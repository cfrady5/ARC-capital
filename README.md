# ARC — Applied Research Capital website

Hand-built static rebuild of the ARC marketing site (previously on Wix), incorporating the
August 2026 content updates: the About story moved to the homepage (including the
ARI → ARC bridge and "Why ARC"), advisory services added for founders and companies,
and a standalone Investment Thesis page.

## Structure

Pure static HTML/CSS/JS — no framework, no build step, no dependencies.
Deployable as-is on any static host (Vercel, Netlify, Cloudflare Pages, S3, …).

| Route | File | Page |
|---|---|---|
| `/` | `index.html` | Home — hero, About ARC, From ARI to ARC, Why ARC, platform, wayfinding |
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

1. **Company name.** The rename is still pending. When decided, update:
   - all six `index.html` files (titles, meta descriptions, copy, JSON-LD in `index.html`),
   - `assets/img/arc-logo.svg` and `assets/img/favicon.svg` (dot-matrix wordmark —
     regenerate or redraw for the new name),
   - this README.
   `grep -ri "applied research capital\|ARC" --include="*.html"` finds every occurrence.
2. **Form backend.** Both forms post to a placeholder (`https://formspree.io/f/YOUR_FORM_ID`).
   Create a Formspree form (or a serverless function + transactional email) and replace the
   placeholder in `contact/index.html` and the footer form in the other five pages. Until then,
   JS intercepts submits and shows a fallback message pointing to `innovations@theari.us`.
   The form captures `audience` and `intent` fields so LP vs. Founder messages can be routed
   to different recipients. A honeypot field (`company_website`) is included; consider adding
   a captcha as well. Confirm the real destination inbox with the team.
3. **Team headshots.** `assets/img/avatar-placeholder.svg` is used for all three bios.
   Replace with background-removed WebP/AVIF cutouts and update the `alt` text.
4. **Open Graph image.** No `og:image` yet — export a 1200×630 card from the wordmark
   and add the tag to each page's `<head>`.
5. **Sitemap.** Add `sitemap.xml` and the `Sitemap:` line in `robots.txt` once the
   domain is decided.
6. **Legal.** No privacy policy / disclosures pages exist yet; the securities disclaimer
   currently appears only on `/thesis/`. An investment firm will likely need proper
   disclosure pages before broad launch.

## Design system

Defined in `assets/css/main.css` (tokens at the top):

- **Palette:** ink `#072B31`, accent `#3CDBC0`, bright `#28FEDD`, body text `#C5D5D7`.
  Thesis domain accents: `#3CDBC0` / `#38D4E8` / `#6BA6FF`.
- **Type:** Space Grotesk (display), Inter (body), IBM Plex Mono (eyebrow labels) via
  Google Fonts.
- **Motifs:** `// EYEBROW //` labels (slashes are `aria-hidden`), white/teal split
  headlines ending in a teal period, pill buttons with ↗, cards with asymmetric
  bottom/left border glow.
- **Motion:** scroll reveal via IntersectionObserver; fully disabled under
  `prefers-reduced-motion`, and content renders visible without JavaScript.

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```
