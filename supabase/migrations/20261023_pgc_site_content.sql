-- ============================================================================
-- Proving Ground Capital (PGC) — editable website content.          2026-10-23
--
-- NOT APPLIED. Apply this file first, then 20261023_pgc_media_bucket.sql,
-- then (optionally) 20261023_pgc_seed_content.sql.
--
-- Additive only. Nothing here alters, drops or re-creates an existing ARI
-- table, function, policy or trigger. The single exception is the
-- employee_access_module_check constraint, which is replaced with the same
-- list plus 'pgc' — exactly as 20261022_documents_access.sql did for
-- 'documents'.
--
-- What this adds
--   1. Module "pgc" (levels contributor | publisher) on employee_access.
--      NOT explicit: ARI administrators have it automatically, because
--      has_access() short-circuits on is_admin().
--   2. Four content tables, all prefixed pgc_:
--        pgc_pages     one row per page of provinggroundcapital.vercel.app
--        pgc_sections  the ordered blocks of a page (text, items, images)
--        pgc_team      the people on /team/
--        pgc_settings  site-wide values (footer lines, contact address, …)
--      Each carries `published boolean` and `review_state`
--      (draft | in_review | changes_requested), like ARI's posts/events.
--   3. RLS:
--        anon + everyone         select published rows only
--        can_edit('pgc')         select drafts, insert/update unpublished rows
--        can_publish('pgc')      publish, unpublish, delete
--      anon keeps select and nothing else.
--   4. A review guard: only a pgc publisher may set 'changes_requested', and
--      publishing resets review_state to 'draft' (the ARI convention).
--   5. Revision logging into the shared public.content_revisions, through a
--      PGC-specific trigger function (ARI's log_content_revision() is left
--      untouched) and public.pgc_restore_revision() for undo. Restoring is a
--      publisher action.
--
-- Note for whoever grants the permission: public.is_comms() in ARI is true
-- for anyone holding any employee_access row whose module is not 'messages'.
-- Granting "pgc" therefore also makes that person is_comms() inside the ARI
-- portal, which lets them read content_revisions and upload to the shared
-- comms storage buckets. That is ARI's existing rule, not something this
-- migration changes; it is called out so the grant is made knowingly.
-- ============================================================================
set lock_timeout = '15s';

-- ---------------------------------------------------------------------------
-- 1. Module
-- ---------------------------------------------------------------------------
alter table public.employee_access drop constraint if exists employee_access_module_check;
alter table public.employee_access add constraint employee_access_module_check
  check (module in ('pages', 'newsroom', 'calendar', 'evsites', 'messages',
                    'newsletter', 'babble', 'pulse', 'documents', 'pgc'));

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.pgc_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                 -- 'home', 'thesis', 'investors', …
  path text not null,                        -- '/', '/thesis/', …
  title text not null,                       -- browser/page title
  nav_label text,
  meta_description text,
  sort_order integer not null default 0,
  published boolean not null default false,
  review_state text not null default 'draft'
    check (review_state in ('draft', 'in_review', 'changes_requested')),
  updated_at timestamptz not null default now(),
  updated_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.pgc_sections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pgc_pages (id) on delete cascade,
  -- Matches data-pgc-section in the page's markup. A section added from the
  -- portal has no key and is rendered from `kind`.
  section_key text,
  kind text not null default 'rich'
    check (kind in ('hero', 'rich', 'cards', 'ticks', 'statement', 'cta')),
  eyebrow text,
  heading text,
  heading_accent text,                       -- the mint clause, on its own line
  kicker text,
  lead text,                                 -- paragraphs, blank-line separated
  note text,
  bullets jsonb not null default '[]'::jsonb,
  items jsonb not null default '[]'::jsonb,
  image_url text,
  image_alt text,
  band text not null default 'default' check (band in ('default', 'alt')),
  sort_order integer not null default 0,
  published boolean not null default false,
  review_state text not null default 'draft'
    check (review_state in ('draft', 'in_review', 'changes_requested')),
  updated_at timestamptz not null default now(),
  updated_by text,
  created_at timestamptz not null default now(),
  unique (page_id, section_key)
);
create index if not exists pgc_sections_page_idx on public.pgc_sections (page_id, sort_order);

create table if not exists public.pgc_team (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  bio text,                                  -- paragraphs, blank-line separated
  photo_url text,
  photo_alt text,
  linkedin_url text,
  email text,
  team_group text not null default 'principals'
    check (team_group in ('principals', 'bench')),
  sort_order integer not null default 0,
  published boolean not null default false,
  review_state text not null default 'draft'
    check (review_state in ('draft', 'in_review', 'changes_requested')),
  updated_at timestamptz not null default now(),
  updated_by text,
  created_at timestamptz not null default now()
);
create index if not exists pgc_team_group_idx on public.pgc_team (team_group, sort_order);

create table if not exists public.pgc_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  value text,
  published boolean not null default false,
  review_state text not null default 'draft'
    check (review_state in ('draft', 'in_review', 'changes_requested')),
  updated_at timestamptz not null default now(),
  updated_by text,
  created_at timestamptz not null default now()
);

alter table public.pgc_pages    enable row level security;
alter table public.pgc_sections enable row level security;
alter table public.pgc_team     enable row level security;
alter table public.pgc_settings enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
--    read:   published, or a pgc editor
--    write:  a pgc publisher always; a pgc contributor only while unpublished
--    delete: pgc publishers only
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pgc_pages', 'pgc_sections', 'pgc_team', 'pgc_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for select using (published = true or public.can_edit(''pgc''))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert with check (public.can_publish(''pgc'') or (public.can_edit(''pgc'') and published = false))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update using (public.can_publish(''pgc'') or (public.can_edit(''pgc'') and published = false)) with check (public.can_publish(''pgc'') or (public.can_edit(''pgc'') and published = false))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete using (public.can_publish(''pgc''))',
      t || '_delete', t);
  end loop;
