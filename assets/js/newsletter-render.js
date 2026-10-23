// GENERATED from supabase/functions/pgc-mailchimp/render.ts by tools/build-newsletter-render.mjs — do not edit; edit the .ts and rerun the build.
// Proving Ground Capital (PGC) email renderer — adapted from ARI's
// supabase/functions/mailchimp/render.ts (cfrady5/ARI). Campaign draft → HTML
// email (table layout, inline styles) and a plain-text twin. Used for the
// portal preview and for the content pushed to Mailchimp, so both are always
// identical. Mailchimp merge tags (*|UNSUB|* etc.) are baked into the footer;
// they cannot be removed from the portal. The portal composer runs the same
// code in the browser (assets/js/newsletter-render.js, generated from this file
// by tools/build-newsletter-render.mjs) with opts.editor set, which only adds
// the canvas markers described at RenderOpts.
const SITE = "https://pgc.capital";
const LOGO = SITE + "/assets/img/email/pgc-logo-dark.png";
// Funnel Sans is the brand typeface; clients that ignore the link fall back to Arial.
const FUNNEL = "font-family:'Funnel Sans',Arial,Helvetica,sans-serif;";
const FUNNEL_LINK = '<link href="https://fonts.googleapis.com/css2?family=Funnel+Sans:wght@400;700&display=swap" rel="stylesheet" />';
/* PGC brand: dark teal #072B31 for buttons, links and the footer; mint #3CDBC0 as the
   header rule; a darker mint for small labels so they stay readable on white. */
const DEFAULTS = {
    navy: "#072b31", green: "#0b7a6a", ink: "#101820", body: "#101820", muted: "#54585a", rule: "#dddddd", bg: "#eef3f2", card: "#ffffff", footer: "#072b31", radius: "16px",
    font: FUNNEL, fontH: FUNNEL, fontLink: FUNNEL_LINK,
    logo: LOGO, logoAlt: "Proving Ground Capital (PGC)", logoWidth: 170, logoHeight: 112, logoPlate: "", poweredBy: false, buttonText: "#ffffff", btnBg: "", btnRadius: "8px", btnWidth: 0, link: "#072b31", dark: false, accentRule: "#3cdbc0",
};
/* Header logo choices. "ink" says what color the artwork is, so a plate can
   be added automatically when it would otherwise vanish into the background;
   w/h are the files' pixel sizes and "width" the largest display width. */
