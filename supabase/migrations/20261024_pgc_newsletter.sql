-- ============================================================================
-- Proving Ground Capital (PGC) — email campaigns sent through Mailchimp.
-- 2026-10-24
--
-- NOT APPLIED. Apply after 20261023_pgc_site_content.sql.
--
-- A copy of ARI's newsletter model (20260923_newsletter.sql,
-- 20260923_newsletter_templates.sql, 20261020_newsletter_template_newsletter.sql,
-- 20261021_newsletter_groups.sql in cfrady5/ARI) for the PGC site, with its own
-- tables and its own module, so nothing of ARI's is touched:
--
--   1. Module "pgc_newsletter" (contributor | publisher) joins employee_access.
--      Unlike ARI's "newsletter" it is NOT explicit: administrators have it
--      automatically (has_access() is unchanged), the same way they have "pgc".
--      Everyone else needs the grant from Users & Access.
--   2. public.pgc_campaigns: drafts and the send record. Contributors create and
--      edit drafts and submit for review; publishers review and, through the
--      pgc-mailchimp edge function, test, schedule and send. Status
--      scheduled/sent and the Mailchimp columns are written by the server
--      (service role) only; sent campaigns are frozen.
--   3. public.pgc_campaign_templates: reusable starting points, shared by
--      everyone with the module.
--
-- Additive only: the module check is replaced with the same list plus
-- 'pgc_newsletter'; no ARI table, function, policy or trigger is changed.
-- ============================================================================
set lock_timeout = '15s';

-- ---------------------------------------------------------------------------
-- 1. Module
-- ---------------------------------------------------------------------------
alter table public.employee_access drop constraint if exists employee_access_module_check;
alter table public.employee_access add constraint employee_access_module_check
  check (module in ('pages', 'newsroom', 'calendar', 'evsites', 'messages',
                    'newsletter', 'babble', 'pulse', 'documents', 'pgc', 'pgc_newsletter'));

-- ---------------------------------------------------------------------------
-- 2. Campaigns
-- ---------------------------------------------------------------------------
create table if not exists public.pgc_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject text not null default '',
  preview_text text not null default '',
  from_name text not null default 'Proving Ground Capital (PGC)',
  reply_to text not null default 'innovations@theari.us',
  template text not null default 'digest' check (template in ('digest', 'event', 'release', 'newsletter')),
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'changes_requested', 'scheduled', 'sent')),
  -- Audience: everyone, or one Mailchimp group (tag / saved segment).
  segment_id bigint,
  segment_name text,
  -- Written by the server only (pgc-mailchimp edge function):
  mailchimp_id text,
  mailchimp_web_id bigint,
  scheduled_for timestamptz,
  sent_at timestamptz,
  emails_sent integer,
  test_sent_at timestamptz,
  test_sent_to text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pgc_campaigns_updated_idx on public.pgc_campaigns (updated_at desc);
alter table public.pgc_campaigns enable row level security;

drop policy if exists pgc_campaigns_select on public.pgc_campaigns;
create policy pgc_campaigns_select on public.pgc_campaigns for select
  using (public.can_edit('pgc_newsletter'));
drop policy if exists pgc_campaigns_insert on public.pgc_campaigns;
create policy pgc_campaigns_insert on public.pgc_campaigns for insert
  with check (public.can_edit('pgc_newsletter') and status in ('draft', 'in_review'));
drop policy if exists pgc_campaigns_update on public.pgc_campaigns;
create policy pgc_campaigns_update on public.pgc_campaigns for update
  using (public.can_publish('pgc_newsletter') or (public.can_edit('pgc_newsletter') and status in ('draft', 'in_review', 'changes_requested')))
  with check (public.can_publish('pgc_newsletter') or (public.can_edit('pgc_newsletter') and status in ('draft', 'in_review', 'changes_requested')));
