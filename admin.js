/* ===========================================================================
   admin.js - the PRMSU Freedom Wall admin / moderation side.
     - login (existing admins)
     - not-an-admin screen (apply to moderate)
     - dashboard: review queue, live/hidden/all posts, admin applications, admins
   The main admin's identity is kept anonymous: emails are masked in the UI so a
   screenshot never leaks who the admin is. Every privileged action is also
   enforced server-side by RLS + the admin_* SECURITY DEFINER functions.
   =========================================================================== */
import { DB } from './db.js';
import { toast, confirmDialog } from './ui.js';

const CFG = window.PRMSU_WALL_CONFIG || {};
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
  s.innerHTML = paths;
  return s;
}
function fmt(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function maskEmail(e) {
  if (!e || e.indexOf('@') < 0) return 'admin';
  const [u, d] = e.split('@');
  const um = u.length <= 2 ? u[0] + '***' : u[0] + '***' + u[u.length - 1];
  return um + '@' + d;
}
const reviewNeeded = (p) => p.status === 'pending' || ((p.report_count || 0) > 0 && p.status === 'visible');

const state = { user: null, tab: 'review', role: 'mod', paused: false };

/* live owner-inbox subscription (owner only) */
let msgSub = null;
function teardownMsgSub() { if (msgSub) { msgSub(); msgSub = null; } }
async function onNewOwnerMessage() {
  if (state.tab === 'messages') {
    if (openConvThread && openConvRefresh) { openConvRefresh(); refreshMsgPill(); return; }
    loadDash(); return;
  }
  toast('New message from a visitor 💌', 'ok');
  refreshMsgPill();
}

/* ---------------- views ---------------- */
function show(view) {
  ['viewLogin', 'viewAccess', 'viewDash'].forEach((v) => $(v).classList.toggle('hidden', v !== view));
}
async function route() {
  state.user = await DB.currentUser();
  if (!state.user) { teardownMsgSub(); show('viewLogin'); return; }
  if (!(await DB.isAdmin())) { teardownMsgSub(); show('viewAccess'); return; }
  state.role = await DB.myRole();
  state.paused = await DB.isPaused();
  const rl = state.role === 'owner' ? 'the Owner' : state.role === 'admin' ? 'a Full admin' : 'a Moderator';
  $('dashWho').textContent = 'Signed in as ' + rl;
  const full = state.role === 'owner' || state.role === 'admin';
  const pb = $('pauseBtn');
  pb.classList.toggle('hidden', !full);
  pb.textContent = state.paused ? 'Resume wall' : 'Pause wall';
  pb.classList.toggle('gold', !!state.paused);
  $('pausedBanner').classList.toggle('hidden', !state.paused);
  // Messages inbox is owner-only.
  const isOwner = state.role === 'owner';
  $('tabMessages').classList.toggle('hidden', !isOwner);
  if (isOwner) { if (!msgSub) msgSub = DB.subscribeOwnerMessages(onNewOwnerMessage); }
  else { teardownMsgSub(); if (state.tab === 'messages') selectTab('review'); }
  show('viewDash');
  loadDash();
}
function selectTab(tab) {
  state.tab = tab;
  openConvThread = null; openConvRefresh = null;  // any tab switch returns to the chat list
  $('tabs').querySelectorAll('.tab').forEach((x) => {
    const on = x.dataset.tab === tab;
    x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on));
  });
}
async function togglePause() {
  const next = !state.paused;
  const ok = await confirmDialog({ title: next ? 'Pause the wall?' : 'Resume the wall?', message: next ? 'Nobody can post or comment until you resume. People can still read.' : 'People can post and comment again.', confirmText: next ? 'Pause' : 'Resume', danger: next });
  if (!ok) return;
  try { await DB.setPaused(next); toast(next ? 'Wall paused.' : 'Wall resumed.', 'ok'); route(); }
  catch (err) { toast(err.message || 'Could not update.', 'err'); }
}

