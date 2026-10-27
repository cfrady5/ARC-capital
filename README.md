# Proving Ground Capital (PGC) website

Hand-built static marketing site for Proving Ground Capital (PGC) (formerly "ARC / Applied
Research Capital", originally on Wix). Content follows the PGC Capital Markets Brief
(July 2026): ARI → PGC bridge, two-phase operating model (advisory now, SPVs gated on
Board ratification), market-scale stats, advisory services, standalone Investment Thesis,
and updated team. Indicative SPV economics, service pricing, and internal governance
details are deliberately omitted from the public site; disclaimers are included instead.
Design follows the PGC brand system from `PGC Brand Guidelines v1.0`: Funnel Sans
typography, mint (#3CDBC0) + dark (#072B31) palette with neutral greys,
holding-device cards with corner cutouts, halftone diagram textures, and the approved
microcopy set (`// PROVING GROUND CAPITAL //`, `>> DATA LOADED`, `< HQ / … >`, `(↗)`).

## Structure

Pure static HTML/CSS/JS — no framework, no build step, no dependencies.
Deployable as-is on any static host (Vercel, Netlify, Cloudflare Pages, S3, …).

| Route | File | Page |
|---|---|---|
| `/` | `index.html` | Home — mint hero device, About PGC, From ARI to PGC, Why PGC, values, platform, wayfinding |
| `/thesis/` | `thesis/index.html` | Investment Thesis — BIO × MICRO × ROBOTICS converging domains |
| `/investors/` | `investors/index.html` | For Investors |
| `/founders/` | `founders/index.html` | For Founders & Companies — capital, go-to-market, scale, advisory |
| `/team/` | `team/index.html` | Team |
| `/contact/` | `contact/index.html` | Contact — LP / Founder-Company routing form |

Shared assets live in `assets/` (`css/main.css`, `js/main.js`, `img/`). The header and
footer are duplicated in each page — if you edit one, mirror the change across all six files.

Links are root-relative (`/thesis/`), so the site must be served from a domain root
(not a sub-path like `user.github.io/repo/`).

| Also in the repo | What |
|---|---|
| `portal/` + `assets/js/portal.js` + `assets/css/portal.css` | Employee website editor (see below) |
| `assets/js/supabase.js`, `assets/js/content.js` | Supabase client (publishable key) and the public-site content layer |
| `supabase/migrations/` | The `pgc_*` migrations (all applied to production) |
| `tests/` | Playwright suites with a Supabase stub, SQL RLS tests (`tests/README.md`) |
| `tools/dump_content.mjs` | Regenerates the seed migration from the served pages |
| `docs/ARI-REPO-TASK.md` | The change to make in cfrady5/ARI so the permission can be granted |
| `vercel.json` | `no-store` + `noindex` headers for `/portal/` |

`tools/`, `tests/`, `supabase/` and `docs/` are excluded from the Vercel deployment
(`.vercelignore`).

## Editable content and the employee portal

The HTML in this repository **is** the site and stays the fallback. Supabase (ARI's
project `xpelcuegqtpvojnjetkt`) holds an editable copy of it; authorised ARI staff edit
that copy at **`/portal/`**, and the public pages replace what they shipped with the
published rows.

### How the public pages read content (`assets/js/content.js`)

- `<main data-pgc-page="home">` names the page; every managed block is a
  `<section data-pgc-section="why">`; its repeating items sit in a container marked
  `data-pgc-items` (cards, bridge nodes, buttons); the team grids are
  `data-pgc-team="principals|bench"`; three footer values carry `data-pgc-setting`.
- On load, the module asks for the page row (`published = true`), its published
  sections, the published team and settings — with the anon key, so RLS alone makes
  drafts unreachable — and **patches the existing markup in place**: eyebrow, white/mint
  headline split, lead paragraphs, items (extra items are cloned from the designed one),
  bullets, buttons, band colour and section order. A section that exists only in the
  database is rendered from its `kind` (`rich`, `cards`, `ticks`, `statement`, `cta`).
  A section with no published row is removed from a managed page.
- If the page has no published rows, the request fails or times out (6 s), the page is
  shown exactly as it is in this repository. Nothing unpublished can ever reach it.
- `?pgc_preview=1` turns off the fetch and listens for draft rows from the portal
  (same-origin `postMessage`) — that is the live preview.
- Not editable from the portal (static by design): header/nav, the form markup, the
  hero's values strip and halftone device, the thesis "lens" banner and arc, the
  footer's legal lines other than the three settings.

### Data model (`supabase/migrations/20261023_pgc_site_content.sql`)

`pgc_pages` (one per page) → `pgc_sections` (ordered blocks: eyebrow, heading,
heading_accent, kicker, lead, note, bullets, items JSON, band, kind, sort_order),
`pgc_team` (people, grouped principals/bench), `pgc_settings` (key/value). Every table
has `published` and `review_state` (`draft | in_review | changes_requested`).

Permission is ARI's new `employee_access` module **`pgc`** — `contributor` edits drafts
and submits for review, `publisher` publishes, unpublishes, deletes and undoes;
administrators have it automatically. RLS: everyone reads published rows; `can_edit('pgc')`
reads and edits drafts; `can_publish('pgc')` manages live rows. A trigger stops
non-publishers setting `changes_requested` and resets `review_state` on publish. Every
change is logged to ARI's shared `content_revisions`; `pgc_restore_revision(id)` puts a
version back (publishers). Images go to the public `pgc-media` bucket (images only, 8 MB).

As in ARI (§49.6), a contributor cannot edit a page that is live; a publisher edits live
rows directly (the history keeps every version) or unpublishes first.

### The migrations (in this order)

1. `supabase/migrations/20261023_pgc_site_content.sql` — tables, module, RLS, triggers, undo. *Applied 2026-10-23.*
2. `supabase/migrations/20261023_pgc_media_bucket.sql` — the `pgc-media` bucket + policies. *Applied 2026-10-23.*
3. `supabase/migrations/20261023_pgc_seed_content.sql` — today's pages as *published* rows
   (applying it changed nothing for visitors). *Applied 2026-10-23.* Regenerate with
   `node tools/dump_content.mjs` after editing the HTML.
4. `supabase/migrations/20261024_pgc_newsletter.sql` — email campaigns tables + the
   `pgc_newsletter` module. *Applied 2026-10-26.*
5. `supabase/migrations/20261024_pgc_sections_extra.sql` — `pgc_sections.extra` (one-off
   pieces such as the Thesis lens banner) plus the current values of the newly editable
   bits and the `hq_location` setting. Safe to re-run. *Applied 2026-10-26* (see
   `EDITOR-UPDATE.md`).
6. cfrady5/ARI `supabase/migrations/20261027_registration_domains.sql` (owned by the ARI
   repo; a copy for the local tests is in `tests/db/ari/`) — ARI's sign-up guard reads a
   list of allowed domains instead of hardcoding @theari.us. ARI sign-ups are unchanged.
   **Not applied yet.**
7. `supabase/migrations/20261027_pgc_self_registration.sql` — adds @pgc.capital to that
   list, starting as contributor on `pgc` and `pgc_newsletter`. **Not applied yet.**

Then: Supabase → Authentication → URL configuration: add `https://pgc.capital`
and `https://pgc.capital/portal/**` as redirect URLs (sign-in and confirmation links
land on `/portal/`). Email confirmation stays on. Magic links never create accounts
(`shouldCreateUser: false`); new accounts come from **Create an account** (below) or an
administrator. Change people's access in ARI's Users & Access once
`docs/ARI-REPO-TASK.md` is done.

### Creating an account (@pgc.capital)

Anyone with a **@pgc.capital** address can use **Create an account** on the
`/portal/` sign-in screen: name, email, password (10+ characters). Supabase emails a
6-digit code (and a link). Once the email is confirmed, the database creates a baseline
Employee profile and grants **contributor** on the website (`pgc`) and email campaigns
(`pgc_newsletter`). They can edit pages, save drafts, draft and test campaigns, and
submit either for review. Publishing and sending stay with publishers and
administrators. Only the exact domain counts: subdomains, lookalikes and blocklisted
addresses are refused by the database, whatever the browser sends. @theari.us people
register in the ARI portal and get no PGC access by default.

- To raise someone (e.g. to publisher), use ARI's Users & Access once the ARI-repo task
  adds the PGC rows, or SQL until then:
  `select public.grant_access('name@pgc.capital', 'pgc', 'publisher');`
- The confirmation email uses the project's shared **Confirm signup** template (ARI
  wording). The portal sends `site: "pgc"` in the sign-up metadata, so the template can
  show PGC wording to PGC people: in Supabase → Authentication → Email Templates →
  Confirm signup, wrap the existing text as
  `{{ if eq .Data.site "pgc" }}…PGC version…{{ else }}…current ARI text…{{ end }}`
  and keep `{{ .Token }}` (the 6-digit code) in both versions.

### Email campaigns (Mailchimp) in the portal

ARI's campaign system (Campaigns, Reports, Templates, Email Lists — HANDOFF §51–§52,
§77–§97 in cfrady5/ARI) is ported into this portal under an **Email** section, with its
own tables, module and sending function so nothing of ARI's is shared or changed:

