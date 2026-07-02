/* ===========================================================================
   wall.js - PRMSU Freedom Wall (modern app-like feed)
   Categories, filter/sort/search, like/reply/report, mobile bottom-sheet
   composer, smooth scroll, animated cards. All user text via textContent.
   =========================================================================== */
import { DB } from './db.js';
import { toast, reportDialog, commentsDialog, openSheet } from './ui.js';

const CFG = window.PRMSU_WALL_CONFIG || {};
const FILTER = window.PRMSU_FILTER || { contains: () => false };
const POST_MAX = CFG.POST_MAX || 500;
const COOLDOWN = CFG.POST_COOLDOWN_MS || 15000;
const LOAD_STEP = 25;

const POST_CATS = [
  { key: 'confession', label: 'Confession' }, { key: 'crush', label: 'Crush' },
  { key: 'rant', label: 'Rant' }, { key: 'question', label: 'Question' },
  { key: 'funny', label: 'Funny' }, { key: 'lostfound', label: 'Lost & Found' },
  { key: 'tip', label: 'Campus Tip' },
];
const FILTERS = [{ key: 'all', label: 'All' }].concat([
  { key: 'confession', label: 'Confessions' }, { key: 'crush', label: 'Crushes' },
  { key: 'rant', label: 'Rants' }, { key: 'question', label: 'Questions' },
  { key: 'funny', label: 'Funny' }, { key: 'lostfound', label: 'Lost & Found' },
  { key: 'tip', label: 'Campus Tips' },
]);
const SORTS = [{ key: 'new', label: 'New' }, { key: 'trending', label: 'Trending' }, { key: 'top', label: 'Most Reacted' }];
const CAT_LABEL = { confession: 'Confession', crush: 'Crush', rant: 'Rant', question: 'Question', funny: 'Funny', lostfound: 'Lost & Found', tip: 'Campus Tip' };
const CAT_COLOR = { confession: '#7C5CFC', crush: '#EC4E86', rant: '#EF6C4D', question: '#2E8BEF', funny: '#E0A20B', lostfound: '#1FA97E', tip: '#0FA9C4' };
const catOf = (p) => (CAT_LABEL[p && p.category] ? p.category : 'confession');

/* ---------------- dom helpers ---------------- */
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function svg(paths, w) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', w || '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = paths; return s;
}
const ICON = {
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
};

/* ---------------- state ---------------- */
const state = { posts: [], map: new Map(), dismissed: new Set(), cat: 'all', sort: 'new', q: '', shown: LOAD_STEP, loading: true, composeCat: 'confession' };

/* ---------------- per-browser identity + likes ---------------- */
function getHandle() {
  let h = localStorage.getItem('prmsu_wall_nick');
  if (!h) { h = 'ramonians-' + Math.floor(1000000 + Math.random() * 9000000); localStorage.setItem('prmsu_wall_nick', h); }
  return h;
}
function reporterToken() {
  let t = localStorage.getItem('prmsu_wall_uid');
  if (!t) { t = crypto.randomUUID(); localStorage.setItem('prmsu_wall_uid', t); }
  return t;
}
function likedMap() { try { return JSON.parse(localStorage.getItem('prmsu_wall_liked') || '{}'); } catch { return {}; } }
function isLiked(id) { return !!likedMap()[id]; }
function setLiked(id, on) { const m = likedMap(); if (on) m[id] = 1; else delete m[id]; localStorage.setItem('prmsu_wall_liked', JSON.stringify(m)); }

