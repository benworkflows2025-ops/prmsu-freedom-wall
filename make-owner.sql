-- ============================================================================
--  Create YOUR owner account (run AFTER supabase-setup.sql)
--
--  Account creation is now locked to approved emails only, so you seed the
--  owner yourself here. Supabase sign-in uses an EMAIL (not a plain username),
--  so "RedOwner" becomes a login email + the password you picked. With
--  "Auto Confirm" you do NOT need a real inbox - the email is just the login id.
-- ----------------------------------------------------------------------------
--  STEP 1 - create the login in Supabase (no confirmation email needed):
--    Supabase Dashboard  ->  Authentication  ->  Users  ->  "Add user"
--      Email:     redowner@prmsu-freedom-wall.app     (change if you want)
--      Password:  Redprmsu123!
--      [x] Auto Confirm User        <-- IMPORTANT: no email link required
--    Click "Create user".
--
--  STEP 2 - run the SQL below so that email is the OWNER (all powers).
--    If you used a different email in Step 1, change it here to match.
--
--  STEP 3 - open admin.html and sign in with that email + password. Done.
-- ============================================================================

insert into public.admins (email, role)
values (lower('redowner@prmsu-freedom-wall.app'), 'owner')
on conflict (email) do update set role = 'owner';


-- ----------------------------------------------------------------------------
--  OPTIONAL - keep ONLY this new account as owner. If you want to step your old
--  personal account down from owner, uncomment ONE of these and set your email:
-- ----------------------------------------------------------------------------
-- update public.admins set role = 'admin' where email = lower('your-old-email@gmail.com');
-- delete from public.admins where email = lower('your-old-email@gmail.com');
