(function (root) {
  'use strict';
  const native = Boolean(root.webkit?.messageHandlers?.host);
  const previewKey = 'weekly-note-ios-preview-v1';
  const unavailable = () => ({ authorization: 'unavailable', scheduled: 0, unscheduled: 0 });
  async function invoke(action, payload = {}) {
    if (native) return root.webkit.messageHandlers.host.postMessage({ action, payload });
    if (action === 'loadData') {
      const saved = localStorage.getItem(previewKey);
      return saved ? JSON.parse(saved) : null;
    }
    if (action === 'saveData') {
      try { localStorage.setItem(previewKey, JSON.stringify(payload.state)); return { ok: true }; }
      catch (error) { return { ok: false, error: error.message }; }
    }
    if (action === 'notificationStatus' || action === 'requestNotificationPermission') return unavailable();
    if (action === 'ready') return true;
    return { ok: false, error: '此功能需在 iPhone App 中使用。' };
  }
  root.NoteHost = Object.freeze({ native, invoke });
})(globalThis);
