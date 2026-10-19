#!/usr/bin/env node
/**
 * ZetaMaster browser smoke runner (M1 item 5: an end-to-end browser test runner).
 *
 * Drives the real app in a real headless Chrome over the DevTools protocol — no npm dependencies:
 * Node >= 22 is required because the CDP client uses the global WebSocket; the runner launches the
 * Chrome already installed on the machine (macOS path below, override with $CHROME_BIN). It serves
 * the app itself on a free ephemeral port with the same handler contract as scripts/serve.mjs
 * (including the nosniff header), from a throwaway browser profile: user data and dev servers are
 * never touched. Every interaction goes through the same DOM surfaces a person uses (mode select,
 * setup fields, keypad buttons, answer input events); nothing calls the app internals directly.
 *
 * Contract:
 *   `npm run smoke` boots a fresh headless Chrome, runs the checklist, prints PASS/FAIL per check,
 *   takes a screenshot into the repo's tmp/ dir, and exits non-zero on any failure.
 *
 * Not covered here on purpose (pinned by unit tests instead): generator distribution parity,
 * spaced-review scheduling math, import sanitization — the smoke suite verifies the shipped UI
 * actually works in a browser, not arithmetic already pinned in tests/.
 */
if (typeof WebSocket === 'undefined') {
  console.error('npm run smoke needs Node >= 22 (global WebSocket) — current node: ' + process.version);
  process.exit(2);
}
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]+$/, '');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const step = async (name, fn) => {
  let out;
  try {
    out = await fn();
    results.push({ name, ok: true, out });
    console.log(`  PASS ${name}${out ? ` — ${out}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false, out: String(error?.message ?? error) });
    console.log(`  FAIL ${name} — ${String(error?.message ?? error)}`);
  }
};
const assert = (cond, message) => { if (!cond) throw new Error(message); };

