(function (root) {
  'use strict';

  // A decimal or date such as 3.14 / 2026.11.2 is content, not a list marker.
  const marker = /^[\t ]*\d+[.．、)](?:[\t ]+|(?=[^\d\t ])|$)/;
  const prefixFor = line => line.match(marker)?.[0] || '';
  const continuation = line => !prefixFor(line) && /^(?: {3,}|\t)/.test(line);
  const clamp = (value, length) => Math.max(0, Math.min(length, Number.isFinite(value) ? value : length));

  function normalize(value, start = String(value).length, end = start) {
    const source = String(value).replace(/\r\n?/g, '\n');
    start = clamp(start, source.length); end = clamp(end, source.length);
    let oldOffset = 0, newOffset = 0, number = 0;
    const segments = [];
    const lines = source.split('\n').map(line => {
      const oldPrefix = prefixFor(line);
      const isContinuation = continuation(line);
      const newPrefix = isContinuation ? '' : `${++number}. `;
      const body = isContinuation ? line : line.slice(oldPrefix.length);
      const nextLine = newPrefix + body;
      segments.push({ oldOffset, newOffset, oldLength: line.length, oldPrefix: oldPrefix.length, newPrefix: newPrefix.length, bodyLength: body.length });
      oldOffset += line.length + 1; newOffset += nextLine.length + 1;
      return nextLine;
    });
    const text = lines.join('\n');
    function mapPosition(position) {
      const segment = segments.find(part => position <= part.oldOffset + part.oldLength);
      if (!segment) return text.length;
      const bodyPosition = Math.max(0, Math.min(segment.bodyLength, position - segment.oldOffset - segment.oldPrefix));
      return segment.newOffset + segment.newPrefix + bodyPosition;
    }
    return { value: text, start: mapPosition(start), end: mapPosition(end) };
  }

  function toStoredBody(value) {
    const lines = String(value).replace(/\r\n?/g, '\n').split('\n').map(line => line.slice(prefixFor(line).length));
    // A new, empty final item is editing UI, not a saved note of its own.
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.some(line => line.trim()) ? lines.join('\n') : '';
  }

  function insertNewline(value, start, end = start, options = {}) {
    const current = normalize(value, start, end);
    const insert = options.plain ? '\n   ' : '\n';
    const next = current.value.slice(0, current.start) + insert + current.value.slice(current.end);
    return normalize(next, current.start + insert.length);
  }

  function bind(textarea, onChange) {
    let composing = false;
    let plainBreak = false;
    let pendingNativeBreak = null;
    const beforeInputSupported = 'onbeforeinput' in textarea;
    const listeners = [];
    const listen = (name, callback) => { textarea.addEventListener(name, callback); listeners.push([name, callback]); };
    function apply(result) {
      textarea.value = result.value;
      textarea.setSelectionRange(result.start, result.end);
    }
    function commit() {
      if (textarea.readOnly) return;
      apply(normalize(textarea.value, textarea.selectionStart, textarea.selectionEnd));
      onChange(toStoredBody(textarea.value));
    }
    // Decoration is deliberately separate from saving. Opening an old note does
    // not rewrite it, and the persisted notes remain ordinary text strings.
    textarea.value = toStoredBody(textarea.value) ? normalize(textarea.value).value : '';
    textarea.title = '回车添加下一项 · Shift + 回车在同一项内换行';
    listen('focus', () => {
      if (!textarea.readOnly && !toStoredBody(textarea.value)) {
        textarea.value = '1. '; textarea.setSelectionRange(3, 3);
      }
    });
    function keepCaretAfterMarker() {
      if (textarea.readOnly || textarea.selectionStart !== textarea.selectionEnd) return;
      const caret = textarea.selectionStart;
      const start = textarea.value.lastIndexOf('\n', caret - 1) + 1;
      const end = textarea.value.indexOf('\n', start);
      const prefix = prefixFor(textarea.value.slice(start, end === -1 ? textarea.value.length : end));
      if (prefix && caret < start + prefix.length) textarea.setSelectionRange(start + prefix.length, start + prefix.length);
    }
    // A mouse click or Home key may land inside the generated number; typing
    // should still start in the item's content rather than before its marker.
    listen('click', keepCaretAfterMarker);
    listen('beforeinput', event => {
      if (textarea.readOnly || composing || event.isComposing) return;
      if (['insertParagraph', 'insertLineBreak'].includes(event.inputType)) {
        const change = { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd, plain: plainBreak };
        plainBreak = false;
        if (event.cancelable) {
          event.preventDefault();
          apply(insertNewline(change.value, change.start, change.end, { plain: change.plain }));
          onChange(toStoredBody(textarea.value));
        } else pendingNativeBreak = change;
        return;
      }
      if (/^insert/.test(event.inputType || '')) keepCaretAfterMarker();
    });
    listen('compositionstart', () => { keepCaretAfterMarker(); composing = true; });
    listen('compositionend', () => { composing = false; commit(); });
    listen('input', event => {
      if (composing || event.isComposing) return;
      if (pendingNativeBreak) {
        const change = pendingNativeBreak; pendingNativeBreak = null;
        apply(insertNewline(change.value, change.start, change.end, { plain: change.plain }));
        onChange(toStoredBody(textarea.value));
      } else commit();
    });
    listen('keydown', event => {
      if (textarea.readOnly || composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') {
        // Keep app shortcuts available without inserting another numbered item.
        if (event.ctrlKey || event.metaKey || event.altKey) { event.preventDefault(); return; }
        // Software keyboards may only send beforeinput. Let that be the single
        // insertion path when supported, avoiding a keydown + beforeinput pair.
        if (beforeInputSupported) { plainBreak = Boolean(event.shiftKey); return; }
        event.preventDefault();
        apply(insertNewline(textarea.value, textarea.selectionStart, textarea.selectionEnd, { plain: event.shiftKey }));
        onChange(toStoredBody(textarea.value)); return;
      }
      if (!['Backspace', 'Delete'].includes(event.key) || textarea.selectionStart !== textarea.selectionEnd || event.ctrlKey || event.metaKey || event.altKey) return;
      const caret = textarea.selectionStart;
      const lineStart = textarea.value.lastIndexOf('\n', caret - 1) + 1;
      const foundEnd = textarea.value.indexOf('\n', caret);
      const lineEnd = foundEnd === -1 ? textarea.value.length : foundEnd;
      const prefix = prefixFor(textarea.value.slice(lineStart, lineEnd));
      const bodyStart = lineStart + prefix.length;
      if (event.key === 'Backspace' && prefix && caret <= bodyStart) {
        event.preventDefault();
        if (!lineStart) { textarea.setSelectionRange(bodyStart, bodyStart); return; }
        const next = textarea.value.slice(0, lineStart - 1) + textarea.value.slice(bodyStart);
        apply(normalize(next, lineStart - 1)); onChange(toStoredBody(textarea.value));
      } else if (event.key === 'Delete' && prefix && caret < bodyStart) {
        event.preventDefault(); textarea.setSelectionRange(bodyStart, bodyStart);
      } else if (event.key === 'Delete' && caret === lineEnd && foundEnd !== -1) {
        event.preventDefault();
        const nextEnd = textarea.value.indexOf('\n', lineEnd + 1);
        const nextLine = textarea.value.slice(lineEnd + 1, nextEnd === -1 ? textarea.value.length : nextEnd);
        const next = textarea.value.slice(0, lineEnd) + textarea.value.slice(lineEnd + 1 + prefixFor(nextLine).length);
        apply(normalize(next, lineEnd)); onChange(toStoredBody(textarea.value));
      }
    });
    listen('paste', event => {
      if (textarea.readOnly || composing) return;
      const text = event.clipboardData?.getData('text/plain');
      if (text === undefined) return;
      event.preventDefault();
      let inserted = text.replace(/\r\n?/g, '\n');
      const start = textarea.selectionStart;
      const lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = textarea.value.indexOf('\n', textarea.selectionEnd);
      const currentLine = textarea.value.slice(lineStart, lineEnd === -1 ? textarea.value.length : lineEnd);
      const currentPrefix = prefixFor(currentLine);
      // Pasting "1. …" into the blank "1. |" item reuses its marker.
      if (currentPrefix && start === lineStart + currentPrefix.length &&
          !textarea.value.slice(textarea.selectionEnd, lineEnd === -1 ? textarea.value.length : lineEnd).trim()) {
        inserted = inserted.slice(prefixFor(inserted.split('\n')[0]).length);
      }
      textarea.setRangeText(inserted, start, textarea.selectionEnd, 'end');
      apply(normalize(textarea.value, start + inserted.length));
      onChange(toStoredBody(textarea.value));
    });
    listen('blur', () => {
      if (composing) return;
      const body = toStoredBody(textarea.value);
      // Remove the temporary empty final number after leaving the writing area.
      textarea.value = body ? normalize(body).value : '';
    });
    return () => { for (const [name, callback] of listeners) textarea.removeEventListener(name, callback); };
  }

  const api = { normalize, insertNewline, toStoredBody, bind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoteNumberedNotes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
