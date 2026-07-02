/* ===========================================================================
   wall.js - the public PRMSU Freedom Wall
   Anonymous posting, a live feed over Supabase realtime, a report action that
   feeds the admin review queue, and a client-side profanity filter.
   All user text is rendered with textContent / createElement (never innerHTML),
   so a post can never inject markup or scripts.
   =========================================================================== */
import { DB } from './db.js';
import { toast, reportDialog, commentsDialog } from './ui.js';

const CFG = window.PRMSU_WALL_CONFIG || {};
const FILTER = window.PRMSU_FILTER || { contains: () => false };
const POST_MAX = CFG.POST_MAX || 500;
const COOLDOWN = CFG.POST_COOLDOWN_MS || 15000;
const COLORS = ['sky', 'gold', 'mint', 'rose', 'lilac', 'peach'];

// Starter posts so a brand-new wall does not look empty. These are local
// decoration only: their ids start with "seed-", they are never sent to the
// server, and reporting one just hides it for you. Delete this array (or set
// it to []) once real posts roll in. agoMin = how long ago it was "posted".
const SEED = [
  { id: 'seed-24', body: 'lala wala parin kaming prof sa isang subj ano na gagawin nmin', nickname: null, color: 'gold', agoMin: 5 },
  { id: 'seed-25', body: 'san po ba kukuha ng sched kung wala sa sias tanong lng po', nickname: 'ramonians-3293794', color: 'sky', agoMin: 9 },
  { id: 'seed-26', body: 'grabe ang init sa loob ng room walang aircon tas 1pm pa class huhu', nickname: null, color: 'peach', agoMin: 14 },
  { id: 'seed-19', body: 'ano po gagawin kpag magkaiba ang schedule sa cor at sias nalilito po ako', nickname: null, color: 'gold', agoMin: 18 },
  { id: 'seed-27', body: 'sino dito 1A di ko pa gaano kilala mga block mates ko hehe', nickname: 'ramonians-1847265', color: 'mint', agoMin: 22 },
  { id: 'seed-16', body: 'anong window po sa registrar yung pagpa certified true copy ng cor nalilito po ako eh', nickname: 'ramonians-6620194', color: 'sky', agoMin: 25 },
  { id: 'seed-28', body: 'may nakakita po ba ng tumbler blue naiwan ko sa 3rd floor kanina', nickname: null, color: 'sky', agoMin: 30 },
  { id: 'seed-21', body: 'hello po ask ko lng po kung ano pa pong course yung may avail slot pa', nickname: 'ramonians-7788321', color: 'mint', agoMin: 35 },
  { id: 'seed-20', body: 'pa approve po admin sino po BS-EE 2A dito baka pwede pa add sa gc ng art apreciation and asean culture tyia', nickname: null, color: 'sky', agoMin: 40 },
  { id: 'seed-23', body: 'FS PRMSU BLUE PANTS waistline 27-28 pm sa price discounted na kpag iba ang buyer', nickname: 'ramonians-9910384', color: 'lilac', agoMin: 55 },
  { id: 'seed-6', body: 'kilig ako sa ka groupmate ko sa 1A kanina thankyou sa pagpahiram ng ballpen pogi mo pala', nickname: 'pogi lang', color: 'peach', agoMin: 180 },
  { id: 'seed-14', body: '3B represent bagong sem na kaya natin to mga kaklase sana all pumasa', nickname: 'ramonians-1102938', color: 'sky', agoMin: 240 },
  { id: 'seed-2', body: 'may crush ako sa 2B yung laging naka pink na scrunchie pag pe day sana mapansin nya ko char', nickname: 'ramonians-1938472', color: 'rose', agoMin: 260 },
  { id: 'seed-3', body: 'bakit puro 7am ang sched namin sa 1C di ko na kya gumising ng maaga', nickname: null, color: 'gold', agoMin: 300 },
  { id: 'seed-1', body: 'sino po dyan may extra pe uniform size medium wiling to buy pm nyo ko thnx', nickname: 'ramonians-4821093', color: 'sky', agoMin: 340 },
  { id: 'seed-15', body: 'may available pa po bang slot for civil engineering sana meron pa incoming first year po 🙏', nickname: null, color: 'mint', agoMin: 500 },
  { id: 'seed-10', body: 'grabe si sir sa math ang bilis mag discuss di ko tlga magets 2C ba kayo ganun din', nickname: null, color: 'gold', agoMin: 600 },
  { id: 'seed-12', body: 'reminder mag dala kayo tumbler mainit masyado ngaun stay hydrated', nickname: 'ramonians-3341290', color: 'peach', agoMin: 700 },
  { id: 'seed-7', body: 'bakit ang bilis masold out ng siopao sa canteen tuwing recess unfair tlga', nickname: 'ramonians-5567281', color: 'sky', agoMin: 900 },
  { id: 'seed-22', body: 'FS BSTM CORPO FOR GIRLS new corpo bstm black old corpo pm price po', nickname: 'ramonians-5029471', color: 'rose', agoMin: 1200 },
  { id: 'seed-4', body: 'shoutout kay ate sa canteen ang bait laging dinadagdagan ako ng kanin hahah', nickname: 'ramonians-7261540', color: 'mint', agoMin: 1400 },
  { id: 'seed-8', body: 'sino kasama ko sa 2A ngaun sem add nyo ko di pa ako marunong mag adjust dito', nickname: null, color: 'gold', agoMin: 1440 },
  { id: 'seed-11', body: 'who is that pretty girl sa 1B na laging naka ponytail asa na crush ko hahaha sana single', nickname: 'ramonians-8890021', color: 'lilac', agoMin: 1500 },
  { id: 'seed-17', body: 'tanong lng po kelan po deadline ng adding and dropping ng subject salamat po', nickname: null, color: 'lilac', agoMin: 2000 },
  { id: 'seed-5', body: 'naghahanap po ako ng lab gown mura lng 3A po ako pm nyo ko salamat', nickname: null, color: 'lilac', agoMin: 2600 },
  { id: 'seed-18', body: 'open pa po ba ang shifting ng course gusto ko sana mag shift di ko type course ko ngaun', nickname: 'ramonians-4409183', color: 'peach', agoMin: 3600 },
  { id: 'seed-9', body: 'sana all may ka LT ako nlang wala char lang guys 4A here 🥲', nickname: 'ramonians-2093847', color: 'rose', agoMin: 4320 },
  { id: 'seed-13', body: 'salamat po sa nakapulot ng wallet ko last week ibinalik ng buo may pag asa pa pala tao', nickname: null, color: 'mint', agoMin: 5760 },
];
function seedRows() {
  // Starter posts now live in the database (run seed-posts.sql) so they show in
  // the admin panel and can be moderated. Nothing is injected client-side.
  return [];
}

