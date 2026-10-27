# Tests

No build tooling: plain Node scripts plus `psql`. Nothing here touches the
production Supabase project — the browser tests swap `assets/js/supabase.js`
for the in-memory stub in `fixtures/`, and the database tests run against a
local Postgres.

## Setup

```sh
python3 -m http.server 8765 &            # serve the repo root
# Playwright + Chromium: defaults below work in the Claude cloud container;
# elsewhere point PLAYWRIGHT_MODULE at playwright's index.mjs and CHROME_PATH at a Chromium.
export PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs
export CHROME_PATH=/opt/pw-browsers/chromium
export BASE=http://127.0.0.1:8765
```

Each browser suite prints one JSON object and exits 0 when it passes: no
`"ok": false`, `errors` is `[]`, `FATAL` absent. Screenshots land in `tests/out/`.

## Public site (`public-content.headless.mjs`)

Anonymous visitor against seeded published and draft rows:

- Published rows replace the repository markup: section order follows
  `sort_order`, sections without a row disappear, the `// motif //` and the
  white/mint headline split survive patching, lead paragraphs and cards grow
  or shrink to match the rows (extra cards are cloned from the designed one),
  buttons keep their `(↗)`, a section that exists only in the database is
  rendered from its `kind`, the closing quote keeps its mint clause, settings
  change the footer, `meta description` follows the page row.
- Drafts never render — not sections, not team members, not settings — and an
  unpublished page (`/thesis/` in review) shows the repository markup untouched.
- Team: published people only, grouped and ordered; multi-paragraph bios;
  photo, LinkedIn and email per person; missing links are hidden.
- Fetch failure (every table, or sections alone): the page is exactly as shipped.
- Round trip on all six pages: `readPage` → `patchSection` → `readPage` is
  lossless, which is what `tools/dump_content.mjs` and the seed migration rely on.

```sh
node tests/public-content.headless.mjs
```

## Portal (`portal.headless.mjs`)

- **Signed out:** sign-in form only, no internal markup in the DOM, `noindex`,
  validation messages, wrong password, magic link sent with
  `shouldCreateUser: false` and the `/portal/` redirect, visible focus ring.
- **Create an account:** link on the sign-in card carries a typed @pgc.capital
  address over; name, domain (other domains refused, @theari.us pointed to the
  ARI portal), password length and match checked before anything is sent; an
  existing address gets "already has an account"; `signUp` carries the name and
  `site: "pgc"` (never a role) with the `/portal/` redirect; the code screen
  names the address, throttles resend, rejects a wrong code, and the right code
  (spaces allowed) signs the person straight in as Contributor with the website
  and email sections, without Publish; back-to-sign-in works.
- **Employee without the module** (after a successful password sign-in),
  **suspended** publisher and a **sign-in not linked to an employee**: the
  "no access" card, nothing internal rendered, sign out returns to sign-in.
- **Contributor:** six pages listed with state pills, edits a draft page and an
  item, adds and reorders a section, the live preview iframe shows the draft
  (patched section, patched stat, rendered new section), Save draft writes
  unpublished rows stamped `updated_by`, Submit for review sets `in_review`
  on the page and its sections, no Publish / Request changes buttons, direct
  API publish / live edit / delete / restore are refused by the stub RLS, a
  live page is read-only with a notice and no Remove buttons, history is
  visible without Undo, live team member locked while a draft person is editable.
- **Publisher:** Publish (page + sections → `published`, `review_state` reset),
  live notice, Request changes on a submitted draft, Unpublish, Remove section,
  Undo from the history (restores the old snapshot and logs a `restore`),
  headshot upload goes to `pgc-media` and fills the URL, team and settings
  publish, team cards spaced apart with no title running into its status pill, phone
  width without sideways scroll (page and change history) and a working menu toggle.
- **Administrator:** implicit publisher; "Start from the live page" creates
  draft rows from the served markup.

```sh
node tests/portal.headless.mjs
```

## Email campaigns (`newsletter.headless.mjs`)

