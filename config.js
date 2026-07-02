/* ===========================================================================
   PRMSU Freedom Wall - configuration
   ---------------------------------------------------------------------------
   1. Create a free Supabase project  →  https://supabase.com
   2. Run supabase-setup.sql in the SQL Editor (see that file's header)
   3. In Supabase: Project Settings → API, copy:
         • Project URL      → SUPABASE_URL
         • anon public key  → SUPABASE_ANON_KEY   (safe to publish)
   4. Paste them below and deploy.

   Until real keys are added, the site runs in DEMO MODE (posts are stored
   only in this browser) so you can preview the look and feel.
   =========================================================================== */
window.PRMSU_WALL_CONFIG = {
  // --- Supabase (leave the YOUR-... placeholders to stay in demo mode) ---
  SUPABASE_URL: 'https://jxfjmufypjvdbeajwvxf.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4ZmptdWZ5cGp2ZGJlYWp3dnhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MzQxMjksImV4cCI6MjA5ODUxMDEyOX0.d4PVBSG2I0PZjmR7Ivm5xTbtlYAKZ-tW9oFiiBLowq4',

  // --- Limits (keep in sync with supabase-setup.sql if you change them) ---
  POST_MAX: 500,            // max characters per post
  NICK_MAX: 24,             // max characters for an optional nickname
  POST_COOLDOWN_MS: 15000,  // gentle wait between posts from one browser

  // --- Copy shown in the footer ---
  VERSION: '1.0.0',
  UPDATED: 'July 2, 2026',
};
