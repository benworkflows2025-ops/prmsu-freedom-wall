// ============================================================================
//  Edge Function: notify-approved
//  When the owner/admin approves an applicant, this emails them a Supabase
//  INVITE (reaches any inbox for free, no custom domain needed). The invite
//  link brings them to admin.html to set a password, and since their email is
//  already in `admins`, they land in the dashboard as a moderator.
//
//  SETUP (one time):
//   - Just deploy it. No API keys or secrets needed - Supabase auto-provides
//     SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
//       supabase functions deploy notify-approved
//     (or Dashboard -> Edge Functions -> new function -> paste this file)
//   - Optional: brand the invite email later at Authentication -> Emails ->
//     "Invite user" (needs custom SMTP to edit; the plain default works fine).
//
//  Security: the caller must be a signed-in full admin / owner. We verify their
//  JWT against is_full_admin() before inviting anyone.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SITE = 'https://prmsu-freedom-wall.netlify.app';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Verify the caller is a full admin / owner using their own JWT.
    const authHeader = req.headers.get('Authorization') || '';
    const caller = createClient(supaUrl, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: isAdmin, error: adminErr } = await caller.rpc('is_full_admin');
    if (adminErr || !isAdmin) return json({ error: 'Not allowed.' }, 403);

    const { email, name } = await req.json().catch(() => ({}));
    if (!email || typeof email !== 'string') return json({ error: 'Missing email.' }, 400);

    // Invite (service role). Sends Supabase's invite email to any inbox.
    const admin = createClient(supaUrl, serviceKey);
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: SITE + '/admin.html',
      data: { full_name: typeof name === 'string' ? name : '' },
    });
    if (error) {
      // Already has an account? Then there's nothing to invite - not an error.
      const m = (error.message || '').toLowerCase();
      if (m.includes('already') || m.includes('registered') || m.includes('exists')) {
        return json({ ok: true, already: true });
      }
      return json({ error: error.message }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