/* ---------------- login ---------------- */
let authMode = 'signin';
function setAuthMode(mode) {
  authMode = mode;
  $('loginTitle').textContent = mode === 'signin' ? 'Sign in' : 'Create your account';
  $('loginSub').textContent = mode === 'signin'
    ? 'Sign in to moderate the wall. For admins and approved moderators.'
    : 'Account creation is only for people already approved to moderate. Not approved yet? Apply to moderate first.';
  $('authBtn').textContent = mode === 'signin' ? 'Sign in' : 'Create account';
  $('password').setAttribute('autocomplete', mode === 'signin' ? 'current-password' : 'new-password');
  $('switchLine').textContent = '';
  $('switchLine').appendChild(document.createTextNode(mode === 'signin' ? 'Approved applicant? ' : 'Already have an account? '));
  const b = el('button', 'link', mode === 'signin' ? 'Create your account' : 'Sign in');
  b.type = 'button';
  b.onclick = () => setAuthMode(mode === 'signin' ? 'signup' : 'signin');
  $('switchLine').appendChild(b);
  loginMsg('', null);
}
function loginMsg(text, kind) {
  const m = $('loginMsg');
  if (!text) { m.className = 'login-msg hidden'; m.textContent = ''; return; }
  m.className = 'login-msg ' + (kind || '');
  m.textContent = text;
}
async function doAuth() {
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) { loginMsg('Enter your email and password.', 'err'); return; }
  const btn = $('authBtn');
  btn.disabled = true;
  try {
    if (authMode === 'signup') {
      // Creating an account is not open to everyone - only approved people
      // (owner + approved moderators) can. Everyone else applies to moderate.
      const allowed = await DB.emailCanSignup(email);
      if (!allowed) {
        loginMsg('This email is not approved yet. Only approved moderators can create an account. Want to help? Apply to moderate first.', 'err');
        return;
      }
      const data = await DB.signUp(email, password);
      if (data && data.user && !data.session && DB.isConfigured()) {
        setAuthMode('signin');
        loginMsg('Account created. Check your email to confirm, then sign in.', 'ok');
        return;
      }
    } else {
      await DB.signIn(email, password);
    }
    await route();
  } catch (err) {
    loginMsg(err.message || 'Something went wrong.', 'err');
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- access (signed in, not admin) ---------------- */
async function doClaim() {
  try {
    await DB.claimAdmin();
    toast('You are now the admin.', 'ok');
    await route();
  } catch (err) {
    const m = $('accessMsg');
    m.className = 'login-msg err';
    m.textContent = err.message || 'Could not claim admin.';
  }
}

/* ---------------- dashboard ---------------- */
async function loadDash() {
  const body = $('dashBody');
  body.textContent = '';
  body.appendChild(el('div', 'a-empty', 'Loading…'));
  try {
    const isOwner = state.role === 'owner';
    const [posts, apps, msgs] = await Promise.all([
      DB.adminFetchPosts(), DB.adminFetchApplications(),
      isOwner ? DB.ownerFetchMessages() : Promise.resolve([]),
    ]);
    renderStats(posts, apps);

    const reviewCount = posts.filter(reviewNeeded).length;
    setPill('pillReview', reviewCount);
    const appsPending = apps.filter((a) => a.status === 'pending').length;
    setPill('pillApps', appsPending);
    if (isOwner) setPill('pillMessages', unreadCount(msgs));

    if (state.tab === 'messages') return renderMessages(body, isOwner ? msgs : []);
    if (state.tab === 'admins') return renderAdmins(body);
    if (state.tab === 'apps') return renderApplications(body, apps);

    let list;
    if (state.tab === 'review') list = posts.filter(reviewNeeded).sort((a, b) => (b.report_count || 0) - (a.report_count || 0));
    else if (state.tab === 'all') list = posts;
    else list = posts.filter((p) => p.status === state.tab);
    renderList(body, list);
  } catch (err) {
    body.textContent = '';
    body.appendChild(el('div', 'a-empty', err.message || 'Could not load.'));
  }
}
function setPill(id, n) {
  const pill = $(id);
  if (!pill) return;
  pill.textContent = String(n);
  pill.classList.toggle('zero', n === 0);
}
function renderStats(posts, apps) {
  const s = $('stats');
  s.textContent = '';
  const tiles = [
    { n: posts.filter((p) => p.status === 'visible').length, l: 'Live', cls: '' },
    { n: posts.filter(reviewNeeded).length, l: 'Needs review', cls: 'warn' },
    { n: posts.filter((p) => (p.report_count || 0) > 0).length, l: 'Reported', cls: 'danger' },
    { n: apps.filter((a) => a.status === 'pending').length, l: 'Applications', cls: '' },
  ];
  tiles.forEach((t) => {
    const d = el('div', 'stat' + (t.cls ? ' ' + t.cls : ''));
    d.appendChild(el('div', 'n', String(t.n)));
    d.appendChild(el('div', 'l', t.l));
    s.appendChild(d);
  });
}

/* ---- posts ---- */
function renderList(container, list) {
  container.textContent = '';
  if (!list.length) {
    const msgs = { review: 'Nothing needs review right now.', visible: 'No live posts yet.', hidden: 'No hidden posts.', all: 'No posts yet.' };
    container.appendChild(el('div', 'a-empty', msgs[state.tab] || 'Nothing here.'));
    return;
  }
  list.forEach((post) => container.appendChild(buildArow(post)));
}
function buildArow(post) {
  const row = el('div', 'arow' + ((post.report_count || 0) > 0 ? ' flagged' : ''));
  const top = el('div', 'arow-top');
  top.appendChild(el('span', 'badge ' + post.status, post.status));
  if ((post.report_count || 0) > 0) {
    top.appendChild(el('span', 'badge rep', post.report_count + ' report' + (post.report_count === 1 ? '' : 's')));
  }
  top.appendChild(el('span', 'a-time', fmt(post.created_at)));
  row.appendChild(top);

  row.appendChild(el('div', 'a-body', post.body));
  const who = el('div', 'a-who');
  who.appendChild(document.createTextNode('by '));
  who.appendChild(el('b', null, post.nickname || 'Anonymous'));
  who.appendChild(document.createTextNode(' · color: ' + (post.color || 'sky')));
  row.appendChild(who);

  const acts = el('div', 'arow-actions');
  const mk = (label, cls, fn) => { const x = el('button', 'btn ' + cls + ' small', label); x.onclick = fn; return x; };
  if (post.status !== 'visible') acts.appendChild(mk(post.status === 'hidden' ? 'Restore' : 'Approve', 'gold', () => act(post, 'visible')));
  if (post.status !== 'hidden') acts.appendChild(mk('Hide', 'ghost', () => act(post, 'hidden')));
  acts.appendChild(mk('Delete', 'danger', () => del(post)));

  if ((post.report_count || 0) > 0) {
    const box = el('div', 'a-reports hidden');
    const rbtn = mk('View reports (' + post.report_count + ')', 'ghost', async () => {
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      box.textContent = 'Loading reports…';
      try {
        const reports = await DB.adminFetchReports(post.id);
        box.textContent = '';
        box.appendChild(el('h4', null, 'Reports'));
        const ul = el('ul');
        if (!reports.length) ul.appendChild(el('li', null, 'No details recorded.'));
        reports.forEach((r) => ul.appendChild(el('li', null, (r.reason || '(no reason given)') + ' - ' + fmt(r.created_at))));
        box.appendChild(ul);
      } catch (err) { box.textContent = err.message || 'Could not load reports.'; }
    });
    acts.appendChild(rbtn);
    row.appendChild(acts);
    row.appendChild(box);
    return row;
  }
  row.appendChild(acts);
  return row;
}
async function act(post, status) {
  try {
    await DB.adminSetStatus(post.id, status);
    toast(status === 'visible' ? 'Post is now live.' : 'Post hidden.', 'ok');
    loadDash();
  } catch (err) { toast(err.message || 'Action failed.', 'err'); }
}
async function del(post) {
  const ok = await confirmDialog({ title: 'Delete this post?', message: 'This permanently removes the post and cannot be undone.', confirmText: 'Delete', danger: true });
  if (!ok) return;
  try { await DB.adminDeletePost(post.id); toast('Post deleted.', 'ok'); loadDash(); }
  catch (err) { toast(err.message || 'Delete failed.', 'err'); }
}

/* ---- applications ---- */
function renderApplications(container, apps) {
  container.textContent = '';
  const pending = apps.filter((a) => a.status === 'pending');
  const decided = apps.filter((a) => a.status !== 'pending');
  if (!apps.length) { container.appendChild(el('div', 'a-empty', 'No applications yet.')); return; }
  pending.forEach((a) => container.appendChild(buildAppCard(a)));
  if (decided.length) {
    container.appendChild(el('h3', 'apps-sub', 'Reviewed'));
    decided.forEach((a) => container.appendChild(buildAppCard(a)));
  }
}
function buildAppCard(app) {
  const card = el('div', 'arow app-card' + (app.status === 'pending' ? ' flagged' : ''));
  const top = el('div', 'arow-top');
  top.appendChild(el('span', 'badge ' + (app.status === 'pending' ? 'pending' : app.status === 'approved' ? 'visible' : 'hidden'), app.status));
  top.appendChild(el('span', 'a-time', fmt(app.created_at)));
  card.appendChild(top);

  const name = el('div', 'app-name', app.full_name || '(no name)');
  card.appendChild(name);
  card.appendChild(el('div', 'app-email', app.email || ''));
  if (app.note) card.appendChild(el('div', 'app-note', app.note));

  const acts = el('div', 'arow-actions');
  if (app.status === 'pending') {
    const imgs = el('div', 'app-imgs');
    imgs.appendChild(buildAppImage(app, 'id', 'School ID'));
    imgs.appendChild(buildAppImage(app, 'face', 'Selfie'));
    card.appendChild(imgs);

    const approve = el('button', 'btn gold small', 'Approve');
    approve.onclick = async () => {
      const ok = await confirmDialog({ title: 'Approve ' + (app.full_name || 'this applicant') + '?', message: 'They become a moderator, and their ID + selfie are deleted right away.', confirmText: 'Approve' });
      if (!ok) return;
      try { await DB.approveApplication(app); toast('Approved. Photos deleted.', 'ok'); loadDash(); }
      catch (err) { toast(err.message || 'Could not approve.', 'err'); }
    };
    const reject = el('button', 'btn danger small', 'Reject');
    reject.onclick = async () => {
      const ok = await confirmDialog({ title: 'Reject this application?', message: 'Their ID + selfie are deleted right away. They will not get moderator access.', confirmText: 'Reject', danger: true });
      if (!ok) return;
      try { await DB.rejectApplication(app); toast('Rejected. Photos deleted.', 'ok'); loadDash(); }
      catch (err) { toast(err.message || 'Could not reject.', 'err'); }
    };
    acts.appendChild(approve);
    acts.appendChild(reject);
  } else {
    card.appendChild(el('div', 'app-deleted', 'Verification photos were deleted after review.'));
  }

  const del = el('button', 'btn ghost small', 'Delete record');
  del.onclick = async () => {
    const ok = await confirmDialog({
      title: 'Delete this application record?',
      message: app.status === 'pending'
        ? 'This permanently removes the application and its uploaded photos.'
        : 'This permanently removes this record so other admins cannot see it. If it was approved, the person stays a moderator (remove them from the Admins list separately).',
      confirmText: 'Delete', danger: true,
    });
    if (!ok) return;
    try { await DB.adminDeleteApplication(app); toast('Application deleted.', 'ok'); loadDash(); }
    catch (err) { toast(err.message || 'Could not delete.', 'err'); }
  };
  acts.appendChild(del);
  card.appendChild(acts);
  return card;
}
function buildAppImage(app, which, label) {
  const wrap = el('a', 'app-img');
  wrap.target = '_blank';
  wrap.rel = 'noopener';
  const img = el('img');
  img.alt = label;
  img.loading = 'lazy';
  wrap.appendChild(img);
  wrap.appendChild(el('span', 'app-img-l', label));

  const demoData = which === 'id' ? app.id_data : app.face_data;
  if (demoData) { img.src = demoData; wrap.href = demoData; }
  else {
    const path = which === 'id' ? app.id_path : app.face_path;
    DB.applicationImageUrl(path).then((url) => { if (url) { img.src = url; wrap.href = url; } else wrap.classList.add('no-img'); });
  }
  return wrap;
}

/* ---- owner chat (owner only): thread list + conversation view ---- */
let openConvThread = null;   // which conversation is open (null = thread list)
let openConvRefresh = null;  // refresh fn for the open conversation
function chatTime(iso) {
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
const unreadCount = (all) => all.filter((m) => m.sender === 'visitor' && !m.read_by_owner).length;
async function refreshMsgPill() {
  if (state.role !== 'owner') return;
  try { setPill('pillMessages', unreadCount(await DB.ownerFetchMessages())); } catch (e) {}
}
function threadsOf(all) {
  const map = new Map();
  all.forEach((m) => { if (!map.has(m.thread)) map.set(m.thread, []); map.get(m.thread).push(m); });
  const threads = [];
  for (const [thread, list] of map) {
    list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    threads.push({ thread, list, last: list[list.length - 1], unread: list.filter((m) => m.sender === 'visitor' && !m.read_by_owner).length });
  }
  threads.sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));
  return threads;
}
function renderMessages(container, all) {
  if (openConvThread) return renderConversation(container, all, openConvThread);
  renderThreadList(container, all);
}
function renderThreadList(container, all) {
  container.textContent = '';
  const threads = threadsOf(all);
  if (!threads.length) {
    container.appendChild(el('div', 'a-empty', 'No conversations yet. When someone messages you from the wall, their chat shows up here (only you can see these).'));
    return;
  }
  threads.forEach((t) => {
    const card = el('div', 'arow thread-card' + (t.unread ? ' flagged' : ''));
    const top = el('div', 'arow-top');
    if (t.unread) top.appendChild(el('span', 'badge pending', t.unread + ' new'));
    else top.appendChild(el('span', 'badge visible', 'chat'));
    top.appendChild(el('span', 'a-time', fmt(t.last.created_at)));
    card.appendChild(top);
    const prev = el('div', 'thread-prev');
    prev.appendChild(el('span', 'thread-who', t.last.sender === 'owner' ? 'You: ' : 'Them: '));
    const body = t.last.body || '';
    prev.appendChild(document.createTextNode(body.length > 90 ? body.slice(0, 90) + '…' : body));
    card.appendChild(prev);
    card.onclick = () => { openConvThread = t.thread; loadDash(); };
    container.appendChild(card);
  });
}
function renderConversation(container, all, thread) {
  container.textContent = '';
  let cur = all.filter((m) => m.thread === thread).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  DB.ownerMarkThreadRead(thread).then(refreshMsgPill).catch(() => {});

  const bar = el('div', 'conv-bar');
  const back = el('button', 'btn ghost small', '← All chats');
  back.onclick = () => { openConvThread = null; openConvRefresh = null; loadDash(); };
  bar.appendChild(back);
  const del = el('button', 'btn danger small', 'Delete chat');
  del.onclick = async () => {
    if (!(await confirmDialog({ title: 'Delete this conversation?', message: 'This permanently removes the whole chat and cannot be undone.', confirmText: 'Delete', danger: true }))) return;
    try { await DB.ownerDeleteThread(thread); toast('Chat deleted.', 'ok'); openConvThread = null; openConvRefresh = null; loadDash(); }
    catch (e) { toast(e.message || 'Could not delete.', 'err'); }
  };
  bar.appendChild(del);
  container.appendChild(bar);

  const box = el('div', 'chat-body admin-chat');
  const paint = (msgs) => {
    box.textContent = '';
    msgs.forEach((m) => {
      const b = el('div', 'bubble ' + (m.sender === 'owner' ? 'me' : 'them'));
      b.appendChild(el('div', 'bubble-body', m.body));
      b.appendChild(el('div', 'bubble-time', (m.sender === 'visitor' ? 'Visitor · ' : '') + chatTime(m.created_at)));
      box.appendChild(b);
    });
    box.scrollTop = box.scrollHeight;
  };
  paint(cur);
  container.appendChild(box);

  const foot = el('div', 'chat-input');
  const ta = el('textarea'); ta.rows = 1; ta.maxLength = 1000; ta.placeholder = 'Reply…'; ta.setAttribute('data-autofocus', '');
  const send = el('button', 'chat-send'); send.setAttribute('aria-label', 'Send');
  send.appendChild(svg('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>', '1.9'));
  foot.appendChild(ta); foot.appendChild(send); container.appendChild(foot);
  const autoGrow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(110, ta.scrollHeight) + 'px'; };
  ta.addEventListener('input', autoGrow);

  const refresh = async () => {
    try {
      const l = (await DB.ownerFetchMessages()).filter((m) => m.thread === thread).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      if (l.length !== cur.length) { cur = l; paint(cur); }
    } catch (e) {}
  };
  openConvRefresh = refresh;
  const doSend = async () => {
    const body = ta.value.trim(); if (!body) return; ta.value = ''; autoGrow();
    cur = cur.concat([{ id: 'tmp', thread, sender: 'owner', body, created_at: new Date().toISOString() }]); paint(cur);
    try { await DB.ownerReply(thread, body); await refresh(); } catch (e) { toast(e.message || 'Could not send.', 'err'); }
  };
  send.onclick = doSend;
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
}

