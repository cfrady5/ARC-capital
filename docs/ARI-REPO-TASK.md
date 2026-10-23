# Task for cfrady5/ARI — grant "Proving Ground Capital pages" from Users & Access

The Proving Ground Capital website (cfrady5/ARC-capital, provinggroundcapital.vercel.app)
now has an employee portal at `/portal/` that uses ARI's Supabase project for sign-in,
permissions and content. Its permission is a new `employee_access` module, **`pgc`**,
with levels `contributor | publisher`. Administrators have it implicitly (the module is
not "explicit", like `pages` / `newsroom`, unlike `newsletter` / `babble`).

The database side is handled by migrations in the ARC-capital repo
(`supabase/migrations/20261023_pgc_site_content.sql` extends
`employee_access_module_check` with `'pgc'`). This task is only the ARI portal UI and
the invite function, so administrators can grant the permission.

## 1. `assets/portal-access.js`

```js
export const MODULES = ["pages", "newsroom", "calendar", "evsites", "pulse", "newsletter", "babble", "messages", "documents", "pgc"];
MODULE_LABEL.pgc = "Proving Ground Capital pages";
MODULE_DESC.pgc  = "The Proving Ground Capital website (provinggroundcapital.vercel.app): contributors edit drafts and submit them for review; publishers publish, unpublish and undo. Edited at provinggroundcapital.vercel.app/portal/.";
```

`EXPLICIT_MODULES` is unchanged — administrators keep the module automatically.
No `WORKSPACES` entry: the editor lives on the PGC site, not in the ARI portal.
(Optional: a nav link `{ href: "https://provinggroundcapital.vercel.app/portal/", label: "PGC website editor", icon: "site", when: (a) => a.canEdit("pgc") }` under My Workspace, the way the Program Chart is linked.)

## 2. `assets/users-access.js`

Add a **"Proving Ground Capital pages"** row to the Edit access modal with the same
three-way choice the other content modules have — **No access / Contributor /
Publisher** — in the per-module section (not the "Internal documents" checkbox pattern;
this module has two levels). Follow the existing module radios: they are generated from
`MODULES`, so check whether adding `pgc` to `MODULES` already produces the row; if the
modal lists modules by hand, add `pgc` there. Then:

- Badge in the user list (near line 31, where `documents` adds "Program Chart: update"):
  `if (m.pgc) out.push(["PGC site: " + LEVEL_LABEL[m.pgc].toLowerCase(), "pstatus--…"]);`
- `syncAdmin()` must disable the `pgc` radios and tick Publisher when Administrator is on,
  exactly as for the other non-explicit modules.
- The payload sent to `portal-invite` `set_access` must carry
  `modules.pgc = "contributor" | "publisher" | null`.

## 3. `supabase/functions/portal-invite/index.ts`

```ts
const MODULES = ["pages", "newsroom", "calendar", "evsites", "pulse", "newsletter", "babble", "documents", "pgc"];
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

1. Apply `20261023_pgc_site_content.sql` in Supabase (this is what adds `'pgc'` to the
   constraint; `grant_access(email, 'pgc', level)` works from that moment).
2. Apply `20261023_pgc_media_bucket.sql`, then optionally `20261023_pgc_seed_content.sql`.
3. Deploy this ARI change (UI + `portal-invite`).
4. Grant people the permission in Administration → Users & Access.
