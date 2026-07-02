# PRMSU Freedom Wall - Setup

An anonymous, shared freedom wall for PRMSU students (Ramonians). Static frontend
(HTML/CSS/JS, no build step) plus [Supabase](https://supabase.com) for the shared
database, realtime updates, admin auth, and private storage. Deploys anywhere
static (Netlify, etc.).

Out of the box it runs in **Demo mode** (posts saved only in your browser) so you
can preview it. Follow the steps below to make it a real, shared wall.

---

## What you get

- **Anonymous posting** - no account, optional nickname, 6 note colors.
- **Profanity filter** - a Tagalog + Cebuano + Ilocano + English word filter runs in
  the browser and blocks obvious slurs before a post is sent (see `profanity.js`).
- **Report + review queue** - every post has a Report action with our own popup (not
  the browser's). Reports are queue-only: they flag a post for the admin but can never
  hide it on their own, and one browser can report a post once.
- **Full admin side** (`admin.html`) - sign in, review queue, hide / restore / delete,
  per-post report details. The admin's identity is masked so screenshots do not leak it.
- **Apply to moderate** (`apply.html`) - students apply with a full name, email, a
  photo of their school ID, and a selfie. Applications appear in the admin's
  **Applications** tab to approve or reject. The ID and selfie live in **private
  storage** only the admin can open, and are **permanently deleted the moment the
  application is approved or rejected**.
- **Realtime** - new posts appear live for everyone.
- **Privacy-honest** legal pages (posts and verification data are described truthfully).

---

## 1. Create a Supabase project (free)

Go to <https://supabase.com>, sign up, create a project, and wait for it to finish.

## 2. Run the database setup

Open **SQL Editor -> New query**, paste the entire contents of
[`supabase-setup.sql`](./supabase-setup.sql), and click **Run**. This creates the
tables, security rules (RLS), the safe write functions, realtime, and the private
`admin-apps` storage bucket with its policies.

> If the storage lines error on an older project, create a bucket named `admin-apps`
> in **Storage** manually and set it to **Private**, then re-run the file.

## 3. Turn on email auth for admins

**Authentication -> Providers -> Email**: make sure it is **enabled**. For a single
admin, turning **Confirm email OFF** is easiest; leave it ON if you prefer.

## 4. Paste your keys into `config.js`

In Supabase: **Project Settings -> API**. Copy the **Project URL** into `SUPABASE_URL`
and the **anon public** key into `SUPABASE_ANON_KEY` (this key is safe to publish, RLS
protects your data). Once real keys are in, the demo banner disappears.

## 5. Deploy

Deploy this folder to any static host. For **Netlify**, drag-and-drop the folder or
connect the repo; `netlify.toml` is already set (`publish = "."`).

## 6. Claim the first admin

Open **`/admin.html`**, choose **Create your account**, sign up, sign in, then press
**First-time setup: claim this site**. The first account to do this becomes the admin.

## 7. Add more moderators (the application flow)

1. A student opens **Apply to moderate** (link in the nav) and submits their name,
   email, school ID photo, and selfie.
2. It shows up in your **Applications** tab. Review the photos, then **Approve** or
   **Reject**. Either way, the ID and selfie are deleted right away.
3. On approval, that email is granted admin. The person creates an account on
   `admin.html` with the same email and can then sign in to moderate.

---

## Tuning

| What | Where |
|------|-------|
| Pre-moderation (hold every post for approval) | `create_post()` in `supabase-setup.sql` - change `'visible'` to `'pending'` |
| Max post length / nickname length | `config.js` **and** the checks in `supabase-setup.sql` |
| Posting cooldown | `POST_COOLDOWN_MS` in `config.js` |
| Banned words | the `STRONG` and `RISKY` lists in `profanity.js` |
| How long an ID/selfie preview link lasts for the admin | `applicationImageUrl()` in `db.js` (default 300s) |

---

## Security notes

- The site only ever uses the **anon public** key. All anonymous writes go through
  `SECURITY DEFINER` Postgres functions that validate input and control which columns
  are set, so visitors cannot forge a post's status or report count.
- **Row Level Security** is on for every table: the public can only read visible posts;
  reading hidden posts, reports, applications, and all moderation require an admin.
- **Reporting is queue-only** and deduped per browser, so no single person can hide
  someone else's post by reporting it repeatedly.
- **Verification images** (ID + selfie) live in a private bucket only admins can read,
  and are deleted the moment an application is approved or rejected.
- The word filter is a courtesy, not a guarantee. That is why Report + admin review
  exist. Keep an eye on the review queue.

## Files

| File | Purpose |
|------|---------|
| `index.html` / `wall.js` | The public wall |
| `admin.html` / `admin.js` | Admin login + moderation dashboard |
| `apply.html` / `apply.js` | Apply-to-moderate form |
| `ui.js` | Our own toast + confirm/report popups |
| `db.js` | The only file that talks to Supabase (with a localStorage demo fallback) |
| `config.js` | Your Supabase keys + limits |
| `profanity.js` | Filipino + English word filter |
| `style.css` | Shared design system |
| `supabase-setup.sql` | Database schema, RLS, functions, realtime, storage |
| `privacy.html` / `terms.html` | Legal + community rules |
| `netlify.toml` | Static deploy config |

Created by Red Pogi Lang.
