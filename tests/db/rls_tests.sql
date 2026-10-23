-- RLS / access tests for the pgc_* tables. Run after local_schema.sql and the
-- two PGC migrations (see tests/README.md). Prints one row per check and a
-- final `failures | total` line; the run passes when failures = 0.

create table if not exists public.t_results (n serial, label text, ok boolean, note text);
grant all on public.t_results, public.t_results_n_seq to anon, authenticated, service_role;

-- Run `sql` and record whether it behaved as expected (ok / blocked).
create or replace function public.t(label text, sql text, expect_ok boolean) returns void language plpgsql as $$
declare msg text;
begin
  begin
    execute sql;
    insert into public.t_results (label, ok, note) values (label, expect_ok, case when expect_ok then 'ok' else 'UNEXPECTED SUCCESS' end);
  exception when others then
    get stacked diagnostics msg = message_text;
    insert into public.t_results (label, ok, note) values (label, not expect_ok, case when expect_ok then 'UNEXPECTED FAIL: ' || msg else 'blocked: ' || left(msg, 70) end);
  end;
end $$;
-- Expect a statement to touch exactly n rows (RLS hides rows silently on update/delete).
create or replace function public.t_rows(label text, sql text, expect_n int) returns void language plpgsql as $$
declare n int; msg text;
begin
  begin
    execute sql; get diagnostics n = row_count;
    insert into public.t_results (label, ok, note) values (label, n = expect_n, 'rows=' || n || ' expected=' || expect_n);
  exception when others then
    get stacked diagnostics msg = message_text;
    insert into public.t_results (label, ok, note) values (label, false, 'ERROR: ' || msg);
  end;
end $$;
create or replace function public.t_count(label text, sql text, expect_n int) returns void language plpgsql as $$
declare n int; msg text;
begin
  begin
    execute 'select count(*) from (' || sql || ') q' into n;
    insert into public.t_results (label, ok, note) values (label, n = expect_n, 'count=' || n || ' expected=' || expect_n);
  exception when others then
    get stacked diagnostics msg = message_text;
    insert into public.t_results (label, ok, note) values (label, false, 'ERROR: ' || msg);
  end;
end $$;
create or replace function public.t_eq(label text, sql text, expect text) returns void language plpgsql as $$
declare v text; msg text;
begin
  begin
    execute sql into v;
    insert into public.t_results (label, ok, note) values (label, v is not distinct from expect, 'got=' || coalesce(v, '<null>') || ' expected=' || coalesce(expect, '<null>'));
  exception when others then
    get stacked diagnostics msg = message_text;
    insert into public.t_results (label, ok, note) values (label, false, 'ERROR: ' || msg);
  end;
end $$;
grant execute on function public.t(text, text, boolean), public.t_rows(text, text, int), public.t_count(text, text, int), public.t_eq(text, text, text) to anon, authenticated, service_role;

-- Switch identity: role + JWT claims, the way PostgREST does it.
create or replace function public.as_user(p_email text, p_role text default 'authenticated') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when p_email is null and p_role = 'anon' then json_build_object('role', 'anon')::text
                                                when p_email is null then ''
                                                else json_build_object('email', p_email, 'role', p_role, 'sub', gen_random_uuid())::text end, false);
end $$;

-- ================= SEED (superuser, RLS bypassed) =================
select public.as_user(null);
insert into public.employees (id, email, full_name, role, status) values
  ('00000000-0000-0000-0000-000000000001', 'admin@theari.us', 'Ada Admin', 'admin', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'contrib@theari.us', 'Cora Contributor', 'employee', 'active'),
  ('00000000-0000-0000-0000-000000000003', 'pub@theari.us', 'Pat Publisher', 'employee', 'active'),
  ('00000000-0000-0000-0000-000000000004', 'base@theari.us', 'Bea Baseline', 'employee', 'active'),
  ('00000000-0000-0000-0000-000000000005', 'susp@theari.us', 'Sue Suspended', 'employee', 'suspended'),
  ('00000000-0000-0000-0000-000000000006', 'news@theari.us', 'Ned Newsroom', 'employee', 'active');

