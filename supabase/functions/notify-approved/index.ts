// ============================================================================
//  Edge Function: notify-approved
//  Emails an applicant that they've been approved as a moderator.
//  Called from admin.js right after the owner/admin approves an application.
//
//  SETUP (one time):
//   1. Make a free account at https://resend.com and create an API key.
//   2. In your project:  supabase secrets set RESEND_API_KEY=re_xxx
//   3. Deploy:           supabase functions deploy notify-approved
//      (or paste this file in Dashboard -> Edge Functions -> new function)
//   4. To email ANY address (not just your own Resend email), verify a sending
//      domain in Resend and change MAIL_FROM below to an address on it, e.g.
//      "PRMSU Freedom Wall <noreply@yourdomain.com>".
//
//  Security: the caller must be a signed-in full admin / owner. We verify their
//  JWT against is_full_admin() before sending anything, so this can't be abused
//  to blast emails.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SITE = 'https://prmsu-freedom-wall.netlify.app';
// Until you verify your own domain in Resend, this only reaches your own
// Resend account email. After verifying a domain, use an address on it.
const MAIL_FROM = 'PRMSU Freedom Wall <onboarding@resend.dev>';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function approvedHtml(name: string) {
  const hi = name ? ' ' + name : '';
  return `
<div style="background:#f4f6fb;padding:28px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6eaf2;">
    <div style="background:linear-gradient(135deg,#4b7bea,#103A8A);padding:24px;text-align:center;">
      <img src="${SITE}/seal.png" width="52" height="52" alt="PRMSU" style="border-radius:50%;background:#fff;padding:4px;">
      <div style="color:#fff;font-size:18px;font-weight:800;margin-top:10px;">PRMSU Freedom Wall</div>
    </div>
    <div style="padding:28px 26px;color:#1b2540;">
      <h1 style="font-size:20px;margin:0 0 12px;">You're approved to moderate 🎉</h1>
      <p style="font-size:15px;line-height:1.6;color:#3c485f;margin:0 0 18px;">
        Hi${hi}, good news! You've been approved as a <b>moderator</b> of the PRMSU Freedom Wall.
        Create your account with <b>this same email</b>, then sign in to start helping keep the wall kind and safe.
      </p>
      <a href="${SITE}/admin.html" style="display:inline-block;background:#3B6FE3;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;font-size:15px;">Create my account</a>
      <p style="font-size:12.5px;color:#8a93a6;line-height:1.6;margin:22px 0 0;">
        Use the email this was sent to. If you did not apply to moderate, you can ignore this message.
      </p>
    </div>
    <div style="padding:14px;text-align:center;font-size:11.5px;color:#9aa3b6;border-top:1px solid #eef1f7;">
      Unofficial student-made platform. Not affiliated with PRMSU.
    </div>
  </div>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ error: 'RESEND_API_KEY is not set.' }, 500);

    // Verify the caller is a full admin / owner using their own JWT.
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';
    const caller = createClient(supaUrl, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: isAdmin, error: adminErr } = await caller.rpc('is_full_admin');
    if (adminErr || !isAdmin) return json({ error: 'Not allowed.' }, 403);

    const { email, name } = await req.json().catch(() => ({}));
    if (!email || typeof email !== 'string') return json({ error: 'Missing email.' }, 400);

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [email],
        subject: "You're approved to moderate the PRMSU Freedom Wall 🎉",
        html: approvedHtml(typeof name === 'string' ? name.trim() : ''),
      }),
    });
    if (!r.ok) return json({ error: 'Email send failed.', detail: await r.text() }, 502);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
