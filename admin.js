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

const state = { user: null, tab: 'review' };

/* ---------------- views ---------------- */
function show(view) {
  ['viewLogin', 'viewAccess', 'viewDash'].forEach((v) => $(v).classList.toggle('hidden', v !== view));
}
async function route() {
  state.user = await DB.currentUser();
  if (!state.user) { show('viewLogin'); return; }
  const admin = await DB.isAdmin();
  if (!admin) { show('viewAccess'); return; }
  $('dashWho').textContent = 'Signed in as admin';
  show('viewDash');
  loadDash();
}

/* ---------------- login ---------------- */
let authMode = 'signin';
function setAuthMode(mode) {
  authMode = mode;
  $('loginTitle').textContent = mode === 'signin' ? 'Admin sign in' : 'Create an admin account';
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
      const data = await DB.signUp(email, password);
      if (data && data.user && !data.session && DB.mode === 'supabase') {
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
    const [posts, apps] = await Promise.all([DB.adminFetchPosts(), DB.adminFetchApplications()]);
    renderStats(posts, apps);

    const reviewCount = posts.filter(reviewNeeded).length;
    setPill('pillReview', reviewCount);
    const appsPending = apps.filter((a) => a.status === 'pending').length;
    setPill('pillApps', appsPending);

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

/* ---- admins ---- */
async function renderAdmins(container) {
  container.textContent = '';
  const box = el('div', 'admins-box');
  box.appendChild(el('h3', null, 'Moderators'));
  const ul = el('ul', 'admins-list');
  box.appendChild(ul);
  try {
    const admins = await DB.fetchAdmins();
    admins.forEach((a) => {
      const li = el('li');
      li.appendChild(svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', '1.8'));
      const isYou = a.email === (state.user && state.user.email);
      li.appendChild(el('span', null, maskEmail(a.email) + (isYou ? '  (you)' : '')));
      ul.appendChild(li);
    });
    if (!admins.length) ul.appendChild(el('li', null, 'No moderators yet.'));
  } catch (err) { ul.appendChild(el('li', null, err.message || 'Could not load moderators.')); }

  // add a moderator directly by email (no application needed)
  box.appendChild(el('div', 'admins-sub', 'Add a moderator by email'));
  const form = el('div', 'add-admin');
  const input = el('input');
  input.type = 'email';
  input.placeholder = 'new-moderator@email.com';
  const addBtn = el('button', 'btn small', 'Add moderator');
  const submit = async () => {
    const email = input.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Please enter a valid email.', 'err'); return; }
    addBtn.disabled = true;
    try {
      await DB.addAdmin(email);
      toast('Added. They can moderate once they sign in with that email.', 'ok');
      input.value = '';
      renderAdmins(container);
    } catch (err) { toast(err.message || 'Could not add moderator.', 'err'); }
    finally { addBtn.disabled = false; }
  };
  addBtn.onclick = submit;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  form.appendChild(input);
  form.appendChild(addBtn);
  box.appendChild(form);

  box.appendChild(el('p', 'admins-note', 'A moderator can review, hide, and delete posts, comments, and applications, just like you. They get access after creating an account on the sign-in page using the exact email you add here. Emails are masked so a screenshot never reveals who the moderators are. (You can also approve them from the Applications tab.)'));
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

  $('tabs').querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      $('tabs').querySelectorAll('.tab').forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
      t.classList.add('active'); t.setAttribute('aria-selected', 'true');
      state.tab = t.dataset.tab;
      loadDash();
    };
  });

  route();
}
boot();
