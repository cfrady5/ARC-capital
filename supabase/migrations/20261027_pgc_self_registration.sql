-- ============================================================================
-- Proving Ground Capital (PGC) — @pgc.capital people create their own account.
-- 2026-10-27
--
-- NOT APPLIED. Apply after cfrady5/ARI supabase/migrations/20261027_registration_domains.sql,
-- which replaces ARI's @theari.us-only sign-up guard with the
-- public.portal_registration_domains list (ARI's own sign-ups are unchanged).
--
-- Adds @pgc.capital to that list. Someone with a @pgc.capital address can then
-- use "Create an account" on pgc.capital/portal/; once they verify their email
-- they get a baseline Employee profile plus:
--   pgc            contributor   edit website pages, save drafts, submit for review
--   pgc_newsletter contributor   draft and test email campaigns, submit for review
-- Publishing and sending stay with publishers and administrators, who can raise
-- anyone's access afterwards. Exact domain only: @mail.pgc.capital or
-- @pgc.capital.example are refused. Safe to run more than once; an existing
-- row is left as it is.
-- ============================================================================

do $$
begin
  if to_regclass('public.portal_registration_domains') is null then
    raise exception 'Apply cfrady5/ARI supabase/migrations/20261027_registration_domains.sql first.';
  end if;
end $$;

insert into public.portal_registration_domains (domain, label, modules)
values ('pgc.capital', 'Proving Ground Capital (PGC)', '{"pgc": "contributor", "pgc_newsletter": "contributor"}'::jsonb)
on conflict (domain) do nothing;