/* ---- admins ---- */
async function renderAdmins(container) {
  container.textContent = '';
  const box = el('div', 'admins-box');
  box.appendChild(el('h3', null, 'The team'));
  const ul = el('ul', 'admins-list');
  box.appendChild(ul);
  const rLabel = (r) => r === 'owner' ? 'Owner' : r === 'admin' ? 'Full admin' : 'Moderator';
  const isOwner = state.role === 'owner';
  const isFull = isOwner || state.role === 'admin';
  try {
    const admins = await DB.fetchAdmins();
    admins.forEach((a) => {
      const role = a.role || 'mod';
      const li = el('li');
      li.appendChild(svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', '1.8'));
      const you = a.email === (state.user && state.user.email);
      li.appendChild(el('span', null, maskEmail(a.email) + (you ? '  (you)' : '')));
      li.appendChild(el('span', 'role-badge ' + role, rLabel(role)));
      if (isOwner && role !== 'owner') {
        const acts = el('span', 'role-acts');
        const t = el('button', 'link', role === 'admin' ? 'Make moderator' : 'Make full admin');
        t.onclick = async () => { try { await DB.setAdminRole(a.email, role === 'admin' ? 'mod' : 'admin'); toast('Role updated.', 'ok'); renderAdmins(container); } catch (e) { toast(e.message, 'err'); } };
        const rm = el('button', 'link danger', 'Remove');
        rm.onclick = async () => { if (!(await confirmDialog({ title: 'Remove this person?', message: 'They lose all access.', confirmText: 'Remove', danger: true }))) return; try { await DB.removeAdmin(a.email); toast('Removed.', 'ok'); renderAdmins(container); } catch (e) { toast(e.message, 'err'); } };
        acts.appendChild(t); acts.appendChild(rm); li.appendChild(acts);
      }
      ul.appendChild(li);
    });
    if (!admins.length) ul.appendChild(el('li', null, 'No one yet.'));
  } catch (err) { ul.appendChild(el('li', null, err.message || 'Could not load.')); }

  if (isFull) {
    box.appendChild(el('div', 'admins-sub', 'Add someone by email'));
    const form = el('div', 'add-admin');
    const input = el('input'); input.type = 'email'; input.placeholder = 'email@example.com';
    let role = 'mod', roleSel = null;
    if (isOwner) {
      roleSel = el('select', 'role-select');
      [['mod', 'Moderator'], ['admin', 'Full admin']].forEach(([v, l]) => { const o = el('option', null, l); o.value = v; roleSel.appendChild(o); });
      roleSel.onchange = () => { role = roleSel.value; };
    }
    const addBtn = el('button', 'btn small', 'Add');
    const submit = async () => {
      const email = input.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter a valid email.', 'err'); return; }
      addBtn.disabled = true;
      try { await DB.addAdmin(email, role); toast('Added. They get access after signing in with that email.', 'ok'); input.value = ''; renderAdmins(container); }
      catch (e) { toast(e.message || 'Could not add.', 'err'); } finally { addBtn.disabled = false; }
    };
    addBtn.onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    form.appendChild(input); if (roleSel) form.appendChild(roleSel); form.appendChild(addBtn);
    box.appendChild(form);
  }
  const note = isOwner ? 'As owner you can change roles and remove people. Full admins can pause the wall and add moderators. Emails are masked so a screenshot never reveals the team.'
    : isFull ? 'You can add moderators and pause the wall. Only the owner can change roles or remove people.'
    : 'Only full admins can add people or pause the wall.';
  box.appendChild(el('p', 'admins-note', note));
  container.appendChild(box);
}

/* ---------------- boot ---------------- */
function boot() {
  $('footMeta').textContent = 'Version ' + (CFG.VERSION || '1.0.0') + ' · Last updated ' + (CFG.UPDATED || '');
  if (!DB.isConfigured()) $('demoHint').textContent = 'Demo mode: any email + password signs you in as a demo admin.';
  setAuthMode('signin');
  $('authBtn').onclick = doAuth;
  $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
  $('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
  $('claimLink').onclick = doClaim;
  $('accessSignOut').onclick = async () => { await DB.signOut(); route(); };
  $('signOutBtn').onclick = async () => { await DB.signOut(); toast('Signed out.'); route(); };
  $('pauseBtn').onclick = togglePause;

  $('tabs').querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => { selectTab(t.dataset.tab); loadDash(); };
  });

  route();
}
boot();