// hardcoded comments for a few seed posts, plus anything a visitor adds locally
const SEED_COMMENTS = {
  'seed-2': [{ body: 'HAHAHA sana all may ganyan', nickname: null, agoMin: 4000 }, { body: 'char lang mga bes', nickname: null, agoMin: 3200 }],
  'seed-6': [{ body: 'awts sino ka? 👀 char', nickname: null, agoMin: 380 }],
  'seed-11': [{ body: 'alam ko yan HAHAHA', nickname: 'tropa', agoMin: 2500 }],
  'seed-14': [{ body: 'lets goo 3B 💪', nickname: null, agoMin: 250 }],
  'seed-20': [{ body: 'add mo ko po, BS-EE 2A din ako', nickname: 'classmate', agoMin: 40 }],
  'seed-22': [{ body: 'hm po old corpo?', nickname: 'Rhona', agoMin: 840 }],
};
function seedLocal() { try { return JSON.parse(localStorage.getItem('prmsu_wall_seedcmt') || '{}'); } catch { return {}; } }
function seedCommentsFor(id) {
  const hard = (SEED_COMMENTS[id] || []).map((c) => ({ body: c.body, nickname: c.nickname || null, created_at: new Date(Date.now() - c.agoMin * 60000).toISOString() }));
  const loc = seedLocal()[id] || [];
  return [...hard, ...loc].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}
function seedCommentCount(id) { return (SEED_COMMENTS[id] || []).length + ((seedLocal()[id] || []).length); }
function addSeedComment(id, body, nick) {
  const all = seedLocal(); all[id] = all[id] || [];
  const c = { body: body, nickname: nick || null, created_at: new Date().toISOString() };
  all[id].push(c); localStorage.setItem('prmsu_wall_seedcmt', JSON.stringify(all));
  return c;
}