const PGC_LOGOS = {
    "pgc-dark": { url: LOGO, ink: "dark", width: 170, w: 600, h: 394, alt: "Proving Ground Capital (PGC)" },
    "pgc-mint": { url: SITE + "/assets/img/email/pgc-logo-mint.png", ink: "light", width: 170, w: 600, h: 394, alt: "Proving Ground Capital (PGC)" },
    "pgc-mark-dark": { url: SITE + "/assets/img/email/pgc-mark-dark.png", ink: "dark", width: 120, w: 480, h: 174, alt: "PGC" },
    "pgc-mark-mint": { url: SITE + "/assets/img/email/pgc-mark-mint.png", ink: "light", width: 120, w: 480, h: 174, alt: "PGC" },
};
const LOGO_MAX_W = 200, LOGO_MAX_H = 64, LOGO_MAX_H_TALL = 88; // a crest or stacked mark may run taller than a wordmark
/** Display size for a logo: within maxW × LOGO_MAX_H (taller for square-ish artwork), never upscaled. Unknown pixel size → width only (height 0). */
export function fitLogo(w, h, maxW) {
    if (!(w > 0 && h > 0))
        return { width: maxW, height: 0 };
    const ratio = w / h, maxH = ratio < 1.5 ? LOGO_MAX_H_TALL : LOGO_MAX_H;
    const width = Math.max(24, Math.min(maxW, Math.round(maxH * ratio), Math.round(w)));
    return { width, height: Math.max(1, Math.min(maxH, Math.round(width / ratio))) };
}
/** The theme's header logo for the email surface: the brand kit's file drawn for that surface, else the initiative's site logo. */
export function themeLogo(theme, cardLight, meta) {
    if (!theme)
        return null;
    const c = theme.configuration || {};
    const alt = (theme.logo && theme.logo.alt) || theme.name || "";
    // Kit files are drawn for the surface they are named after; the site's initiative logos are white.
    const kitLight = { url: assetUrl(c.logo_url), ink: "dark" }, kitDark = { url: assetUrl(c.logo_dark_url), ink: "light" }, site = { url: assetUrl(theme.logo && theme.logo.url), ink: "light" };
    const pick = (cardLight ? [kitLight, site, kitDark] : [kitDark, site, kitLight]).find((x) => x.url);
    if (!pick || !pick.url)
        return null;
    const m = (meta && meta[pick.url]) || {};
    const ink = m.ink === "light" || m.ink === "dark" ? m.ink : pick.ink; // measured artwork wins over the file's role
    return { url: pick.url, alt, ink, w: Number(m.w) || 0, h: Number(m.h) || 0 };
}
/** Keep only well-formed measurements: at most 8 absolute http(s) keys, ink light|dark, positive integer sizes. */
export function cleanLogoMeta(v) {
    if (!v || typeof v !== "object")
        return undefined;
    const out = {};
    for (const [k, m] of Object.entries(v)) {
        if (Object.keys(out).length >= 8)
            break;
        if (k.length > 600 || !/^https?:\/\//i.test(k) || !m || typeof m !== "object")
            continue;
        const mm = m;
        const ink = mm.ink === "light" || mm.ink === "dark" ? mm.ink : "";
        const size = (x) => (Number.isInteger(x) && x > 0 && x < 20000 ? x : 0);
        const w = size(mm.w), h = size(mm.h);
        if (!ink && !(w && h))
            continue;
        out[k] = { ink, w, h };
    }
    return Object.keys(out).length ? out : undefined;
}
const isLight = (h) => luminance(h) > 0.5;
let P = { ...DEFAULTS };
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function hex(v, fallback) { return typeof v === "string" && HEX.test(v.trim()) ? v.trim() : fallback; }
function luminance(h) {
    let c = h.slice(1);
    if (c.length === 3)
        c = c.split("").map((x) => x + x).join("");
    const n = parseInt(c, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const darkEnough = (h) => luminance(h) < 0.35;
/* Blend hex a towards hex b by t (0 = a, 1 = b); 6-digit lowercase result. */
function mix(a, b, t) {
    const rgb = (h) => { let c = h.slice(1); if (c.length === 3)
        c = c.split("").map((x) => x + x).join(""); const n = parseInt(c, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const A = rgb(a), B = rgb(b);
    return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function fontStack(name, fallback) {
    const n = typeof name === "string" ? name.replace(/[^\w\s-]/g, "").trim() : "";
    return n ? `font-family:'${n}',${fallback};` : `font-family:${fallback};`;
}
export function paletteFor(theme, ap) {
    const a = ap || {};
    const dark = a.mode === "dark";
    let P = { ...DEFAULTS };
    const c = (theme && theme.configuration) || null;
    if (c) {
        const primary = hex(c.primary, DEFAULTS.green), secondary = hex(c.secondary, primary), dk = hex(c.dark, DEFAULTS.navy);
        const labelColor = darkEnough(primary) ? primary : darkEnough(secondary) ? secondary : dk;
        const fonts = [c.font_heading, c.font_body].filter((f) => typeof f === "string" && f && !/^(Arial|Helvetica|Inter)$/i.test(f));
        const fontLink = fonts.length ? `<link href="https://fonts.googleapis.com/css2?${[...new Set(fonts)].map((f) => "family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;700").join("&")}&display=swap" rel="stylesheet" />` : "";
        P = { ...P,
            navy: dk, green: labelColor, ink: hex(c.heading, DEFAULTS.ink), body: hex(c.body, DEFAULTS.body), muted: hex(c.body, DEFAULTS.muted),
            rule: hex(c.border, DEFAULTS.rule), bg: hex(c.background, hex(c.surface, DEFAULTS.bg)), footer: dk,
            radius: typeof c.radius === "string" && /^\d{1,2}px$/.test(c.radius) ? c.radius : DEFAULTS.radius,
            font: fontStack(c.font_body, "Arial,Helvetica,sans-serif"), fontH: fontStack(c.font_heading || c.font_body, "Arial,Helvetica,sans-serif"), fontLink, accentRule: primary,
        };
        P.link = P.navy;
    }
    if (dark) {
        // Dark mode: deep card and page, light type, and the theme's brightest
        // color (accent or primary) for buttons, links and labels.
        const bright = [c && c.accent, c && c.primary, "#3cdbc0"].map((v) => hex(v, "")).filter(Boolean).sort((x, y) => luminance(y) - luminance(x))[0] || "#3cdbc0";
        const deep = hex(c && c.dark2, hex(c && c.dark, "#0a343b"));
        P = { ...P, card: isLight(deep) ? "#0a343b" : deep, bg: "#041d21", ink: "#ffffff", body: "#c9d6d6", muted: "#9fb3b2", rule: "#16363c", footer: "#041d21",
            navy: bright, green: bright, link: bright, buttonText: isLight(bright) ? "#0b1410" : "#ffffff", dark: true, accentRule: bright };
    }
    if (a.card && HEX.test(a.card)) {
        P.card = a.card;
        if (isLight(a.card) === dark) { /* user chose an opposite-brightness card: keep type readable */
            P.ink = isLight(a.card) ? "#101820" : "#ffffff";
            P.body = isLight(a.card) ? "#101820" : "#c9d6d6";
            P.muted = isLight(a.card) ? "#54585a" : "#9fb3b2";
            P.rule = isLight(a.card) ? "#dddddd" : "#16363c";
        }
    }
    if (a.background && HEX.test(a.background))
        P.bg = a.background;
    // Explicit type colors win over everything derived above: headings and body copy take `text`
    // (muted copy is that color eased a third of the way towards the card), links and labels `accent`.
    if (a.text && HEX.test(a.text)) {
        P.ink = a.text;
        P.body = a.text;
        P.muted = mix(a.text, P.card, 0.35);
    }
    if (a.accent && HEX.test(a.accent)) {
        P.link = a.accent;
        P.green = a.accent;
    }
    // Header logo: explicit choice, else the theme's, else the PGC lockup in the
    // variant that suits the background.
    const cardLight = isLight(P.card);
    let choice = a.logo || "auto";
    const tl = themeLogo(theme, cardLight, a.logoMeta);
    if (choice === "initiative" && !tl)
        choice = "auto";
    if (choice === "auto")
        choice = tl ? "initiative" : (cardLight ? "pgc-dark" : "pgc-mint");
    let ink;
    if (choice === "initiative" && tl) {
        const f = fitLogo(tl.w, tl.h, LOGO_MAX_W);
        P.logo = tl.url;
        P.logoAlt = tl.alt;
        P.logoWidth = f.width;
        P.logoHeight = f.height;
        P.poweredBy = true;
        ink = tl.ink;
    }
    else {
        const L = PGC_LOGOS[choice] || PGC_LOGOS["pgc-dark"];
        const f = fitLogo(L.w, L.h, L.width);
        P.logo = L.url;
        P.logoAlt = L.alt;
        P.logoWidth = f.width;
        P.logoHeight = f.height;
        P.poweredBy = false;
        ink = L.ink;
    }
    // Plate: only when the artwork would vanish (white on a light card, dark on
    // a dark card). The "dark" plate is the theme's dark color when that is
    // actually dark.
    const plate = a.logoPlate || "auto";
    const themeDark = c ? hex(c.dark, "") : "";
    const darkPlate = themeDark && darkEnough(themeDark) ? themeDark : "#072b31";
    P.logoPlate = plate === "light" ? "#ffffff" : plate === "dark" ? darkPlate : plate === "none" ? "" : (ink === "light" && cardLight ? darkPlate : (ink === "dark" && !cardLight ? "#ffffff" : ""));
    // Buttons: the theme's navy (or brightest color on dark emails) unless the campaign picks its own.
    const bt = a.button || {};
    P.btnRadius = BTN_RADIUS[bt.shape || ""] || "8px";
    P.btnWidth = btnWidth(bt.width);
    if (bt.color && HEX.test(bt.color)) {
        P.btnBg = bt.color;
        P.buttonText = bt.text && HEX.test(bt.text) ? bt.text : (isLight(bt.color) ? "#0b1410" : "#ffffff");
    }
    else if (bt.text && HEX.test(bt.text))
        P.buttonText = bt.text;
    return P;
}
export function plateFor(kind, theme) {
    if (kind === "light")
        return "#ffffff";
    if (kind === "dark")
        return hex(theme && theme.configuration && theme.configuration.dark, "#072b31");
    return "";
}
/* Header <img>: an explicit width and height when the file's pixel size is
   known (no reflow when the image arrives, no squashing by max-height); else
   a box the artwork fits into at its own proportions. */
function logoImg() {
    const W = P.logoWidth, H = P.logoHeight;
    const size = H ? `width="${W}" height="${H}" style="display:block;width:${W}px;height:${H}px;border:0;"` : `width="${W}" style="display:block;max-width:${W}px;max-height:72px;width:auto;height:auto;border:0;"`;
    return `<img src="${esc(P.logo)}" ${size} alt="${esc(P.logoAlt)}" />`;
}
/* The default footer (the data model keeps ARI's key "ari" for it). */
export const ARI_FOOTER = {
    name: "Proving Ground Capital (PGC)", tagline: "Capital built for critical technology. An Applied Research Institute company.",
    note: "You’re receiving this because you subscribed to updates from Proving Ground Capital on pgc.capital.",
    links: [{ label: "pgc.capital", url: SITE + "/" }, { label: "Contact", url: SITE + "/contact/" }],
};
/** The brand on a theme: the initiative's name (else the kit's), for a footer without ARI wording. */
export function kitName(theme) { return String((theme && theme.logo && theme.logo.alt) || (theme && theme.name) || "").trim(); }
/** What a preset footer says (the starting point when someone switches to editing their own). */
export function footerPreset(preset, theme) {
    const name = kitName(theme);
    if (preset === "kit" && name)
        return { name, tagline: "", note: "You’re receiving this because you subscribed to updates from " + name + ".", links: [] };
    return { ...ARI_FOOTER, links: ARI_FOOTER.links.map((l) => ({ ...l })) };
}
function resolveFooter(f, theme) {
    if (f && f.preset === "custom")
        return { name: f.name || "", tagline: f.tagline || "", note: f.note || "", links: (f.links || []).filter((l) => l && l.url) };
    return footerPreset(f && f.preset === "kit" ? "kit" : "ari", theme);
}
const SAFE_URL = /^(https?:\/\/|mailto:)[^\s"<>]+$/i;
export function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function assetUrl(v) {
    if (!v)
        return null;
    const s = String(v).trim();
    if (/^https?:\/\//i.test(s))
        return s;
    return SITE + "/" + s.replace(/^(\.\.\/|\.\/|\/)+/, "");
}
// The post's clean address (a vercel.json rewrite to article.html?id=…, which older emails still use).
export function postUrl(p) { return SITE + "/newsroom/" + encodeURIComponent(p.id) + "/"; }
export function eventUrl(e) { return (e.register_url && /^https?:\/\//i.test(e.register_url)) ? e.register_url : SITE + "/events/"; }
export function formatEventDate(start, end) {
    if (!start)
        return "";
    const s = new Date(start + "T00:00:00Z");
    const full = { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" };
    if (!end || end === start)
        return s.toLocaleDateString("en-US", full);
    const e = new Date(end + "T00:00:00Z");
    if (s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear()) {
        return s.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) + "–" + e.getUTCDate() + ", " + e.getUTCFullYear();
    }
    return s.toLocaleDateString("en-US", full) + " – " + e.toLocaleDateString("en-US", full);
}
function shortMonth(d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase(); }
function dayNum(d) { return String(new Date(d + "T00:00:00Z").getUTCDate()); }
// Bold and underline: authors type **bold** and __underline__ (the composer's B and U buttons insert
// these). They are applied to already-escaped text, so they only ever produce <strong> / underline
// spans; no HTML from authors is interpreted. Markers never cross a line break.
const BOLD_RE = /\*\*(?=\S)([^\n]*?\S)\*\*/g, UNDER_RE = /__(?=\S)([^\n]*?\S)__/g;
export function inlineFormat(escaped) {
    return escaped
        .replace(BOLD_RE, '<strong style="font-weight:bold;">$1</strong>')
        .replace(UNDER_RE, '<span style="text-decoration:underline;">$1</span>');
}
/** The plain-text twin: the same words without the markers. */
export function plainFormat(s) {
    return String(s ?? "").replace(BOLD_RE, "$1").replace(UNDER_RE, "$1");
}
const URL_RE = /(https?:\/\/[^\s<*]+)/;
// Lists: a run of lines starting with "- " (or "* ", "• ") is a bulleted list, "1. " (or "1) ") a numbered
// one; the composer's list buttons write these. "**bold**" at the start of a line is not a bullet.
const BULLET_RE = /^\s*[-*•]\s+(.*\S.*)$/, NUM_RE = /^\s*(\d{1,3})[.)]\s+(.*\S.*)$/;
/** One line of author text → HTML: escaped, URLs linked as they are, the rest bold/underline-formatted. */
function lineHtml(s) {
    return esc(s).split(URL_RE).map((part, i) => (i % 2 ? `<a href="${part}" style="color:${P.link};">${part}</a>` : inlineFormat(part))).join("");
}
function listHtml(kind, items, start, style) {
    const startAttr = kind === "ol" && start !== 1 ? ` start="${start}"` : "";
    return `<${kind}${startAttr} style="margin:0 0 14px;padding:0 0 0 24px;${P.font}font-size:16px;line-height:1.55;color:${P.body};${style}">` +
        items.map((t) => `<li style="margin:0 0 6px;">${lineHtml(t)}</li>`).join("") + `</${kind}>`;
}
// Plain text → paragraphs and lists, with bare URLs linked and **bold** / __underline__ applied. No HTML from
// authors is ever interpreted, so nothing pasted into the portal can inject markup.
function paragraphs(text, style = "") {
    const t = String(text || "").replace(/\r\n?/g, "\n").trim();
    if (!t)
        return "";
    return t.split(/\n{2,}/).map((block) => {
        const lines = block.split("\n"), out = [];
        let buf = [];
        const flush = () => { if (buf.length)
            out.push(`<p style="margin:0 0 14px;${P.font}font-size:16px;line-height:1.55;color:${P.body};${style}">${buf.map(lineHtml).join("<br />")}</p>`); buf = []; };
        for (let i = 0; i < lines.length;) {
            const b = BULLET_RE.exec(lines[i]), n = b ? null : NUM_RE.exec(lines[i]);
            if (!b && !n) {
                buf.push(lines[i]);
                i++;
                continue;
            }
            flush();
            const kind = b ? "ul" : "ol", re = b ? BULLET_RE : NUM_RE, items = [], start = n ? Number(n[1]) : 1;
            for (let m = re.exec(lines[i]); i < lines.length && m; m = i < lines.length ? re.exec(lines[i]) : null) {
                items.push(kind === "ul" ? m[1] : m[2]);
                i++;
            }
            out.push(listHtml(kind, items, start, style));
        }
        flush();
        return out.join("");
    }).join("");
}
function excerpt(s, max = 220) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t.length <= max)
        return t;
    // A cut can split a **bold** or __underline__ pair: drop the orphaned opening marker.
    let out = t.slice(0, max).replace(/\s+\S*$/, "");
    for (const m of ["**", "__"])
        if (out.split(m).length % 2 === 0) {
            const k = out.lastIndexOf(m);
            out = out.slice(0, k) + out.slice(k + 2);
        }
    return out + "…";
}
const BTN_RADIUS = { pill: "999px", rounded: "8px", square: "0" };
/* Button width: 0 is "as wide as the label", "full" the whole content column, otherwise 80 to 536 px (the content width). */
const BTN_MIN_W = 80, BTN_MAX_W = 536;
export function btnWidth(v) { if (v === "full")
    return "full"; const n = Math.round(Number(v) || 0); return n > 0 ? Math.max(BTN_MIN_W, Math.min(BTN_MAX_W, n)) : 0; }
/** A call-to-action button. Campaign-wide style from the palette; a block may override color, text, shape, size, alignment, filled/outline and width. */
function button(label, url, center = false, o) {
    const s = o || {};
    const bg = s.color && HEX.test(s.color) ? s.color : (P.btnBg || P.navy);
    const text = s.text && HEX.test(s.text) ? s.text : (s.color && HEX.test(s.color) ? (isLight(s.color) ? "#0b1410" : "#ffffff") : P.buttonText);
    const radius = s.shape ? (BTN_RADIUS[s.shape] || P.btnRadius) : P.btnRadius;
    const big = s.size === "large";
    const outline = s.style === "outline";
    const margin = s.align === "right" ? "0 0 0 auto" : s.align === "left" ? "0" : center || s.align === "center" ? "0 auto" : "0";
    const cell = outline ? `border:2px solid ${bg};border-radius:${radius};background:transparent;` : `border-radius:${radius};background:${bg};`;
    // A fixed or full width: the table takes it and the link fills the cell; otherwise the button hugs its label.
    const w = btnWidth(s.width) || P.btnWidth;
    const tableW = w === "full" ? ` width="100%"` : w ? ` width="${w}"` : "", tableStyle = w === "full" ? `width:100%;` : w ? `width:${w}px;max-width:100%;` : "";
    const linkBox = w ? `display:block;text-align:center;` : `display:inline-block;`;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${tableW} style="margin:${margin};${tableStyle}"><tr><td style="${cell}">
    <a href="${esc(url)}" style="${linkBox}padding:${big ? "16px 30px" : "12px 22px"};${P.font}font-size:${big ? 17 : 15}px;font-weight:bold;color:${outline ? bg : text};text-decoration:none;border-radius:${radius};">${esc(label)}</a></td></tr></table>`;
}
function label(text) {
    return `<p style="margin:0 0 6px;${P.font}font-size:12px;letter-spacing:1.2px;text-transform:uppercase;font-weight:bold;color:${P.green};">${esc(text)}</p>`;
}
function rule() { return `<tr><td style="padding:0 32px;"><div style="height:1px;background:${P.rule};line-height:1px;font-size:1px;">&nbsp;</div></td></tr>`; }
function section(inner, pad = "24px 32px") { return `<tr><td style="padding:${pad};">${inner}</td></tr>`; }
/* Editor markers (opts.editor only): data-nl on a row's leading <tr> names
   what the row is on the composer canvas; data-nl-empty flags a stand-in for
   a block the email itself leaves out. Rows not starting with <tr are left
   alone. */
function markRow(row, name, empty = false) {
    if (!/^<tr[\s>]/.test(row))
        return row;
    return `<tr data-nl="${name}"${empty ? ' data-nl-empty="1"' : ""}` + row.slice(3);
}
/* Editor-only stand-in row for a block that renders nothing, so it stays visible and selectable. */
function placeholder(message) {
    return `<tr><td style="padding:10px 32px;"><div style="border:1px dashed ${P.muted};border-radius:10px;padding:14px 16px;${P.font}font-size:13px;line-height:1.4;color:${P.muted};text-align:center;">${esc(message)}</div></td></tr>`;
}
function postCard(p, featured, cta, compact = false) {
    const url = postUrl(p);
    const cover = assetUrl(p.cover_image);
    const img = cover && !compact ? `<a href="${esc(url)}"><img src="${esc(cover)}" width="536" alt="" style="display:block;width:100%;max-width:536px;height:auto;border-radius:${P.radius};margin:0 0 16px;" /></a>` : "";
    const title = `<h2 style="margin:0 0 ${compact ? 6 : 10}px;${P.fontH}font-size:${featured ? 26 : compact ? 18 : 20}px;line-height:1.25;font-weight:bold;color:${P.ink};"><a href="${esc(url)}" style="color:${P.ink};text-decoration:none;">${esc(p.title)}</a></h2>`;
    const summary = paragraphs(excerpt(p.summary || p.body, featured ? 420 : compact ? 150 : 220), `font-size:${featured ? 16 : 15}px;color:${featured ? P.ink : P.muted};${compact ? "margin-bottom:8px;" : ""}`);
    const link = featured ? button(cta || "Read the full story", url) : `<a href="${esc(url)}" style="${P.font}font-size:15px;font-weight:bold;color:${P.link};text-decoration:none;">${esc(cta || "Read more")} &rarr;</a>`;
    return section(img + (p.category ? label(p.category) : "") + title + summary + link, featured ? "28px 32px 24px" : compact ? "16px 32px" : "22px 32px");
}
function eventCard(e, featured) {
    const url = eventUrl(e);
    const when = formatEventDate(e.start_date, e.end_date) + (e.time ? " · " + e.time : "");
    const where = [e.location, e.platform].filter(Boolean).join(" · ");
    const cta = (e.cta_label || "Register").trim() || "Register";
    if (featured) {
        return section(label(e.event_type || "Event") +
            `<h2 style="margin:0 0 8px;${P.fontH}font-size:26px;line-height:1.25;font-weight:bold;color:${P.ink};">${esc(e.title)}</h2>` +
            `<p style="margin:0 0 4px;${P.font}font-size:16px;font-weight:bold;color:${P.link};">${esc(when)}</p>` +
            (where ? `<p style="margin:0 0 14px;${P.font}font-size:15px;color:${P.muted};">${esc(where)}</p>` : `<div style="height:10px;"></div>`) +
            paragraphs(excerpt(e.description, 600)) + button(cta, url), "28px 32px 24px");
    }
    return `<tr><td style="padding:18px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td width="64" valign="top" style="padding-right:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="64" style="border:1px solid ${P.rule};border-radius:12px;"><tr><td align="center" style="padding:6px 0 2px;${P.font}font-size:11px;font-weight:bold;letter-spacing:1px;color:${P.green};">${esc(shortMonth(e.start_date))}</td></tr><tr><td align="center" style="padding:0 0 8px;${P.font}font-size:24px;font-weight:bold;color:${P.ink};line-height:1;">${esc(dayNum(e.start_date))}</td></tr></table>
      </td>
      <td valign="top">
        <p style="margin:0 0 4px;${P.font}font-size:18px;font-weight:bold;line-height:1.3;color:${P.ink};"><a href="${esc(url)}" style="color:${P.ink};text-decoration:none;">${esc(e.title)}</a></p>
        <p style="margin:0 0 4px;${P.font}font-size:14px;color:${P.muted};">${esc(when)}${where ? " · " + esc(where) : ""}</p>
        ${e.description ? `<p style="margin:0 0 8px;${P.font}font-size:15px;line-height:1.5;color:${P.ink};">${inlineFormat(esc(excerpt(e.description, 180)))}</p>` : ""}
        <a href="${esc(url)}" style="${P.font}font-size:14px;font-weight:bold;color:${P.link};text-decoration:none;">${esc(cta)} &rarr;</a>
      </td></tr></table></td></tr>`;
}
function textBlock(b) {
    return section((b.heading ? `<h2 style="margin:0 0 10px;${P.fontH}font-size:20px;line-height:1.3;font-weight:bold;color:${P.ink};">${esc(b.heading)}</h2>` : "") + paragraphs(b.body), "22px 32px 8px");
}
function buttonBlock(b) {
    if (!b.url)
        return "";
    return section(button(b.label || "Learn more", b.url, true, b), "8px 32px 24px");
}
const ALIGN = (a) => (a === "center" || a === "right" ? a : "left");
function headingBlock(b) {
    const big = b.size !== "small";
    return section(`<h2 style="margin:0;${P.fontH}font-size:${big ? 26 : 19}px;line-height:1.25;font-weight:bold;color:${P.ink};text-align:${ALIGN(b.align)};">${esc(b.text)}</h2>`, big ? "26px 32px 6px" : "18px 32px 4px");
}
function imageBlock(b, plateColor) {
    const src = assetUrl(b.url);
    if (!src)
        return "";
    const w = Math.max(40, Math.min(536, Number(b.width) || 536));
    const img = `<img src="${esc(src)}" width="${w}" alt="${esc(b.alt || "")}" style="display:block;width:${w}px;max-width:100%;height:auto;border:0;" />`;
    const plated = plateColor ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;"><tr><td style="padding:14px 18px;background:${plateColor};border-radius:12px;">${img}</td></tr></table>` : img;
    const inner = b.link && /^https?:\/\//i.test(b.link) ? `<a href="${esc(b.link)}" style="display:inline-block;">${plated}</a>` : plated;
    return `<tr><td align="${ALIGN(b.align)}" style="padding:14px 32px;text-align:${ALIGN(b.align)};">${inner}</td></tr>`;
}
function dividerBlock() { return `<tr><td style="padding:14px 32px;"><div style="height:1px;background:${P.rule};line-height:1px;font-size:1px;">&nbsp;</div></td></tr>`; }
function spacerBlock(b) {
    const h = Math.max(8, Math.min(120, Number(b.height) || 24));
    return `<tr><td style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</td></tr>`;
}
/* Blocks that separate themselves; no automatic rule is drawn before or after them. */
const SELF_SEPARATING = new Set(["heading", "image", "divider", "spacer", "button"]);
/* Bumped whenever the rendered email changes. The portal compares it with the
   sending service's copy so a stale deployment is visible before sending. */
// PGC renderer: versions start at 1 (the ARI source was at 12 when this copy was made).
export const RENDER_VERSION = 1;
/* Normalisation shared by the sending service and the portal canvas: the same
   limits, defaults and validation, so what the canvas shows is what is sent.
   `strict` (the service) drops blocks that cannot be sent — unknown types and
   post/event ids that are not uuids; the canvas keeps every block in place so
   its editor markers stay aligned with the draft. */
const UUID = /^[0-9a-f-]{36}$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;
const str = (x, max) => (x == null ? "" : String(x)).slice(0, max);
export function normalizeBlock(b, strict) {
    const v = b;
    if (!v || typeof v !== "object")
        return null;
    if (v.type === "post" || v.type === "event") {
        const id = String(v.id || "");
        if (strict && !UUID.test(id))
            return null;
        const o = { type: v.type, id };
        // Optional overrides for this email only; blank means "use the site's text".
        const title = str(v.title, 200).trim(), body = str(v.type === "post" ? v.summary : v.description, 2000).trim(), cta = str(v.cta, 80).trim();
        if (title)
            o.title = title;
        if (body)
            o[v.type === "post" ? "summary" : "description"] = body;
        if (cta)
            o.cta = cta;
        return o;
    }
    if (v.type === "text")
        return { type: "text", heading: str(v.heading, 200), body: str(v.body, 20000) };
    if (v.type === "button") {
        const o = { type: "button", label: str(v.label, 80), url: str(v.url, 1000) };
        const hx = (x) => (HEX6.test(String(x || "")) ? String(x).toLowerCase() : "");
        if (hx(v.color))
            o.color = hx(v.color);
        if (hx(v.text))
            o.text = hx(v.text);
        if (btnWidth(v.width))
            o.width = btnWidth(v.width);
        if (["pill", "rounded", "square"].includes(v.shape))
            o.shape = v.shape;
        if (v.size === "large")
            o.size = "large";
        if (["left", "center", "right"].includes(v.align) && v.align !== "center")
            o.align = v.align;
        if (v.style === "outline")
            o.style = "outline";
        return o;
    }
    if (v.type === "heading")
        return { type: "heading", text: str(v.text, 200), size: v.size === "small" ? "small" : "large", align: ["left", "center", "right"].includes(v.align) ? v.align : "left" };
    if (v.type === "image") {
        const url = str(v.url, 1000), link = str(v.link, 1000);
        return { type: "image", url: /^(https?:\/\/|assets\/)/i.test(url) ? url : "", alt: str(v.alt, 200), link: /^https?:\/\//i.test(link) ? link : "", width: Math.max(40, Math.min(536, Number(v.width) || 536)), align: ["left", "center", "right"].includes(v.align) ? v.align : "center", plate: ["light", "dark"].includes(v.plate) ? v.plate : "none" };
    }
    if (v.type === "divider")
        return { type: "divider" };
    if (v.type === "spacer")
        return { type: "spacer", height: Math.max(8, Math.min(120, Number(v.height) || 24)) };
    return null;
}
export function normalizeBlocks(v, strict) {
    if (!Array.isArray(v))
        return [];
    const out = v.slice(0, 40).map((b) => normalizeBlock(b, strict));
    return (strict ? out.filter(Boolean) : out);
}
export function normalizeAppearance(v) {
    const a = (v && typeof v === "object" ? v : {});
    return {
        mode: a.mode === "dark" ? "dark" : "light",
        background: HEX6.test(String(a.background || "")) ? String(a.background).toLowerCase() : "",
        card: HEX6.test(String(a.card || "")) ? String(a.card).toLowerCase() : "",
        logo: ["auto", "pgc-dark", "pgc-mint", "pgc-mark-dark", "pgc-mark-mint", "initiative"].includes(a.logo) ? a.logo : "auto",
        logoPlate: ["auto", "none", "light", "dark"].includes(a.logoPlate) ? a.logoPlate : "auto",
        logoMeta: cleanLogoMeta(a.logoMeta) || null,
        text: HEX6.test(String(a.text || "")) ? String(a.text).toLowerCase() : "",
        accent: HEX6.test(String(a.accent || "")) ? String(a.accent).toLowerCase() : "",
        button: normalizeButtonStyle(a.button),
        header: normalizeHeader(a.header),
        footer: normalizeFooter(a.footer),
    };
}
const line = (v, max) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
function normalizeHeader(v) {
    const h = (v && typeof v === "object" ? v : {});
    const link = line(h.link, 300);
    const out = { powered: h.powered !== false, viewOnline: h.viewOnline !== false, tagline: line(h.tagline, 120), link: /^https?:\/\//i.test(link) && SAFE_URL.test(link) ? link : "" };
    return out.powered && out.viewOnline && !out.tagline && !out.link ? null : out;
}
function normalizeFooter(v) {
    const f = (v && typeof v === "object" ? v : {});
    const preset = f.preset === "kit" || f.preset === "custom" ? f.preset : "ari";
    if (preset !== "custom")
        return preset === "ari" ? null : { preset };
    const links = (Array.isArray(f.links) ? f.links : []).slice(0, 4).map((l) => { const o = (l && typeof l === "object" ? l : {}); return { label: line(o.label, 40), url: line(o.url, 300) }; }).filter((l) => l.url && SAFE_URL.test(l.url));
    return { preset, name: line(f.name, 120), tagline: line(f.tagline, 160), note: line(f.note, 300), links };
}
function normalizeButtonStyle(v) {
    const b = (v && typeof v === "object" ? v : {});
    const out = { shape: ["pill", "rounded", "square"].includes(b.shape) ? b.shape : "", color: HEX6.test(String(b.color || "")) ? String(b.color).toLowerCase() : "", text: HEX6.test(String(b.text || "")) ? String(b.text).toLowerCase() : "", width: btnWidth(b.width) };
    return out.shape || out.color || out.text || out.width ? out : null;
}
export function normalizeCampaign(src, strict) {
    const s = (src && typeof src === "object" ? src : {});
    const c = (s.content && typeof s.content === "object" ? s.content : {});
    return {
        title: str(s.title, 200) || "Untitled campaign", subject: str(s.subject, 200), preview_text: str(s.preview_text, 300),
        from_name: str(s.from_name, 100) || "Proving Ground Capital (PGC)",
        template: ["digest", "event", "release", "newsletter"].includes(s.template) ? s.template : "digest",
        content: { heading: str(c.heading, 200), intro: str(c.intro, 20000), closing: str(c.closing, 20000), blocks: normalizeBlocks(c.blocks, strict), appearance: normalizeAppearance(c.appearance), theme_id: UUID.test(String(c.theme_id || "")) ? String(c.theme_id) : "" },
    };
}
export function renderCampaign(c, posts, events, theme, opts) {
    const content = c.content || {};
    const editor = !!(opts && opts.editor);
    const mark = editor ? markRow : (row) => row;
    P = paletteFor(theme, content.appearance || null);
    const accentRule = P.accentRule;
    const ap = content.appearance || {};
    const hd = ap.header || {};
    const logoHref = hd.link && /^https?:\/\//i.test(hd.link) && SAFE_URL.test(hd.link) ? hd.link : SITE + "/";
    const warnings = [];
    const blocks = Array.isArray(content.blocks) ? content.blocks : [];
    const subject = (c.subject || "").trim();
    const heading = (content.heading || "").trim() || subject || c.title;
    if (!subject)
        warnings.push("The campaign has no subject line.");
    if (!blocks.length)
        warnings.push("The campaign has no content blocks yet.");
    if (!(c.preview_text || "").trim())
        warnings.push("No preview text: inboxes will show the first line of the email instead.");
    const rows = [];
    const textLines = [];
    const featuredType = c.template === "release" ? "post" : c.template === "event" ? "event" : null;
    // "Newsletter" layout: an issue line above the headline, an "In this issue"
    // list from the headings and posts, and compact post cards.
    const isNews = c.template === "newsletter";
    const issueLine = isNews ? label("PGC Newsletter · " + new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/Indiana/Indianapolis" })) : "";
    const inThisIssue = isNews ? blocks.map((b) => (!b || typeof b !== "object") ? "" : b.type === "heading" ? String(b.text || "").trim() : b.type === "post" ? (b.title || (posts.get(b.id) || { title: "" }).title || "").trim() : "").filter(Boolean).slice(0, 8) : [];
    const issueList = inThisIssue.length >= 2 ? `<p style="margin:18px 0 6px;${P.font}font-size:12px;letter-spacing:1.2px;text-transform:uppercase;font-weight:bold;color:${P.muted};">In this issue</p>` + inThisIssue.map((t) => `<p style="margin:0 0 4px;${P.font}font-size:15px;line-height:1.5;color:${P.body};">&bull;&nbsp; ${esc(t)}</p>`).join("") : "";
    let featuredUsed = false;
    // The previous rendered block's type decides whether a thin rule is drawn:
    // rules sit between content cards, never next to self-separating blocks
    // (headings, images, dividers, spacers, buttons) or between two events.
    let prev = null;
    const sep = (type) => {
        if (prev === null || SELF_SEPARATING.has(prev) || SELF_SEPARATING.has(type))
            return;
        if (prev === "event" && type === "event")
            return;
        rows.push(rule());
    };
    rows.push(mark(section(issueLine + `<h1 style="margin:0 0 14px;${P.fontH}font-size:30px;line-height:1.2;font-weight:bold;color:${P.ink};">${esc(heading)}</h1>` + paragraphs(content.intro) + issueList, "30px 32px 8px"), "lead"));
    textLines.push(heading.toUpperCase(), "");
    if (content.intro)
        textLines.push(plainFormat(String(content.intro).trim()), "");
    if (issueList)
        textLines.push("IN THIS ISSUE", ...inThisIssue.map((t) => "- " + t), "");
    blocks.forEach((b, i) => {
        if (!b || typeof b !== "object")
            return;
        const key = "block:" + i;
        const put = (row) => rows.push(mark(row, key));
        // A block with nothing to show is left out of the email; the editor shows
        // a stand-in instead. Neither touches `prev`, so the rules between the
        // remaining cards fall exactly where the sent email draws them.
        const skip = (message) => { if (editor)
            rows.push(mark(placeholder(message), key, true)); };
        if (b.type === "post") {
            const src = posts.get(b.id);
            if (!src) {
                warnings.push(`Post #${i + 1} could not be found (it may have been deleted).`);
                skip("This post can’t be shown: it may be unpublished, deleted, or not visible to you.");
                return;
            }
            if (src.published === false)
                warnings.push(`“${src.title}” is not published on the website; its link will not work until it is.`);
            // The block's own words win for this email; the newsroom post is untouched.
            const p = { ...src, title: b.title || src.title, summary: b.summary || src.summary, body: b.summary ? "" : src.body };
            const featured = featuredType === "post" && !featuredUsed;
            featuredUsed = featuredUsed || featured;
            sep("post");
            put(postCard(p, featured, b.cta, isNews));
            prev = "post";
            textLines.push((p.category ? p.category.toUpperCase() + ": " : "") + p.title, plainFormat(excerpt(p.summary || p.body, 300)), postUrl(p), "");
        }
        else if (b.type === "event") {
            const srcE = events.get(b.id);
            if (!srcE) {
                warnings.push(`Event #${i + 1} could not be found (it may have been deleted).`);
                skip("This event can’t be shown: it may be unpublished, deleted, or not visible to you.");
                return;
            }
            if (srcE.published === false)
                warnings.push(`“${srcE.title}” is not published on the events calendar.`);
            const e = { ...srcE, title: b.title || srcE.title, description: b.description || srcE.description, cta_label: b.cta || srcE.cta_label };
            const featured = featuredType === "event" && !featuredUsed;
            featuredUsed = featuredUsed || featured;
            sep("event");
            put(eventCard(e, featured));
            prev = featured ? "post" : "event";
            textLines.push(e.title, formatEventDate(e.start_date, e.end_date) + (e.location ? " · " + e.location : ""), eventUrl(e), "");
        }
        else if (b.type === "text") {
            if (!(b.heading || b.body)) {
                skip("Empty text block — add a heading or text in the panel.");
                return;
            }
            sep("text");
            put(textBlock(b));
            prev = "text";
            if (b.heading)
                textLines.push(String(b.heading).toUpperCase());
            if (b.body)
                textLines.push(plainFormat(String(b.body).trim()));
            textLines.push("");
        }
        else if (b.type === "button") {
            if (!b.url) {
                warnings.push(`Button #${i + 1} has no link.`);
                skip("Button — add a link.");
                return;
            }
            put(buttonBlock(b));
            prev = "button";
            textLines.push((b.label || "Learn more") + ": " + b.url, "");
        }
        else if (b.type === "heading") {
            if (!(b.text || "").trim()) {
                warnings.push(`Heading #${i + 1} is empty.`);
                skip("Empty heading — type a title.");
                return;
            }
            put(headingBlock(b));
            prev = "heading";
            textLines.push(String(b.text).trim().toUpperCase(), "");
        }
        else if (b.type === "image") {
            if (!b.url) {
                warnings.push(`Image #${i + 1} has no picture yet.`);
                skip("Image — choose a picture or logo.");
                return;
            }
            if (!(b.alt || "").trim())
                warnings.push(`Image #${i + 1} has no description (alt text) for screen readers and blocked images.`);
            put(imageBlock(b, plateFor(b.plate, theme)));
            prev = "image";
            if (b.alt)
                textLines.push("[" + b.alt + "]", "");
        }
        else if (b.type === "divider") {
            put(dividerBlock());
            prev = "divider";
            textLines.push("—", "");
        }
        else if (b.type === "spacer") {
            put(spacerBlock(b));
            prev = "spacer";
        }
    });
    if (content.closing) {
        rows.push(rule(), mark(section(paragraphs(content.closing), "22px 32px 10px"), "closing"));
        textLines.push(plainFormat(String(content.closing).trim()), "");
    }
    else if (editor)
        rows.push(mark(placeholder("Add a closing note (optional)"), "closing", true));
    const preheader = (c.preview_text || "").trim();
    const headerRow = `<tr><td style="padding:26px 32px 18px;border-bottom:4px solid ${accentRule};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td valign="middle">${P.logoPlate ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;"><tr><td style="padding:12px 18px;background:${P.logoPlate};border-radius:10px;">` : ""}<a href="${esc(logoHref)}" style="display:inline-block;">${logoImg()}</a>${P.logoPlate ? "</td></tr></table>" : ""}${P.poweredBy && hd.powered !== false ? `<p style="margin:8px 0 0;${P.font}font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${P.muted};">An Applied Research Institute company</p>` : ""}${hd.tagline ? `<p style="margin:8px 0 0;${P.font}font-size:12px;line-height:1.4;color:${P.muted};">${esc(hd.tagline)}</p>` : ""}</td>
      ${hd.viewOnline !== false ? `<td valign="middle" align="right" style="${P.font}font-size:12px;color:${P.muted};"><a href="*|ARCHIVE|*" style="color:${P.muted};">View in browser</a></td>` : ""}
    </tr></table></td></tr>`;
    // Footer: the chosen preset or the edited one. The mailing address, Update preferences and Unsubscribe
    // are always there (Mailchimp requires them and fills them in when sending).
    const ft = resolveFooter(ap.footer, theme);
    const ftLinks = ft.links.filter((l) => l.url && SAFE_URL.test(l.url));
    const footerRow = `<tr><td style="padding:26px 32px 30px;background:${P.footer};">
    <p style="margin:0 0 10px;${P.font}font-size:13px;line-height:1.6;color:#b9c0c4;">${ft.name ? `<strong style="color:#ffffff;">${esc(ft.name)}</strong><br />` : ""}${ft.tagline ? esc(ft.tagline) + "<br />" : ""}*|LIST:ADDRESSLINE|*</p>
    <p style="margin:0 0 10px;${P.font}font-size:12px;line-height:1.6;color:#808285;">${ft.note ? inlineFormat(esc(ft.note)) + " " : ""}<a href="*|UPDATE_PROFILE|*" style="color:#b9c0c4;">Update preferences</a> &middot; <a href="*|UNSUB|*" style="color:#b9c0c4;">Unsubscribe</a></p>
    ${ftLinks.length ? `<p style="margin:0;${P.font}font-size:12px;color:#808285;">${ftLinks.map((l) => `<a href="${esc(l.url)}" style="color:#b9c0c4;">${esc(l.label || l.url)}</a>`).join(" &middot; ")}</p>` : ""}
  </td></tr>`;
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(subject || c.title)}</title>
${P.fontLink}
<style>@media only screen and (max-width:620px){.wrap{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}}</style>${editor ? "<style>[data-nl]{cursor:pointer} html,body{overflow-x:hidden}</style>" : ""}</head>
<body style="margin:0;padding:0;background:${P.bg};">
${preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${P.bg};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="wrap" style="width:600px;max-width:600px;background:${P.card};border-radius:${P.radius};overflow:hidden;">
  ${mark(headerRow, "header")}
  ${rows.join("\n")}
  ${mark(footerRow, "footer")}
</table></td></tr></table></body></html>`;
    const text = textLines.concat([
        "—",
        ...[[ft.name, ft.tagline].filter(Boolean).join(" · ")].filter(Boolean),
        "*|LIST:ADDRESSLINE|*",
        ...(ft.note ? [plainFormat(ft.note)] : []),
        ...ftLinks.map((l) => (l.label ? l.label + ": " : "") + l.url),
        "Update preferences: *|UPDATE_PROFILE|*",
        "Unsubscribe: *|UNSUB|*",
    ]).join("\n");
    return { html, text, warnings };
}