/* ---------------- time ---------------- */
function ago(iso) {
  const t = new Date(iso).getTime(); if (isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h';
  const d = Math.floor(h / 24); if (d < 7) return d + 'd';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ---------------- content safety check ---------------- */
function contentIssue(text) {
  if (FILTER.contains(text)) return 'Let’s keep it kind — please remove the offensive words.';
  if (/(^|\D)09\d{2}[\s-]?\d{3}[\s-]?\d{4}(\D|$)/.test(text) || /\b\d{8,}\b/.test(text)) return 'Please remove phone or student numbers — keep it anonymous.';
  return null;
}

/* ---------------- simulated online count ---------------- */
function fakeUsers() {
  const BASE = 580, START = Date.UTC(2026, 5, 29, 9, 0, 0);
  const periods = Math.max(0, Math.floor((Date.now() - START) / 86400000));
  let total = BASE;
  for (let i = 0; i < periods; i++) total += 15 + (((i * 2654435761) % 31) + 31) % 31;
  return total;
}
function updateUserCount() { const e = $('userCount'); if (e) e.textContent = fakeUsers().toLocaleString(); }

/* ============================================================================
   CATEGORY / FILTER / SORT UI
   ========================================================================== */
function buildCatSelect(container, current, onPick) {
  container.textContent = '';
  POST_CATS.forEach((c) => {
    const b = el('button', 'cat-chip', c.label);
    b.type = 'button'; b.dataset.cat = c.key;
    b.setAttribute('aria-pressed', String(c.key === current));
    b.onclick = () => {
      container.querySelectorAll('.cat-chip').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      onPick(c.key);
    };
    container.appendChild(b);
  });
}
function buildSortSeg() {
  const wrap = $('sortSeg'); wrap.textContent = '';
  SORTS.forEach((s) => {
    const b = el('button', 'sort-btn' + (s.key === state.sort ? ' active' : ''), s.label);
    b.type = 'button';
    b.onclick = () => { state.sort = s.key; state.shown = LOAD_STEP; wrap.querySelectorAll('.sort-btn').forEach((x) => x.classList.remove('active')); b.classList.add('active'); render(); };
    wrap.appendChild(b);
  });
}
/* ============================================================================
   FEED
   ========================================================================== */
function buildCard(post, idx) {
  const cat = catOf(post);
  const card = el('article', 'pcard'); card.dataset.id = post.id; card.dataset.cat = cat;
  if (idx < 8) card.style.animationDelay = (idx * 45) + 'ms';

  const top = el('div', 'pcard-top');
  const badge = el('span', 'cat-badge', CAT_LABEL[cat]); badge.dataset.cat = cat;
  top.appendChild(badge);
  top.appendChild(el('span', 'pcard-time', ago(post.created_at)));
  card.appendChild(top);

  const who = el('div', 'pcard-who');
  who.appendChild(document.createTextNode('by '));
  who.appendChild(el('b', null, post.nickname || 'Anonymous Ramonian'));
  card.appendChild(who);

  card.appendChild(el('div', 'pcard-body', post.body));

  const acts = el('div', 'pcard-actions');
  // like
  const likeBtn = el('button', 'pact' + (isLiked(post.id) ? ' liked' : ''));
  likeBtn.setAttribute('aria-label', 'Like');
  likeBtn.appendChild(svg(ICON.heart, '1.9'));
  likeBtn.appendChild(el('span', 'like-n', String(post.like_count || 0)));
  likeBtn.onclick = () => toggleLike(post, likeBtn);
  acts.appendChild(likeBtn);
  // reply (comments)
  const reply = el('button', 'pact');
  reply.setAttribute('aria-label', 'Reply');
  reply.appendChild(svg(ICON.chat, '1.8'));
  reply.appendChild(el('span', null, String(post.comment_count || 0)));
  reply.onclick = () => openComments(post);
  acts.appendChild(reply);
  // report
  const rep = el('button', 'pact report');
  rep.setAttribute('aria-label', 'Report');
  rep.appendChild(svg(ICON.flag, '1.8'));
  rep.appendChild(el('span', null, 'Report'));
  rep.onclick = () => reportPost(post);
  acts.appendChild(rep);

  card.appendChild(acts);
  return card;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = state.posts.filter((p) => !state.dismissed.has(p.id));
  if (state.cat !== 'all') list = list.filter((p) => catOf(p) === state.cat);
  if (q) list = list.filter((p) => (p.body || '').toLowerCase().includes(q) || (p.nickname || '').toLowerCase().includes(q));
  const t = (p) => new Date(p.created_at).getTime();
  if (state.sort === 'new') list.sort((a, b) => t(b) - t(a));
  else if (state.sort === 'top') list.sort((a, b) => (b.like_count || 0) - (a.like_count || 0) || t(b) - t(a));
  else { // trending: engagement decayed by age
    const score = (p) => ((p.like_count || 0) + (p.comment_count || 0) * 1.5 + 1) / Math.pow((Date.now() - t(p)) / 3600000 + 2, 0.55);
    list.sort((a, b) => score(b) - score(a));
  }
  return list;
}
function render() {
  const feed = $('feed');
  if (state.loading) {
    feed.textContent = '';
    for (let i = 0; i < 5; i++) {
      const s = el('div', 'skel');
      s.appendChild(el('div', 'skel-line w30'));
      s.appendChild(el('div', 'skel-line w90'));
      s.appendChild(el('div', 'skel-line w70'));
      s.appendChild(el('div', 'skel-line w40'));
      feed.appendChild(s);
    }
    $('loadMoreWrap').style.display = 'none';
    return;
  }
  const list = filtered();
  $('count').textContent = list.length ? list.length + (list.length === 1 ? ' post' : ' posts') : '';
  feed.textContent = '';
  if (!list.length) {
    const e = el('div', 'empty2');
    e.appendChild(el('span', 'big', '📝'));
    const b = el('b', null, state.q || state.cat !== 'all' ? 'Walang nahanap.' : 'Wala pang posts. Ikaw na mauna.');
    e.appendChild(b);
    e.appendChild(el('div', null, state.q || state.cat !== 'all' ? 'Try another category or search.' : 'Tap “Post anonymously” and share mo na, Ramonian.'));
    feed.appendChild(e);
    $('loadMoreWrap').style.display = 'none';
    return;
  }
  const slice = list.slice(0, state.shown);
  slice.forEach((p, i) => feed.appendChild(buildCard(p, i)));
  $('loadMoreWrap').style.display = list.length > state.shown ? 'flex' : 'none';
}

/* ---------------- actions ---------------- */
async function toggleLike(post, btn) {
  const on = isLiked(post.id);
  const delta = on ? -1 : 1;
  post.like_count = Math.max(0, (post.like_count || 0) + delta);
  setLiked(post.id, !on);
  btn.classList.toggle('liked', !on);
  const n = btn.querySelector('.like-n'); if (n) n.textContent = String(post.like_count);
  if (!on) { const ic = btn.querySelector('svg'); if (ic) { ic.classList.remove('pop-heart'); void ic.offsetWidth; ic.classList.add('pop-heart'); } }
  try {
    const updated = await DB.likePost(post.id, delta);
    if (updated && typeof updated.like_count === 'number') { post.like_count = updated.like_count; if (n) n.textContent = String(post.like_count); }
  } catch (err) {
    post.like_count = Math.max(0, (post.like_count || 0) - delta); setLiked(post.id, on);
    btn.classList.toggle('liked', on); if (n) n.textContent = String(post.like_count);
    toast(err.message || 'Could not like.', 'err');
  }
}
async function reportPost(post) {
  const res = await reportDialog();
  if (!res) return;
  try {
    await DB.report(post.id, res.reason, reporterToken());
    state.dismissed.add(post.id); removePost(post.id);
    toast('Report submitted. Salamat!', 'ok');
  } catch (err) { toast(err.message || 'Could not report.', 'err'); }
}
function openComments(post) {
  commentsDialog({
    post, defaultNick: getHandle(),
    fetchComments: () => DB.fetchComments(post.id),
    submitComment: async (body, nick) => {
      const issue = contentIssue(body); if (issue) throw new Error(issue);
      if (nick) localStorage.setItem('prmsu_wall_nick', nick);
      const c = await DB.createComment(post.id, body, nick);
      post.comment_count = (post.comment_count || 0) + 1; patchCard(post);
      return c;
    },
  });
}

/* ---------------- compose ---------------- */
async function doPost(body, category, onDone) {
  const issue = contentIssue(body);
  if (!body.trim()) throw new Error('Write something first 🙂');
  if (body.length > POST_MAX) throw new Error('Sobrang haba — keep it under ' + POST_MAX + ' characters.');
  if (issue) throw new Error(issue);
  const last = Number(localStorage.getItem('prmsu_wall_last') || 0);
  const wait = Math.ceil((COOLDOWN - (Date.now() - last)) / 1000);
  if (last && wait > 0) throw new Error('Sandali lang — wait ' + wait + 's before posting again.');
  const row = await DB.createPost({ body: body.trim(), nickname: getHandle(), color: 'sky', category });
  localStorage.setItem('prmsu_wall_last', String(Date.now()));
  if (row && row.id) { row.like_count = row.like_count || 0; row.comment_count = row.comment_count || 0; upsertPost(row, true); }
  if (onDone) onDone();
}

function initDesktopComposer() {
  const bodyEl = $('body'), counter = $('counter'), btn = $('postBtn'), warn = $('composeWarn');
  buildCatSelect($('catSelect'), state.composeCat, (k) => { state.composeCat = k; });
  const sync = () => {
    const len = bodyEl.value.trim().length, left = POST_MAX - len;
    counter.textContent = String(left); counter.classList.toggle('over', left < 0);
    btn.disabled = len === 0 || left < 0;
    const issue = contentIssue(bodyEl.value);
    if (issue && len > 0) { warn.textContent = issue; warn.classList.remove('hidden'); } else warn.classList.add('hidden');
  };
  bodyEl.addEventListener('input', sync);
  bodyEl.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); btn.click(); } });
  btn.onclick = async () => {
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Posting…';
    try {
      await doPost(bodyEl.value, state.composeCat, () => { bodyEl.value = ''; sync(); });
      toast('Posted anonymously! 🎉', 'ok');
    } catch (err) { warn.textContent = err.message; warn.classList.remove('hidden'); }
    finally { btn.disabled = false; btn.textContent = ''; btn.appendChild(document.createTextNode('Post anonymously ')); btn.appendChild(svg(ICON.send, '1.9')); btn.querySelector('svg').classList.add('ico'); }
  };
  sync();
}

