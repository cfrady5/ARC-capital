-- Proving Ground Capital (PGC) website editor — one-time database update.
-- Adds pgc_sections.extra for one-off pieces of a section (the Thesis
-- "National Security" lens banner) and records the values the live site
-- already shows, so the database matches the pages exactly.
-- Safe to run more than once. Nullable on purpose: pgc_restore_revision()
-- re-inserts older snapshots that have no "extra" key.

alter table public.pgc_sections add column if not exists extra jsonb default '{}'::jsonb;

update public.pgc_sections s
   set extra = coalesce(s.extra, '{}'::jsonb) || jsonb_build_object(
         'lens_label', 'The Lens',
         'lens_title', 'National Security',
         'lens_note',  'Every thesis area is underwritten against a defense and dual-use mission need.')
  from public.pgc_pages p
 where s.page_id = p.id and p.slug = 'thesis' and s.section_key = 'focus'
   and not (coalesce(s.extra, '{}'::jsonb) ? 'lens_title');

update public.pgc_sections s set kicker = 'Conviction / Craft / Endurance'
  from public.pgc_pages p
 where s.page_id = p.id and p.slug = 'home' and s.section_key = 'hero' and s.kicker is null;

update public.pgc_sections s set note = 'Please fill out the required information below.'
  from public.pgc_pages p
 where s.page_id = p.id and p.slug = 'contact' and s.section_key = 'form' and s.note is null;

insert into public.pgc_settings (key, label, value, published, review_state)
select 'hq_location', 'HQ line', 'HQ / Indianapolis, IN', true, 'draft'
 where not exists (select 1 from public.pgc_settings where key = 'hq_location');