| Piece | Here | ARI original |
|---|---|---|
| Pages | `assets/js/newsletter.js` (+ `newsletter.css`) | `assets/newsletter.js` + `styles.css` |
| Composer (canvas workspace) | `assets/js/newsletter-editor.js` (+ `newsletter-editor.css`) | same names under `assets/` |
| Renderer | `supabase/functions/pgc-mailchimp/render.ts` → `assets/js/newsletter-render.js` (generated by `node tools/build-newsletter-render.mjs`) | `functions/mailchimp/render.ts` |
| Sending function | `supabase/functions/pgc-mailchimp/index.ts` | `functions/mailchimp/index.ts` |
| Tables | `pgc_campaigns`, `pgc_campaign_templates` (`20261024_pgc_newsletter.sql`) | `newsletter_campaigns`, `newsletter_templates` |
| Permission | module **`pgc_newsletter`** (contributor \| publisher); administrators have it implicitly | `newsletter` (explicit, admins excluded) |

What changed in the port: PGC branding (dark teal buttons/footer, mint header rule,
Funnel Sans, PNG logos in `assets/img/email/` because email clients don't render SVG),
no newsroom-post / event blocks (this site has neither), no brand-kit themes (one PGC
palette; the Design tab's colors, buttons, header and footer still apply), quick links
to the pgc.capital pages, uploads to `pgc-media/campaigns/`, default sender
"Proving Ground Capital (PGC)" <innovations@theari.us>. Contributors draft, test and
submit for review; publishers request changes, send now or schedule, unschedule, manage
groups and contacts. Statuses `scheduled` / `sent` and every Mailchimp column are written
only by the function (service role); sent campaigns are frozen.

**To turn it on:**
1. Apply `supabase/migrations/20261024_pgc_newsletter.sql`. *Done 2026-10-26.*
2. In Mailchimp, create (or pick) the PGC audience and verify the From domain.
3. Supabase → Edge Functions → Secrets: add `PGC_MAILCHIMP_AUDIENCE_ID` (the audience id)
   and optionally `PGC_MAILCHIMP_TAGS`. `MAILCHIMP_API_KEY` / `MAILCHIMP_SERVER_PREFIX`
   are shared with ARI's function and already exist.
4. Deploy the function: `supabase functions deploy pgc-mailchimp --no-verify-jwt`
   (like ARI's `mailchimp`: `subscribe` is public, every other action checks the caller
   through `my_access` with their own token). *Deployed 2026-10-26 (version 1).* Redeploy
   after any change to `index.ts` or `render.ts`.
   Until step 3 is done, Send test says which secret is missing, and **Check sending
   setup** in the Send test dialog lists the account's audiences with their IDs.
5. Grant `pgc_newsletter` in ARI's Users & Access (after the ARI-repo task adds the row).
   Administrators can use the Email section right away.

### Portal (`/portal/`)

Sign in with email + password or a magic link, or create an account with a @pgc.capital
email → `rpc("my_access")` → only the people with `pgc` or `pgc_newsletter` (or
administrators) see anything; signed-out, suspended and unknown accounts
get a sign-in or "no access" card and no internal markup. Page list with state pills,
an editor per page (page title/description, sections with text, items, images, up/down
ordering, add/remove), Team and Site settings editors, **Save draft / Submit for review /
Withdraw / Publish / Request changes / Unpublish**, a live preview iframe (desktop or
phone width), and **Change history** with Undo. `vercel.json` sends `no-store` and
`X-Robots-Tag: noindex` for `/portal/`.

### Contact routing

Every CTA passes intent through the URL, e.g. `/contact/?type=lp&intent=materials` or
`/contact/?type=founder&intent=advisory`. `assets/js/main.js` pre-selects the audience
radio, fills a hidden `intent` field, and adapts the helper copy. The audience selector
is a required radio group (the old Wix site used two independent checkboxes).

## TODO before launch

1. **Domain + email.** Site copy spells out "Proving Ground Capital (PGC)" throughout.
   The contact
   email is still `innovations@theari.us` — confirm whether PGC gets its own domain
   and inbox, then update the six HTML files.
2. **Form backend.** Both forms post to a placeholder (`https://formspree.io/f/YOUR_FORM_ID`).
   Create a Formspree form (or a serverless function + transactional email) and replace the
   placeholder in `contact/index.html` and the footer form in the other five pages. Until then,
   JS intercepts submits and shows a fallback message pointing to `innovations@theari.us`.
   The form captures `audience` and `intent` fields so LP vs. Founder messages can be routed
   to different recipients. A honeypot field (`company_website`) is included; consider adding
   a captcha as well. Confirm the real destination inbox with the team.
3. **Team headshots.** All seven have photos, normalized to one system by
   `tools/normalize_headshots.py`: 4:5 portrait (720×900 WebP), eye line at 36% of
   frame height, and matched head size and exposure. Photos stay in natural color.
   Two sources are only 400×400 (Griffin, Hunt) and are upscaled — request
   higher-resolution originals when available.
   Re-run the script after replacing any source photo.
4. **Open Graph image.** No `og:image` yet — export a 1200×630 card from the wordmark
   and add the tag to each page's `<head>`.
5. **Sitemap.** Done — `sitemap.xml` lists the six pages at `https://pgc.capital/` and
   `robots.txt` points to it (and disallows `/portal/`).
6. **Legal.** No privacy policy / disclosures pages exist yet; the securities disclaimer
   currently appears only on `/thesis/`. An investment firm will likely need proper
   disclosure pages before broad launch.

## Design system

Defined in `assets/css/main.css` (tokens at the top):

- **Palette (brand /2.1):** mint `#3CDBC0`, dark `#072B31`, white, light `#DDDDDD`,
  grey `#54585A`, black `#101820`.
- **Type:** Funnel Sans only, via Google Fonts (weights 300–700). Headlines use the
  regular weight with tight tracking; microcopy uses medium at +300 tracking; paragraph
  headings use bold. `--font-display` is an alias of `--font-sans` so display-role rules
  stay identifiable in the stylesheet.
- **Motifs (brand /5):** `// MICROCOPY //` labels (decorations `aria-hidden`),
  white/mint split headlines, rectangular uppercase buttons with `(↗)`, holding-device
  cards with large radii and corner cutouts (`.device--cutout`), halftone diagram SVGs
  (`assets/img/halftone-*.svg`).
- **Logos:** from `PGC_Logos_v2_20260825.zip` (2026-08-25 revision, not committed).
  `pgc-logo-mint.svg` / `pgc-logo-dark.svg` are the full stacked lockup (footer, hero);
  `pgc-mark-mint.svg` / `pgc-mark-dark.svg` are the PGC letters alone, extracted
  from the lockup since v2 ships no standalone mark; `pgc-wordmark-mint.svg` is the
  Proving Ground Capital wordmark. The header pairs the mark and wordmark
  (`.brand-mark` + `.brand-wordmark`) so the logo itself spells out the full name. All are reframed to tight bounds. The favicon embeds
  the PGC letters on the dark tile.
- **Motion:** scroll reveal via IntersectionObserver; fully disabled under
  `prefers-reduced-motion`, and content renders visible without JavaScript.

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```