function openComposerSheet() {
  let cat = 'confession';
  openSheet((close, sheet) => {
    const head = el('div', 'sheet-head');
    head.appendChild(el('h3', null, 'Post anonymously'));
    const x = el('button', 'sheet-x', '×'); x.setAttribute('aria-label', 'Close'); x.onclick = () => close(null);
    head.appendChild(x); sheet.appendChild(head);

    const bodyWrap = el('div', 'sheet-body');
    const ta = el('textarea', 'comp-textarea'); ta.maxLength = POST_MAX; ta.placeholder = 'Ano’ng gusto mong sabihin, Ramonian?'; ta.setAttribute('data-autofocus', '');
    bodyWrap.appendChild(ta);
    const mid = el('div', 'comp-mid');
    mid.appendChild(el('div', 'cat-label', 'Category'));
    const cs = el('div', 'cat-select'); mid.appendChild(cs); bodyWrap.appendChild(mid);
    buildCatSelect(cs, cat, (k) => { cat = k; });
    const warn = el('div', 'comp-warn hidden'); bodyWrap.appendChild(warn);
    bodyWrap.appendChild(el('div', 'comp-reminder', 'No names, sections, student numbers, or private info.'));
    sheet.appendChild(bodyWrap);

    const foot = el('div', 'sheet-foot');
    const row = el('div', 'comp-foot'); const counter = el('span', 'counter', String(POST_MAX)); row.appendChild(counter); foot.appendChild(row);
    const btn = el('button', 'btn block', 'Post anonymously');
    foot.appendChild(btn); sheet.appendChild(foot);

    const sync = () => {
      const left = POST_MAX - ta.value.trim().length; counter.textContent = String(left); counter.classList.toggle('over', left < 0);
      const issue = contentIssue(ta.value);
      if (issue && ta.value.trim()) { warn.textContent = issue; warn.classList.remove('hidden'); } else warn.classList.add('hidden');
    };
    ta.addEventListener('input', sync); sync();
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Posting…';
      try {
        await doPost(ta.value, cat, null);
        close(true); toast('Posted anonymously! 🎉', 'ok');
      } catch (err) { warn.textContent = err.message; warn.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Post anonymously'; }
    };
  });
}