/* ------------ dom helpers ------------ */
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function svg(paths, w) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', w || '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = paths; // static, developer-authored icon markup only
  return s;
}

/* ------------ state ------------ */
const state = { posts: [], map: new Map(), color: 'sky', loading: true, dismissed: new Set() };

/* a stable anonymous id so one browser can report a post once */
function reporterToken() {
  let t = localStorage.getItem('prmsu_wall_uid');
  if (!t) { t = crypto.randomUUID(); localStorage.setItem('prmsu_wall_uid', t); }
  return t;
}

/* an auto nickname saved per browser, e.g. ramonians-1842097 */
function getHandle() {
  let h = localStorage.getItem('prmsu_wall_nick');
  if (!h) { h = 'ramonians-' + Math.floor(1000000 + Math.random() * 9000000); localStorage.setItem('prmsu_wall_nick', h); }
  return h;
}

/* a friendly (simulated) "total Ramonians" count that ticks up once a day at
   5pm. Deterministic, so it is stable within a day and jumps at the 5pm boundary. */
function fakeUsers() {
  const BASE = 580;
  const START = Date.UTC(2026, 5, 29, 9, 0, 0); // Jun 29 2026, 5:00pm PH (=09:00 UTC)
  const periods = Math.max(0, Math.floor((Date.now() - START) / 86400000));
  let total = BASE;
  for (let i = 0; i < periods; i++) {
    total += 15 + (((i * 2654435761) % 31) + 31) % 31; // deterministic +15..45 per day
  }
  return total;
}
function updateUserCount() {
  const eln = $('userCount');
  if (eln) eln.textContent = fakeUsers().toLocaleString();
}

/* ------------ time ------------ */
function ago(iso) {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ------------ menus (report kebab) ------------ */
let openMenu = null, openTrigger = null;
function closeMenu(focusTrigger) {
  if (openMenu) { openMenu.remove(); openMenu = null; }
  if (openTrigger) {
    openTrigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger) openTrigger.focus();
    openTrigger = null;
  }
}
document.addEventListener('click', (e) => {
  if (openMenu && !openMenu.contains(e.target) && !e.target.closest('[data-menu-btn]')) closeMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openMenu) closeMenu(true); });

/* ============================================================================
   RENDER
   ========================================================================== */
