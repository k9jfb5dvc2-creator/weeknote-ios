(function (root) {
  'use strict';
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  function parseDate(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return null;
    const date = new Date(`${key}T12:00:00`);
    return Number.isFinite(date.getTime()) && dateKey(date) === key ? date : null;
  }
  function mondayFor(offset = 0, reference = new Date()) {
    const result = new Date(reference); result.setHours(12, 0, 0, 0);
    result.setDate(result.getDate() - ((result.getDay() + 6) % 7) + offset * 7); return result;
  }
  function weekDates(offset = 0, reference = new Date()) {
    const monday = mondayFor(offset, reference);
    return Array.from({ length: 7 }, (_, i) => { const date = new Date(monday); date.setDate(date.getDate() + i); return date; });
  }
  function weekOffsetFor(key, reference = new Date()) {
    const target = parseDate(key); if (!target) return 0;
    const first = mondayFor(0, target), current = mondayFor(0, reference);
    return Math.round((Date.UTC(first.getFullYear(), first.getMonth(), first.getDate()) - Date.UTC(current.getFullYear(), current.getMonth(), current.getDate())) / 604800000);
  }
  function fullDate(date) { return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[(date.getDay() + 6) % 7]}`; }
  function formatWeek(dates) {
    const [first, last] = [dates[0], dates[6]], left = `${first.getFullYear()}.${first.getMonth() + 1}.${first.getDate()}`;
    const right = first.getFullYear() === last.getFullYear() ? `${last.getMonth() + 1}.${last.getDate()}` : `${last.getFullYear()}.${last.getMonth() + 1}.${last.getDate()}`;
    return `${left} — ${right}`;
  }
  function normalizeState(saved) {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !saved.tasks || typeof saved.tasks !== 'object' || Array.isArray(saved.tasks)) throw new Error('任务数据格式不正确');
    const tasks = {}, ids = new Set();
    for (const [key, items] of Object.entries(saved.tasks)) {
      if (!parseDate(key) || !Array.isArray(items)) throw new Error('任务日期或列表格式不正确');
      tasks[key] = items.map(task => {
        if (!task || typeof task !== 'object' || typeof task.id !== 'string' || !task.id || typeof task.text !== 'string' || ids.has(task.id)) throw new Error('任务内容或编号不正确');
        ids.add(task.id);
        if (task.reminder != null && !Number.isFinite(new Date(task.reminder).getTime())) throw new Error('提醒时间格式不正确');
        return { ...task, done: Boolean(task.done), reminder: task.reminder || null, priority: task.priority === 'high' ? 'high' : 'normal' };
      });
    }
    const notes = {};
    for (const [key, value] of Object.entries(saved.notes || {})) {
      if (!parseDate(key) || typeof value !== 'string') throw new Error('便签内容格式不正确'); notes[key] = value;
    }
    return { ...saved, tasks, notes };
  }
  function mergeStates(current, incoming) {
    const result = normalizeState(JSON.parse(JSON.stringify(current))), source = normalizeState(incoming);
    const ids = new Set(Object.values(result.tasks).flat().map(task => task.id)); let added = 0;
    for (const [key, tasks] of Object.entries(source.tasks)) for (const task of tasks) if (!ids.has(task.id)) { (result.tasks[key] ||= []).push(task); ids.add(task.id); added++; }
    let notesAdded = 0;
    for (const [key, value] of Object.entries(source.notes)) {
      if (!value.trim()) continue;
      if (!result.notes[key]) { result.notes[key] = value; notesAdded++; }
      else if (result.notes[key] !== value && !result.notes[key].includes(value)) { result.notes[key] += `\n\n${value}`; notesAdded++; }
    }
    return { state: result, added, notesAdded };
  }
  function undoMergeState(current, before, merged) {
    const result = normalizeState(JSON.parse(JSON.stringify(current)));
    const original = normalizeState(before), imported = normalizeState(merged);
    const originalIds = new Set(Object.values(original.tasks).flat().map(task => task.id));
    const importedTasks = new Map();
    for (const [key, tasks] of Object.entries(imported.tasks)) for (const task of tasks) if (!originalIds.has(task.id)) importedTasks.set(task.id, { key, task });
    for (const [key, tasks] of Object.entries(result.tasks)) {
      result.tasks[key] = tasks.filter(task => {
        const added = importedTasks.get(task.id);
        // Keep any imported task the user has since moved, edited or completed.
        return !added || added.key !== key || JSON.stringify(added.task) !== JSON.stringify(task);
      });
      if (!result.tasks[key].length) delete result.tasks[key];
    }
    for (const [key, note] of Object.entries(imported.notes)) {
      if (note !== original.notes[key] && result.notes[key] === note) {
        if (Object.prototype.hasOwnProperty.call(original.notes, key)) result.notes[key] = original.notes[key];
        else delete result.notes[key];
      }
    }
    return result;
  }
  const api = { weekdays, dateKey, parseDate, mondayFor, weekDates, weekOffsetFor, fullDate, formatWeek, normalizeState, mergeStates, undoMergeState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NoteCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
