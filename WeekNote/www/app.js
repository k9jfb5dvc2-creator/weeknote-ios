(function () {
  'use strict';
  const { weekdays, dateKey, parseDate, weekDates, weekOffsetFor, fullDate, formatWeek, normalizeState, mergeStates, undoMergeState } = window.NoteCore;
  const host = window.NoteHost;
  const numbers = window.NoteNumberedNotes;
  const $ = selector => document.querySelector(selector);
  const clone = value => JSON.parse(JSON.stringify(value));
  let state = { tasks: {}, notes: {} }, ready = false;
  let selectedDate = dateKey(new Date()), currentDay = selectedDate, weekOffset = 0;
  let activeScreen = 'week', filter = 'all', search = '', editingId = null;
  let pendingSave = false, savePromise = null, saveError = null, lastPersistedState = null;
  let toastTimer, undoAction = null, unbindNote = null;
  let notificationState = { authorization: 'unknown', scheduled: 0, unscheduled: 0 };
  let permissionRequest = false, queuedFocus = null, resumePromise = null;
  let viewportBaseline = window.innerHeight;
  const el = {
    tabs: $('#dayTabs'), taskList: $('#taskList'), note: $('#dayNote'), dialog: $('#taskDialog'), form: $('#taskForm'),
    text: $('#editText'), date: $('#editDate'), time: $('#editTime'), priority: $('#editPriority'),
    toast: $('#toast'), save: $('#saveState'), content: $('#mainContent'), results: $('#searchResults')
  };

  function allTasks() { return Object.entries(state.tasks).flatMap(([date, tasks]) => tasks.map(task => ({ ...task, date }))); }
  function findTask(id, source = state) {
    for (const [date, tasks] of Object.entries(source.tasks)) { const task = tasks.find(item => item.id === id); if (task) return { task, date }; }
    return null;
  }
  function saveStatus(message, error = false) { el.save.textContent = message; el.save.classList.toggle('error', error); }
  function requestSave() {
    if (!ready) return Promise.resolve(false);
    pendingSave = true; saveStatus('正在保存…');
    if (!savePromise) savePromise = drainSaves();
    return savePromise;
  }
  async function drainSaves() {
    await Promise.resolve();
    while (pendingSave) {
      pendingSave = false;
      const snapshot = clone(state);
      try {
        const result = await host.invoke('saveData', { state: snapshot });
        if (!result?.ok) throw new Error(result?.error || '数据未能保存');
        lastPersistedState = snapshot; saveError = null; saveStatus(host.native ? '已保存在这台 iPhone' : '预览数据已保存在此浏览器');
      } catch (error) {
        saveError = error.message || String(error); saveStatus('保存失败，轻点重试', true);
        showToast(`保存失败：${saveError}`, null, 12000);
      }
    }
    savePromise = null;
    if (activeScreen !== 'week') refreshNotificationStatus();
    return !saveError;
  }
  async function flushSaves() { if (saveError) requestSave(); while (savePromise) await savePromise; return !saveError; }
  function showToast(message, undo = null, delay = 6000) {
    $('#toastMessage').textContent = message; undoAction = undo; $('#undoButton').hidden = !undo;
    el.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, delay);
  }
  function hideToast() { el.toast.classList.remove('show'); undoAction = null; $('#undoButton').hidden = true; }
  function matches(task) {
    if (filter === 'open' && task.done || filter === 'done' && !task.done || filter === 'high' && task.priority !== 'high') return false;
    return !search || task.text.toLocaleLowerCase().includes(search);
  }
  function clock() {
    const today = new Date(); $('#todayDate').dateTime = dateKey(today); $('#todayDate').textContent = fullDate(today);
    if (dateKey(today) !== currentDay) {
      currentDay = dateKey(today);
      if (weekOffset === 0) selectedDate = currentDay;
      if (ready && !el.dialog.open && document.activeElement !== el.note) renderWeek();
    }
  }
  function renderWeek() {
    const dates = weekDates(weekOffset), keys = dates.map(dateKey);
    if (!keys.includes(selectedDate)) selectedDate = keys.includes(currentDay) ? currentDay : keys[0];
    $('#thisWeek').textContent = formatWeek(dates);
    el.tabs.replaceChildren();
    dates.forEach((date, i) => {
      const key = dateKey(date), button = document.createElement('button'); button.className = 'day-tab';
      button.dataset.date = key; button.classList.toggle('selected', key === selectedDate); button.classList.toggle('is-today', key === currentDay);
      button.classList.toggle('has-tasks', (state.tasks[key] || []).some(task => !task.done));
      button.setAttribute('aria-label', fullDate(date)); button.setAttribute('aria-current', key === selectedDate ? 'date' : 'false');
      const weekday = document.createElement('span'); weekday.textContent = weekdays[i];
      const number = document.createElement('strong'); number.textContent = date.getDate();
      button.append(weekday, number, document.createElement('i'));
      button.addEventListener('click', () => { selectedDate = key; renderWeek(); el.content.scrollTo({ top: 0 }); });
      el.tabs.append(button);
    });
    renderTasks(); renderNote(); renderSearch();
  }
  function updateProgress() {
    const tasks = weekDates(weekOffset).map(dateKey).flatMap(key => state.tasks[key] || []);
    $('#weekProgress').textContent = `本周 ${tasks.filter(task => task.done).length}/${tasks.length}`;
  }
  function renderTasks() {
    const date = parseDate(selectedDate);
    $('#selectedDate').textContent = `${date.getMonth() + 1}月${date.getDate()}日 · ${weekdays[(date.getDay() + 6) % 7]}${selectedDate === currentDay ? ' · 今天' : ''}`;
    updateProgress(); el.taskList.replaceChildren();
    const tasks = (state.tasks[selectedDate] || []).filter(matches);
    tasks.forEach(task => el.taskList.append(taskCard(task)));
    if (!tasks.length) {
      const empty = document.createElement('div'); empty.className = 'empty-tasks';
      if ((state.tasks[selectedDate] || []).length) empty.textContent = '没有符合筛选的任务。';
      else { empty.append('这一天还没有任务。'); const add = document.createElement('button'); add.textContent = '记下一件事'; add.addEventListener('click', () => openTask()); empty.append(add); }
      el.taskList.append(empty);
    }
  }
  function renderNote() {
    unbindNote?.(); unbindNote = null;
    const noteDate = selectedDate;
    el.note.value = state.notes[noteDate] || ''; el.note.readOnly = !ready;
    el.note.setAttribute('aria-label', `${fullDate(parseDate(noteDate))}的自动编号便签`);
    unbindNote = numbers.bind(el.note, body => {
      if (body) state.notes[noteDate] = body; else delete state.notes[noteDate];
      requestSave(); sizeNote();
    });
    sizeNote();
  }
  function sizeNote() { el.note.style.height = 'auto'; el.note.style.height = `${Math.max(250, el.note.scrollHeight)}px`; }
  function taskCard(task) {
    const card = $('#taskTemplate').content.firstElementChild.cloneNode(true); card.dataset.id = task.id;
    card.classList.toggle('done', task.done);
    const check = card.querySelector('.check'); check.setAttribute('aria-pressed', String(task.done));
    check.setAttribute('aria-label', `${task.done ? '恢复任务' : '完成任务'}：${task.text}`); check.firstElementChild.textContent = task.done ? '✓' : '';
    check.addEventListener('click', () => { const found = findTask(task.id); if (!found) return; found.task.done = !found.task.done; requestSave(); refreshTaskViews(); });
    const text = card.querySelector('.task-text'); text.textContent = task.text; text.setAttribute('aria-label', `编辑任务：${task.text}`); text.addEventListener('click', () => openTask(task.id));
    card.querySelector('.priority-tag').hidden = task.priority !== 'high';
    const time = card.querySelector('.task-time');
    if (task.reminder) {
      const date = new Date(task.reminder), overdue = !task.done && date.getTime() <= Date.now();
      time.textContent = `${overdue ? '已到时 · ' : ''}${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
      time.classList.toggle('overdue', overdue); time.setAttribute('aria-label', `编辑提醒：${fullDate(date)} ${time.textContent}`);
    } else { time.textContent = '＋ 设置提醒'; time.setAttribute('aria-label', '为任务设置提醒'); }
    time.addEventListener('click', () => openTask(task.id));
    card.querySelector('.delete-task').addEventListener('click', () => deleteTask(task.id));
    return card;
  }
  function refreshTaskViews() { renderTasks(); renderSearch(); renderReminders(); }
  function deleteTask(id) {
    const found = findTask(id); if (!found) return;
    const snapshot = clone(found.task), index = state.tasks[found.date].findIndex(task => task.id === id);
    state.tasks[found.date].splice(index, 1); if (!state.tasks[found.date].length) delete state.tasks[found.date];
    requestSave(); refreshTaskViews();
    showToast('任务已删除', () => {
      if (!findTask(id)) { const list = state.tasks[found.date] ||= []; list.splice(Math.min(index, list.length), 0, snapshot); requestSave(); refreshTaskViews(); showToast('已恢复任务'); }
    }, 12000);
  }
  function renderSearch() {
    $('#dayContent').hidden = Boolean(search); el.results.hidden = !search;
    el.results.replaceChildren(); if (!search) return;
    const tasks = allTasks().filter(matches).sort((a, b) => a.date.localeCompare(b.date));
    const notes = Object.entries(state.notes).filter(([, text]) => text.toLocaleLowerCase().includes(search));
    const heading = document.createElement('h2'); heading.textContent = `全部日期 · ${tasks.length} 个任务${notes.length ? `，${notes.length} 条便签` : ''}`; el.results.append(heading);
    tasks.forEach(task => {
      const group = document.createElement('div'); group.className = 'search-result';
      const date = document.createElement('button'); date.className = 'result-date'; date.textContent = fullDate(parseDate(task.date)); date.addEventListener('click', () => focusTask(task.id));
      group.append(date, taskCard(task)); el.results.append(group);
    });
    notes.forEach(([date, note]) => {
      const button = document.createElement('button'); button.className = 'note-result';
      const title = document.createElement('strong'); title.textContent = `${fullDate(parseDate(date))} · 随手记`;
      const content = document.createElement('span'); content.textContent = numbers.normalize(note).value;
      button.append(title, content); button.addEventListener('click', () => { clearSearch(); selectedDate = date; weekOffset = weekOffsetFor(date); renderWeek(); el.note.focus(); }); el.results.append(button);
    });
    if (!tasks.length && !notes.length) { const empty = document.createElement('p'); empty.className = 'search-empty'; empty.textContent = '没有找到。换个关键词，或调整任务筛选。'; el.results.append(empty); }
  }
  function clearSearch() { search = ''; $('#searchInput').value = ''; }
  function renderReminders() {
    const list = $('#reminderList'); list.replaceChildren();
    const reminders = allTasks().filter(task => task.reminder && !task.done).sort((a, b) => new Date(a.reminder) - new Date(b.reminder));
    if (!reminders.length) {
      const empty = document.createElement('div'); empty.className = 'empty-reminders';
      const sign = document.createElement('span'); sign.textContent = '◷'; const copy = document.createElement('div'); copy.textContent = '还没有时间提醒';
      const hint = document.createElement('div'); hint.textContent = '新建或编辑任务，选择一个时间。'; empty.append(sign, copy, hint); list.append(empty); return;
    }
    reminders.forEach(task => {
      const date = new Date(task.reminder), overdue = date.getTime() <= Date.now();
      const item = document.createElement('button'); item.className = 'reminder-item'; item.dataset.id = task.id; item.classList.toggle('overdue', overdue);
      const time = document.createElement('span'); time.className = 'reminder-clock'; time.textContent = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      const content = document.createElement('span'); content.className = 'reminder-copy';
      const text = document.createElement('strong'); text.textContent = task.text;
      const day = document.createElement('small'); day.textContent = `${fullDate(date)}${overdue ? ' · 已到时' : ''}`;
      content.append(text, day); item.append(time, content); item.addEventListener('click', () => focusTask(task.id)); list.append(item);
    });
  }
  function showScreen(screen) {
    if (!['week', 'reminder', 'settings'].includes(screen)) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    activeScreen = screen;
    for (const name of ['week', 'reminder', 'settings']) {
      $(`#${name}Screen`).hidden = name !== screen;
      $(`#${name}Tab`).classList.toggle('active', name === screen);
      if (name === screen) $(`#${name}Tab`).setAttribute('aria-current', 'page'); else $(`#${name}Tab`).removeAttribute('aria-current');
    }
    el.content.scrollTo({ top: 0 });
    if (screen === 'week') requestAnimationFrame(sizeNote);
    if (screen === 'reminder') renderReminders();
    if (screen !== 'week') refreshNotificationStatus();
  }
  function focusTask(id) {
    if (!ready) { queuedFocus = id; return; }
    const found = findTask(id); if (!found) return;
    clearSearch(); filter = 'all'; $('#filterSelect').value = 'all'; selectedDate = found.date; weekOffset = weekOffsetFor(found.date);
    showScreen('week'); renderWeek();
    requestAnimationFrame(() => {
      const card = [...el.taskList.querySelectorAll('.task-card')].find(node => node.dataset.id === id);
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); card?.classList.add('highlight'); setTimeout(() => card?.classList.remove('highlight'), 2200);
    });
  }
  function goToday() { clearSearch(); currentDay = dateKey(new Date()); selectedDate = currentDay; weekOffset = 0; showScreen('week'); renderWeek(); }
  function openTask(id = null) {
    if (!ready) return;
    document.activeElement?.blur(); editingId = id; const found = id ? findTask(id) : null; if (id && !found) return;
    el.form.reset(); $('#formError').hidden = true; $('#dialogTitle').textContent = found ? '编辑任务' : '新建任务';
    el.text.value = found?.task.text || ''; el.date.value = found?.date || selectedDate; el.priority.checked = found?.task.priority === 'high';
    if (found?.task.reminder) { const date = new Date(found.task.reminder); el.time.value = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
    updateReminderTip(); el.dialog.showModal();
    // Focus in the user gesture so the iPhone software keyboard can appear.
    el.text.focus(); el.text.setSelectionRange(el.text.value.length, el.text.value.length);
  }
  function updateReminderTip() {
    const target = el.date.value && el.time.value ? new Date(`${el.date.value}T${el.time.value}:00`) : null;
    const past = target && target.getTime() <= Date.now();
    $('#reminderTip').textContent = !target ? '不选时间也可以保存为待办。' : !host.native ? '浏览器预览不能发送 iPhone 系统提醒。' : past ? '这个时间已过去；保存后会作为错过的提醒处理。' : `将在 ${fullDate(target)} ${el.time.value} 提醒。`;
    $('#reminderTip').classList.toggle('warning', Boolean(past));
  }
  async function submitTask(event) {
    event.preventDefault(); if (!ready) return;
    const text = el.text.value.trim(), date = el.date.value;
    if (!text || !parseDate(date)) { $('#formError').textContent = '请填写任务内容和有效日期。'; $('#formError').hidden = false; return; }
    const reminder = el.time.value ? new Date(`${date}T${el.time.value}:00`) : null;
    if (reminder && !Number.isFinite(reminder.getTime())) { $('#formError').textContent = '请重新选择有效的提醒时间。'; $('#formError').hidden = false; return; }
    const found = editingId ? findTask(editingId) : null;
    const task = found ? { ...found.task } : { id: `task-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`, done: false, createdAt: new Date().toISOString() };
    task.text = text; task.reminder = reminder ? reminder.toISOString() : null; task.priority = el.priority.checked ? 'high' : 'normal';
    if (found) { state.tasks[found.date] = state.tasks[found.date].filter(item => item.id !== task.id); if (!state.tasks[found.date].length) delete state.tasks[found.date]; }
    (state.tasks[date] ||= []).push(task); selectedDate = date; weekOffset = weekOffsetFor(date); clearSearch();
    if (filter === 'done' && !task.done || filter === 'open' && task.done || filter === 'high' && task.priority !== 'high') { filter = 'all'; $('#filterSelect').value = 'all'; }
    const saved = requestSave(); el.dialog.close(); showScreen('week'); renderWeek();
    if (await saved) showToast(found ? '任务已更新' : reminder ? '任务已保存，通知状态可在设置中查看' : '任务已添加');
  }
  const authorized = value => ['authorized', 'provisional', 'ephemeral'].includes(value);
  function renderNotificationStatus() {
    const status = notificationState.authorization;
    const labels = { authorized: '系统通知已开启', provisional: '已允许安静通知', ephemeral: '通知已临时开启', denied: '系统通知尚未开启', notDetermined: '还未开启系统通知', unknown: '暂时无法读取通知状态', unavailable: '浏览器预览不支持系统提醒' };
    $('#notificationStatus').textContent = labels[status] || labels.unknown;
    $('#notificationDetail').textContent = !host.native ? '在真正的 iPhone App 中，可使用离线、锁屏时由系统发送的本地提醒。预览不会申请或模拟系统通知权限。' : authorized(status) ? `已安排 ${notificationState.scheduled || 0} 个提醒。系统会在对应时间提示；显示方式也受 iPhone 的通知和专注模式设置影响。` : status === 'denied' ? '任务仍会正常保存。到 iPhone 设置中允许周纸条发送通知后，再打开 App。' : '设置提醒时间不会自动申请权限。准备好后，点击下方按钮开启系统通知。';
    if (notificationState.error) $('#notificationDetail').textContent += ` ${notificationState.error}`;
    $('#permissionButton').hidden = !host.native || authorized(status) || status === 'denied';
    $('#permissionButton').disabled = permissionRequest;
    $('#permissionButton').textContent = permissionRequest ? '正在请求…' : '开启通知';
    $('#notificationSettingsButton').hidden = !host.native || status !== 'denied';
    const warning = Number(notificationState.unscheduled) || 0;
    $('#scheduleWarning').hidden = !warning;
    $('#scheduleWarning').textContent = `还有 ${warning} 个提醒尚未排程。系统待安排数量有限，打开 App 时会继续安排近期提醒。`;
    const notice = $('#reminderPermission');
    notice.hidden = host.native && authorized(status) && !warning;
    notice.textContent = !host.native ? '当前是浏览器预览，不能发送 iPhone 系统提醒。' : !authorized(status) ? '系统通知未开启。请到下方“设置”页开启，便签和任务仍可正常使用。' : `还有 ${warning} 个提醒尚未排程，打开 App 时会继续安排。`;
  }
  async function refreshNotificationStatus() {
    try { notificationState = await host.invoke('notificationStatus'); renderNotificationStatus(); }
    catch (error) { notificationState = { authorization: 'unknown', scheduled: 0, unscheduled: 0, error: error.message }; renderNotificationStatus(); }
  }
  function reconcileOnResume() {
    if (!ready) return Promise.resolve();
    if (resumePromise) return resumePromise;
    resumePromise = (async () => {
      try {
        const saved = await host.invoke('loadData'); if (saved == null) return;
        const incoming = normalizeState(saved); let changed = false;
        for (const remote of Object.values(incoming.tasks).flat()) {
          const local = findTask(remote.id), previous = lastPersistedState && findTask(remote.id, lastPersistedState)?.task;
          if (!local || !previous) continue;
          // Native notification actions only alter these two fields. A field
          // unchanged in native storage must not erase a still-pending UI edit.
          if (remote.done !== previous.done && local.task.done !== remote.done) { local.task.done = remote.done; changed = true; }
          if (remote.reminder !== previous.reminder && local.task.reminder !== remote.reminder) { local.task.reminder = remote.reminder; changed = true; }
        }
        if (changed) { refreshTaskViews(); requestSave(); }
      } catch (error) { showToast(`读取最新提醒状态失败：${error.message}`, null, 10000); }
    })().finally(() => { resumePromise = null; });
    return resumePromise;
  }
  function updateViewport() {
    const viewport = window.visualViewport;
    const visibleHeight = viewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${visibleHeight}px`);
    const editing = document.activeElement?.matches('input, textarea, select');
    const layoutHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
    if (!editing && visibleHeight >= viewportBaseline - 80 || visibleHeight > viewportBaseline) viewportBaseline = Math.max(layoutHeight, visibleHeight);
    const keyboard = Boolean(editing && Math.max(viewportBaseline, layoutHeight) - visibleHeight > 100);
    $('#appShell').classList.toggle('keyboard-open', keyboard);
    $('#noteToolbar').hidden = document.activeElement !== el.note;
  }
  function insertNoteBreak(plain) {
    if (!ready) return;
    const change = numbers.insertNewline(el.note.value, el.note.selectionStart, el.note.selectionEnd, { plain });
    el.note.value = change.value; el.note.setSelectionRange(change.start, change.end);
    el.note.dispatchEvent(new Event('input', { bubbles: true })); el.note.focus({ preventScroll: true });
    requestAnimationFrame(() => { sizeNote(); el.note.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  }

  $('#newTask').addEventListener('click', () => openTask());
  $('#headerToday').addEventListener('click', goToday); $('#thisWeek').addEventListener('click', goToday);
  $('#prevWeek').addEventListener('click', () => { weekOffset--; clearSearch(); renderWeek(); }); $('#nextWeek').addEventListener('click', () => { weekOffset++; clearSearch(); renderWeek(); });
  $('#searchInput').addEventListener('input', event => { search = event.target.value.trim().toLocaleLowerCase(); renderSearch(); });
  $('#filterSelect').addEventListener('change', event => { filter = event.target.value; renderTasks(); renderSearch(); });
  for (const screen of ['week', 'reminder', 'settings']) $(`#${screen}Tab`).addEventListener('click', () => showScreen(screen));
  el.form.addEventListener('submit', submitTask);
  ['#cancelDialog', '#cancelDialogX'].forEach(selector => $(selector).addEventListener('click', () => el.dialog.close()));
  el.dialog.addEventListener('close', updateViewport);
  el.form.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); el.form.requestSubmit(); }
    else if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA' && event.target.tagName !== 'BUTTON') event.preventDefault();
  });
  $('#clearTime').addEventListener('click', () => { el.time.value = ''; updateReminderTip(); }); el.date.addEventListener('input', updateReminderTip); el.time.addEventListener('input', updateReminderTip);
  $('#undoButton').addEventListener('click', () => { const undo = undoAction; hideToast(); undo?.(); }); $('#dismissToast').addEventListener('click', hideToast);
  el.save.addEventListener('click', () => { if (saveError) requestSave(); });
  $('#exportButton').addEventListener('click', async () => {
    if (!ready || !await flushSaves()) return;
    try { const result = await host.invoke('exportData'); if (result?.ok) showToast('备份已交给系统保存或分享'); else if (!result?.cancelled) showToast(result?.error || '导出未完成，请重试'); } catch (error) { showToast(`导出失败：${error.message}`); }
  });
  $('#importButton').addEventListener('click', async () => {
    if (!ready) return showToast('数据未读完，暂时不能导入。');
    if (!await flushSaves()) return;
    try {
      const result = await host.invoke('importData'); if (result?.cancelled) return; if (!result?.ok) throw new Error(result?.error || '未能读取备份');
      const before = clone(state), merged = mergeStates(state, result.state); if (!merged.added && !merged.notesAdded) return showToast('内容已存在，无需重复导入');
      const after = clone(merged.state); state = merged.state; requestSave(); renderWeek(); renderReminders();
      showToast(`已合并 ${merged.added} 个任务、${merged.notesAdded} 条便签`, () => { state = undoMergeState(state, before, after); requestSave(); renderWeek(); renderReminders(); showToast('已撤销导入，保留之后的修改'); }, 15000);
    } catch (error) { showToast(`导入失败：${error.message}`, null, 12000); }
  });
  $('#permissionButton').addEventListener('click', async () => {
    if (!host.native || permissionRequest) return;
    permissionRequest = true; renderNotificationStatus();
    try { notificationState = await host.invoke('requestNotificationPermission'); }
    catch (error) { showToast(`无法请求通知权限：${error.message}`); }
    permissionRequest = false; renderNotificationStatus();
  });
  $('#notificationSettingsButton').addEventListener('click', async () => { try { await host.invoke('openNotificationSettings'); } catch (error) { showToast(error.message); } });
  for (const id of ['nextNoteItem', 'noteLineBreak', 'finishNote']) $(`#${id}`).addEventListener('pointerdown', event => event.preventDefault());
  $('#nextNoteItem').addEventListener('click', () => insertNoteBreak(false)); $('#noteLineBreak').addEventListener('click', () => insertNoteBreak(true)); $('#finishNote').addEventListener('click', () => { el.note.blur(); updateViewport(); flushSaves(); });
  document.addEventListener('focusin', () => { updateViewport(); requestAnimationFrame(() => document.activeElement?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })); });
  document.addEventListener('focusout', () => setTimeout(updateViewport, 0));
  window.visualViewport?.addEventListener('resize', updateViewport); window.addEventListener('resize', updateViewport);
  window.addEventListener('native-data-changed', event => {
    if (!ready) return;
    try {
      const incoming = normalizeState(event.detail.state), change = event.detail.change;
      if (!change?.id) return;
      const local = findTask(change.id), remote = Object.values(incoming.tasks).flat().find(task => task.id === change.id);
      if (local && remote) { local.task.done = remote.done; local.task.reminder = remote.reminder; requestSave(); refreshTaskViews(); }
    } catch (error) { showToast(`读取任务更新失败：${error.message}`); }
  });
  window.addEventListener('native-focus-task', event => focusTask(event.detail));
  window.addEventListener('native-app-active', () => { clock(); refreshNotificationStatus(); reconcileOnResume(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSaves();
    else { clock(); refreshNotificationStatus(); reconcileOnResume(); }
  });
  window.addEventListener('pagehide', () => { if (ready && pendingSave) host.invoke('saveData', { state: clone(state) }); });
  setInterval(() => { clock(); if (activeScreen === 'reminder') renderReminders(); }, 30000);

  async function init() {
    clock(); updateViewport(); $('#previewBanner').hidden = host.native;
    try {
      const saved = await host.invoke('loadData'); state = saved == null ? { tasks: {}, notes: {} } : normalizeState(saved);
      if (saved == null) { const result = await host.invoke('saveData', { state: clone(state) }); if (!result?.ok) throw new Error(result?.error || '无法创建本机数据文件'); }
      lastPersistedState = clone(state); ready = true; $('#newTask').disabled = false; renderWeek(); renderReminders();
      saveStatus(host.native ? '已保存在这台 iPhone' : '浏览器预览 · 系统提醒不可用');
      await refreshNotificationStatus();
      await host.invoke('ready');
      if (queuedFocus) { const id = queuedFocus; queuedFocus = null; focusTask(id); }
    } catch (error) {
      ready = false; $('#newTask').disabled = true; el.note.readOnly = true;
      saveStatus('读取失败，原有数据未被覆盖', true); renderWeek();
      showToast(`读取失败：${error.message}。请保留原数据后重试。`, null, 30000);
    }
  }
  // Expose only the lifecycle flush used by the native wrapper and local tests.
  window.NoteApp = Object.freeze({ flushSaves });
  init();
})();
