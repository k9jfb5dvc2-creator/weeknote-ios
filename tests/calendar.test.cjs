const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const core = require('../WeekNote/www/calendar.js');
const { dateKey, parseDate, mondayFor, weekDates, weekOffsetFor, fullDate, formatWeek, normalizeState, mergeStates, undoMergeState } = core;

test('every day through Sunday focuses the correct week instead of rounding forward', () => {
  const reference = new Date('2026-11-02T09:00:00');
  for (const key of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']) {
    assert.equal(weekOffsetFor(key, reference), 0, key);
  }
  assert.equal(weekOffsetFor('2026-11-01', reference), -1);
  assert.equal(weekOffsetFor('2026-11-09', reference), 1);
});

test('weeks crossing a year boundary retain all seven calendar dates and both years', () => {
  const reference = new Date('2027-01-01T23:59:00');
  const dates = weekDates(0, reference);
  assert.deepEqual(dates.map(dateKey), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.equal(formatWeek(dates), '2026.12.28 — 2027.1.3');
  assert.equal(weekOffsetFor('2027-01-03', reference), 0);
  assert.equal(weekOffsetFor('2027-01-04', reference), 1);
  assert.equal(weekOffsetFor('2026-12-27', reference), -1);
  assert.equal(dateKey(mondayFor(-1, reference)), '2026-12-21');
  assert.equal(dateKey(reference), '2027-01-01', 'calendar helpers must not change their reference date');
});

test('leap-day rendering and the complete today label use the actual local calendar', () => {
  assert.equal(dateKey(parseDate('2024-02-29')), '2024-02-29');
  assert.equal(parseDate('2026-02-29'), null);
  assert.equal(parseDate('2026-04-31'), null);
  assert.equal(parseDate('2026-1-2'), null);
  assert.deepEqual(weekDates(0, new Date('2024-02-29T08:00:00')).map(dateKey), ['2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03']);
  assert.equal(fullDate(new Date('2026-11-02T08:00:00')), '2026年11月2日 周一');
  assert.equal(fullDate(new Date('2026-11-08T08:00:00')), '2026年11月8日 周日');
});

test('week navigation remains correct around daylight-saving changes', () => {
  const script = `
    const c = require(process.argv[1]);
    const spring = new Date('2026-03-09T09:00:00');
    const autumn = new Date('2026-11-02T09:00:00');
    process.stdout.write(JSON.stringify([
      c.weekOffsetFor('2026-03-08', spring),
      c.weekOffsetFor('2026-03-15', spring),
      c.weekOffsetFor('2026-11-01', autumn),
      c.weekOffsetFor('2026-11-08', autumn),
      c.weekDates(-1, spring).map(c.dateKey)
    ]));
  `;
  const result = spawnSync(process.execPath, ['-e', script, path.resolve(__dirname, '../WeekNote/www/calendar.js')], {
    encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [-1, 0, -1, 0, ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']]);
});

test('legacy state normalization preserves task and root metadata and rejects duplicate identities', () => {
  const original = {
    customRoot: { theme: 'paper' },
    tasks: { '2026-11-02': [{ id: 'a', text: '旧任务', done: false, reminder: null, custom: 7 }] },
    notes: { '2026-11-02': '旧便签' }
  };
  const normalized = normalizeState(original);
  assert.equal(normalized.tasks['2026-11-02'][0].priority, 'normal');
  assert.equal(normalized.tasks['2026-11-02'][0].custom, 7);
  assert.deepEqual(normalized.customRoot, { theme: 'paper' });
  assert.equal(normalized.notes['2026-11-02'], '旧便签');
  assert.throws(() => normalizeState({ tasks: { '2026-11-02': [original.tasks['2026-11-02'][0]], '2026-11-03': [original.tasks['2026-11-02'][0]] } }));
  assert.throws(() => normalizeState({ tasks: { '2026-02-29': [] } }));
});

test('backup merge preserves existing task edits and both notes without duplicate imports', () => {
  const current = {
    tasks: { '2026-11-02': [{ id: 'a', text: '本机已修改', done: true, reminder: null, priority: 'high' }] },
    notes: { '2026-11-02': '本机便签' }
  };
  const incoming = {
    tasks: {
      '2026-11-03': [
        { id: 'a', text: '旧备份任务', done: false, reminder: '2026-11-03T09:00:00+08:00' },
        { id: 'b', text: '新增任务', done: false, reminder: null }
      ]
    },
    notes: { '2026-11-02': '备份便签', '2026-11-03': '另一日便签' }
  };
  const snapshot = JSON.stringify({ current, incoming });
  const first = mergeStates(current, incoming);
  assert.equal(first.added, 1);
  assert.equal(first.notesAdded, 2);
  assert.equal(first.state.tasks['2026-11-02'][0].text, '本机已修改');
  assert.equal(first.state.tasks['2026-11-02'][0].done, true);
  assert.deepEqual(first.state.tasks['2026-11-03'].map((task) => task.id), ['b']);
  assert.equal(first.state.notes['2026-11-02'], '本机便签\n\n备份便签');
  assert.equal(JSON.stringify({ current, incoming }), snapshot, 'merge must leave both input states intact');
  const second = mergeStates(first.state, incoming);
  assert.equal(second.added, 0);
  assert.equal(second.notesAdded, 0);
  assert.deepEqual(second.state, first.state);
});

test('undoing an import restores only unchanged imported content and preserves later work', () => {
  const before = {
    tasks: { '2026-11-02': [{ id: 'existing', text: '原有任务', done: false, reminder: null }] },
    notes: { '2026-11-02': '本机便签' }
  };
  const merged = mergeStates(before, {
    tasks: { '2026-11-03': [
      { id: 'untouched', text: '未修改的导入任务', done: false, reminder: null },
      { id: 'edited', text: '稍后会编辑', done: false, reminder: null },
      { id: 'moved', text: '稍后会移动', done: false, reminder: null }
    ] },
    notes: { '2026-11-02': '导入便签', '2026-11-03': '未修改的导入便签', '2026-11-04': '稍后会修改的导入便签' }
  }).state;
  const later = JSON.parse(JSON.stringify(merged));
  later.tasks['2026-11-02'][0].done = true;
  later.tasks['2026-11-03'].find((task) => task.id === 'edited').text = '用户已经修改';
  const moved = later.tasks['2026-11-03'].find((task) => task.id === 'moved');
  later.tasks['2026-11-03'] = later.tasks['2026-11-03'].filter((task) => task.id !== 'moved');
  later.tasks['2026-11-04'] = [moved, { id: 'new', text: '用户新建', done: false, reminder: null }];
  later.notes['2026-11-04'] += '\n用户继续写的内容';
  const snapshot = JSON.stringify(later);
  const restored = undoMergeState(later, before, merged);
  assert.equal(restored.tasks['2026-11-02'][0].done, true, 'do not roll back completion of an existing task');
  assert.deepEqual(restored.tasks['2026-11-03'].map((task) => task.id), ['edited']);
  assert.equal(restored.tasks['2026-11-03'][0].text, '用户已经修改');
  assert.deepEqual(restored.tasks['2026-11-04'].map((task) => task.id), ['moved', 'new']);
  assert.equal(restored.notes['2026-11-02'], '本机便签');
  assert.equal(restored.notes['2026-11-03'], undefined);
  assert.equal(restored.notes['2026-11-04'], '稍后会修改的导入便签\n用户继续写的内容');
  assert.equal(JSON.stringify(later), snapshot, 'undo must not mutate its current-state input');
});

test('undoing a note import retains typing performed after the import', () => {
  const before = { tasks: {}, notes: { '2026-11-02': '原有便签' } };
  const merged = mergeStates(before, { tasks: {}, notes: { '2026-11-02': '导入便签' } }).state;
  const later = JSON.parse(JSON.stringify(merged));
  later.notes['2026-11-02'] += '\n刚刚输入的新内容';
  assert.equal(undoMergeState(later, before, merged).notes['2026-11-02'], '原有便签\n\n导入便签\n刚刚输入的新内容');
});
