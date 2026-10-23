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
  publish, phone width without sideways scroll and a working menu toggle.
- **Administrator:** implicit publisher; "Start from the live page" creates
  draft rows from the served markup.

```sh
node tests/portal.headless.mjs
```

## Database (`db/`)

`local_schema.sql` recreates the parts of ARI's production schema the PGC
migrations depend on (auth stubs, `employees`, `employee_access` with the
pre-PGC module check, the helpers, `content_revisions`, a plain `storage`
schema). Then the two PGC migrations and `rls_tests.sql` (93 checks) run:

```sh
createdb pgc_test
psql -v ON_ERROR_STOP=1 -d pgc_test -f tests/db/local_schema.sql
psql -v ON_ERROR_STOP=1 -d pgc_test -f supabase/migrations/20261023_pgc_site_content.sql
psql -v ON_ERROR_STOP=1 -d pgc_test -f supabase/migrations/20261023_pgc_media_bucket.sql
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

## Regenerating the seed

`supabase/migrations/20261023_pgc_seed_content.sql` is generated from the
served pages — never edit it by hand:

```sh
node tools/dump_content.mjs
```