/* ---------------- list mutations ---------------- */
function patchCard(post) {
  const oldEl = document.querySelector('.pcard[data-id="' + cssEsc(post.id) + '"]');
  if (oldEl) { const nc = buildCard(post, 99); nc.style.animation = 'none'; oldEl.replaceWith(nc); }
}
function upsertPost(post, prepend) {
  if (!post || (post.status && post.status !== 'visible') || state.dismissed.has(post.id)) return;
  if (state.map.has(post.id)) { Object.assign(state.map.get(post.id), post); patchCard(state.map.get(post.id)); return; }
  state.map.set(post.id, post);
  if (prepend) state.posts.unshift(post); else state.posts.push(post);
  render();}
function removePost(id) { if (!state.map.has(id)) return; state.map.delete(id); state.posts = state.posts.filter((p) => p.id !== id); render(); }
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

/* ---------------- load + realtime ---------------- */
async function load(silent) {
  if (!silent) { state.loading = true; render(); }
  try {
    const posts = (await DB.fetchPosts(400)).filter((p) => !state.dismissed.has(p.id));
    state.posts = posts; state.map = new Map(posts.map((p) => [p.id, p]));
  } catch (err) { if (!silent) toast(err.message || 'Something went wrong. Try refreshing.', 'err'); }
  finally { state.loading = false; render(); }
}
function wireRealtime() {
  DB.subscribe({
    onInsert: (row) => { if (row === null) { load(true); return; } upsertPost(row, true); },
    onUpdate: (row) => { if (!row) return; if (row.status && row.status !== 'visible') { removePost(row.id); return; } upsertPost(row, true); },
    onDelete: (row) => { if (row && row.id) removePost(row.id); },
  });
  const resync = () => { updateUserCount(); if (document.visibilityState === 'visible') load(true); };
  document.addEventListener('visibilitychange', resync);
  window.addEventListener('focus', resync);
  setInterval(resync, 60000);
}