-- The module must be grantable, and only the known modules are.
select public.t('module: pgc contributor grant is accepted', $$insert into public.employee_access (employee_id, module, level) values ('00000000-0000-0000-0000-000000000002', 'pgc', 'contributor')$$, true);
select public.t('module: pgc publisher grant is accepted', $$insert into public.employee_access (employee_id, module, level) values ('00000000-0000-0000-0000-000000000003', 'pgc', 'publisher')$$, true);
select public.t('module: suspended publisher grant stored (ignored by helpers)', $$insert into public.employee_access (employee_id, module, level) values ('00000000-0000-0000-0000-000000000005', 'pgc', 'publisher')$$, true);
select public.t('module: existing ARI module still accepted', $$insert into public.employee_access (employee_id, module, level) values ('00000000-0000-0000-0000-000000000006', 'newsroom', 'publisher')$$, true);
select public.t('module: unknown module is refused', $$insert into public.employee_access (employee_id, module, level) values ('00000000-0000-0000-0000-000000000004', 'bogus', 'publisher')$$, false);

insert into public.pgc_pages (id, slug, path, title, nav_label, sort_order, published) values
  ('10000000-0000-0000-0000-000000000001', 'home', '/', 'Home', 'Home', 10, true),
  ('10000000-0000-0000-0000-000000000002', 'thesis', '/thesis/', 'Investment Thesis', 'Thesis', 20, false);
insert into public.pgc_sections (id, page_id, section_key, kind, heading, items, sort_order, published) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'hero', 'hero', 'Live hero', '[]', 10, true),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'why', 'rich', 'Draft why', '[]', 20, false),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'hero', 'hero', 'Thesis hero draft', '[]', 10, false);
insert into public.pgc_team (id, name, role, team_group, sort_order, published) values
  ('30000000-0000-0000-0000-000000000001', 'Live Person', 'CEO', 'principals', 10, true),
  ('30000000-0000-0000-0000-000000000002', 'Draft Person', 'Associate', 'bench', 10, false);
insert into public.pgc_settings (id, key, label, value, published) values
  ('40000000-0000-0000-0000-000000000001', 'footer_tagline', 'Footer tagline', 'Live tagline', true),
  ('40000000-0000-0000-0000-000000000002', 'contact_email', 'Contact email', 'draft@example.com', false);
insert into public.posts (id, title, published) values ('50000000-0000-0000-0000-000000000001', 'An ARI post', true);
-- The seed above ran as superuser with no JWT, so the revision trigger logged it with changed_by null.
delete from public.content_revisions;

-- ================= ANONYMOUS =================
set role anon;
select public.as_user(null, 'anon');
select public.t_count('anon: sees only the published page', $$select * from public.pgc_pages$$, 1);
select public.t_count('anon: sees only published sections', $$select * from public.pgc_sections$$, 1);
select public.t_eq('anon: the published section is the live one', $$select heading from public.pgc_sections limit 1$$, 'Live hero');
select public.t_count('anon: sees only the published team member', $$select * from public.pgc_team$$, 1);
select public.t_count('anon: sees only the published setting', $$select * from public.pgc_settings$$, 1);
select public.t('anon: cannot insert a page', $$insert into public.pgc_pages (slug, path, title) values ('x', '/x/', 'X')$$, false);
select public.t('anon: cannot update a section', $$update public.pgc_sections set heading = 'hacked' where id = '20000000-0000-0000-0000-000000000001'$$, false);
select public.t('anon: cannot delete a team member', $$delete from public.pgc_team$$, false);
select public.t('anon: cannot read change history', $$select * from public.content_revisions$$, false);
select public.t('anon: cannot restore a version', $$select public.pgc_restore_revision(1)$$, false);
select public.t('anon: cannot upload to pgc-media', $$insert into storage.objects (bucket_id, name) values ('pgc-media', 'a.png')$$, false);
reset role;

-- ================= SIGNED IN, NOT AN EMPLOYEE =================
set role authenticated;
select public.as_user('stranger@example.com');
select public.t_count('outsider: sees only published pages', $$select * from public.pgc_pages$$, 1);
select public.t_count('outsider: sees only published sections', $$select * from public.pgc_sections$$, 1);
select public.t('outsider: cannot insert a draft', $$insert into public.pgc_sections (page_id, kind, heading) values ('10000000-0000-0000-0000-000000000001', 'rich', 'x')$$, false);
select public.t_rows('outsider: update touches nothing', $$update public.pgc_sections set heading = 'x' where id = '20000000-0000-0000-0000-000000000001'$$, 0);
select public.t_count('outsider: my_access is null', $$select 1 where public.my_access() = 'null'::jsonb$$, 1);
reset role;

