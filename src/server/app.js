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
    div.className = `thread${t.id === activeId ? ' active' : ''}`;
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
    div.className = `entry ${e.role}`;
    div.innerHTML = `<div class="who">${escapeHtml(who)}</div><pre>${escapeHtml(e.text)}</pre>`;
    logEl.appendChild(div);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

async function selectThread(id) {
  activeId = id;
  setComposerEnabled(true);
  await loadThreads();
  const thread = await api(`/api/threads/${id}`);
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

// Append a status line and return its element so we can update it in place.
function addStatus(text, cls) {
  const div = document.createElement('div');
  div.className = `status ${cls || ''}`;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

function addEntry(role, who, text) {
  const div = document.createElement('div');
  div.className = `entry ${role}`;
  div.innerHTML = `<div class="who">${escapeHtml(who)}</div><pre>${escapeHtml(text)}</pre>`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

// Render one dispatch lifecycle event into the live log.
function handleEvent(ev, state) {
  switch (ev.kind) {
    case 'agent_start':
      state.statusByAgent[ev.agent] = addStatus(
        `${ev.agent} is working${ev.hop > 0 ? ` (handoff, hop ${ev.hop})` : ''}…`,
        'working',
      );
      break;
    case 'message': {
      const m = ev.message;
      if (m.type === 'tool_use') {
        addStatus(`${ev.agent} → ${m.tool}`, 'tool');
      } else if (m.type === 'result' && !m.ok) {
        addStatus(`${ev.agent} error: ${m.error || 'failed'}`, 'error');
      }
      break;
    }
    case 'agent_end': {
      const s = state.statusByAgent[ev.agent];
      if (s) s.remove();
      if (ev.ok) {
        addEntry('agent', ev.agent, ev.text);
      } else {
        addEntry('agent failed', ev.agent, ev.text);
      }
      break;
    }
    case 'done':
      if (ev.noMatch) {
        addStatus('No known @mention — nothing dispatched.', 'muted');
      }
      break;
  }
}

$('#composer').onsubmit = async (ev) => {
  ev.preventDefault();
  const message = input.value.trim();
  if (!message || !activeId) return;
  input.value = '';
  setComposerEnabled(false);
  addEntry('user', 'you', message);

  const state = { statusByAgent: {} };
  try {
    const res = await fetch(`/api/threads/${activeId}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok || !res.body) {
      addStatus('Request failed — is the server running?', 'error');
    } else {
      // Read the newline-delimited JSON event stream as it arrives.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            handleEvent(JSON.parse(trimmed), state);
          } catch {
            /* ignore partial/non-JSON line */
          }
        }
      }
    }
  } catch (err) {
    addStatus(`Connection lost: ${err?.message || err}`, 'error');
  }

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