/* ---------------- chrome: menu, scroll, fab ---------------- */
function initChrome() {
  const menu = $('mobileMenu'), btn = $('menuBtn');
  const closeMenu = () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
  btn.onclick = () => { const open = menu.classList.toggle('open'); btn.setAttribute('aria-expanded', String(open)); };
  menu.querySelectorAll('[data-close]').forEach((e) => e.addEventListener('click', closeMenu));

  // smooth scroll for in-page links
  document.querySelectorAll('a[data-scroll]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href'); if (!id || id[0] !== '#') return;
      const target = document.querySelector(id); if (!target) return;
      e.preventDefault(); closeMenu(); target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // mobile composer triggers
  $('postTrigger').onclick = openComposerSheet;
  $('fab').onclick = openComposerSheet;

  // fab appears after scrolling a bit
  const fab = $('fab');
  const onScroll = () => { fab.classList.toggle('show', window.scrollY > 260); };
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // load more
  $('loadMore').onclick = () => { state.shown += LOAD_STEP; render(); };

  // search (debounced)
  let tmr; $('search').addEventListener('input', (e) => { clearTimeout(tmr); const v = e.target.value; tmr = setTimeout(() => { state.q = v; state.shown = LOAD_STEP; render(); }, 180); });

  $('refreshHint');
}

/* ---------------- boot ---------------- */
function boot() {
  if (!DB.isConfigured()) $('demoBar').classList.remove('hidden');
  $('footMeta').textContent = 'Version ' + (CFG.VERSION || '1.0.0') + ' · Last updated ' + (CFG.UPDATED || '');
  // inject the live "online" badge into the welcome banner
  const badges = document.querySelector('.welcome-badges');
  if (badges && !$('userBadge')) {
    const span = el('span', 'badge2'); span.id = 'userBadge';
    span.appendChild(el('span', 'dot'));
    const b = el('b'); b.id = 'userCount'; span.appendChild(b);
    span.appendChild(document.createTextNode(' online'));
    badges.appendChild(span);
  }
  updateUserCount();
  buildSortSeg(); initDesktopComposer(); initChrome();
  load(false); wireRealtime();
}
boot();