-- ================= EMPLOYEE WITHOUT THE MODULE =================
set role authenticated;
select public.as_user('base@theari.us');
select public.t_count('employee: sees only published pages', $$select * from public.pgc_pages$$, 1);
select public.t_count('employee: sees only published sections', $$select * from public.pgc_sections$$, 1);
select public.t_count('employee: sees only published team', $$select * from public.pgc_team$$, 1);
select public.t('employee: cannot insert a draft section', $$insert into public.pgc_sections (page_id, kind, heading, published) values ('10000000-0000-0000-0000-000000000001', 'rich', 'x', false)$$, false);
select public.t_rows('employee: cannot update a live section (0 rows)', $$update public.pgc_sections set heading = 'x' where id = '20000000-0000-0000-0000-000000000001'$$, 0);
select public.t_rows('employee: cannot delete (0 rows)', $$delete from public.pgc_team where id = '30000000-0000-0000-0000-000000000001'$$, 0);
select public.t('employee: cannot upload to pgc-media', $$insert into storage.objects (bucket_id, name) values ('pgc-media', 'b.png')$$, false);
select public.t_count('employee: change history is empty for them', $$select * from public.content_revisions$$, 0);
select public.t_eq('employee: my_access has no pgc module', $$select (public.my_access() -> 'modules') ->> 'pgc'$$, null);
reset role;

-- ================= SUSPENDED (holds a publisher grant) =================
set role authenticated;
select public.as_user('susp@theari.us');
select public.t_count('suspended: sees only published sections', $$select * from public.pgc_sections$$, 1);
select public.t('suspended: cannot insert', $$insert into public.pgc_sections (page_id, kind, heading, published) values ('10000000-0000-0000-0000-000000000001', 'rich', 'x', false)$$, false);
select public.t_rows('suspended: cannot edit a draft (0 rows)', $$update public.pgc_sections set heading = 'x' where id = '20000000-0000-0000-0000-000000000002'$$, 0);
select public.t_rows('suspended: cannot publish (0 rows)', $$update public.pgc_sections set published = true where id = '20000000-0000-0000-0000-000000000002'$$, 0);
select public.t('suspended: cannot upload', $$insert into storage.objects (bucket_id, name) values ('pgc-media', 'c.png')$$, false);
select public.t_eq('suspended: my_access reports the status', $$select public.my_access() ->> 'status'$$, 'suspended');
reset role;

-- ================= ARI EMPLOYEE WITH A DIFFERENT MODULE =================
set role authenticated;
select public.as_user('news@theari.us');
select public.t_count('newsroom publisher: sees only published PGC sections', $$select * from public.pgc_sections$$, 1);
select public.t('newsroom publisher: cannot insert PGC content', $$insert into public.pgc_sections (page_id, kind, heading, published) values ('10000000-0000-0000-0000-000000000001', 'rich', 'x', false)$$, false);
select public.t_rows('newsroom publisher: cannot edit a PGC draft', $$update public.pgc_sections set heading = 'x' where id = '20000000-0000-0000-0000-000000000002'$$, 0);
reset role;

