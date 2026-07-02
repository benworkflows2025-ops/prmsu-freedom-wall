/* ===========================================================================
   ui.js - our own toast + modal dialogs (no native alert/confirm/prompt).
   Shared by wall.js, admin.js and apply.js so every popup looks like the site.
   =========================================================================== */

/* ---------------- toast ---------------- */
let toastTimer;
export function toast(msg, kind) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3400);
}

/* ---------------- low-level modal ---------------- */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/*
  openModal(build) - build(close) returns the modal card's inner content and may
  call close(result) to resolve. Returns a Promise that resolves with whatever
  close() was given (or null if dismissed via overlay / Escape / cancel).
*/
export function openModal(build) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const overlay = el('div', 'modal-overlay');
    const card = el('div', 'modal-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    overlay.appendChild(card);

    let done = false;
    const close = (result) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); }, 160);
      resolve(result === undefined ? null : result);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      if (e.key === 'Tab') trapTab(e, card);
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });

    build(close, card);
    document.body.appendChild(overlay);
    // force reflow then animate in
    requestAnimationFrame(() => overlay.classList.add('show'));
    const first = card.querySelector('[data-autofocus]') || card.querySelector('button, input, textarea, a');
    if (first) first.focus();
  });
}

function trapTab(e, card) {
  const f = [...card.querySelectorAll('button, input, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ---------------- confirm ---------------- */
export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return openModal((close, card) => {
    const head = el('div', 'modal-head');
    head.appendChild(el('h3', 'modal-title', title || 'Are you sure?'));
    card.appendChild(head);
    if (message) card.appendChild(el('p', 'modal-msg', message));

    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn ghost', cancelText);
    cancel.onclick = () => close(false);
    const ok = el('button', 'btn' + (danger ? ' danger-solid' : ''), confirmText);
    ok.setAttribute('data-autofocus', '');
    ok.onclick = () => close(true);
    actions.appendChild(cancel);
    actions.appendChild(ok);
    card.appendChild(actions);
  });
}

/* ---------------- report dialog ---------------- */
const REPORT_REASONS = ['Spam', 'Harassment or bullying', 'Hate speech', 'Sexual or explicit', 'Personal info / doxxing', 'Other'];

export function reportDialog() {
  return openModal((close, card) => {
    const head = el('div', 'modal-head');
    head.appendChild(el('h3', 'modal-title', 'Report this post'));
    card.appendChild(head);
    card.appendChild(el('p', 'modal-msg', 'Tell the admins what is wrong. This goes to the review queue, not the public.'));

    let selected = '';
    const chips = el('div', 'modal-chips');
    REPORT_REASONS.forEach((r) => {
      const c = el('button', 'modal-chip', r);
      c.type = 'button';
      c.onclick = () => {
        selected = selected === r ? '' : r;
        chips.querySelectorAll('.modal-chip').forEach((x) => x.classList.remove('sel'));
        if (selected) c.classList.add('sel');
      };
      chips.appendChild(c);
    });
    card.appendChild(chips);

    const ta = el('textarea', 'modal-textarea');
    ta.placeholder = 'Add any details (optional)';
    ta.maxLength = 200;
    card.appendChild(ta);

    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.onclick = () => close(null);
    const submit = el('button', 'btn danger-solid', 'Report');
    submit.onclick = () => {
      const reason = [selected, ta.value.trim()].filter(Boolean).join(': ').slice(0, 200);
      close({ reason });
    };
    actions.appendChild(cancel);
    actions.appendChild(submit);
    card.appendChild(actions);
  });
}

/* ---------------- relative time ---------------- */
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

/* ---------------- comments dialog (same popup animation as report) ---------------- */
function commentEl(c) {
  const item = el('div', 'cmt');
  item.appendChild(el('div', 'cmt-body', c.body));
  const m = el('div', 'cmt-meta');
  m.appendChild(el('span', 'cmt-who', c.nickname || 'Anonymous'));
  m.appendChild(el('span', 'cmt-dot', '·'));
  m.appendChild(el('span', null, ago(c.created_at)));
  item.appendChild(m);
  return item;
}

export function commentsDialog({ post, defaultNick, fetchComments, submitComment }) {
  return openModal((close, card) => {
    card.classList.add('modal-comments');

    const head = el('div', 'modal-head');
    head.appendChild(el('h3', 'modal-title', 'Comments'));
    const x = el('button', 'modal-x', '×');
    x.setAttribute('aria-label', 'Close');
    x.onclick = () => close(null);
    head.appendChild(x);
    card.appendChild(head);

    const pv = el('div', 'cmt-post');
    pv.appendChild(el('div', 'cmt-post-body', post.body));
    const pm = el('div', 'cmt-meta');
    pm.appendChild(el('span', 'cmt-who', post.nickname || 'Anonymous'));
    pv.appendChild(pm);
    card.appendChild(pv);

    const list = el('div', 'cmt-list');
    list.appendChild(el('div', 'cmt-empty', 'Loading comments...'));
    card.appendChild(list);

    const renderList = (comments) => {
      list.textContent = '';
      if (!comments.length) { list.appendChild(el('div', 'cmt-empty', 'No comments yet. Be the first!')); return; }
      comments.forEach((c) => list.appendChild(commentEl(c)));
      list.scrollTop = list.scrollHeight;
    };
    fetchComments().then(renderList).catch(() => renderList([]));

    const form = el('div', 'cmt-form');
    const nick = el('input', 'cmt-nick');
    nick.type = 'text'; nick.maxLength = 24; nick.placeholder = 'Nickname (optional)';
    if (defaultNick) nick.value = defaultNick;
    const row = el('div', 'cmt-send-row');
    const ta = el('textarea', 'cmt-ta');
    ta.maxLength = 300; ta.placeholder = 'Write a comment...';
    const send = el('button', 'btn small', 'Send');
    const err = el('div', 'cmt-err hidden');
    send.onclick = async () => {
      const body = ta.value.trim();
      err.classList.add('hidden');
      if (!body) return;
      send.disabled = true;
      try {
        const c = await submitComment(body, nick.value.trim());
        if (c) {
          const empty = list.querySelector('.cmt-empty'); if (empty) empty.remove();
          list.appendChild(commentEl(c));
          list.scrollTop = list.scrollHeight;
          ta.value = '';
        }
      } catch (e) {
        err.textContent = e.message || 'Could not comment.';
        err.classList.remove('hidden');
      } finally { send.disabled = false; }
    };
    ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send.click(); } });
    row.appendChild(ta); row.appendChild(send);
    form.appendChild(nick); form.appendChild(row); form.appendChild(err);
    card.appendChild(form);
  });
}
