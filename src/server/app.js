// BAi web UI — vanilla JS, no build step.
const $ = (sel) => document.querySelector(sel);
const threadsEl = $('#threads');
const legendEl = $('#legend');
const logEl = $('#log');
const input = $('#message');
const sendBtn = $('#sendBtn');
const mentionPop = $('#mentionPop');
const threadTitleEl = $('#threadTitle');
const threadSubEl = $('#threadSub');

let activeId = null;
let activeTitle = '';
/** Agents available to @mention, loaded from the server. */
let agents = [];

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

// ---- agents + legend ----------------------------------------------------

async function loadAgents() {
  try {
    agents = await api('/api/agents');
  } catch {
    agents = [];
  }
  legendEl.innerHTML = '';
  if (agents.length === 0) return;
  const label = document.createElement('div');
  label.className = 'section-label';
  label.style.padding = '0 0 4px';
  label.textContent = 'Agents';
  legendEl.appendChild(label);
  for (const a of agents) {
    const row = document.createElement('div');
    row.className = 'legend-agent';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `@${a.id}`;
    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = a.role || '';
    row.append(tag, role);
    legendEl.appendChild(row);
  }
}

/** Two-letter avatar initials for an agent (display name, else id). */
function initials(a) {
  const src = a.name || a.id || '?';
  return src.slice(0, 2).toUpperCase();
}

// ---- threads -------------------------------------------------------------

async function loadThreads() {
  const threads = await api('/api/threads');
  threadsEl.innerHTML = '';
  for (const t of threads) {
    const div = document.createElement('div');
    div.className = `thread${t.id === activeId ? ' active' : ''}`;
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = t.title;
    const small = document.createElement('small');
    small.textContent = `${t.id} · ${t.entries.length} entries`;
    div.append(title, small);
    div.onclick = () => selectThread(t.id, t.title);
    threadsEl.appendChild(div);
  }
}