The Email section of the portal (Campaigns, Reports, Templates, Email lists —
ARI's Mailchimp composer ported for PGC) against the stub, with the
`pgc-mailchimp` function answered in-page:

- **Website contributor without the module:** no Email section, `#/campaigns`
  refused with a notice, direct reads/inserts of `pgc_campaigns` refused.
- **Tables missing:** every Email page explains which migration to run; no
  Mailchimp calls.
- **Function not deployed / audience secret missing:** Send test and Check
  sending setup say the service can't be reached (not "Failed to fetch"), or
  name `PGC_MAILCHIMP_AUDIENCE_ID` and list the account's audiences with IDs.
- **Campaigns contributor:** lands on Campaigns (no page editor), list with
  status pills, can select only their own drafts; New campaign → the canvas
  composer with the PGC block tiles (no post/event), adds a heading and a text
  block, the canvas shows them with PGC branding (dark lockup, mint rule, PGC
  footer, `**bold**` applied), Create campaign writes a draft stamped
  `created_by`, Send test calls `test_send` with the typed addresses,
  "Review & submit" offers Submit for review but no Send now / Schedule,
  submit sets `in_review`, direct shortcuts (status sent, changes requested,
  deleting someone else's draft) are refused, a sent campaign opens locked.
- **Publisher:** "Review & send" → Send now → the confirm names the audience
  size → `send` is called → the row is `sent` and the editor locks; Save as
  template writes `pgc_campaign_templates` and the Templates page lists it with
  the four layouts; Reports shows the audience and the sent campaign; Email
  lists shows the groups band, browsing a group, Add contact → `add_member`;
  leaving an unsaved campaign asks Save / Leave / Stay.

```sh
node tests/newsletter.headless.mjs
```

## Email renderer (`newsletter-render.test.mjs`)

Node only: the committed `assets/js/newsletter-render.js` matches a fresh
transpile of `supabase/functions/pgc-mailchimp/render.ts`, and a rendered
campaign carries the PGC lockup, mint rule, dark-teal buttons/footer, Funnel
Sans, Mailchimp merge tags, editor markers only in editor mode, escaped author
markup and no ARI wording. 19 checks.

```sh
node tests/newsletter-render.test.mjs
node tools/build-newsletter-render.mjs   # regenerate after editing render.ts
```

## Database (`db/`)

`local_schema.sql` recreates the parts of ARI's production schema the PGC
migrations depend on (auth stubs, `employees`, `employee_access` with the
pre-PGC module check, the helpers, `content_revisions`, a plain `storage`
schema, and ARI's @theari.us-only sign-up guard and provisioning as production had them
before 2026-10-27). Then the PGC migrations, the ARI registration-domains migration
(`tests/db/ari/`, a verbatim copy of cfrady5/ARI's) and `rls_tests.sql` (153 checks) run:

```sh
createdb pgc_test
psql -v ON_ERROR_STOP=1 -d pgc_test -f tests/db/local_schema.sql
psql -v ON_ERROR_STOP=1 -d pgc_test -f supabase/migrations/20261023_pgc_site_content.sql
psql -v ON_ERROR_STOP=1 -d pgc_test -f supabase/migrations/20261023_pgc_media_bucket.sql
psql -v ON_ERROR_STOP=1 -d pgc_test -f supabase/migrations/20261024_pgc_newsletter.sql
psql -v ON_ERROR_STOP=1 -d pgc_test -f supabase/migrations/20261024_pgc_sections_extra.sql
psql -v ON_ERROR_STOP=1 -d pgc_test -f tests/db/ari/20261027_registration_domains.sql
psql -v ON_ERROR_STOP=1 -d pgc_test -f supabase/migrations/20261027_pgc_self_registration.sql
psql -v ON_ERROR_STOP=1 -d pgc_test -f tests/db/rls_tests.sql    # last line: failures | total
# optional: the seed applies cleanly and is idempotent
psql -v ON_ERROR_STOP=1 -d pgc_test -f supabase/migrations/20261023_pgc_seed_content.sql
```

Covered: the module check accepts `pgc` and still refuses unknown modules;
anonymous, outsider, employee-without-module, suspended and other-module
employees read published rows only and can write nothing; contributors read
drafts, insert/edit drafts, submit and withdraw, cannot publish, request
changes, delete, edit live rows, restore or delete uploads; publishers edit
live rows, publish (review state resets), request changes, unpublish, delete,
restore (restores are logged; ARI tables are refused); administrators have it
all implicitly; the database stamps `updated_by`; no-op updates log nothing.
Email campaigns (`pgc_newsletter`): a website contributor without the module
and anon see nothing; contributors create drafts (creator stamped, Mailchimp
columns frozen), submit, cannot request changes / mark sent / touch sent rows /
delete others' drafts; publishers request changes and delete drafts but cannot
bypass the sending service or edit sent rows; the service role sets
`scheduled`, after which the row is frozen; administrators have the module
implicitly while ARI's explicit `newsletter` stays out of their reach.
Self-registration (@pgc.capital): the domain row and its grants; other,
lookalike, subdomain, similar and blocklisted addresses refused; no profile
until the email is verified; then a baseline employee (a requested admin role
ignored) with exactly `pgc` + `pgc_newsletter` contributor, logged; the new
person can edit but not publish, draft but not send, cannot raise their own
access, read the domain list or call `provision_employee`; @theari.us sign-ups
still work and get no PGC access.

## Regenerating the seed

`supabase/migrations/20261023_pgc_seed_content.sql` is generated from the
served pages — never edit it by hand:

```sh
node tools/dump_content.mjs
```
