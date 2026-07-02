/* ===========================================================================
   apply.js - the public "apply to help moderate" form.
   Uploads a school ID photo + a selfie to a PRIVATE storage bucket and records
   the application. The admin reviews it; the images are deleted on decision.
   =========================================================================== */
import { DB } from './db.js';
import { toast } from './ui.js';

const CFG = window.PRMSU_WALL_CONFIG || {};
const $ = (id) => document.getElementById(id);
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB per image

const files = { id: null, face: null };

function msg(text, kind) {
  const m = $('applyMsg');
  if (!text) { m.className = 'login-msg hidden'; m.textContent = ''; return; }
  m.className = 'login-msg ' + (kind || '');
  m.textContent = text;
  m.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function wireFile(inputId, innerId, key) {
  const input = $(inputId);
  const inner = $(innerId);
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('Please choose an image file.', 'err'); input.value = ''; return; }
    if (f.size > MAX_BYTES) { toast('That image is over 6 MB. Please pick a smaller one.', 'err'); input.value = ''; return; }
    files[key] = f;
    const url = URL.createObjectURL(f);
    inner.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'file-thumb';
    img.alt = 'Selected photo';
    img.src = url;
    const badge = document.createElement('span');
    badge.className = 'file-change';
    badge.textContent = 'Tap to change';
    inner.appendChild(img);
    inner.appendChild(badge);
    inner.parentElement.classList.add('has-file');
  });
}

function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

async function submit() {
  const fullName = $('fullName').value.trim();
  const email = $('email').value.trim().toLowerCase();
  const note = $('note').value.trim();

  msg('', null);
  if (fullName.length < 2) return msg('Please enter your full name.', 'err');
  if (!validEmail(email)) return msg('Please enter a valid email address.', 'err');
  if (!files.id) return msg('Please add a photo of your school ID.', 'err');
  if (!files.face) return msg('Please add a selfie so we can verify you.', 'err');
  if (!$('consent').checked) return msg('Please tick the box to agree before submitting.', 'err');

  const btn = $('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  try {
    await DB.submitApplication({ fullName, email, note, idFile: files.id, faceFile: files.face });
    $('applyForm').classList.add('hidden');
    $('applyDone').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    msg(err.message || 'Could not submit your application. Please try again.', 'err');
    btn.disabled = false;
    btn.textContent = 'Submit application';
  }
}

function boot() {
  $('footMeta').textContent = 'Version ' + (CFG.VERSION || '1.0.0') + ' · Last updated ' + (CFG.UPDATED || '');
  if (!DB.isConfigured()) {
    $('demoHint').textContent = 'Demo mode: Supabase is not configured, so this application is saved only in this browser.';
  }
  wireFile('idFile', 'idInner', 'id');
  wireFile('faceFile', 'faceInner', 'face');
  $('submitBtn').onclick = submit;
}
boot();
