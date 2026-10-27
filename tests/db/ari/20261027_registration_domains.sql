-- FIXTURE: verbatim copy of cfrady5/ARI supabase/migrations/20261027_registration_domains.sql,
-- run by the local database tests before 20261027_pgc_self_registration.sql.
-- The ARI repository owns this change; keep this copy identical to it.

-- ============================================================================
-- Self-registration for more than one email domain.                2026-10-27
--
-- Until now the guard on auth.users and provision_employee() allowed only
-- @theari.us. They now read public.portal_registration_domains: one row per
-- domain whose people may create their own portal account, with the module
-- access a new account from that domain starts with.
--
--   * @theari.us is seeded with no modules: exactly today's behaviour
--     (baseline Employee, verified email, blocklist honoured, idempotent).
--   * Proving Ground Capital adds its own row from its repository
--     (cfrady5/ARC-capital supabase/migrations/20261027_pgc_self_registration.sql):
--     @pgc.capital, starting as contributor on the pgc and pgc_newsletter modules.
--   * Domains match exactly: subdomains and lookalikes stay rejected.
--   * A grant the employee_access check refuses (an unknown module or level)
--     is skipped and logged; it never stops the account from being created.
--   * provision_employee() is no longer callable through the API (it was open
--     to anon): only the auth.users trigger and ensure_my_profile() use it.
--
-- Rows are managed in SQL by an administrator (no client writes); admins can
-- read them. Safe to run more than once.
-- ============================================================================

create table if not exists public.portal_registration_domains (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  label text not null,
  modules jsonb not null default '{}'::jsonb check (jsonb_typeof(modules) = 'object'),
  created_at timestamptz not null default now()
);
comment on table public.portal_registration_domains is
  'Email domains whose people may create their own portal account, and the module access ({module: level}) a new account starts with.';
alter table public.portal_registration_domains enable row level security;
drop policy if exists registration_domains_admin_read on public.portal_registration_domains;
create policy registration_domains_admin_read on public.portal_registration_domains for select using (public.is_admin());

insert into public.portal_registration_domains (domain, label, modules)
values ('theari.us', 'Applied Research Institute (ARI)', '{}'::jsonb)
on conflict (domain) do nothing;

-- Unconfirmed sign-ups (self-registration) must come from a listed domain and
-- not be blocklisted. Admin-created logins arrive confirmed and are not policed.
create or replace function public.auth_users_registration_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare dom text := lower(split_part(coalesce(new.email, ''), '@', 2)); allowed text;
begin
  if new.email_confirmed_at is null then
    if not exists (select 1 from public.portal_registration_domains d where d.domain = dom) then
      select string_agg('@' || d.domain, ' or ' order by d.domain <> 'theari.us', d.domain) into allowed from public.portal_registration_domains d;
      raise exception 'Only % email addresses can register for the employee portal', coalesce(allowed, 'approved');
    end if;
    if exists (select 1 from public.portal_blocklist b where b.email = lower(new.email)) then
      raise exception 'This address cannot register for the employee portal. Contact an administrator.';
    end if;
  end if;
  return new;
end $$;

-- Once the email is verified, create the profile (baseline Employee) and the
-- domain's starting access. Idempotent: an existing profile (admin-created,
-- or a retry) is left untouched, including its role and grants.
create or replace function public.provision_employee(p_email text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(coalesce(p_email, ''));
  d public.portal_registration_domains;
  v_id uuid; m text; lvl text;
  granted jsonb := '{}'::jsonb; skipped jsonb := '{}'::jsonb;
begin
  select * into d from public.portal_registration_domains where domain = lower(split_part(e, '@', 2));
  if d.domain is null then return; end if;
  if exists (select 1 from public.portal_blocklist b where b.email = e) then return; end if;
  if exists (select 1 from public.employees where lower(email) = e) then return; end if;
  insert into public.employees (email, full_name, role, status)
  values (e, nullif(left(coalesce(p_name, ''), 160), ''), 'employee', 'active')
  on conflict (email) do nothing
  returning id into v_id;
  if v_id is null then return; end if;   -- created concurrently: that call owns it
  for m, lvl in select key, value from jsonb_each_text(d.modules) loop
    begin
      insert into public.employee_access (employee_id, module, level, granted_by)
      values (v_id, m, lvl, 'self-registration')
      on conflict (employee_id, module) do nothing;
      granted := granted || jsonb_build_object(m, lvl);
    exception when others then
      skipped := skipped || jsonb_build_object(m, sqlerrm);
    end;
  end loop;
  insert into public.admin_activity (actor_email, action, target_email, detail)
  values (null, 'account_registered', e,
          jsonb_build_object('role', 'employee', 'via', 'self-registration', 'domain', d.domain)
          || case when granted <> '{}'::jsonb then jsonb_build_object('modules', granted) else '{}'::jsonb end
          || case when skipped <> '{}'::jsonb then jsonb_build_object('skipped', skipped) else '{}'::jsonb end);
end $$;
revoke execute on function public.provision_employee(text, text) from public, anon, authenticated;
grant execute on function public.provision_employee(text, text) to service_role;