drop policy if exists pgc_campaigns_delete on public.pgc_campaigns;
create policy pgc_campaigns_delete on public.pgc_campaigns for delete
  using ((public.can_publish('pgc_newsletter') and status <> 'sent')
      or (public.can_edit('pgc_newsletter') and status = 'draft' and lower(coalesce(created_by, '')) = public.jwt_email()));

-- Field-level rules that RLS cannot express. The service role (edge function)
-- bypasses all of them; it is the only writer of the Mailchimp columns.
create or replace function public.pgc_campaigns_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_server() then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'in_review') then raise exception 'New campaigns start as drafts.'; end if;
    new.mailchimp_id := null; new.mailchimp_web_id := null; new.scheduled_for := null;
    new.sent_at := null; new.emails_sent := null; new.test_sent_at := null; new.test_sent_to := null;
    new.created_by := public.jwt_email();
  else
    if old.status in ('scheduled', 'sent') then
      raise exception 'A % campaign can only be changed with the Campaigns page actions.', old.status;
    end if;
    if new.status in ('scheduled', 'sent') then
      raise exception 'Use Send or Schedule on the Campaigns page to send a campaign.';
    end if;
    if new.status = 'changes_requested' and new.status is distinct from old.status
       and not public.can_publish('pgc_newsletter') then
      raise exception 'Only a publisher can request changes.';
    end if;
    -- Server-owned columns are frozen for portal users.
    new.mailchimp_id := old.mailchimp_id; new.mailchimp_web_id := old.mailchimp_web_id;
    new.scheduled_for := old.scheduled_for; new.sent_at := old.sent_at; new.emails_sent := old.emails_sent;
    new.test_sent_at := old.test_sent_at; new.test_sent_to := old.test_sent_to;
    new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  new.updated_by := public.jwt_email();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists pgc_campaigns_guard on public.pgc_campaigns;
create trigger pgc_campaigns_guard before insert or update on public.pgc_campaigns
  for each row execute function public.pgc_campaigns_guard();

revoke all on public.pgc_campaigns from anon;
grant select, insert, update, delete on public.pgc_campaigns to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Templates
-- ---------------------------------------------------------------------------
create table if not exists public.pgc_campaign_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  template text not null default 'digest' check (template in ('digest', 'event', 'release', 'newsletter')),
  from_name text not null default 'Proving Ground Capital (PGC)',
  reply_to text not null default 'innovations@theari.us',
  subject text not null default '',
  preview_text text not null default '',
  content jsonb not null default '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pgc_campaign_templates_updated_idx on public.pgc_campaign_templates (updated_at desc);
alter table public.pgc_campaign_templates enable row level security;

drop policy if exists pgc_campaign_templates_select on public.pgc_campaign_templates;
create policy pgc_campaign_templates_select on public.pgc_campaign_templates for select using (public.can_edit('pgc_newsletter'));
drop policy if exists pgc_campaign_templates_write on public.pgc_campaign_templates;
create policy pgc_campaign_templates_write on public.pgc_campaign_templates for all
  using (public.can_edit('pgc_newsletter')) with check (public.can_edit('pgc_newsletter'));

create or replace function public.pgc_campaign_templates_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(nullif(public.jwt_email(), ''), new.created_by); new.created_at := now(); end if;
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  new.updated_by := coalesce(nullif(public.jwt_email(), ''), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists pgc_campaign_templates_stamp on public.pgc_campaign_templates;
create trigger pgc_campaign_templates_stamp before insert or update on public.pgc_campaign_templates
  for each row execute function public.pgc_campaign_templates_stamp();

revoke all on public.pgc_campaign_templates from anon;
grant select, insert, update, delete on public.pgc_campaign_templates to authenticated, service_role;

comment on table public.pgc_campaigns is 'Proving Ground Capital email campaigns (composed in the PGC portal, sent through Mailchimp by the pgc-mailchimp function).';
comment on table public.pgc_campaign_templates is 'Proving Ground Capital email campaign templates.';
