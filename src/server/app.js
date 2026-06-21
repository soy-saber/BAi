// BAi web UI — vanilla JS, no build step.
const $ = (sel) => document.querySelector(sel);
const threadsEl = $('#threads');
const logEl = $('#log');
const input = $('#message');
const sendBtn = $('#sendBtn');
let activeId = null;

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  return res.json();
}

function setComposerEnabled(on) {
  input.disabled = !on;
  sendBtn.disabled = !on;
}

async function loadThreads() {
  const threads = await api('/api/threads');
  threadsEl.innerHTML = '';
  for (const t of threads) {
    const div = document.createElement('div');
    div.className = 'thread' + (t.id === activeId ? ' active' : '');
    div.innerHTML = `${escapeHtml(t.title)}<small>${t.id} · ${t.entries.length} entries</small>`;
    div.onclick = () => selectThread(t.id);
    threadsEl.appendChild(div);
  }
}

function renderEntries(thread) {
  if (!thread || thread.entries.length === 0) {
    logEl.innerHTML = '<div class="empty">No messages yet. Mention an agent to start.</div>';
    return;
  }
  logEl.innerHTML = '';
  for (const e of thread.entries) {
    const who = e.role === 'user' ? 'you' : e.agent || 'agent';
    const div = document.createElement('div');
    div.className = 'entry ' + e.role;
    div.innerHTML = `<div class="who">${escapeHtml(who)}</div><pre>${escapeHtml(e.text)}</pre>`;
    logEl.appendChild(div);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

async function selectThread(id) {
  activeId = id;
  setComposerEnabled(true);
  await loadThreads();
  const thread = await api('/api/threads/' + id);
  renderEntries(thread);
}

$('#newThread').onclick = async () => {
  const title = prompt('Thread title?', 'untitled');
  if (title === null) return;
  const thread = await api('/api/threads', {
    method: 'POST',
    body: JSON.stringify({ title: title || 'untitled' }),
  });
  await selectThread(thread.id);
};

$('#composer').onsubmit = async (ev) => {
  ev.preventDefault();
  const message = input.value.trim();
  if (!message || !activeId) return;
  input.value = '';
  setComposerEnabled(false);
  // optimistic: show the user message immediately
  const optimistic = document.createElement('div');
  optimistic.className = 'entry user';
  optimistic.innerHTML = `<div class="who">you</div><pre>${escapeHtml(message)}</pre>`;
  logEl.appendChild(optimistic);
  logEl.scrollTop = logEl.scrollHeight;

  const { thread } = await api('/api/threads/' + activeId + '/send', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  renderEntries(thread);
  setComposerEnabled(true);
  await loadThreads();
};

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

loadThreads();
