// BAi web UI — vanilla JS, no build step.
const $ = (sel) => document.querySelector(sel);
const threadsEl = $('#threads');
const legendEl = $('#legend');
const logEl = $('#log');
const input = $('#message');
const sendBtn = $('#sendBtn');
const auditBtn = $('#auditBtn');
const mentionPop = $('#mentionPop');
const threadTitleEl = $('#threadTitle');
const threadSubEl = $('#threadSub');
const gitPanelEl = $('#gitPanel');
const diffOverlayEl = $('#diffOverlay');

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
  auditBtn.disabled = !on;
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
  loadGit();
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

// ---- git panel ----------------------------------------------------------
// A read-only window onto the working tree: "what did the agents change?"
// Refreshed when a thread opens and after every turn/audit, since that's when
// files may have moved. Collapsed state is remembered for the session.

let gitCollapsed = false;

// Two-letter status glyph for a changed file, plus the class that colors it.
// Prefers the staged (index) char, then the worktree char, then '?' untracked.
function gitGlyph(f) {
  if (f.untracked) return { text: '??', cls: 'untracked' };
  if (f.staged) return { text: (f.index + (f.worktree.trim() || '')).trim(), cls: 'staged' };
  return { text: (f.worktree || '').trim() || 'M', cls: 'unstaged' };
}

async function loadGit() {
  let status;
  try {
    status = await api('/api/git/status');
  } catch {
    status = { repo: false, files: [] };
  }
  gitPanelEl.innerHTML = '';
  // Outside a git repo there's nothing useful to show — hide the panel entirely.
  if (!status?.repo) return;

  if (gitCollapsed) gitPanelEl.classList.add('collapsed');
  else gitPanelEl.classList.remove('collapsed');

  const head = document.createElement('div');
  head.className = 'git-head';
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▾';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Changes';
  const branch = document.createElement('span');
  branch.className = 'branch';
  branch.textContent = status.branch || '';
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = String(status.files.length);
  head.append(caret, label, branch, count);
  head.onclick = () => {
    gitCollapsed = !gitCollapsed;
    loadGit();
  };
  gitPanelEl.appendChild(head);

  const list = document.createElement('div');
  list.id = 'gitFiles';
  if (status.files.length === 0) {
    const clean = document.createElement('div');
    clean.className = 'git-file';
    clean.style.cursor = 'default';
    clean.textContent = 'working tree clean';
    list.appendChild(clean);
  }
  for (const f of status.files) {
    const row = document.createElement('div');
    row.className = 'git-file';
    const g = gitGlyph(f);
    const xy = document.createElement('span');
    xy.className = `xy ${g.cls}`;
    xy.textContent = g.text.padEnd(2, ' ');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.path;
    name.title = f.orig ? `${f.orig} → ${f.path}` : f.path;
    row.append(xy, name);
    row.onclick = () => openDiff(f);
    list.appendChild(row);
  }
  gitPanelEl.appendChild(list);
}

// ---- diff overlay -------------------------------------------------------

const diffFileEl = $('#diffFile');
const diffBodyEl = $('#diffBody');

function classifyDiffLine(line) {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return '';
}

function renderDiff(file, payload) {
  diffFileEl.textContent = file.orig ? `${file.orig} → ${file.path}` : file.path;
  diffBodyEl.innerHTML = '';
  if (payload.untracked) {
    const note = document.createElement('div');
    note.className = 'diff-empty';
    note.textContent = 'New untracked file — no previous version to diff against.';
    diffBodyEl.appendChild(note);
    return;
  }
  const text = (payload.diff || '').replace(/\n$/, '');
  if (!text) {
    const note = document.createElement('div');
    note.className = 'diff-empty';
    note.textContent = 'No textual diff (binary file, or already staged/committed).';
    diffBodyEl.appendChild(note);
    return;
  }
  for (const line of text.split('\n')) {
    const span = document.createElement('span');
    span.className = `dl ${classifyDiffLine(line)}`;
    span.textContent = line || ' ';
    diffBodyEl.appendChild(span);
  }
}

async function openDiff(file) {
  diffFileEl.textContent = file.path;
  diffBodyEl.innerHTML = '<div class="diff-empty">Loading…</div>';
  diffOverlayEl.classList.add('open');
  let payload;
  try {
    payload = await api(`/api/git/diff?file=${encodeURIComponent(file.path)}`);
  } catch {
    payload = { diff: '' };
  }
  renderDiff(file, payload);
}

function closeDiff() {
  diffOverlayEl.classList.remove('open');
}

$('#diffClose').onclick = closeDiff;
diffOverlayEl.onclick = (e) => {
  if (e.target === diffOverlayEl) closeDiff();
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && diffOverlayEl.classList.contains('open')) closeDiff();
});

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
    case 'no_tools':
      // Ran as a tool-capable agent but called no tools — the model may be
      // chat-only in practice. Point the operator at the one-key downgrade.
      addStatus(
        `${ev.agent} called no tools this turn — if it's actually chat-only, set BAI_CHAT_AGENTS=${ev.agent} to feed files instead.`,
        'fail',
      );
      break;
    case 'pipeline': {
      // Audit-pipeline lifecycle: a stage starting, a fallback, or a stage end.
      if (ev.stage_start) {
        addStatus(`stage "${ev.stage_start.stage}" → ${ev.stage_start.agent}`, 'stage');
      } else if (ev.fallback) {
        const { stage, from, to, reason } = ev.fallback;
        addStatus(`[${stage}] ${from} couldn't run (${reason}) → falling back to ${to}`, 'fail');
      } else if (ev.stage_end) {
        const r = ev.stage_end;
        const over = r.failedOver.length ? ` (after ${r.failedOver.join(', ')} failed)` : '';
        if (r.ok) addStatus(`stage "${r.stage}" done by ${r.agent}${over}`, 'ok');
        else addStatus(`stage "${r.stage}" EXHAUSTED — tried ${r.failedOver.join(', ')}`, 'fail');
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
  // The audit button shares the one in-flight slot with send, so it's only
  // usable when nothing is running and a thread is open.
  auditBtn.disabled = sending || !activeId;
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

// Stream an NDJSON dispatch/pipeline feed into the live log. Shared by send and
// audit: both hit a streaming endpoint that emits one JSON event per line.
async function streamInto(url, body) {
  const state = { statusByAgent: {}, liveByAgent: {} };
  const controller = new AbortController();
  activeController = controller;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      addStatus('Request failed — is the server running?', 'fail');
      return;
    }
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
    loadGit();
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
  await streamInto(`/api/threads/${activeId}/stream`, { message });
};

// Audit: run the security-audit pipeline (find vuln flows → verify each) over
// the composer text, which may carry @file: refs naming the code to audit.
auditBtn.onclick = async () => {
  if (activeController) return;
  const target = input.value.trim();
  if (!target || !activeId) return;
  input.value = '';
  autoGrow();
  closeMention();
  setSending(true);
  addEntry('user', 'you', `🛡 audit: ${target}`);
  addStatus('Security audit: find vulnerability flows, then verify each.', 'ok');
  await streamInto(`/api/threads/${activeId}/audit`, { target });
};

loadAgents();
loadThreads();
loadGit();