/* ---------- serve the app on a free port ---------- */
async function serveApp() {
  const server = createServer(async (req, res) => {
    const { readFile, stat } = await import('node:fs/promises');
    try {
      const url = new URL(req.url, 'http://localhost');
      const relative = decodeURIComponent(url.pathname);
      const requested = relative === '/' ? '/apps/web/index.html' : relative === '/sw.js' ? '/apps/web/sw.js' : relative;
      const pathname = resolve(REPO, '.' + requested);
      if (!pathname.startsWith(REPO + sep)) { res.writeHead(403); res.end(); return; }
      const target = (await stat(pathname).catch(() => null))?.isDirectory() ? resolve(pathname, 'index.html') : pathname;
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
      res.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(await readFile(target));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

/* ---------- minimal CDP client over Node's built-in WebSocket ---------- */
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.pageErrors = [];
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message} (${msg.error.data ?? ''}`.trim() + ')')) : resolve(msg.result);
        return;
      }
      this.events.push(msg);
      if (msg.method === 'Runtime.exceptionThrown') this.pageErrors.push('exception: ' + JSON.stringify(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? '', ).slice(0, 300));
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !msg.params.entry.source.includes('network')) {
        // Ignore resource loads (404s would show up as failed test steps anyway); keep JS/console errors.
        if (msg.params.entry.source === 'javascript' || msg.params.entry.source === 'console') this.pageErrors.push(msg.params.entry.text.slice(0, 300));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.pageErrors.push('console.error: ' + msg.params.args.map(a => JSON.stringify(a.value ?? a.description ?? '')).join(' ').slice(0, 300));
      }
    });
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () => reject(new Error('WebSocket to Chrome failed')));
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, 20000);
    });
  }
  close() { this.ws.close(); }
}

/** Navigate and return only after the NEW document finished loading (loadEventFired of that nav). */
async function goto(cdp, url) {
  const before = cdp.events.filter(m => m.method === 'Page.loadEventFired').length;
  await cdp.send('Page.navigate', { url });
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (cdp.events.filter(m => m.method === 'Page.loadEventFired').length > before) break;
    await new Promise(r => setTimeout(r, 50));
  }
  await waitUntil(cdp, () => !!document.querySelector('#start'), { label: 'document ready' });
  await installDriverInto(cdp);
  await waitUntil(cdp, jsBound, { label: 'app JS bound' });
}

async function callFn(cdp, fn, ...args) {
  const name = fn.name;
  const expression = name
    ? `window.__zmDrive[${JSON.stringify(name)}](...${JSON.stringify(args)})`
    : `(${fn.toString()})(...${JSON.stringify(args)})`;
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (result.exceptionDetails) throw new Error('page threw: ' + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text).split('\n')[0]);
  return result.result?.value;
}
const ev = (cdp, fn, ...args) => callFn(cdp, fn, ...args);

async function waitUntil(cdp, fn, { timeoutMs = 10000, intervalMs = 100, label = 'condition' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await ev(cdp, fn)) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`timeout waiting for ${label}`);
}

/* ---------- page-side driver functions (serialized via toString; self-contained!) ---------- */
const installTraps = () => {
  window.__zmSmoke = { alerts: [], errors: [] };
  window.addEventListener('error', e => window.__zmSmoke.errors.push(String(e.message).slice(0, 300)));
  window.addEventListener('unhandledrejection', e => window.__zmSmoke.errors.push('rejection: ' + String(e.reason).slice(0, 300)));
  window.alert = m => window.__zmSmoke.alerts.push(String(m));
  window.confirm = () => true;
};
const pageErrors = () => ({ alerts: window.__zmSmoke?.alerts ?? [], errors: window.__zmSmoke?.errors ?? [] });
const click = sel => { const el = document.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.click(); return true; };
const jsBound = () => (document.querySelector('#mode-hint')?.textContent ?? '').includes('no skips or pausing');
const setNav = view => { document.querySelector(`.nav-link[data-view="${view}"]`).click(); return document.querySelector('#view-' + view)?.classList.contains('active'); };
const setMode = mode => { const s = document.querySelector('#mode'); s.value = mode; s.dispatchEvent(new Event('change')); return { hint: document.querySelector('#mode-hint').textContent, rangesOpen: document.querySelector('#custom-ranges').classList.contains('hidden') === false && document.querySelector('#custom-ranges').open }; };
const setDuration = secs => { const d = document.querySelector('#duration'); d.value = String(secs); return d.value; };
const setField = (sel, value) => { const el = document.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.value = value; return el.value; };
const clearField = sel => { const el = document.querySelector(sel); if (el) el.value = ''; };
const gameVisible = () => !document.querySelector('#game').classList.contains('hidden');
const gameState = () => ({
  visible: !document.querySelector('#game').classList.contains('hidden'),
  mode: document.querySelector('#game-mode').textContent,
  score: Number(document.querySelector('#game-score').textContent.match(/\d+/)?.[0] ?? 0),
  timer: document.querySelector('#timer').textContent,
  problem: document.querySelector('#problem').textContent,
  answer: document.querySelector('#answer').value,
});
const resultsState = () => ({
  visible: !document.querySelector('#results').classList.contains('hidden'),
  title: document.querySelector('#result-title').textContent,
  score: document.querySelector('#result-score').textContent,
  detail: document.querySelector('#result-detail').textContent,
});
/* Solve the on-screen problem by typing the answer into the real input path (input event).
 * The generator renders subtraction with '–' (en dash, U+2013) and the Academy cards use '−'
 * (minus, U+2212) — the parser accepts both spellings of "minus". */
function solveOnce() {
  const OP = { '+': (a, b) => a + b, '−': (a, b) => a - b, '–': (a, b) => a - b, '×': (a, b) => a * b, '÷': (a, b) => a / b };
  const t = (document.querySelector('#problem').textContent ?? '').trim();
  const m = /^(\d+)\s*([+×÷]|−|–)\s*(\d+)$/.exec(t);
  if (!m) return { solved: false, why: 'unparseable: ' + t };
  const value = String(Math.round(OP[m[2]](Number(m[1]), Number(m[3]))));
  const input = document.querySelector('#answer');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { solved: true, value, problem: t };
}
function solveMany(cap) {
  const g = document.querySelector('#game');
  if (g.classList.contains('hidden')) return { solved: 0, score: 0 };
  let solved = 0, attempts = 0;
  while (solved < cap && attempts < cap * 6) {
    attempts++;
    const before = Number(document.querySelector('#game-score').textContent.match(/\d+/)?.[0] ?? 0);
    const r = solveOnce();
    if (!r.solved) break;
    const after = Number(document.querySelector('#game-score').textContent.match(/\d+/)?.[0] ?? 0);
    if (after > before) solved++;
    else break; // stuck: stop rather than spin
  }
  return { solved, score: Number(document.querySelector('#game-score').textContent.match(/\d+/)?.[0] ?? 0) };
}
function keypadSolveOne() {
  const OP = { '+': (a, b) => a + b, '−': (a, b) => a - b, '–': (a, b) => a - b, '×': (a, b) => a * b, '÷': (a, b) => a / b };
  const text = (document.querySelector('#problem').textContent ?? '').trim();
  const m = /^(\d+)\s*([+×÷]|−|–)\s*(\d+)$/.exec(text);
  if (!m) throw new Error('unparseable problem: ' + text);
  const value = String(Math.round(OP[m[2]](Number(m[1]), Number(m[3]))));
  const before = Number(document.querySelector('#game-score').textContent.match(/\d+/)?.[0] ?? 0);
  for (const ch of value) {
    const btn = document.querySelector(`.keypad-key[data-key="${ch}"]`);
    if (!btn) throw new Error('keypad key missing: ' + ch);
    btn.click();
  }
  const after = gameState();
  return { problem: text, value, scored: after.score > before, keypadVisible: !document.querySelector('#keypad').classList.contains('hidden'), scoreAfter: after.score };
}
const entrySettingsState = () => ({
  keypadBox: document.querySelector('#setting-keypad')?.checked,
  soundBox: document.querySelector('#setting-sound')?.checked,
  stored: localStorage.getItem('zetamaster-entry-settings-v1'),
  rangesStored: localStorage.getItem('zetamaster-custom-ranges-v1'),
  addLeftPrefill: document.querySelector('#add-left-min')?.value ?? null,
});
const dumpSessions = async () => {
  const db = await import('/packages/storage/src/db.js');
  const [sessions, reviews] = await Promise.all([db.listSessions(), db.listSkillReviews()]);
  return { count: sessions.length, reviews: reviews.length, sessions: sessions.map(s => ({ mode: s.mode, benchmark: s.benchmark, score: s.score, endedEarly: s.endedEarly, elapsedMs: s.elapsedMs, seed: s.seed, eventCount: (s.events ?? []).length, rulesId: s.rules?.id, tagsOk: (s.events ?? []).every(e => Array.isArray(e.tags)), drillStage: s.drill?.stage ?? null, drillCell: s.drill?.cell ?? null })) };
};
const academyState = () => {
  const opened = document.querySelector('[data-academy-open]');
  return {
    cards: document.querySelectorAll('.lesson-card').length,
    openButtons: document.querySelectorAll('[data-academy-open]').length,
    firstOpen: opened?.getAttribute('data-academy-open'),
    stepInputs: document.querySelectorAll('#academy-answer').length,
    message: document.querySelector('#academy-message')?.textContent ?? '',
    complete: document.querySelector('.academy-complete')?.textContent ?? '',
    seedCode: document.querySelector('.academy-problem code')?.textContent ?? '',
    problem: document.querySelector('.academy-problem')?.textContent ?? '',
    drillButtons: document.querySelectorAll('[data-academy-drill]').length,
  };
};
const academyAnswer = value => {
  const input = document.querySelector('#academy-answer');
  if (!input) throw new Error('no academy input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelectorAll('[data-academy-check]').forEach(b => b.click());
  return { message: document.querySelector('#academy-message')?.textContent ?? '', complete: document.querySelector('.academy-complete')?.textContent ?? '', asks: !!document.querySelector('#academy-answer') };
};
const duelCoachesState = () => ({
  duel: { text: document.querySelector('#duel-panel')?.textContent?.slice(0, 200) ?? '', buttons: document.querySelectorAll('#duel-panel button').length },
  coach: { text: document.querySelector('#coach-panel')?.textContent?.slice(0, 200) ?? '', consent: document.querySelector('#coach-panel input[type="checkbox"]')?.checked ?? null },
});
const quantState = () => ({ panels: document.querySelectorAll('#quant-root .panel, #quant-root article, #quant-root section').length, firstTitle: document.querySelector('#quant-root h2, #quant-root h3')?.textContent ?? '', empty: (document.querySelector('#quant-root')?.textContent ?? '').trim().length === 0 });
const heatmapState = () => ({
  title: document.querySelector('#heatmap-title')?.textContent ?? null,
  cells: document.querySelectorAll('#heatmap-root .hm-cell').length,
  observations: (document.querySelector('#heatmap-root p.secondary')?.textContent ?? '').slice(0, 120),
  gridFocusable: document.querySelectorAll('#heatmap-root td[tabindex]').length,
});
const replayState = () => ({ rows: document.querySelectorAll('#replay-root .history-row, #replay-root .review-row').length, text: (document.querySelector('#replay-root')?.textContent ?? '').slice(0, 160), slowBtn: !!document.querySelector('#replay-slow') });

/* Driver bundle: all helpers install once per document as page globals under window.__zmDrive, so
 * helpers may reference each other by bare name (solveMany → solveOnce → OP_CALC) and no function
 * has to be serialized per call. installDriverInto runs after every navigation. */
const PAGE_FN_NAMES = Object.keys({ installTraps, pageErrors, click, jsBound, setNav, setMode, setDuration, setField, clearField, gameVisible, gameState, resultsState, solveOnce, solveMany, keypadSolveOne, entrySettingsState, dumpSessions, academyState, academyAnswer, duelCoachesState, quantState, heatmapState, replayState });
const PAGE_BUNDLE = `
  const OP_CALC = { '+': (a, b) => a + b, '−': (a, b) => a - b, '×': (a, b) => a * b, '÷': (a, b) => a / b };
  ${ ['installTraps', 'pageErrors', 'click', 'jsBound', 'setNav', 'setMode', 'setDuration', 'setField', 'clearField', 'gameVisible', 'gameState', 'resultsState', 'solveOnce', 'solveMany', 'keypadSolveOne', 'entrySettingsState', 'dumpSessions', 'academyState', 'academyAnswer', 'duelCoachesState', 'quantState', 'heatmapState', 'replayState'].map(name => {
      const fn = { installTraps, pageErrors, click, jsBound, setNav, setMode, setDuration, setField, clearField, gameVisible, gameState, resultsState, solveOnce, solveMany, keypadSolveOne, entrySettingsState, dumpSessions, academyState, academyAnswer, duelCoachesState, quantState, heatmapState, replayState }[name];
      const src = String(fn);
      return /^function /.test(src) ? src : `const ${name} = ${src};`;
    }).join('\n')
  }
  window.__zmDrive = { ${PAGE_FN_NAMES.join(', ')} };
`;

/* ---------- chrome + cdp boot ---------- */
async function installDriverInto(cdp) {
  const result = await cdp.send('Runtime.evaluate', { expression: PAGE_BUNDLE, awaitPromise: false, returnByValue: false, userGesture: true });
  if (result.exceptionDetails) throw new Error('driver install failed: ' + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text).split('\n')[0]);
  return true;
}

async function launchChrome(profileDir) {
  const child = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-proxy-server',
    '--window-size=1280,960', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const stderr = [];
  let settled = false;
  const bail = () => { try { child.kill('SIGTERM'); } catch {} };
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('chrome never reported a debug port: ' + stderr.join('').slice(0, 500))), 15000);
      const succeed = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
      const fail = error => { if (!settled) { settled = true; clearTimeout(timer); bail(); reject(error); } };
      child.stderr.on('data', chunk => { stderr.push(String(chunk)); const m = stderr.join('').match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) succeed(Number(m[1])); });
      child.on('error', error => fail(new Error('chrome spawn failed: ' + error.message + (stderr.join('').slice(0, 300)))));
      child.on('exit', code => fail(new Error('chrome exited early code ' + code + ': ' + stderr.join('').slice(0, 500))));
    });
    const targets = await (await fetch(`http://127.0.0.1:${wsUrl}/json/list`)).json();
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('no page target (targets: ' + JSON.stringify(targets.map(t => t.type)) + ')');
    settled = true;
    return { child, cdp: new Cdp(page.webSocketDebuggerUrl) };
  } catch (error) {
    bail(); // never leave a zombie Chrome behind on any launch failure
    throw error;
  }
}

/* ---------- the checklist ---------- */
const TOP = '  ↓ smoke checklist';
async function run(font) {
  const tmp = await mkdtemp(join(tmpdir(), 'opencode', 'zetamaster-smoke-'));
  const profileDir = join(tmp, 'profile');
  const scratchDir = join(tmp, 'out');
  await mkdir(scratchDir, { recursive: true });
  const { server, port } = await serveApp();
  const url = `http://127.0.0.1:${port}/`;
  let child = null, cdp = null, chrome = null;
  try {
    ({ child, cdp } = await launchChrome(profileDir));
    chrome = child;
    await cdp.ready();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');

    await step('boot: app loads over HTTP with zero JS errors', async () => {
      const probe = await fetch(url).then(r => r.status).catch(e => 'ERR ' + e.cause);
      assert(probe === 200, 'node-side probe should see the app, got ' + probe);
      await goto(cdp, url);
      await ev(cdp, installTraps);
      const errs = await ev(cdp, pageErrors);
      assert(errs.errors.length === 0, 'boot errors: ' + JSON.stringify(errs.errors));
      return 'title ' + (await ev(cdp, () => document.title));
    });

    await step('F02: custom mode opens the range panel; progress select serves the field', async () => {
      const mode = await ev(cdp, setMode, 'custom');
      assert(mode.rangesOpen, 'range panel should open in custom mode');
      assert(/custom/i.test(mode.hint), 'hint should mention custom: ' + mode.hint);
      return 'hint: ' + mode.hint;
    });

    await step('F02: half-filled axis surfaces a named-field error, never guesses', async () => {
      await ev(cdp, setField, '#add-left-min', '10000');
      await ev(cdp, click, '#start');
      await new Promise(r => setTimeout(r, 150));
      const errs = await ev(cdp, pageErrors);
      assert(errs.alerts.length === 1, 'expected one alert, got ' + JSON.stringify(errs.alerts));
      assert(errs.alerts[0].includes('Addition: first addend'), 'alert must name the field: ' + errs.alerts[0]);
      assert(!(await ev(cdp, gameVisible)), 'an invalid ruleset must never start a session');
      await ev(cdp, clearField, '#add-left-min');
      return 'alert: ' + errs.alerts[0];
    });

    await step('F05: entry settings toggle on and persist to localStorage', async () => {
      await ev(cdp, click, '#setting-keypad');
      await ev(cdp, click, '#setting-sound');
      const state = await ev(cdp, entrySettingsState);
      assert(state.keypadBox === true && state.soundBox === true, 'checkboxes should be on: ' + JSON.stringify(state));
      assert(JSON.parse(state.stored).keypad === true && JSON.parse(state.stored).sound === true, 'stored settings wrong: ' + state.stored);
      return state.stored;
    });

    let customScore = 0;
    await step('F02/F05/F10: valid custom run (add axis 3–5) plays, keypad feeds answers, tags recorded', async () => {
      await ev(cdp, setNav, 'train');
      await ev(cdp, setDuration, 15);
      await ev(cdp, setField, '#add-left-min', '3');
      await ev(cdp, setField, '#add-left-max', '5');
      await ev(cdp, click, '#start');
      await waitUntil(cdp, gameVisible, { label: 'game open' });
      const state = await ev(cdp, gameState);
      assert(state.mode.includes('CUSTOM') && state.mode.includes('PRACTICE'), 'mode line: ' + state.mode);
      assert(state.timer === '0:15', 'timer should read 0:15, got ' + state.timer);
      const k1 = await ev(cdp, keypadSolveOne);
      assert(k1.scored, 'keypad entry should solve: ' + JSON.stringify(k1));
      assert(k1.keypadVisible, 'keypad should be visible when enabled');
      const more = await ev(cdp, solveMany, 10);
      customScore = more.score;
      assert(more.solved >= 6, 'solver should clear >=6 problems, got ' + JSON.stringify(more));
      await ev(cdp, click, '#finish');
      await waitUntil(cdp, () => !document.querySelector('#results').classList.contains('hidden'), { label: 'results' });
      const res = await ev(cdp, resultsState);
      assert(Number(res.score) === customScore, 'results score mismatch');
      assert(res.title.startsWith('custom session completed'), 'title: ' + res.title);
      assert(/practice\/unverified/.test(res.detail), 'custom run must be labeled practice');
      return `solved ${customScore} via keypad+solver`;
    });

    await step('storage: custom run persisted as practice with tags + wrongAttempts arrays', async () => {
      const dump = await ev(cdp, dumpSessions);
      assert(dump.count === 1, 'expected 1 saved session, got ' + dump.count);
      const s = dump.sessions[0];
      assert(s.mode === 'custom' && s.benchmark === false && s.endedEarly === true, JSON.stringify(s));
      assert(s.eventCount === customScore, 'event count ' + s.eventCount + ' vs score ' + customScore);
      assert(s.tagsOk, 'tags must be arrays on every event');
      const stored = await ev(cdp, async () => { const db = await import('/packages/storage/src/db.js'); const ss = await db.listSessions(); return { wrongAttempts: Array.isArray(ss[0]?.events?.[0]?.wrongAttempts), trace: Array.isArray(ss[0]?.events?.[0]?.trace), firstInput: typeof ss[0]?.events?.[0]?.firstInputMs }; });
      assert(stored.wrongAttempts && stored.trace && stored.firstInput === 'number', JSON.stringify(stored));
      return JSON.stringify(dump.sessions[0]);
    });

    await step('reload: entry settings, custom ranges and history survive reload', async () => {
      await goto(cdp, url);
      await ev(cdp, installTraps);
      const state = await ev(cdp, entrySettingsState);
      assert(state.keypadBox === true, 'keypad toggle should persist');
      assert(state.addLeftPrefill === '3', 'custom ranges should prefill last-used, got ' + state.addLeftPrefill);
      const dump = await ev(cdp, dumpSessions);
      assert(dump.count === 1, 'history should survive reload');
      return 'persisted settings + 1 session';
    });

    await step('F04: sequence viewer renders history; replay relaunches as untimed practice', async () => {
      await ev(cdp, setNav, 'analytics');
      await waitUntil(cdp, () => document.querySelectorAll('#analytics-root .panel').length > 4, { label: 'analytics render' });
      const hm = await ev(cdp, heatmapState);
      assert(hm.cells > 0 && hm.title, 'heatmap should render: ' + JSON.stringify(hm));
      const rp = await ev(cdp, replayState);
      assert(rp.slowBtn, 'replay-slowest button must exist: ' + JSON.stringify(rp));
      await ev(cdp, click, '#replay-slow');
      await waitUntil(cdp, gameVisible, { label: 'replay game' });
      const g = await ev(cdp, gameState);
      assert(g.mode.startsWith('REPLAY') && g.mode.includes('PRACTICE'), 'replay mode line: ' + g.mode);
      await ev(cdp, click, '#finish');
      await waitUntil(cdp, () => !document.querySelector('#results').classList.contains('hidden'), { label: 'replay results' });
      const dump = await ev(cdp, dumpSessions);
      const replay = dump.sessions[0];
      assert(replay.mode === 'replay' && replay.benchmark === false, 'replay run must be practice: ' + JSON.stringify(replay));
      assert(dump.sessions.filter(x => x.benchmark).length === 0, 'no benchmark contaminants so far');
      return 'replay row count ' + rp.rows + '; replay run saved as practice';
    });

    await step('F26: Academy guided rehearsal completes the pinned addition example', async () => {
      await ev(cdp, setNav, 'academy');
      const academy = await ev(cdp, academyState);
      assert(academy.cards === 12 && academy.openButtons === 12, '12 cards expected, got ' + JSON.stringify(academy));
      await ev(cdp, click, '[data-academy-open="addition-round"]');
      let st = await ev(cdp, academyState);
      assert(st.stepInputs === 1, 'guided mode asks step 1, got ' + st.stepInputs);
      st = await ev(cdp, academyAnswer, '999');
      assert(/Not this one/.test(st.message), 'wrong answer should re-ask: ' + st.message);
      st = await ev(cdp, academyAnswer, '118');
      assert(st.asks && !st.complete, 'step 1 should advance to step 2');
      st = await ev(cdp, academyAnswer, '115');
      assert(/✓/.test(st.complete) && /115/.test(st.complete), 'completion line: ' + st.complete);
      return '68 + 50 = 118, 118 − 3 = 115 ✓';
    });

    await step('F26: drill hand-off launches a labeled practice run; transfer draws fresh seeded problem', async () => {
      const drills = await ev(cdp, academyState);
      assert(drills.drillButtons === 1, 'addition-round should offer one drill: ' + JSON.stringify(drills));
      await ev(cdp, click, '[data-academy-drill]');
      await waitUntil(cdp, gameVisible, { label: 'drill game' });
      const g = await ev(cdp, gameState);
      assert(g.mode.startsWith('DRILL') && g.mode.includes('PRACTICE'), 'drill mode line: ' + g.mode);
      await ev(cdp, click, '#finish');
      await waitUntil(cdp, () => !document.querySelector('#results').classList.contains('hidden'), { label: 'drill results' });
      await ev(cdp, setNav, 'academy');
      // The panel is still open from the previous step; academyToggle switches open/closed.
      // Click the open button until the transfer button is actually present.
      const ensureOpen = async () => {
        for (let i = 0; i < 2; i++) {
          const has = await ev(cdp, () => !!document.querySelector('[data-academy-transfer]'));
          if (has) return true;
          await ev(cdp, click, '[data-academy-open="addition-round"]');
          await new Promise(r => setTimeout(r, 80));
        }
        return false;
      };
      const opened = await ensureOpen();
      if (!opened) throw new Error('academy panel did not reopen (transfer button missing)');
      await ev(cdp, click, '[data-academy-transfer]');
      const st = await ev(cdp, academyState);
      assert(/seed /.test(st.seedCode), 'transfer draw should show its seed: ' + st.seedCode);
      await ev(cdp, click, '[data-academy-open="addition-round"]'); // close again
      const dump = await ev(cdp, dumpSessions);
      const drill = dump.sessions[0];
      assert(drill.mode === 'drill' && drill.benchmark === false && drill.drillStage === null, 'drill run practice-only: ' + JSON.stringify(drill));
      return 'drill saved practice; transfer seeded ' + st.seedCode;
    });

    await step('F27/F29: duel panel renders; coach verifier consent defaults OFF', async () => {
      const dc = await ev(cdp, duelCoachesState);
      assert(dc.duel.buttons > 0 && /duel|arm/i.test(dc.duel.text), 'duel panel should render: ' + JSON.stringify(dc.duel));
      assert(dc.coach.text.length > 40, 'coach panel should render');
      assert(dc.coach.consent === false, 'coach consent must default off');
      return 'duel buttons ' + dc.duel.buttons + '; coach consent off';
    });

    await step('M6: quant view renders its panels', async () => {
      await ev(cdp, setNav, 'quant');
      const q = await ev(cdp, quantState);
      assert(q.panels > 3 && !q.empty, 'quant root should render panels: ' + JSON.stringify(q));
      return q.firstTitle;
    });

    await step('F43: seeded 120s standard benchmark completes and stores benchmark:true (real time)', async () => {
      await ev(cdp, setNav, 'train');
      await ev(cdp, setMode, 'benchmark');
      await ev(cdp, setField, '#seed', 'smoke-seed-42');
      await ev(cdp, click, '#start');
      await waitUntil(cdp, gameVisible, { label: 'benchmark game' });
      const g = await ev(cdp, gameState);
      assert(g.mode === 'STANDARD BENCHMARK', 'mode line: ' + g.mode);
      // Real-time run: the only dependency-free way to execute a true 120s standard run in a real
      // browser. (CDP virtual time originally rewound the 2 minutes, but pausing it froze pending
      // IndexedDB completions for the rest of the session — the smoke suite waits the wall clock.)
      const solveStep = await ev(cdp, solveMany, 20);
      assert(solveStep.solved >= 5, 'solver should clear early problems: ' + JSON.stringify(solveStep));
      await waitUntil(cdp, () => !document.querySelector('#results').classList.contains('hidden'), { label: 'benchmark finish', timeoutMs: 140000, intervalMs: 2000 });
      const res = await ev(cdp, resultsState);
      assert(res.title === 'Standard benchmark completed', 'title: ' + res.title);
      assert(Number(res.score) > 0, 'score should be positive: ' + res.score);
      assert(/valid benchmark/.test(res.detail), 'detail should mark it valid: ' + res.detail.slice(0, 200));
      const dump = await ev(cdp, dumpSessions);
      const b = dump.sessions[0];
      assert(b.mode === 'benchmark' && b.benchmark === true, 'stored benchmark flag: ' + JSON.stringify(b));
      assert(b.rulesId === 'zetamac-default-v1', 'rules id: ' + b.rulesId);
      assert(b.elapsedMs >= 119000, 'full duration required, elapsed ' + b.elapsedMs);
      assert(b.endedEarly === false, 'not ended early');
      assert(b.seed === 'smoke-seed-42', 'seed recorded: ' + b.seed);
      return `score ${res.score}, elapsed ${b.elapsedMs}ms, seed ${b.seed}`;
    });

    await step('isolation sweep: across all saved sessions, benchmark iff standard full run', async () => {
      const dump = await ev(cdp, dumpSessions);
      const bad = dump.sessions.filter(s => {
        const isStd = s.mode === 'benchmark' && s.rulesId === 'zetamac-default-v1' && s.endedEarly === false && s.elapsedMs >= 119000;
        return s.benchmark !== isStd;
      });
      assert(bad.length === 0, 'contaminated records: ' + JSON.stringify(bad));
      assert(dump.count >= 4, 'expected ≥4 sessions by now, got ' + dump.count);
      return `${dump.count} sessions, all cleanly segregated`;
    });

    await step('F19: interrupted drill records NO spaced-review entry', async () => {
      const dump = await ev(cdp, dumpSessions);
      assert(dump.reviews === 0, 'no review records should exist after interrupted drill, got ' + dump.reviews);
      return 'review store empty ✓';
    });

    await step('heatmap screenshot: analytics view with heatmap and charts', async () => {
      await ev(cdp, setNav, 'analytics');
      await waitUntil(cdp, () => document.querySelectorAll('#analytics-root .panel').length > 4, { label: 'analytics render' });
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await mkdir(join(REPO, 'tmp'), { recursive: true });
      const path = join(REPO, 'tmp', 'smoke-analytics.png');
      await writeFile(path, Buffer.from(shot.data, 'base64'));
      console.log(`  shot ${path}`);
      const hm = await ev(cdp, heatmapState);
      return `heatmap cells ${hm.cells}, observations line: ${hm.observations}`;
    });

    await step('cleanup: delete-local-history clears the stores', async () => {
      await ev(cdp, click, '#clear-history');
      await new Promise(r => setTimeout(r, 300));
      const dump = await ev(cdp, dumpSessions);
      assert(dump.count === 0, 'sessions should be empty after delete, got ' + dump.count);
      return 'local history deleted';
    });

    const errs = await ev(cdp, pageErrors);
    await step('zero uncaught page errors across the whole session', async () => {
      assert(errs.errors.length === 0, 'page error listeners: ' + JSON.stringify(errs.errors));
      assert(cdp.pageErrors.length === 0, 'CDP page errors: ' + JSON.stringify(cdp.pageErrors));
      return 'clean (F02 alert was asserted in its own step)';
    });
  } finally {
    if (cdp) cdp.close();
    if (chrome) {
      chrome.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 300));
      try { chrome.kill('SIGKILL'); } catch {}
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
    server.close();
  }
  const failed = results.filter(r => !r.ok);
  console.log(failed.length
    ? `\nSMOKE FAILED: ${results.length - failed.length}/${results.length} passed`
    : `\nSMOKE PASSED: ${results.length}/${results.length} checks green`);
  return failed.length ? 1 : 0;
}

process.exit(await run());
