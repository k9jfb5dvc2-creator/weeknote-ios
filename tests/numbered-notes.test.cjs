const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, insertNewline, toStoredBody, bind } = require('../WeekNote/www/numbered-notes.js');

class FakeTextarea {
  constructor(value = '') {
    this.listeners = new Map();
    this.readOnly = false;
    this.value = value;
  }
  get value() { return this.text; }
  set value(value) { this.text = String(value); this.selectionStart = this.selectionEnd = this.text.length; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  setRangeText(text, start, end, mode) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    if (mode === 'end') this.setSelectionRange(start + text.length, start + text.length);
  }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  fire(name, properties = {}) {
    const event = { key: '', keyCode: 0, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
    for (const callback of this.listeners.get(name) || []) callback(event);
    return event;
  }
}

test('a blank note gets its first number on focus without saving an empty item', () => {
  const textarea = new FakeTextarea();
  const changes = [];
  bind(textarea, (body) => changes.push(body));
  assert.equal(textarea.value, '');
  assert.deepEqual(changes, []);
  textarea.fire('focus');
  assert.equal(textarea.value, '1. ');
  assert.equal(textarea.selectionStart, 3);
  assert.equal(textarea.selectionEnd, 3);
  assert.deepEqual(changes, [], 'decoration alone must not modify persisted data');
  textarea.fire('keydown', { key: 'Enter', keyCode: 13 });
  assert.equal(textarea.value, '1. \n2. ');
  assert.deepEqual(changes, ['']);
  textarea.fire('blur');
  assert.equal(textarea.value, '');
  assert.equal(toStoredBody('1. \n2. \n3.'), '');
});

test('existing list markers are renumbered once and do not accumulate after reopening', () => {
  const original = '1. 第一项\n9. 第二项\n2.';
  const expected = '1. 第一项\n2. 第二项\n3. ';
  assert.equal(normalize(original).value, expected);
  assert.equal(normalize(expected).value, expected);
  const body = toStoredBody(expected);
  assert.equal(body, '第一项\n第二项');
  assert.equal(normalize(body).value, '1. 第一项\n2. 第二项');
  const changes = [];
  const textarea = new FakeTextarea(original);
  bind(textarea, (value) => changes.push(value));
  assert.equal(textarea.value, expected);
  assert.deepEqual(changes, [], 'opening a legacy note must not rewrite its saved body');
});

test('dates, decimals and clock times keep every numeric character', () => {
  const body = '2026.11.2 会议\n3.14记录\n12:30开会\n版本 1.2.3';
  const decorated = normalize(body).value;
  assert.equal(decorated, '1. 2026.11.2 会议\n2. 3.14记录\n3. 12:30开会\n4. 版本 1.2.3');
  assert.equal(toStoredBody(decorated), body);
  assert.equal(toStoredBody(normalize(toStoredBody(decorated)).value), body);
});

test('Enter splits text in the middle and puts the caret after the next number', () => {
  const result = insertNewline('1. 客户方案', '1. 客户'.length);
  assert.equal(result.value, '1. 客户\n2. 方案');
  assert.equal(result.start, '1. 客户\n2. '.length);
  assert.equal(result.end, result.start);
  assert.equal(toStoredBody(result.value), '客户\n方案');
  const selected = '1. 甲乙\n2. 丙丁';
  const replaced = insertNewline(selected, '1. 甲'.length, selected.indexOf('丙') + 1);
  assert.equal(replaced.value, '1. 甲\n2. 丁');
  assert.equal(replaced.start, '1. 甲\n2. '.length);
});

test('renumbering after a whole-line deletion preserves remaining text and caret range', () => {
  const input = '1. 第一项\n3. 第三项';
  const caret = input.indexOf('三') + 1;
  const normalized = normalize(input, caret, caret + 1);
  assert.equal(normalized.value, '1. 第一项\n2. 第三项');
  assert.equal(normalized.value.slice(normalized.start, normalized.end), '项');
  assert.equal(toStoredBody(normalized.value), '第一项\n第三项');
  const expanded = normalize('第一项\n第二项', 1, 5);
  assert.equal(expanded.value[expanded.start], '一');
  assert.equal(expanded.value[expanded.end], '二');
});

test('Backspace and Delete across item boundaries join bodies without deleting their text', () => {
  const changes = [];
  const backspace = new FakeTextarea('甲\n乙');
  bind(backspace, (value) => changes.push(value));
  backspace.setSelectionRange('1. 甲\n2. '.length, '1. 甲\n2. '.length);
  assert.equal(backspace.fire('keydown', { key: 'Backspace' }).defaultPrevented, true);
  assert.equal(backspace.value, '1. 甲乙');
  assert.equal(backspace.selectionStart, '1. 甲'.length);
  assert.equal(changes.at(-1), '甲乙');
  const forward = new FakeTextarea('甲\n乙');
  bind(forward, (value) => changes.push(value));
  forward.setSelectionRange('1. 甲'.length, '1. 甲'.length);
  assert.equal(forward.fire('keydown', { key: 'Delete' }).defaultPrevented, true);
  assert.equal(forward.value, '1. 甲乙');
  assert.equal(forward.selectionStart, '1. 甲'.length);
  assert.equal(changes.at(-1), '甲乙');
});

test('pasting multiple numbered lines into a blank item reuses its number and saves all bodies', () => {
  const textarea = new FakeTextarea();
  const changes = [];
  bind(textarea, (value) => changes.push(value));
  textarea.fire('focus');
  const event = textarea.fire('paste', { clipboardData: { getData: () => '1. 客户方案\r\n2. 会议\r\n3. 12:30开会' } });
  assert.equal(event.defaultPrevented, true);
  assert.equal(textarea.value, '1. 客户方案\n2. 会议\n3. 12:30开会');
  assert.equal(textarea.selectionStart, textarea.value.length);
  assert.equal(textarea.selectionEnd, textarea.value.length);
  assert.equal(changes.at(-1), '客户方案\n会议\n12:30开会');
});

test('plain multiline paste replaces only the selected text and leaves both surrounding sides intact', () => {
  const textarea = new FakeTextarea('甲乙丙丁');
  const changes = [];
  bind(textarea, (value) => changes.push(value));
  textarea.setSelectionRange(textarea.value.indexOf('乙'), textarea.value.indexOf('丁'));
  textarea.fire('paste', { clipboardData: { getData: () => '中\n间' } });
  assert.equal(textarea.value, '1. 甲中\n2. 间丁');
  assert.equal(textarea.selectionStart, '1. 甲中\n2. 间'.length);
  assert.equal(changes.at(-1), '甲中\n间丁');
});

test('IME confirmation Enter and composition input do not create a numbered line', () => {
  const textarea = new FakeTextarea();
  const changes = [];
  bind(textarea, (value) => changes.push(value));
  textarea.fire('focus');
  textarea.fire('compositionstart');
  textarea.value = '1. 中文';
  textarea.fire('input', { isComposing: true });
  const confirm = textarea.fire('keydown', { key: 'Enter', keyCode: 13 });
  assert.equal(confirm.defaultPrevented, false);
  assert.equal(textarea.value, '1. 中文');
  assert.deepEqual(changes, []);
  textarea.fire('compositionend');
  assert.deepEqual(changes, ['中文']);
  assert.equal(textarea.fire('keydown', { key: 'Enter', isComposing: true }).defaultPrevented, false);
  assert.equal(textarea.fire('keydown', { key: 'Enter', keyCode: 229 }).defaultPrevented, false);
  assert.equal(textarea.value, '1. 中文');
  textarea.fire('keydown', { key: 'Enter', keyCode: 13 });
  assert.equal(textarea.value, '1. 中文\n2. ');
  assert.equal(changes.at(-1), '中文', 'the trailing empty item must not be stored');
});

test('Shift+Enter creates an unnumbered continuation and Ctrl+Enter creates no extra item', () => {
  const textarea = new FakeTextarea('第一项');
  const changes = [];
  bind(textarea, (value) => changes.push(value));
  textarea.fire('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(textarea.value, '1. 第一项\n   ');
  textarea.value += '同一项续行';
  textarea.fire('input');
  textarea.fire('keydown', { key: 'Enter' });
  assert.equal(textarea.value, '1. 第一项\n   同一项续行\n2. ');
  assert.equal(changes.at(-1), '第一项\n   同一项续行');
  const previous = textarea.value;
  const shortcut = textarea.fire('keydown', { key: 'Enter', ctrlKey: true });
  assert.equal(shortcut.defaultPrevented, true);
  assert.equal(textarea.value, previous);
  assert.equal(normalize(toStoredBody(textarea.value)).value, '1. 第一项\n   同一项续行');
});

test('read-only notes never mutate and disposing the binding removes its event handlers', () => {
  const textarea = new FakeTextarea('第一项');
  const changes = [];
  const dispose = bind(textarea, (value) => changes.push(value));
  textarea.readOnly = true;
  assert.equal(textarea.fire('keydown', { key: 'Enter' }).defaultPrevented, false);
  textarea.fire('input');
  assert.equal(textarea.value, '1. 第一项');
  assert.deepEqual(changes, []);
  dispose();
  textarea.readOnly = false;
  textarea.fire('keydown', { key: 'Enter' });
  assert.equal(textarea.value, '1. 第一项');
  assert.ok([...textarea.listeners.values()].every((listeners) => listeners.size === 0));
});

test('typing inside an automatic marker moves to the body without collapsing a real selection', () => {
  const textarea = new FakeTextarea('甲\n乙');
  const changes = [];
  bind(textarea, (value) => changes.push(value));
  textarea.setSelectionRange(0, 0);
  textarea.fire('click');
  assert.equal(textarea.selectionStart, '1. '.length);
  const secondStart = textarea.value.indexOf('2.');
  textarea.setSelectionRange(secondStart + 1, secondStart + 1);
  textarea.fire('beforeinput', { inputType: 'insertText' });
  assert.equal(textarea.selectionStart, secondStart + '2. '.length);
  textarea.setSelectionRange(0, textarea.value.length);
  textarea.fire('beforeinput', { inputType: 'insertText' });
  assert.equal(textarea.selectionStart, 0);
  assert.equal(textarea.selectionEnd, textarea.value.length);
  assert.deepEqual(changes, [], 'caret correction must not write note data');
});

test('iOS software-keyboard beforeinput adds exactly one item without a keydown event', () => {
  const textarea = new FakeTextarea('甲乙');
  textarea.onbeforeinput = null;
  const changes = [];
  bind(textarea, (body) => changes.push(body));
  textarea.setSelectionRange('1. 甲'.length, '1. 甲'.length);
  const before = textarea.fire('beforeinput', { inputType: 'insertParagraph', cancelable: true });
  assert.equal(before.defaultPrevented, true);
  assert.equal(textarea.value, '1. 甲\n2. 乙');
  assert.equal(textarea.selectionStart, '1. 甲\n2. '.length);
  assert.deepEqual(changes, ['甲\n乙']);
});

test('a hardware keydown plus iOS beforeinput does not insert the newline twice', () => {
  const textarea = new FakeTextarea('第一项');
  textarea.onbeforeinput = null;
  const changes = [];
  bind(textarea, (body) => changes.push(body));
  const keydown = textarea.fire('keydown', { key: 'Enter', keyCode: 13 });
  assert.equal(keydown.defaultPrevented, false);
  assert.equal(textarea.value, '1. 第一项');
  textarea.fire('beforeinput', { inputType: 'insertLineBreak', cancelable: true });
  assert.equal(textarea.value, '1. 第一项\n2. ');
  assert.equal(changes.length, 1);
  assert.equal(changes[0], '第一项');
});

test('noncancelable iOS line-break events preserve both sides and repair numbering on input', () => {
  const textarea = new FakeTextarea('甲乙');
  textarea.onbeforeinput = null;
  const changes = [];
  bind(textarea, (body) => changes.push(body));
  const caret = '1. 甲'.length;
  textarea.setSelectionRange(caret, caret);
  const before = textarea.fire('beforeinput', { inputType: 'insertParagraph', cancelable: false });
  assert.equal(before.defaultPrevented, false);
  assert.deepEqual(changes, []);
  textarea.value = '1. 甲\n乙';
  textarea.setSelectionRange(caret + 1, caret + 1);
  textarea.fire('input', { inputType: 'insertParagraph' });
  assert.equal(textarea.value, '1. 甲\n2. 乙');
  assert.equal(textarea.selectionStart, '1. 甲\n2. '.length);
  assert.deepEqual(changes, ['甲\n乙']);
});

test('iOS composition beforeinput is ignored until confirmed and Shift+Enter keeps a continuation', () => {
  const textarea = new FakeTextarea('中文');
  textarea.onbeforeinput = null;
  const changes = [];
  bind(textarea, (body) => changes.push(body));
  textarea.fire('compositionstart');
  const ime = textarea.fire('beforeinput', { inputType: 'insertParagraph', cancelable: true });
  assert.equal(ime.defaultPrevented, false);
  assert.equal(textarea.value, '1. 中文');
  assert.deepEqual(changes, []);
  textarea.fire('compositionend');
  textarea.fire('keydown', { key: 'Enter', shiftKey: true });
  textarea.fire('beforeinput', { inputType: 'insertLineBreak', cancelable: true });
  assert.equal(textarea.value, '1. 中文\n   ');
  assert.equal(changes.at(-1), '中文');
});
