const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../WeekNote/www/native.js'), 'utf8');
function environment(nativeHandler, initial = {}) {
  const storage = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value))
  };
  const context = { localStorage };
  if (nativeHandler) context.webkit = { messageHandlers: { host: { postMessage: nativeHandler } } };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'native.js' });
  return { host: context.NoteHost, storage };
}
const serial = (value) => JSON.parse(JSON.stringify(value));

test('the iPhone bridge sends the selected action and payload through the native reply channel', async () => {
  const messages = [];
  const env = environment(async (message) => { messages.push(serial(message)); return { ok: true }; });
  assert.equal(env.host.native, true);
  assert.equal(Object.isFrozen(env.host), true);
  const state = { tasks: {}, notes: { '2026-11-02': '中文便签' } };
  assert.deepEqual(await env.host.invoke('saveData', { state }), { ok: true });
  await env.host.invoke('ready');
  assert.deepEqual(messages, [{ action: 'saveData', payload: { state } }, { action: 'ready', payload: {} }]);
  assert.equal(env.storage.size, 0, 'native mode must not secretly save a second copy in preview storage');
});

test('native read failure rejects rather than pretending the data store is empty', async () => {
  const env = environment(async () => { throw new Error('本机数据损坏'); });
  await assert.rejects(env.host.invoke('loadData'), /本机数据损坏/);
  assert.equal(env.storage.size, 0);
});

test('browser preview persists only its own namespace and never claims system notifications', async () => {
  const env = environment(null, { 'weekly-sticky-note-v1': 'unrelated Windows data' });
  assert.equal(env.host.native, false);
  assert.equal(await env.host.invoke('loadData'), null);
  const state = { tasks: {}, notes: { '2026-11-02': '草稿' } };
  assert.deepEqual(serial(await env.host.invoke('saveData', { state })), { ok: true });
  assert.deepEqual(serial(await env.host.invoke('loadData')), state);
  assert.equal(env.storage.get('weekly-sticky-note-v1'), 'unrelated Windows data');
  const status = serial(await env.host.invoke('requestNotificationPermission'));
  assert.equal(status.authorization, 'unavailable');
  assert.equal(status.scheduled, 0);
  assert.equal(serial(await env.host.invoke('exportData')).ok, false);
});

test('corrupt preview data remains intact and reports a read error', async () => {
  const env = environment(null, { 'weekly-note-ios-preview-v1': '{broken' });
  await assert.rejects(env.host.invoke('loadData'));
  assert.equal(env.storage.get('weekly-note-ios-preview-v1'), '{broken');
});
