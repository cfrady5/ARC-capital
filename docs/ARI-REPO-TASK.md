# Task for cfrady5/ARI — grant the Proving Ground Capital permissions from Users & Access

The Proving Ground Capital website (cfrady5/ARC-capital, pgc.capital)
now has an employee portal at `/portal/` that uses ARI's Supabase project for sign-in,
permissions and content. It introduces **two** `employee_access` modules, both with
levels `contributor | publisher`, both implicit for administrators (like `pages` /
`newsroom`; unlike `newsletter` / `babble`):

| Module | Label | What it grants |
|---|---|---|
| **`pgc`** | Proving Ground Capital pages | Edit the website's pages, team and settings at pgc.capital/portal/ |
| **`pgc_newsletter`** | Proving Ground Capital email campaigns | Compose and send PGC email campaigns through Mailchimp (the PGC copy of ARI's Campaigns pages) |

The database side is handled by migrations in the ARC-capital repo
(`20261023_pgc_site_content.sql` adds `'pgc'` to `employee_access_module_check`,
`20261024_pgc_newsletter.sql` adds `'pgc_newsletter'`). This task is only the ARI portal
UI and the invite function, so administrators can grant the permissions.

## 1. `assets/portal-access.js`

```js
export const MODULES = ["pages", "newsroom", "calendar", "evsites", "pulse", "newsletter", "babble", "messages", "documents", "pgc", "pgc_newsletter"];
MODULE_LABEL.pgc = "Proving Ground Capital pages";
MODULE_DESC.pgc  = "The Proving Ground Capital website (pgc.capital): contributors edit drafts and submit them for review; publishers publish, unpublish and undo. Edited at pgc.capital/portal/.";
MODULE_LABEL.pgc_newsletter = "Proving Ground Capital email campaigns";
MODULE_DESC.pgc_newsletter  = "Email campaigns to the PGC Mailchimp audience, composed at pgc.capital/portal/: contributors draft, test and submit for review; publishers send, schedule and manage the lists. Administrators have it automatically.";
```

`EXPLICIT_MODULES` is unchanged — administrators keep the module automatically.
No `WORKSPACES` entry: the editor lives on the PGC site, not in the ARI portal.
(Optional: a nav link `{ href: "https://pgc.capital/portal/", label: "PGC website editor", icon: "site", when: (a) => a.canEdit("pgc") }` under My Workspace, the way the Program Chart is linked.)

## 2. `assets/users-access.js`

Add two rows to the Edit access modal — **"Proving Ground Capital pages"** and
**"Proving Ground Capital email campaigns"** — each with the same three-way choice the
other content modules have: **No access / Contributor / Publisher**, in the per-module
section (not the "Internal documents" checkbox pattern; both modules have two levels).
Follow the existing module radios: they are generated from `MODULES`, so check whether
adding the two keys to `MODULES` already produces the rows; if the modal lists modules by
hand, add both there. Then:

- Badges in the user list (near line 31, where `documents` adds "Program Chart: update"):
  `if (m.pgc) out.push(["PGC site: " + LEVEL_LABEL[m.pgc].toLowerCase(), "pstatus--…"]);`
  and `if (m.pgc_newsletter) out.push(["PGC email: " + LEVEL_LABEL[m.pgc_newsletter].toLowerCase(), "pstatus--…"]);`
- `syncAdmin()` must disable both modules' radios and tick Publisher when Administrator
  is on, exactly as for the other non-explicit modules.
- The payload sent to `portal-invite` `set_access` must carry
  `modules.pgc` and `modules.pgc_newsletter` as `"contributor" | "publisher" | null`.

## 3. `supabase/functions/portal-invite/index.ts`

```ts
const MODULES = ["pages", "newsroom", "calendar", "evsites", "pulse", "newsletter", "babble", "documents", "pgc", "pgc_newsletter"];
```

(line 45). Then redeploy: `supabase functions deploy portal-invite` (keep `verify_jwt: true`).
Until it is redeployed, `set_access` ignores `pgc` and the modal's choice is silently
dropped — so deploy before telling people the row exists.

## 4. Tests + handoff

- `tests/fixtures/supabase-stub.js`: add `pgc` to `MODULE_OF`-style maps only if a test
  needs it; nothing in ARI reads the `pgc_*` tables.
- `tests/portal-workspaces.headless.mjs` admin modal check: assert the new row round-trips
  to the `set_access` payload (like the `documentsGrant` check).
- `tests/db/local_schema.sql` / `rls_tests.sql`: the module check gains `'pgc'` once the
  ARC-capital migration is applied; add `'pgc'` to the constraint in `local_schema.sql` so
  the local replica matches production.
- HANDOFF.md: new section "§99 Proving Ground Capital website permission" pointing at the
  ARC-capital repo for the tables, portal and migrations. Note the side effect: anyone
  holding `pgc` is `is_comms()` in ARI (reads `content_revisions`, may upload to the comms
  buckets) — that is ARI's existing rule for any non-messages module.

## Order of operations (with the ARC-capital side)

1. `20261023_pgc_site_content.sql`, `20261023_pgc_media_bucket.sql` and
   `20261023_pgc_seed_content.sql` are applied (2026-10-23).
2. Apply `20261024_pgc_newsletter.sql` (adds `'pgc_newsletter'` to the constraint;
   `grant_access(email, 'pgc_newsletter', level)` works from that moment).
3. Deploy this ARI change (UI + `portal-invite`).
4. Grant people the permissions in Administration → Users & Access.