end $$;

-- Table privileges. anon may only read; RLS then limits it to published rows.
revoke all on public.pgc_pages, public.pgc_sections, public.pgc_team, public.pgc_settings from anon;
revoke all on public.pgc_pages, public.pgc_sections, public.pgc_team, public.pgc_settings from authenticated;
grant select on public.pgc_pages, public.pgc_sections, public.pgc_team, public.pgc_settings to anon;
grant select, insert, update, delete
  on public.pgc_pages, public.pgc_sections, public.pgc_team, public.pgc_settings to authenticated;
grant all on public.pgc_pages, public.pgc_sections, public.pgc_team, public.pgc_settings to service_role;

-- ---------------------------------------------------------------------------
-- 4. Review-state guard + stamping
--    Only a publisher can send something back with "changes requested", and a
--    published row's review_state is always 'draft' (nothing is in review once
--    it is live). updated_at / updated_by are set by the database so the
--    "Edited by …" line in the portal cannot be spoofed.
-- ---------------------------------------------------------------------------
create or replace function public.pgc_content_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_server() then
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if new.review_state = 'changes_requested'
     and (tg_op = 'INSERT' or old.review_state is distinct from 'changes_requested')
     and not public.can_publish('pgc') then
    raise exception 'Only a Proving Ground Capital publisher can request changes.';
  end if;
  if new.published then new.review_state := 'draft'; end if;
  new.updated_at := now();
  new.updated_by := nullif(public.jwt_email(), '');
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['pgc_pages', 'pgc_sections', 'pgc_team', 'pgc_settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_guard', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.pgc_content_guard()', t || '_guard', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Revision history (shared public.content_revisions) + undo
--    A PGC-specific logger so ARI's log_content_revision() and
--    revision_label() stay exactly as they are.
-- ---------------------------------------------------------------------------
create or replace function public.pgc_revision_label(t text, row_data jsonb) returns text
language sql immutable as $$
  select case t
    when 'pgc_pages'    then coalesce(row_data ->> 'title', row_data ->> 'slug', 'Page')
    when 'pgc_sections' then coalesce(nullif(row_data ->> 'heading', ''),
                                      nullif(row_data ->> 'eyebrow', ''),
                                      nullif(row_data ->> 'section_key', ''), 'Section')
    when 'pgc_team'     then coalesce(row_data ->> 'name', 'Team member')
    when 'pgc_settings' then coalesce(row_data ->> 'label', row_data ->> 'key', 'Setting')
    else t end;
$$;

create or replace function public.pgc_log_revision() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor text; data jsonb; rec_id uuid;
begin
  if coalesce(current_setting('pgc.skip_revision', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    data := to_jsonb(old); rec_id := old.id;
  else
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by')
    then return new; end if;
    data := to_jsonb(new); rec_id := new.id;
  end if;
  begin actor := nullif(auth.jwt() ->> 'email', ''); exception when others then actor := null; end;
  insert into public.content_revisions (table_name, record_id, operation, snapshot, label, changed_by)
  values (tg_table_name, rec_id, lower(tg_op), data,
          public.pgc_revision_label(tg_table_name, data), actor);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['pgc_pages', 'pgc_sections', 'pgc_team', 'pgc_settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_revision', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.pgc_log_revision()', t || '_revision', t);
  end loop;
end $$;

-- Undo. Separate from ARI's restore_revision() (whose table whitelist and
-- module mapping are deliberately left alone).
create or replace function public.pgc_restore_revision(rev_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.content_revisions; actor text;
begin
  select * into r from public.content_revisions where id = rev_id;
  if not found then raise exception 'That version no longer exists.'; end if;
  if r.table_name not in ('pgc_pages', 'pgc_sections', 'pgc_team', 'pgc_settings') then
    raise exception 'Not a Proving Ground Capital record: %', r.table_name;
  end if;
  -- Putting a version back can change what the public site shows.
  if not public.can_publish('pgc') then raise exception 'Not authorized.'; end if;
  begin actor := nullif(auth.jwt() ->> 'email', ''); exception when others then actor := null; end;
  perform set_config('pgc.skip_revision', 'on', true);
  execute format('delete from public.%I where id = $1', r.table_name) using r.record_id;
  execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
                 r.table_name, r.table_name) using r.snapshot;
  perform set_config('pgc.skip_revision', 'off', true);
  insert into public.content_revisions (table_name, record_id, operation, snapshot, label, changed_by)
  values (r.table_name, r.record_id, 'restore', r.snapshot,
          public.pgc_revision_label(r.table_name, r.snapshot), actor);
  return r.snapshot;
end $$;
revoke all on function public.pgc_restore_revision(bigint) from public, anon;
grant execute on function public.pgc_restore_revision(bigint) to authenticated, service_role;

-- The portal reads the history through content_revisions directly; ARI's
-- revisions_select policy (public.is_comms()) already covers a pgc grantee.

comment on table public.pgc_pages is 'Proving Ground Capital website: one row per public page.';
comment on table public.pgc_sections is 'Proving Ground Capital website: ordered content blocks of a page.';
comment on table public.pgc_team is 'Proving Ground Capital website: the people shown on /team/.';
comment on table public.pgc_settings is 'Proving Ground Capital website: site-wide editable values.';
