-- ============================================================================
-- Proving Ground Capital (PGC) — images for the website.            2026-10-23
--
-- APPLIED to production 2026-10-23 (verified: bucket pgc-media + 4 policies).
--
-- A public bucket, because every file in it is shown on a public page
-- (headshots, section images). Images only, 8 MB a file. Anyone with
-- can_edit('pgc') may upload and replace; deleting needs can_publish('pgc'),
-- so a contributor cannot remove a file a live page is pointing at.
--
-- Additive: only the pgc-media bucket and its four policies are touched. The
-- existing post-covers / site-images / brand-kits policies are left alone.
-- ============================================================================
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pgc-media', 'pgc-media', true, 8388608,
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/svg+xml'])
on conflict (id) do nothing;

drop policy if exists "pgc-media public read" on storage.objects;
drop policy if exists "pgc-media editor insert" on storage.objects;
drop policy if exists "pgc-media editor update" on storage.objects;
drop policy if exists "pgc-media publisher delete" on storage.objects;

create policy "pgc-media public read" on storage.objects for select
  using (bucket_id = 'pgc-media');
create policy "pgc-media editor insert" on storage.objects for insert
  with check (bucket_id = 'pgc-media' and public.can_edit('pgc'));
create policy "pgc-media editor update" on storage.objects for update
  using (bucket_id = 'pgc-media' and public.can_edit('pgc'))
  with check (bucket_id = 'pgc-media' and public.can_edit('pgc'));
create policy "pgc-media publisher delete" on storage.objects for delete
  using (bucket_id = 'pgc-media' and public.can_publish('pgc'));

commit;