-- ================= CONTRIBUTOR =================
set role authenticated;
select public.as_user('contrib@theari.us');
select public.t_eq('contributor: my_access reports pgc=contributor', $$select (public.my_access() -> 'modules') ->> 'pgc'$$, 'contributor');
select public.t_count('contributor: sees drafts and live pages', $$select * from public.pgc_pages$$, 2);
select public.t_count('contributor: sees all sections', $$select * from public.pgc_sections$$, 3);
select public.t_count('contributor: sees all team members', $$select * from public.pgc_team$$, 2);
select public.t('contributor: adds a draft section', $$insert into public.pgc_sections (id, page_id, kind, heading, published) values ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', 'cards', 'New cards', false)$$, true);
select public.t('contributor: cannot insert a published section', $$insert into public.pgc_sections (page_id, kind, heading, published) values ('10000000-0000-0000-0000-000000000002', 'cards', 'Sneaky', true)$$, false);
select public.t_rows('contributor: edits a draft section', $$update public.pgc_sections set heading = 'Draft why, edited' where id = '20000000-0000-0000-0000-000000000002'$$, 1);
select public.t_eq('contributor: the database stamped updated_by', $$select updated_by from public.pgc_sections where id = '20000000-0000-0000-0000-000000000002'$$, 'contrib@theari.us');
select public.t_rows('contributor: cannot edit a live section (0 rows)', $$update public.pgc_sections set heading = 'x' where id = '20000000-0000-0000-0000-000000000001'$$, 0);
select public.t_rows('contributor: cannot edit a live team member (0 rows)', $$update public.pgc_team set role = 'x' where id = '30000000-0000-0000-0000-000000000001'$$, 0);
select public.t('contributor: cannot publish a draft', $$update public.pgc_sections set published = true where id = '20000000-0000-0000-0000-000000000002'$$, false);
select public.t('contributor: cannot publish a page', $$update public.pgc_pages set published = true where id = '10000000-0000-0000-0000-000000000002'$$, false);
select public.t_rows('contributor: submits a draft for review', $$update public.pgc_sections set review_state = 'in_review' where id = '20000000-0000-0000-0000-000000000002'$$, 1);
select public.t_rows('contributor: submits the page for review', $$update public.pgc_pages set review_state = 'in_review' where id = '10000000-0000-0000-0000-000000000002'$$, 1);
select public.t_rows('contributor: withdraws from review', $$update public.pgc_pages set review_state = 'draft' where id = '10000000-0000-0000-0000-000000000002'$$, 1);
select public.t('contributor: cannot request changes', $$update public.pgc_sections set review_state = 'changes_requested' where id = '20000000-0000-0000-0000-000000000002'$$, false);
select public.t_rows('contributor: cannot delete a draft section (publishers only)', $$delete from public.pgc_sections where id = '20000000-0000-0000-0000-000000000010'$$, 0);
select public.t_rows('contributor: cannot delete a live team member', $$delete from public.pgc_team where id = '30000000-0000-0000-0000-000000000001'$$, 0);
select public.t('contributor: adds a draft team member', $$insert into public.pgc_team (name, team_group, published) values ('New Hire', 'bench', false)$$, true);
select public.t('contributor: adds a draft setting', $$insert into public.pgc_settings (key, label, value, published) values ('footer_disclaimer', 'Disclosure', 'draft text', false)$$, true);
select public.t('contributor: uploads to pgc-media', $$insert into storage.objects (id, bucket_id, name) values ('60000000-0000-0000-0000-000000000001', 'pgc-media', 'd.png')$$, true);
select public.t_rows('contributor: cannot delete from pgc-media (0 rows)', $$delete from storage.objects where id = '60000000-0000-0000-0000-000000000001'$$, 0);
select public.t('contributor: cannot upload to another bucket', $$insert into storage.objects (bucket_id, name) values ('pgc-media-2', 'e.png')$$, false);
-- Two edits above (heading, then review_state) → two revisions on that section.
select public.t_count('contributor: reads the change history of their edits', $$select * from public.content_revisions where table_name = 'pgc_sections' and record_id = '20000000-0000-0000-0000-000000000002'$$, 2);
select public.t_eq('contributor: history records who made the change', $$select changed_by from public.content_revisions where record_id = '20000000-0000-0000-0000-000000000002' order by id limit 1$$, 'contrib@theari.us');
select public.t('contributor: cannot restore a version', $$select public.pgc_restore_revision((select min(id) from public.content_revisions where record_id = '20000000-0000-0000-0000-000000000002'))$$, false);
reset role;

-- ================= PUBLISHER =================
set role authenticated;
select public.as_user('pub@theari.us');
select public.t_eq('publisher: my_access reports pgc=publisher', $$select (public.my_access() -> 'modules') ->> 'pgc'$$, 'publisher');
select public.t_rows('publisher: requests changes on the submitted draft', $$update public.pgc_sections set review_state = 'changes_requested' where id = '20000000-0000-0000-0000-000000000002'$$, 1);
select public.t_rows('publisher: edits a live section', $$update public.pgc_sections set heading = 'Live hero, edited' where id = '20000000-0000-0000-0000-000000000001'$$, 1);
select public.t_rows('publisher: publishes a draft section', $$update public.pgc_sections set published = true where id = '20000000-0000-0000-0000-000000000002'$$, 1);
select public.t_eq('publisher: publishing resets review_state to draft', $$select review_state from public.pgc_sections where id = '20000000-0000-0000-0000-000000000002'$$, 'draft');
select public.t_rows('publisher: publishes the thesis page', $$update public.pgc_pages set published = true where id = '10000000-0000-0000-0000-000000000002'$$, 1);
select public.t_rows('publisher: unpublishes a section', $$update public.pgc_sections set published = false where id = '20000000-0000-0000-0000-000000000002'$$, 1);
select public.t('publisher: inserts directly as published', $$insert into public.pgc_team (id, name, team_group, published) values ('30000000-0000-0000-0000-000000000003', 'Pub Person', 'bench', true)$$, true);
select public.t_rows('publisher: deletes a draft section', $$delete from public.pgc_sections where id = '20000000-0000-0000-0000-000000000010'$$, 1);
select public.t_rows('publisher: deletes a live team member', $$delete from public.pgc_team where id = '30000000-0000-0000-0000-000000000003'$$, 1);
select public.t_rows('publisher: deletes from pgc-media', $$delete from storage.objects where id = '60000000-0000-0000-0000-000000000001'$$, 1);
-- undo: restore the hero to the version before the publisher's edit
select public.t_eq('publisher: undo restores the earlier heading',
  $$select (public.pgc_restore_revision((select max(id) from public.content_revisions where record_id = '20000000-0000-0000-0000-000000000001' and operation = 'update' and snapshot ->> 'heading' = 'Live hero, edited')))::jsonb ->> 'heading'$$,
  'Live hero, edited');
select public.t_eq('publisher: restoring the pre-edit version brings the old text back',
  $$select (public.pgc_restore_revision((select min(id) from public.content_revisions where record_id = '20000000-0000-0000-0000-000000000002' and operation = 'update')))::jsonb ->> 'heading'$$,
  'Draft why, edited');
select public.t_eq('publisher: the restored row is what the table shows', $$select heading from public.pgc_sections where id = '20000000-0000-0000-0000-000000000002'$$, 'Draft why, edited');
select public.t_count('publisher: a restore is itself logged', $$select * from public.content_revisions where operation = 'restore'$$, 2);
select public.t('publisher: cannot restore a non-PGC record', $$select public.pgc_restore_revision((select id from public.content_revisions where table_name = 'pgc_pages' limit 1) + 100000)$$, false);
select public.t_count('publisher: deleted rows leave a delete revision', $$select * from public.content_revisions where operation = 'delete' and table_name = 'pgc_sections'$$, 1);
reset role;

-- restore_revision refuses ARI tables even for a publisher: forge a revision row as superuser
insert into public.content_revisions (table_name, record_id, operation, snapshot) values ('posts', '50000000-0000-0000-0000-000000000001', 'update', '{"id":"50000000-0000-0000-0000-000000000001","title":"x","published":true}');
set role authenticated;
select public.as_user('pub@theari.us');
select public.t('publisher: pgc_restore_revision refuses an ARI table', $$select public.pgc_restore_revision((select max(id) from public.content_revisions where table_name = 'posts'))$$, false);
reset role;

-- ================= ADMINISTRATOR (no module row) =================
set role authenticated;
select public.as_user('admin@theari.us');
select public.t_count('admin: sees every section', $$select * from public.pgc_sections$$, 3);
select public.t_rows('admin: edits a live section', $$update public.pgc_sections set heading = 'Admin edit' where id = '20000000-0000-0000-0000-000000000001'$$, 1);
select public.t_rows('admin: publishes', $$update public.pgc_sections set published = true where id = '20000000-0000-0000-0000-000000000003'$$, 1);
select public.t_rows('admin: requests changes', $$update public.pgc_sections set review_state = 'changes_requested' where id = '20000000-0000-0000-0000-000000000002'$$, 1);
select public.t('admin: uploads to pgc-media', $$insert into storage.objects (bucket_id, name) values ('pgc-media', 'f.png')$$, true);
select public.t_count('admin: reads the whole history', $$select * from public.content_revisions where table_name like 'pgc_%'$$, (select count(*)::int from public.content_revisions where table_name like 'pgc_%'));
reset role;

-- ================= NO-OP UPDATES DO NOT CLUTTER THE HISTORY =================
set role authenticated;
select public.as_user('pub@theari.us');
create temp table t_before as select count(*) as c from public.content_revisions;
select public.t_rows('history: a no-op update touches the row', $$update public.pgc_sections set heading = heading where id = '20000000-0000-0000-0000-000000000001'$$, 1);
select public.t_eq('history: …but logs nothing', $$select (select count(*) from public.content_revisions) - (select c from t_before)$$, '0');
reset role;

-- ================= PUBLIC READ AFTER THE ROUND =================
set role anon;
select public.as_user(null, 'anon');
select public.t_count('anon: still sees exactly the published sections', $$select * from public.pgc_sections$$, 2);
select public.t_count('anon: never sees a changes-requested draft', $$select * from public.pgc_sections where review_state = 'changes_requested'$$, 0);
reset role;

-- ================= EMAIL CAMPAIGNS (pgc_newsletter) =================
select public.as_user(null);
select public.t('campaigns: pgc_newsletter contributor grant is accepted', $$insert into public.employee_access (employee_id, module, level) values ('00000000-0000-0000-0000-000000000004', 'pgc_newsletter', 'contributor')$$, true);
select public.t('campaigns: pgc_newsletter publisher grant is accepted', $$insert into public.employee_access (employee_id, module, level) values ('00000000-0000-0000-0000-000000000006', 'pgc_newsletter', 'publisher')$$, true);
insert into public.pgc_campaigns (id, title, subject, status, created_by) values
  ('70000000-0000-0000-0000-000000000001', 'Sent issue', 'Sent', 'sent', 'news@theari.us'),
  ('70000000-0000-0000-0000-000000000002', 'Someone else''s draft', 'Draft', 'draft', 'news@theari.us');
update public.pgc_campaigns set mailchimp_id = 'mc-sent', emails_sent = 120, sent_at = now() where id = '70000000-0000-0000-0000-000000000001';

-- A pgc (website) contributor without the campaigns module sees nothing.
set role authenticated;
select public.as_user('contrib@theari.us');
select public.t_count('campaigns: website contributor without the module sees no campaigns', $$select * from public.pgc_campaigns$$, 0);
select public.t('campaigns: …and cannot create one', $$insert into public.pgc_campaigns (title) values ('x')$$, false);
select public.t_count('campaigns: …and sees no templates', $$select * from public.pgc_campaign_templates$$, 0);
reset role;
-- anon: nothing at all
set role anon; select public.as_user(null, 'anon');
select public.t('campaigns: anon cannot read campaigns', $$select * from public.pgc_campaigns$$, false);
select public.t('campaigns: anon cannot read templates', $$select * from public.pgc_campaign_templates$$, false);
reset role;
-- contributor (base@theari.us now holds pgc_newsletter/contributor)
set role authenticated;
select public.as_user('base@theari.us');
select public.t_eq('campaigns: my_access reports pgc_newsletter=contributor', $$select (public.my_access() -> 'modules') ->> 'pgc_newsletter'$$, 'contributor');
select public.t_count('campaigns: contributor sees every campaign', $$select * from public.pgc_campaigns$$, 2);
select public.t('campaigns: contributor creates a draft', $$insert into public.pgc_campaigns (id, title, subject) values ('70000000-0000-0000-0000-000000000003', 'My draft', 'Hello')$$, true);
select public.t_eq('campaigns: created_by is stamped by the database', $$select created_by from public.pgc_campaigns where id = '70000000-0000-0000-0000-000000000003'$$, 'base@theari.us');
select public.t('campaigns: contributor cannot create a scheduled campaign', $$insert into public.pgc_campaigns (title, status) values ('x', 'scheduled')$$, false);
select public.t('campaigns: contributor cannot write the Mailchimp columns', $$update public.pgc_campaigns set mailchimp_id = 'hack', test_sent_at = now() where id = '70000000-0000-0000-0000-000000000003'$$, true);
select public.t_eq('campaigns: …the Mailchimp columns stayed null', $$select coalesce(mailchimp_id, '<null>') || '/' || coalesce(test_sent_at::text, '<null>') from public.pgc_campaigns where id = '70000000-0000-0000-0000-000000000003'$$, '<null>/<null>');
select public.t_rows('campaigns: contributor submits for review', $$update public.pgc_campaigns set status = 'in_review' where id = '70000000-0000-0000-0000-000000000003'$$, 1);
select public.t('campaigns: contributor cannot request changes', $$update public.pgc_campaigns set status = 'changes_requested' where id = '70000000-0000-0000-0000-000000000003'$$, false);
select public.t('campaigns: contributor cannot mark a campaign sent', $$update public.pgc_campaigns set status = 'sent' where id = '70000000-0000-0000-0000-000000000003'$$, false);
select public.t_rows('campaigns: contributor cannot touch a sent campaign (0 rows)', $$update public.pgc_campaigns set subject = 'x' where id = '70000000-0000-0000-0000-000000000001'$$, 0);
select public.t_rows('campaigns: contributor cannot delete someone else''s draft (0 rows)', $$delete from public.pgc_campaigns where id = '70000000-0000-0000-0000-000000000002'$$, 0);
select public.t_rows('campaigns: contributor cannot delete a sent campaign (0 rows)', $$delete from public.pgc_campaigns where id = '70000000-0000-0000-0000-000000000001'$$, 0);
select public.t('campaigns: contributor creates a template', $$insert into public.pgc_campaign_templates (id, name) values ('80000000-0000-0000-0000-000000000001', 'Monthly')$$, true);
select public.t_eq('campaigns: template creator stamped', $$select created_by from public.pgc_campaign_templates where id = '80000000-0000-0000-0000-000000000001'$$, 'base@theari.us');
reset role;
-- publisher (news@theari.us holds pgc_newsletter/publisher)
set role authenticated;
select public.as_user('news@theari.us');
select public.t_rows('campaigns: publisher requests changes', $$update public.pgc_campaigns set status = 'changes_requested' where id = '70000000-0000-0000-0000-000000000003'$$, 1);
select public.t('campaigns: publisher cannot bypass the sending service', $$update public.pgc_campaigns set status = 'sent' where id = '70000000-0000-0000-0000-000000000003'$$, false);
select public.t('campaigns: publisher cannot edit a sent campaign either', $$update public.pgc_campaigns set subject = 'x' where id = '70000000-0000-0000-0000-000000000001'$$, false);
select public.t_rows('campaigns: publisher deletes someone else''s draft', $$delete from public.pgc_campaigns where id = '70000000-0000-0000-0000-000000000002'$$, 1);
select public.t_rows('campaigns: publisher cannot delete a sent campaign (0 rows)', $$delete from public.pgc_campaigns where id = '70000000-0000-0000-0000-000000000001'$$, 0);
select public.t_rows('campaigns: publisher edits a template, creator kept', $$update public.pgc_campaign_templates set description = 'd' where id = '80000000-0000-0000-0000-000000000001'$$, 1);
select public.t_eq('campaigns: …updated_by is the publisher', $$select updated_by || '/' || created_by from public.pgc_campaign_templates where id = '80000000-0000-0000-0000-000000000001'$$, 'news@theari.us/base@theari.us');
reset role;
-- the sending service (service role) owns the Mailchimp columns and statuses
set role service_role;
select public.as_user(null, 'service_role');
select public.t_rows('campaigns: the server marks a campaign scheduled', $$update public.pgc_campaigns set status = 'scheduled', mailchimp_id = 'mc1', scheduled_for = now() + interval '1 day' where id = '70000000-0000-0000-0000-000000000003'$$, 1);
reset role;
set role authenticated;
select public.as_user('news@theari.us');
select public.t('campaigns: a scheduled campaign is frozen for the portal', $$update public.pgc_campaigns set subject = 'x' where id = '70000000-0000-0000-0000-000000000003'$$, false);
reset role;
-- administrator: implicit publisher (unlike ARI's explicit "newsletter")
set role authenticated;
select public.as_user('admin@theari.us');
select public.t_count('campaigns: admin sees every campaign without a grant', $$select * from public.pgc_campaigns$$, 2);
select public.t('campaigns: admin creates a draft', $$insert into public.pgc_campaigns (title) values ('Admin draft')$$, true);
select public.t_eq('campaigns: admin has no ARI newsletter access (that module stays explicit)', $$select public.can_edit('newsletter')::text$$, 'false');
reset role;

-- ================= REPORT =================
select n, case when ok then 'PASS' else 'FAIL' end as result, label, note from public.t_results order by n;
select count(*) filter (where not ok) as failures, count(*) as total from public.t_results;