function renderEntries(thread) {
  if (!thread || thread.entries.length === 0) {
    logEl.innerHTML =
      '<div class="empty"><div class="big">No messages yet</div>' +
      'Type a message below. Use @ to mention an agent.</div>';
    return;
  }
  logEl.innerHTML = '';
  for (const e of thread.entries) {
    addEntry(e.role, e.role === 'user' ? 'you' : e.agent || 'agent', e.text);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

async function selectThread(id, title) {
  activeId = id;
  activeTitle = title || '';
  setComposerEnabled(true);
  threadTitleEl.textContent = activeTitle || 'Thread';
  threadSubEl.textContent = id;
  await loadThreads();
  const thread = await api(`/api/threads/${id}`);
  renderEntries(thread);
  input.focus();
}

$('#newThread').onclick = async () => {
  const title = prompt('Thread title?', 'untitled');
  if (title === null) return;
  const thread = await api('/api/threads', {
    method: 'POST',
    body: JSON.stringify({ title: title || 'untitled' }),
  });
  await selectThread(thread.id, thread.title);
};

// ---- log rendering helpers ----------------------------------------------

function avatarEl(text, cls) {
  const a = document.createElement('span');
  a.className = `avatar${cls ? ` ${cls}` : ''}`;
  a.textContent = text;
  return a;
}

// Append a status line and return its element so we can update it in place.
function addStatus(text, cls) {
  const div = document.createElement('div');
  div.className = `status ${cls || ''}`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  label.textContent = text;
  div.append(dot, label);
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

function addEntry(role, who, text) {
  const div = document.createElement('div');
  div.className = `entry ${role}`;
  const head = document.createElement('div');
  head.className = 'who';
  head.append(avatarEl((who || '?').slice(0, 2).toUpperCase()), document.createTextNode(who));
  const pre = document.createElement('pre');
  pre.textContent = text;
  div.append(head, pre);
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

// Create a "live" agent bubble whose text grows as stream chunks arrive.
function addLiveEntry(who) {
  const div = document.createElement('div');
  div.className = 'entry agent live';
  const head = document.createElement('div');
  head.className = 'who';
  head.append(avatarEl((who || '?').slice(0, 2).toUpperCase()), document.createTextNode(who));
  const pre = document.createElement('pre');
  div.append(head, pre);
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return { wrapper: div, pre };
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
      if (m.type === 'text') {
        // First text chunk: drop the "working" status, open a live bubble.
        if (!state.liveByAgent[ev.agent]) {
          const s = state.statusByAgent[ev.agent];
          if (s) {
            s.remove();
            state.statusByAgent[ev.agent] = null;
          }
          state.liveByAgent[ev.agent] = addLiveEntry(ev.agent);
        }
        const live = state.liveByAgent[ev.agent];
        live.pre.textContent += m.text;
        logEl.scrollTop = logEl.scrollHeight;
      } else if (m.type === 'tool_use') {
        addStatus(`${ev.agent} → ${m.tool}`, 'tool');
      } else if (m.type === 'result' && !m.ok) {
        addStatus(`${ev.agent} error: ${m.error || 'failed'}`, 'fail');
      }
      break;
    }
    case 'agent_end': {
      const s = state.statusByAgent[ev.agent];
      if (s) s.remove();
      state.statusByAgent[ev.agent] = null;
      const live = state.liveByAgent[ev.agent];
      if (live) {
        live.wrapper.classList.remove('live');
        if (!ev.ok) live.wrapper.classList.add('failed');
        state.liveByAgent[ev.agent] = null;
      } else {
        addEntry(ev.ok ? 'agent' : 'agent failed', ev.agent, ev.text);
      }
      break;
    }
    case 'routed':
      addStatus(`No @mention — routed to ${ev.agent} by capability.`, 'ok');
      break;
    case 'file_context': {
      // A chat-only agent can't read files itself; BAi inlined these for it.
      const ok = ev.refs.filter((r) => r.ok).map((r) => r.ref);
      const bad = ev.refs.filter((r) => !r.ok);
      if (ok.length > 0) {
        addStatus(`Fed ${ok.length} file(s) to ${ev.agent}: ${ok.join(', ')}`, 'file');
      }
      for (const r of bad) {
        addStatus(`Skipped @file:${r.ref} — ${r.reason}`, 'fail');
      }
      break;
    }
    case 'done':
      if (ev.noMatch) {
        addStatus('No @mention and no capability match — nothing dispatched.', '');
      }
      break;
  }
}

// ---- @mention autocomplete ----------------------------------------------

const mention = { open: false, index: 0, matches: [], start: -1 };

// Find an active "@token" immediately before the caret, if any. Returns the
// token's start index and the partial text after @, or null when not mentioning.
function mentionContext() {
  const pos = input.selectionStart;
  const text = input.value.slice(0, pos);
  // @ must start the string or follow whitespace; token is word chars only.
  const m = text.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);
  if (!m) return null;
  return { start: pos - m[1].length - 1, query: m[1].toLowerCase() };
}

function closeMention() {
  mention.open = false;
  mentionPop.classList.remove('open');
  mentionPop.innerHTML = '';
}

function renderMention() {
  mentionPop.innerHTML = '';
  mention.matches.forEach((a, i) => {
    const item = document.createElement('div');
    item.className = `mention-item${i === mention.index ? ' active' : ''}`;
    const av = document.createElement('span');
    av.className = 'avatar';
    av.textContent = initials(a);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const line = document.createElement('div');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `@${a.id}`;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = a.name ? ` ${a.name}` : '';
    line.append(tag, name);
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = a.role || (a.strengths || []).join(', ');
    meta.append(line, role);
    item.append(av, meta);
    // Use mousedown so the textarea doesn't blur before we handle the pick.
    item.onmousedown = (e) => {
      e.preventDefault();
      pickMention(i);
    };
    mentionPop.appendChild(item);
  });
  mentionPop.classList.add('open');
}

function updateMention() {
  const ctx = mentionContext();
  if (!ctx) {
    closeMention();
    return;
  }
  const matches = agents.filter((a) => a.id.toLowerCase().startsWith(ctx.query));
  if (matches.length === 0) {
    closeMention();
    return;
  }
  mention.open = true;
  mention.index = 0;
  mention.matches = matches;
  mention.start = ctx.start;
  renderMention();
}

// Replace the in-progress @token with the chosen agent and a trailing space.
function pickMention(i) {
  const a = mention.matches[i];
  if (!a) return;
  const pos = input.selectionStart;
  const before = input.value.slice(0, mention.start);
  const after = input.value.slice(pos);
  const insert = `@${a.id} `;
  input.value = before + insert + after;
  const caret = before.length + insert.length;
  input.setSelectionRange(caret, caret);
  closeMention();
  autoGrow();
  input.focus();
}

// ---- composer: auto-grow + key handling ---------------------------------

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

input.addEventListener('input', () => {
  autoGrow();
  updateMention();
});

input.addEventListener('keydown', (e) => {
  if (mention.open) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mention.index = (mention.index + 1) % mention.matches.length;
      renderMention();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      mention.index = (mention.index - 1 + mention.matches.length) % mention.matches.length;
      renderMention();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pickMention(mention.index);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMention();
      return;
    }
  }
  // Enter sends; Shift+Enter inserts a newline.
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});

input.addEventListener('blur', () => {
  // Delay so a mousedown pick on the popup still registers.
  setTimeout(closeMention, 120);
});

// ---- send / stop ---------------------------------------------------------

let activeController = null;

function setSending(sending) {
  input.disabled = sending;
  if (sending) {
    sendBtn.textContent = 'Stop';
    sendBtn.classList.add('stop');
    sendBtn.disabled = false;
  } else {
    sendBtn.textContent = 'Send';
    sendBtn.classList.remove('stop');
    sendBtn.disabled = !activeId;
    input.focus();
  }
}

$('#composer').onsubmit = async (ev) => {
  ev.preventDefault();
  if (activeController) {
    activeController.abort();
    return;
  }
  const message = input.value.trim();
  if (!message || !activeId) return;
  input.value = '';
  autoGrow();
  closeMention();
  setSending(true);
  addEntry('user', 'you', message);

  const state = { statusByAgent: {}, liveByAgent: {} };
  const controller = new AbortController();
  activeController = controller;
  try {
    const res = await fetch(`/api/threads/${activeId}/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      addStatus('Request failed — is the server running?', 'fail');
    } else {
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
    if (err?.name === 'AbortError') {
      addStatus('Stopped.', '');
    } else {
      addStatus(`Connection lost: ${err?.message || err}`, 'fail');
    }
  } finally {
    activeController = null;
    setSending(false);
    await loadThreads();
  }
};

loadAgents();
loadThreads();
