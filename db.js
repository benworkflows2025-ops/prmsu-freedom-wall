/* ===========================================================================
   db.js - the one place that talks to Supabase.
   Public wall (wall.js), admin side (admin.js) and the apply form (apply.js)
   all import from here, so the API is identical everywhere.

   With placeholder keys in config.js it falls back to DEMO MODE (localStorage)
   so the UI is fully clickable before Supabase is wired up.
   =========================================================================== */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const CFG = window.PRMSU_WALL_CONFIG || {};

const CONFIGURED =
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test((CFG.SUPABASE_URL || '').trim()) &&
  (CFG.SUPABASE_ANON_KEY || '').trim().length > 20 &&
  !/YOUR-/i.test(CFG.SUPABASE_URL || '') &&
  !/YOUR-/i.test(CFG.SUPABASE_ANON_KEY || '');

const supa = CONFIGURED
  ? createClient(CFG.SUPABASE_URL.trim(), CFG.SUPABASE_ANON_KEY.trim(), {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

const APPS_BUCKET = 'admin-apps';

/* ----------------------------------------------------------------------------
   DEMO MODE (localStorage)
---------------------------------------------------------------------------- */
const DEMO_POSTS = 'prmsu_wall_demo_posts';
const DEMO_APPS = 'prmsu_wall_demo_apps';
const DEMO_ADMIN = 'prmsu_wall_demo_admin';

const demo = {
  read(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } },
  write(k, v) {
    localStorage.setItem(k, JSON.stringify(v));
    try { localStorage.setItem(k + '_ping', String(Date.now())); } catch {}
  },
  seedOnce() {
    if (localStorage.getItem(DEMO_POSTS) !== null) return;
    const now = Date.now();
    this.write(DEMO_POSTS, [
      { id: crypto.randomUUID(), body: 'Welcome to the PRMSU Freedom Wall! This is demo mode, so posts are saved only in this browser. Add your Supabase keys in config.js to make it a real shared wall.', nickname: null, color: 'gold', status: 'visible', report_count: 0, created_at: new Date(now - 3600e3).toISOString() },
      { id: crypto.randomUUID(), body: 'Kaya natin ito, mga Ramonians! Good luck sa finals.', nickname: 'Batchmate', color: 'mint', status: 'visible', report_count: 0, created_at: new Date(now - 1800e3).toISOString() },
      { id: crypto.randomUUID(), body: 'Shoutout sa library staff na lagi tayong tinutulungan. Salamat po!', nickname: null, color: 'rose', status: 'visible', report_count: 0, created_at: new Date(now - 600e3).toISOString() },
    ]);
  },
};
function demoIsAdmin() { return localStorage.getItem(DEMO_ADMIN) === '1'; }

function boom(error, fallback) {
  const msg = (error && (error.message || error.error_description)) || fallback || 'Something went wrong.';
  throw new Error(msg);
}

/* ============================================================================
   PUBLIC API
   ========================================================================== */
export const DB = {
  mode: CONFIGURED ? 'supabase' : 'demo',
  isConfigured: () => CONFIGURED,
  client: supa,

  /* ---------------- public wall ---------------- */
  async fetchPosts(limit = 400) {
    if (!CONFIGURED) {
      demo.seedOnce();
      return demo.read(DEMO_POSTS)
        .filter((p) => p.status === 'visible')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);
    }
    const { data, error } = await supa
      .from('posts').select('*')
      .eq('status', 'visible')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) boom(error, 'Could not load the wall.');
    return data || [];
  },

  async createPost({ body, nickname, color }) {
    if (!CONFIGURED) {
      const list = demo.read(DEMO_POSTS);
      const row = {
        id: crypto.randomUUID(), body: String(body).trim(),
        nickname: (nickname || '').trim() || null, color: color || 'sky',
        status: 'visible', report_count: 0, created_at: new Date().toISOString(),
      };
      list.push(row); demo.write(DEMO_POSTS, list);
      return row;
    }
    const { data, error } = await supa.rpc('create_post', {
      p_body: body, p_nickname: nickname || null, p_color: color || 'sky',
    });
    if (error) boom(error, 'Could not post.');
    return data;
  },

  async report(postId, reason, token) {
    if (!CONFIGURED) {
      const list = demo.read(DEMO_POSTS);
      const p = list.find((x) => x.id === postId);
      if (p) { p.report_count = (p.report_count || 0) + 1; demo.write(DEMO_POSTS, list); }
      return;
    }
    const { error } = await supa.rpc('report_post', {
      p_post_id: postId, p_reason: reason || null, p_token: token || null,
    });
    if (error) boom(error, 'Could not report.');
  },

  subscribe({ onInsert, onUpdate, onDelete }) {
    if (!CONFIGURED) {
      const handler = (e) => { if (e.key === DEMO_POSTS + '_ping') onInsert && onInsert(null); };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    }
    const channel = supa.channel('public:posts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (p) => onInsert && onInsert(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (p) => onUpdate && onUpdate(p.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (p) => onDelete && onDelete(p.old))
      .subscribe();
    return () => supa.removeChannel(channel);
  },

  /* ---------------- comments ---------------- */
  async fetchComments(postId) {
    if (!CONFIGURED) {
      try { const all = JSON.parse(localStorage.getItem('prmsu_wall_demo_cmt') || '{}'); return all[postId] || []; }
      catch { return []; }
    }
    const { data, error } = await supa.from('comments').select('*')
      .eq('post_id', postId).order('created_at', { ascending: true });
    if (error) boom(error, 'Could not load comments.');
    return data || [];
  },
  async createComment(postId, body, nickname) {
    if (!CONFIGURED) {
      let all = {};
      try { all = JSON.parse(localStorage.getItem('prmsu_wall_demo_cmt') || '{}'); } catch {}
      const c = { id: crypto.randomUUID(), post_id: postId, body: String(body).trim(), nickname: (nickname || '').trim() || null, created_at: new Date().toISOString() };
      all[postId] = all[postId] || []; all[postId].push(c);
      localStorage.setItem('prmsu_wall_demo_cmt', JSON.stringify(all));
      return c;
    }
    const { data, error } = await supa.rpc('create_comment', { p_post_id: postId, p_body: body, p_nickname: nickname || null });
    if (error) boom(error, 'Could not comment.');
    return data;
  },
  async adminDeleteComment(id) {
    if (!CONFIGURED) return;
    const { error } = await supa.rpc('admin_delete_comment', { p_id: id });
    if (error) boom(error, 'Could not delete the comment.');
  },

  /* ---------------- admin applications ---------------- */
  async submitApplication({ fullName, email, note, idFile, faceFile }) {
    if (!CONFIGURED) {
      const [idData, faceData] = await Promise.all([fileToDataUrl(idFile), fileToDataUrl(faceFile)]);
      const list = demo.read(DEMO_APPS);
      list.push({
        id: crypto.randomUUID(), full_name: fullName, email, note: note || null,
        id_data: idData, face_data: faceData, status: 'pending', created_at: new Date().toISOString(),
      });
      demo.write(DEMO_APPS, list);
      return;
    }
    const appId = crypto.randomUUID();
    const idPath = `${appId}/id.${ext(idFile)}`;
    const facePath = `${appId}/face.${ext(faceFile)}`;
    const up = async (path, file) => {
      const { error } = await supa.storage.from(APPS_BUCKET).upload(path, file, {
        contentType: file.type || 'image/jpeg', upsert: false,
      });
      if (error) boom(error, 'Could not upload your photos.');
    };
    await up(idPath, idFile);
    await up(facePath, faceFile);
    const { error } = await supa.rpc('submit_admin_application', {
      p_full_name: fullName, p_email: email, p_note: note || null,
      p_id_path: idPath, p_face_path: facePath,
    });
    if (error) boom(error, 'Could not submit your application.');
  },

  async adminFetchApplications(status) {
    if (!CONFIGURED) {
      const list = demo.read(DEMO_APPS).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return status ? list.filter((a) => a.status === status) : list;
    }
    let q = supa.from('admin_applications').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) boom(error, 'Could not load applications.');
    return data || [];
  },

  async applicationImageUrl(path) {
    if (!CONFIGURED || !path) return null;
    const { data, error } = await supa.storage.from(APPS_BUCKET).createSignedUrl(path, 300);
    if (error) return null;
    return data?.signedUrl || null;
  },

  async approveApplication(app) {
    if (!CONFIGURED) {
      const list = demo.read(DEMO_APPS);
      const a = list.find((x) => x.id === app.id);
      if (a) { a.status = 'approved'; a.id_data = null; a.face_data = null; demo.write(DEMO_APPS, list); }
      return;
    }
    await deleteAppFiles(app);   // Storage API delete (SQL delete is blocked by Supabase)
    const { error } = await supa.rpc('approve_admin_application', { p_id: app.id });
    if (error) boom(error, 'Could not approve.');
  },

  async rejectApplication(app) {
    if (!CONFIGURED) {
      const list = demo.read(DEMO_APPS);
      const a = list.find((x) => x.id === app.id);
      if (a) { a.status = 'rejected'; a.id_data = null; a.face_data = null; demo.write(DEMO_APPS, list); }
      return;
    }
    await deleteAppFiles(app);
    const { error } = await supa.rpc('reject_admin_application', { p_id: app.id });
    if (error) boom(error, 'Could not reject.');
  },

  /* ---------------- admin auth ---------------- */
  async signUp(email, password) {
    if (!CONFIGURED) { localStorage.setItem(DEMO_ADMIN, '1'); return { demo: true }; }
    const { data, error } = await supa.auth.signUp({ email, password });
    if (error) boom(error, 'Sign-up failed.');
    return data;
  },
  async signIn(email, password) {
    if (!CONFIGURED) { localStorage.setItem(DEMO_ADMIN, '1'); return { demo: true }; }
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) boom(error, 'Sign-in failed.');
    return data;
  },
  async signOut() {
    if (!CONFIGURED) { localStorage.removeItem(DEMO_ADMIN); return; }
    await supa.auth.signOut();
  },
  async currentUser() {
    if (!CONFIGURED) return demoIsAdmin() ? { email: 'demo-admin@local' } : null;
    const { data } = await supa.auth.getUser();
    return data?.user || null;
  },
  onAuth(cb) {
    if (!CONFIGURED) { cb(demoIsAdmin() ? { email: 'demo-admin@local' } : null); return () => {}; }
    const { data } = supa.auth.onAuthStateChange((_e, session) => cb(session?.user || null));
    return () => data?.subscription?.unsubscribe();
  },
  async isAdmin() {
    if (!CONFIGURED) return demoIsAdmin();
    const { data, error } = await supa.rpc('is_admin');
    if (error) return false;
    return !!data;
  },
  async claimAdmin() {
    if (!CONFIGURED) { localStorage.setItem(DEMO_ADMIN, '1'); return 'demo-admin@local'; }
    const { data, error } = await supa.rpc('claim_admin');
    if (error) boom(error, 'Could not claim admin.');
    return data;
  },
  async fetchAdmins() {
    if (!CONFIGURED) return [{ email: 'demo-admin@local', added_at: new Date().toISOString() }];
    const { data, error } = await supa.from('admins').select('*').order('added_at', { ascending: true });
    if (error) boom(error, 'Could not load admins.');
    return data || [];
  },

  /* ---------------- admin moderation ---------------- */
  async adminFetchPosts(status) {
    if (!CONFIGURED) {
      const list = demo.read(DEMO_POSTS).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return status ? list.filter((p) => p.status === status) : list;
    }
    let q = supa.from('posts').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) boom(error, 'Could not load posts.');
    return data || [];
  },
  async adminFetchReports(postId) {
    if (!CONFIGURED) return [];
    const { data, error } = await supa.from('reports').select('*')
      .eq('post_id', postId).order('created_at', { ascending: false });
    if (error) boom(error, 'Could not load reports.');
    return data || [];
  },
  async adminSetStatus(postId, status) {
    if (!CONFIGURED) {
      const list = demo.read(DEMO_POSTS);
      const p = list.find((x) => x.id === postId);
      if (p) { p.status = status; demo.write(DEMO_POSTS, list); }
      return p;
    }
    const { data, error } = await supa.rpc('admin_set_status', { p_post_id: postId, p_status: status });
    if (error) boom(error, 'Could not update the post.');
    return data;
  },
  async adminDeletePost(postId) {
    if (!CONFIGURED) { demo.write(DEMO_POSTS, demo.read(DEMO_POSTS).filter((x) => x.id !== postId)); return; }
    const { error } = await supa.rpc('admin_delete_post', { p_post_id: postId });
    if (error) boom(error, 'Could not delete the post.');
  },
};

/* ---------------- helpers ---------------- */
async function deleteAppFiles(app) {
  const paths = [app && app.id_path, app && app.face_path].filter(Boolean);
  if (!paths.length) return;
  const { error } = await supa.storage.from(APPS_BUCKET).remove(paths);
  if (error) boom(error, 'Could not delete the verification photos. Please try again.');
}
function ext(file) {
  const n = (file && file.name) || '';
  const e = n.split('.').pop().toLowerCase();
  return /^(jpg|jpeg|png|webp|heic|heif)$/.test(e) ? e : 'jpg';
}
function fileToDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}
