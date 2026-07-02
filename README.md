# PRMSU Freedom Wall

An anonymous, shared freedom wall for PRMSU students (Ramonians). Post a thought,
confession, shoutout, or question with no account, comment on others, and report
anything nasty. Built for the PRMSU community.

- **Static frontend** (vanilla HTML / CSS / JS, no build step)
- **[Supabase](https://supabase.com)** for the shared database, realtime updates,
  admin auth, and private storage
- Deploys to **Netlify** (or any static host) as-is

> Not an official university tool. Independent and unofficial.

## Features

- Anonymous posting with an auto nickname (`ramonians-xxxxxxx`) and note colors
- Live feed with comments (popup) and a simulated "Ramonians on the wall" counter
- Filipino + English profanity filter (client-side), report button, and an admin
  review queue
- Admin side: moderation dashboard, and an **apply-to-moderate** flow (ID + selfie
  verification stored privately and deleted on decision)

## Setup

See **[SETUP.md](SETUP.md)** for the full walkthrough. Short version:

1. Create a free Supabase project.
2. Run [`supabase-setup.sql`](supabase-setup.sql) in the SQL Editor.
3. (Optional) Run [`seed-posts.sql`](seed-posts.sql) to populate starter posts.
4. Paste your Project URL + **anon public** key into [`config.js`](config.js).
5. Deploy this folder (Netlify config is in `netlify.toml`).
6. Open `/admin.html`, create your account, and claim the first admin.

## Security

The site only uses the Supabase **anon public** key (safe to publish; protected by
Row Level Security). Never put the `service_role` key in this repo or `config.js`.

---

Created by Red Pogi Lang.