function buildNote(post) {
  const note = el('div', 'note note--' + (COLORS.includes(post.color) ? post.color : 'sky'));
  note.dataset.id = post.id;
  note.appendChild(el('div', 'note-body', post.body));

  const meta = el('div', 'note-meta');
  meta.appendChild(post.nickname
    ? el('span', 'note-who', post.nickname)
    : el('span', 'note-who anon', 'Anonymous'));
  meta.appendChild(el('span', 'note-dot', '·'));
  meta.appendChild(el('span', 'note-time', ago(post.created_at)));

  const right = el('div', 'note-right');
  const cbtn = el('button', 'note-cmt');
  cbtn.setAttribute('aria-label', 'Comments');
  cbtn.appendChild(svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>', '1.8'));
  cbtn.appendChild(el('span', 'note-cmt-n', String(post.comment_count || 0)));
  cbtn.onclick = () => openComments(post);
  right.appendChild(cbtn);

  const kebab = el('div', 'note-kebab');
  const kb = el('button', 'kebab-btn');
  kb.setAttribute('data-menu-btn', '');
  kb.setAttribute('aria-label', 'Post options');
  kb.setAttribute('aria-haspopup', 'true');
  kb.setAttribute('aria-expanded', 'false');
  kb.appendChild(svg('<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>', '1.5'));
  kb.onclick = (ev) => {
    ev.stopPropagation();
    const wasThis = openMenu && openTrigger === kb;
    closeMenu();
    if (wasThis) return;
    const menu = el('div', 'kebab-menu');
    const rep = el('button', 'danger');
    rep.appendChild(svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>', '1.9'));
    rep.appendChild(el('span', null, 'Report post'));
    rep.onclick = () => { closeMenu(); reportPost(post); };
    menu.appendChild(rep);
    kebab.appendChild(menu);
    openMenu = menu; openTrigger = kb;
    kb.setAttribute('aria-expanded', 'true');
  };
  kebab.appendChild(kb);
  right.appendChild(kebab);
  meta.appendChild(right);

  note.appendChild(meta);
  return note;
}

function openComments(post) {
  const isSeed = String(post.id).startsWith('seed-');
  commentsDialog({
    post,
    defaultNick: getHandle(),
    fetchComments: async () => (isSeed ? seedCommentsFor(post.id) : await DB.fetchComments(post.id)),
    submitComment: async (body, nick) => {
      if (FILTER.contains(body) || FILTER.contains(nick)) throw new Error('Please keep it kind. Remove the offensive language.');
      if (nick) localStorage.setItem('prmsu_wall_nick', nick);
      const c = isSeed ? addSeedComment(post.id, body, nick) : await DB.createComment(post.id, body, nick);
      post.comment_count = (post.comment_count || 0) + 1;
      const noteEl = document.querySelector('.note[data-id="' + cssEsc(post.id) + '"]');
      if (noteEl) noteEl.replaceWith(buildNote(post));
      return c;
    },
  });
}

function render() {
  const feed = $('feed');
  feed.textContent = '';
  if (state.loading) {
    for (let i = 0; i < 6; i++) feed.appendChild(el('div', 'sk'));
    return;
  }
  if (!state.posts.length) {
    const empty = el('div', 'empty');
    empty.appendChild(svg('<path d="M14 9V5a3 3 0 0 0-6 0v4"/><rect x="4" y="9" width="16" height="11" rx="2"/>', '1.6'));
    empty.appendChild(el('div', null, 'The wall is empty. Be the first Ramonian to write something.'));
    empty.style.columnSpan = 'all';
    feed.appendChild(empty);
    $('count').textContent = '';
    return;
  }
  state.posts.forEach((p) => feed.appendChild(buildNote(p)));
  $('count').textContent = '· ' + state.posts.length + (state.posts.length === 1 ? ' post' : ' posts');
}

/* ============================================================================
   ACTIONS
   ========================================================================== */
async function reportPost(post) {
  const res = await reportDialog();
  if (!res) return;
  try {
    await DB.report(post.id, res.reason, reporterToken());
    state.dismissed.add(post.id);
    removePost(post.id);
    toast('Thanks. Sent to the admins for review.', 'ok');
  } catch (err) {
    toast(err.message || 'Could not report.', 'err');
  }
}

async function submitPost() {
  const btn = $('postBtn');
  const bodyEl = $('body');
  const nickEl = $('nick');
  const errEl = $('composeErr');
  const body = bodyEl.value.trim();
  const nick = nickEl.value.trim();

  const showErr = (m) => { errEl.textContent = m; errEl.classList.remove('hidden'); };
  errEl.classList.add('hidden');

  if (!body) return showErr('Write something first.');
  if (body.length > POST_MAX) return showErr('That is a bit long. Keep it under ' + POST_MAX + ' characters.');
  if (FILTER.contains(body) || FILTER.contains(nick)) {
    return showErr('Let us keep it kind. Please remove the offensive language before posting.');
  }
  const last = Number(localStorage.getItem('prmsu_wall_last') || 0);
  const wait = Math.ceil((COOLDOWN - (Date.now() - last)) / 1000);
  if (last && wait > 0) return showErr('You just posted. Please wait ' + wait + 's before posting again.');

  btn.disabled = true;
  try {
    const row = await DB.createPost({ body, nickname: nick, color: state.color });
    if (nick) localStorage.setItem('prmsu_wall_nick', nick); // remember their chosen handle
    localStorage.setItem('prmsu_wall_last', String(Date.now()));
    bodyEl.value = '';
    nickEl.value = getHandle();
    if (row && row.id) upsertPost(row, true);
    toast('Posted to the wall.', 'ok');
  } catch (err) {
    showErr(err.message || 'Could not post. Please try again.');
  } finally {
    updateCounter(); // recompute button state (stays disabled over an empty box)
  }
}

/* ------------ list mutations ------------ */
function upsertPost(post, prepend) {
  if (!post || (post.status && post.status !== 'visible')) return;
  if (state.dismissed.has(post.id)) return;
  if (state.map.has(post.id)) {
    Object.assign(state.map.get(post.id), post);
    const old = document.querySelector('.note[data-id="' + cssEsc(post.id) + '"]');
    if (old) old.replaceWith(buildNote(state.map.get(post.id)));
    return;
  }
  state.map.set(post.id, post);
  if (prepend) state.posts.unshift(post); else state.posts.push(post);
  state.posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  render();
}
function removePost(id) {
  if (!state.map.has(id)) return;
  state.map.delete(id);
  state.posts = state.posts.filter((p) => p.id !== id);
  render();
}
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

/* ============================================================================
   LOAD + REALTIME
   ========================================================================== */
function setPosts(list) {
  const merged = list
    .filter((p) => !state.dismissed.has(p.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  state.posts = merged;
  state.map = new Map(merged.map((p) => [p.id, p]));
}

async function load(silent) {
  if (!silent) { state.loading = true; render(); }
  try {
    const real = await DB.fetchPosts(400);
    setPosts([...real, ...seedRows()]);   // real posts + the local seed posts
  } catch (err) {
    if (!silent) toast(err.message || 'Could not load the wall.', 'err');
    setPosts(seedRows());                 // still show the seed so the wall is never empty
  } finally {
    state.loading = false; render();
  }
}

function wireRealtime() {
  DB.subscribe({
    onInsert: (row) => { if (row === null) { load(true); return; } upsertPost(row, true); },
    onUpdate: (row) => {
      if (!row) return;
      if (row.status && row.status !== 'visible') { removePost(row.id); return; }
      upsertPost(row, true);
    },
    onDelete: (row) => { if (row && row.id) removePost(row.id); },
  });
  // Admin hides arrive as RLS-filtered UPDATEs that never reach anon subscribers,
  // so reconcile on focus and on a light interval to drop hidden posts live.
  const resync = () => { updateUserCount(); if (document.visibilityState === 'visible') load(true); };
  document.addEventListener('visibilitychange', resync);
  window.addEventListener('focus', resync);
  setInterval(resync, 60000);
}

/* ============================================================================
   COMPOSE UI
   ========================================================================== */
function updateCounter() {
  const len = $('body').value.trim().length;
  const left = POST_MAX - len;
  const c = $('counter');
  c.textContent = String(left);
  c.classList.toggle('over', left < 0);
  $('postBtn').disabled = len === 0 || left < 0;
}

function initCompose() {
  const bodyEl = $('body');
  $('nick').value = getHandle(); // start with the saved auto handle (they can edit it)
  bodyEl.addEventListener('input', () => { updateCounter(); $('composeErr').classList.add('hidden'); });
  bodyEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitPost(); }
  });
  $('postBtn').onclick = submitPost;

  // color swatches: roving tabindex + arrow-key navigation (ARIA radiogroup)
  const sws = [...$('swatches').querySelectorAll('.swatch')];
  function selectSwatch(b, focus) {
    sws.forEach((x) => {
      const on = x === b;
      x.classList.toggle('sel', on);
      x.setAttribute('aria-checked', on ? 'true' : 'false');
      x.tabIndex = on ? 0 : -1;
    });
    state.color = b.dataset.color;
    if (focus) b.focus();
  }
  sws.forEach((b, i) => {
    b.onclick = () => selectSwatch(b);
    b.onkeydown = (e) => {
      let n = -1;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + sws.length) % sws.length;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % sws.length;
      else return;
      e.preventDefault();
      selectSwatch(sws[n], true);
    };
  });
  selectSwatch(sws.find((x) => x.classList.contains('sel')) || sws[0]);
  updateCounter();
}

/* ============================================================================
   BOOT
   ========================================================================== */
function boot() {
  if (!DB.isConfigured()) $('demoBar').classList.remove('hidden');
  $('footMeta').textContent = 'Version ' + (CFG.VERSION || '1.0.0') + ' · Last updated ' + (CFG.UPDATED || '');
  updateUserCount();
  $('refreshBtn').onclick = () => load(false);
  initCompose();
  load(false);
  wireRealtime();
}
boot();
