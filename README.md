# PGC — Proving Ground Capital website

Hand-built static marketing site for Proving Ground Capital (formerly "ARC / Applied
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

### Contact routing

Every CTA passes intent through the URL, e.g. `/contact/?type=lp&intent=materials` or
`/contact/?type=founder&intent=advisory`. `assets/js/main.js` pre-selects the audience
radio, fills a hidden `intent` field, and adapts the helper copy. The audience selector
is a required radio group (the old Wix site used two independent checkboxes).

## TODO before launch

1. **Domain + email.** Site copy now uses Proving Ground Capital / PGC. The contact
   email is still `innovations@theari.us` — confirm whether PGC gets its own domain
   and inbox, then update the six HTML files.
2. **Form backend.** Both forms post to a placeholder (`https://formspree.io/f/YOUR_FORM_ID`).
   Create a Formspree form (or a serverless function + transactional email) and replace the
   placeholder in `contact/index.html` and the footer form in the other five pages. Until then,
   JS intercepts submits and shows a fallback message pointing to `innovations@theari.us`.
   The form captures `audience` and `intent` fields so LP vs. Founder messages can be routed
   to different recipients. A honeypot field (`company_website`) is included; consider adding
   a captcha as well. Confirm the real destination inbox with the team.
3. **Team headshots.** All three principals have real photos
   (`assets/img/team-*.webp`, 800×800).
4. **Open Graph image.** No `og:image` yet — export a 1200×630 card from the wordmark
   and add the tag to each page's `<head>`.
5. **Sitemap.** Add `sitemap.xml` and the `Sitemap:` line in `robots.txt` once the
   domain is decided.
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
  `pgc-mark-mint.svg` / `pgc-mark-dark.svg` are the PGC letters alone (header), extracted
  from the lockup since v2 ships no standalone mark; `pgc-wordmark-mint.svg` is the
  Proving Ground Capital wordmark. All are reframed to tight bounds. The favicon embeds
  the PGC letters on the dark tile.
- **Motion:** scroll reveal via IntersectionObserver; fully disabled under
  `prefers-reduced-motion`, and content renders visible without JavaScript.

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```
