/* Newsletter composer: canvas workspace. Blocks on the left, the email in the
   centre, a contextual inspector on the right, and a sticky campaign header.
   Mounted by assets/newsletter.js (renderEdit) for campaigns and templates.

   The canvas is the real email: the shared renderer (assets/newsletter-render.js,
   generated from supabase/functions/mailchimp/render.ts) draws it locally on
   every edit, in "editor" mode, which only adds data-nl markers to the rows.
   Selection outlines, toolbars and insertion controls are drawn by this page
   over the iframe and never enter the email. Sending still goes through the
   mailchimp edge function, which renders the same source on the server. */
import { renderCampaign, normalizeCampaign, RENDER_VERSION, footerPreset, kitName } from "./newsletter-render.js";

// PGC has no newsroom or events calendar, so the post and event tiles of the ARI
// composer are left out; the picker code paths below stay for the shared renderer.
const BLOCKS = [
  ["heading", "Heading", "A section title.", "M5 5v14M13 5v14M5 12h8M17 14l2-2 2 2M19 12v7"],
  ["text", "Text", "Paragraphs of your own.", "M4 7h16M4 12h16M4 17h10"],
  ["image", "Image / logo", "A logo from the website or an uploaded picture.", "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01"],
  ["button", "Button", "A call-to-action link.", "M3 9h18v6H3zM8 12h8"],
  ["divider", "Divider", "A thin rule.", "M4 12h16"],
  ["spacer", "Spacer", "Vertical breathing room.", "M4 5h16M4 19h16M12 9v6M10 11l2-2 2 2M10 13l2 2 2-2"],
];
const BLOCK_LABEL = Object.assign({ post: "Newsroom post", event: "Event" }, Object.fromEntries(BLOCKS.map((b) => [b[0], b[1]])));
const ICON = {
  up: "M12 19V5M6 11l6-6 6 6", down: "M12 5v14M6 13l6 6 6-6", dup: "M8 8h12v12H8zM4 16V4h12", del: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13", grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  back: "M15 5l-7 7 7 7", close: "M6 6l12 12M18 6L6 18", plus: "M12 5v14M5 12h14", more: "M5 12h.01M12 12h.01M19 12h.01", desktop: "M3 5h18v11H3zM8 20h8M12 16v4", mobile: "M7 3h10v18H7zM11 18h2",
  settings: "M4 6h16M4 12h16M4 18h16", blocks: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
};
function svg(path, size) { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); if (size) { s.setAttribute("width", size); s.setAttribute("height", size); } const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", path); s.append(p); return s; }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SITE = "https://pgc.capital";
const absUrl = (u) => (/^https?:\/\//i.test(u) ? u : SITE + "/" + String(u).replace(/^(\.\.\/|\.\/|\/)+/, ""));
const blankBlock = (type) => ({ heading: { type, text: "", size: "large", align: "left" }, text: { type, heading: "", body: "" }, image: { type, url: "", alt: "", link: "", width: 240, align: "center", plate: "none" }, button: { type, label: "", url: "" }, divider: { type }, spacer: { type, height: 24 } })[type];
const hasContent = (b) => !!(b && ((b.type === "post" || b.type === "event") ? b.id : b.type === "text" ? (b.heading || b.body) : b.type === "heading" ? b.text : b.type === "image" ? b.url : b.type === "button" ? (b.label || b.url) : false));
const blockName = (b, i, blocks) => BLOCK_LABEL[b.type] + " · " + (i + 1) + " of " + blocks.length;
const narrowMQ = typeof matchMedia === "function" ? matchMedia("(max-width: 1024px)") : null, phoneMQ = typeof matchMedia === "function" ? matchMedia("(max-width: 768px)") : null;
const isNarrow = () => !!(narrowMQ && narrowMQ.matches), isPhone = () => !!(phoneMQ && phoneMQ.matches);
const remember = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (_) { return null; } return null; };

/**
 * Mount the workspace into `host`.
 * @param {object} ctx  state and helpers from assets/newsletter.js
 * @returns {{ destroy(): void, refresh(): void, isDirty(): boolean, select(key: string|null): void }}
 */
export function mountEditor(ctx) {
  const { st, el, supabase, access, canPublish, mc, confirmDialog, notice, fmtDate, fmtDateTime, host, panel, model } = ctx;
  const d = st.draft, isTpl = st.mode === "template";
  let r = isTpl ? st.tpl : st.row;
  const locked = () => !isTpl && !!(r && (r.status === "sent" || r.status === "scheduled"));
  const status = () => (r ? r.status : "draft");
  /* Bold and underline for body text: the B and U buttons (and Ctrl/Cmd+B, Ctrl/Cmd+U) wrap the selection in
     **…** or __…__, or take the markers off again. The renderer turns them into formatting; nothing else is HTML. */
  function toggleMark(ta, mark) {
    if (ta.disabled || ta.readOnly) return;
    const v = ta.value; let a = ta.selectionStart, b = ta.selectionEnd;
    while (a < b && /\s/.test(v[a])) a++; while (b > a && /\s/.test(v[b - 1])) b--;
    const sel = v.slice(a, b), n = mark.length;
    let out, s0, s1;
    if (a >= n && v.slice(a - n, a) === mark && v.slice(b, b + n) === mark) { out = v.slice(0, a - n) + sel + v.slice(b + n); s0 = a - n; s1 = b - n; }
    else if (sel.length > 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) { const inner = sel.slice(n, -n); out = v.slice(0, a) + inner + v.slice(b); s0 = a; s1 = a + inner.length; }
    else if (!sel) { const word = mark === "**" ? "bold text" : "underlined text"; out = v.slice(0, a) + mark + word + mark + v.slice(a); s0 = a + n; s1 = s0 + word.length; }
    else {
      // Markers never cross a line break, so each line of a multi-line selection is wrapped on its own.
      const wrapped = sel.split("\n").map((line) => { const t = line.trim(); if (!t) return line; const lead = line.slice(0, line.indexOf(t)); return lead + mark + t + mark + line.slice(lead.length + t.length); }).join("\n");
      out = v.slice(0, a) + wrapped + v.slice(b); s0 = a; s1 = a + wrapped.length;
      if (!sel.includes("\n")) { s0 = a + n; s1 = b + n; }
    }
    const max = Number(ta.getAttribute("maxlength")) || 0;
    if (max && out.length > max) { notice("That would go past the " + max + "-character limit.", "error"); return; }
    ta.value = out; ta.focus(); try { ta.setSelectionRange(s0, s1); } catch (_) {}
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  /* Lists work on whole lines: every line the selection touches gets "- " (bullets) or "1. ", "2. " … (numbers);
     pressing the same button again on a list takes the markers off. Switching between the two converts. */
  const BULLET = /^\s*[-*•]\s+/, NUMBER = /^\s*\d{1,3}[.)]\s+/;
  function toggleList(ta, kind) {
    if (ta.disabled || ta.readOnly) return;
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    const start = v.lastIndexOf("\n", a - 1) + 1, endNl = v.indexOf("\n", b > a && v[b - 1] === "\n" ? b - 1 : b), end = endNl < 0 ? v.length : endNl;
    const lines = v.slice(start, end).split("\n");
    const mine = kind === "ul" ? BULLET : NUMBER, other = kind === "ul" ? NUMBER : BULLET;
    const filled = lines.filter((l) => l.trim());
    const allOn = filled.length > 0 && filled.every((l) => mine.test(l));
    let n = 0;
    const next = lines.map((l) => {
      if (!l.trim()) return l;
      const bare = l.replace(mine, "").replace(other, "");
      if (allOn) return bare;
      n++; return (kind === "ul" ? "- " : n + ". ") + bare.replace(/^\s+/, "");
    });
    if (!filled.length) next[0] = kind === "ul" ? "- " : "1. ";
    const block = next.join("\n"), out = v.slice(0, start) + block + v.slice(end);
    const max = Number(ta.getAttribute("maxlength")) || 0;
    if (max && out.length > max) { notice("That would go past the " + max + "-character limit.", "error"); return; }
    ta.value = out; ta.focus();
    try { if (!filled.length) ta.setSelectionRange(start + block.length, start + block.length); else ta.setSelectionRange(start, start + block.length); } catch (_) {}
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const LIST_SVG = {
    ul: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/></svg>',
    ol: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10"/><text x="2.2" y="8.2" font-size="6.5" font-family="Arial" font-weight="700" fill="currentColor" stroke="none">1</text><text x="2.2" y="14.2" font-size="6.5" font-family="Arial" font-weight="700" fill="currentColor" stroke="none">2</text><text x="2.2" y="20.2" font-size="6.5" font-family="Arial" font-weight="700" fill="currentColor" stroke="none">3</text></svg>',
  };
  function formatBar(ta, lists) {
    const b = (mark, label, title, cls) => el("button", { type: "button", class: "nle-fmt " + cls, title, "aria-label": title, disabled: locked(), onmousedown: (e) => e.preventDefault(), onclick: () => toggleMark(ta, mark) }, label);
    ta.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase(); if (k !== "b" && k !== "u") return;
      e.preventDefault(); toggleMark(ta, k === "b" ? "**" : "__");
    });
    const l = (kind, title) => { const x = el("button", { type: "button", class: "nle-fmt nle-fmt--" + kind, title, "aria-label": title, disabled: locked(), onmousedown: (e) => e.preventDefault(), onclick: () => toggleList(ta, kind) }); x.innerHTML = LIST_SVG[kind]; return x; };
    return el("div", { class: "nle-fmtbar", role: "toolbar", "aria-label": "Text formatting" },
      b("**", "B", "Bold (Ctrl+B): wraps the selection in **…**", "nle-fmt--b"),
      b("__", "U", "Underline (Ctrl+U): wraps the selection in __…__", "nle-fmt--u"),
      ...(lists ? [el("span", { class: "nle-fmt-sep", "aria-hidden": "true" }), l("ul", "Bulleted list: starts each selected line with “- ”"), l("ol", "Numbered list: starts each selected line with “1. ”, “2. ” …")] : []));
  }
  const field = (label, input, opts) => {
    const o = opts || {};
    const wrap = el("div", { class: "nle-field" });
    const lab = el("label", { class: "nle-label", for: input.id }, label, o.required ? el("span", { class: "req", "aria-hidden": "true" }, " *") : null, o.side || null);
    wrap.append(lab); if (o.format) wrap.append(formatBar(input, o.format !== "inline")); wrap.append(input);
    if (o.help) wrap.append(el("span", { class: "nle-help", id: input.id ? input.id + "-help" : null }, o.help));
    const err = el("span", { class: "nle-error", id: input.id ? input.id + "-err" : null, role: "alert" });
    wrap.append(err);
    if (input.id) input.setAttribute("aria-describedby", [o.help ? input.id + "-help" : "", input.id + "-err"].filter(Boolean).join(" "));
    wrap.setError = (t) => { err.textContent = t || ""; input.classList.toggle("is-invalid", !!t); input.setAttribute("aria-invalid", t ? "true" : "false"); };
    return wrap;
  };
  const control = (tag, attrs) => { const n = el(tag, Object.assign({ class: tag === "select" ? "nle-select" : tag === "textarea" ? "nle-textarea" : "nle-input" }, attrs)); if (locked()) n.disabled = true; return n; };
  const btn = (label, cls, fn, attrs) => el("button", Object.assign({ type: "button", class: "nle-btn " + (cls || ""), onclick: fn }, attrs || {}), label);
  const iconBtn = (path, label, fn, attrs) => el("button", Object.assign({ type: "button", class: "nle-icon", "aria-label": label, title: label, onclick: fn }, attrs || {}), svg(path));
  // Brand-kit colors offered beside every color field: the chosen theme's palette (event website
  // builder) or ARI's own, plus white and black. Rows repaint when the theme changes.
  const KIT_KEYS = [["primary", "Primary"], ["secondary", "Secondary"], ["accent", "Accent"], ["dark", "Dark"], ["dark2", "Dark 2"], ["heading", "Heading"], ["body", "Body"], ["surface", "Surface"], ["background", "Background"], ["border", "Border"]];
  const ARI_KIT = { primary: "#3cdbc0", secondary: "#072b31", accent: "#0b7a6a", dark: "#072b31", dark2: "#0a343b", heading: "#101820", body: "#54585a", surface: "#eef3f2", background: "#dddddd", border: "#dddddd" };
  // Button width in px as the renderer clamps it (0 = as wide as the label).
  const clampBtnWidth = (v) => { const n = Math.round(Number(v) || 0); return n > 0 ? Math.max(80, Math.min(536, n)) : 0; };
  // Width control for buttons: a select (auto / full width / custom) with a px input for custom. get() → 0 | "full" | px.
  const widthControl = (id, get, set, autoLabel) => {
    const sel = control("select", { id }); [["", autoLabel], ["full", "Full width"], ["custom", "Custom (px)"]].forEach(([v, l]) => sel.append(el("option", { value: v }, l)));
    const num = control("input", { type: "number", id: id + "_px", min: "80", max: "536", step: "8", inputmode: "numeric", placeholder: "80–536", "aria-label": "Width in pixels", class: "nle-input nle-width-px" });
    const cur = get(); sel.value = cur === "full" ? "full" : cur ? "custom" : ""; num.value = cur && cur !== "full" ? String(cur) : ""; num.hidden = sel.value !== "custom";
    sel.addEventListener("change", () => { num.hidden = sel.value !== "custom"; if (sel.value === "full") set("full"); else if (!sel.value) set(0); else { if (!clampBtnWidth(num.value)) num.value = "240"; set(clampBtnWidth(num.value)); num.focus(); } });
    num.addEventListener("input", () => set(clampBtnWidth(num.value)));
    num.addEventListener("change", () => { const w = clampBtnWidth(num.value); num.value = w ? String(w) : ""; if (!w) { sel.value = ""; num.hidden = true; set(0); } });
    const f = field("Width", sel); sel.after(num); return f;
  };
  const hex6 = (v) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v || "").trim()); if (!m) return ""; const h = m[1].toLowerCase(); return "#" + (h.length === 3 ? h.split("").map((x) => x + x).join("") : h); };
  function kitColors() {
    const t = (st.themes || []).find((x) => x.id === d.content.theme_id);
    const c = t ? (t.configuration || {}) : ARI_KIT;
    const out = [], seen = new Set();
    const push = (v, label) => { const h = hex6(v); if (!h || seen.has(h)) return; seen.add(h); out.push({ hex: h, label }); };
    KIT_KEYS.forEach(([k, l]) => push(c[k], l)); push("#ffffff", "White"); push("#0b1410", "Black");
    return out;
  }
  const kitRows = new Set();
  function kitChips(get, set, what) {
    const row = el("div", { class: "nle-chips", role: "group", "aria-label": "Brand kit colors for " + what });
    row.paint = () => {
      row.innerHTML = ""; row.append(el("span", { class: "nle-chips-cap" }, "Brand kit"));
      const cur = hex6(get());
      kitColors().forEach((c) => row.append(el("button", { type: "button", class: "nle-chip" + (c.hex === cur ? " is-on" : ""), title: c.label + " " + c.hex, "aria-label": c.label + " " + c.hex, "aria-pressed": c.hex === cur ? "true" : "false", "data-hex": c.hex, style: "background:" + c.hex, disabled: locked(), onclick: () => set(c.hex) })));
    };
    row.paint(); kitRows.add(row); return row;
  }
  function repaintKits() { kitRows.forEach((r) => { if (r.isConnected) r.paint(); else kitRows.delete(r); }); }

  // ---------------- state ----------------
  const E = { sel: null, view: remember("nle-view") === "mobile" || (isPhone() && remember("nle-view") !== "desktop") ? "mobile" : "desktop", tab: remember("nle-tab") === "design" ? "design" : "blocks", pick: null, lib: false, insp: false, lastSaved: "", saveState: r ? "saved" : "new", saveText: "", busy: false, warnings: [], rows: [], frameReady: false, paintTimer: null, savedAt: null, dirtyAnnounced: false };
  // Snapshot for dirty tracking: the payload minus derived data (logo measurements).
  const snapshot = () => { const p = isTpl ? model.templatePayload() : model.payload(); const c = Object.assign({}, p.content, { appearance: Object.assign({}, p.content.appearance) }); delete c.appearance.logoMeta; return JSON.stringify(Object.assign({}, p, { content: c })); };
  E.lastSaved = snapshot();
  const isDirty = () => snapshot() !== E.lastSaved;

  // ---------------- DOM skeleton ----------------
  const root = el("div", { class: "nle" + (locked() ? " is-locked" : ""), id: "nle" });
  const live = el("div", { class: "sr-only", "aria-live": "polite", id: "nleLive" });
  const head = el("div", { class: "nle-head", id: "nleHead" });
  const lib = el("aside", { class: "nle-side nle-lib", id: "nleLib", "aria-label": isTpl ? "Template blocks and design" : "Blocks and design" });
  const canvas = el("div", { class: "nle-canvas", id: "nleCanvas" });
  const insp = el("aside", { class: "nle-side nle-insp", id: "nleInsp", "aria-label": "Settings" });
  const scrim = el("div", { class: "nle-scrim", hidden: true, onclick: () => closeDrawers() });
  const bodyEl = el("div", { class: "nle-body" }, lib, canvas, insp);
  root.append(live, head, bodyEl, scrim);
  host.append(root);
  if (panel) panel.classList.add("is-nle");

  // ---------------- data for the renderer ----------------
  st.refs = st.refs || { posts: new Map(), events: new Map(), pending: new Set() };
  const themeFor = (id) => { const t = (st.themes || []).find((x) => x.id === id); if (!t) return null; const init = t.initiative; return { name: t.name, configuration: t.configuration || null, logo: init && init.logo_image ? { url: String(init.logo_image), alt: String(init.name || t.name || "") } : null }; };
  function campaign() {
    return normalizeCampaign({ title: d.title || (isTpl ? "Untitled template" : "Untitled campaign"), subject: d.subject, preview_text: d.preview_text, from_name: d.from_name, template: d.template, content: { heading: d.content.heading, intro: d.content.intro, closing: d.content.closing, blocks: d.content.blocks, appearance: d.content.appearance } }, false);
  }
  /** Rows the renderer needs for the referenced posts and events; fetched once per id. */
  async function ensureRefs() {
    const want = { posts: [], events: [] };
    d.content.blocks.forEach((b) => { if ((b.type === "post" || b.type === "event") && b.id && !st.refs[b.type + "s"].has(b.id) && !st.refs.pending.has(b.type + ":" + b.id)) want[b.type + "s"].push(b.id); });
    if (!want.posts.length && !want.events.length) return false;
    want.posts.forEach((id) => st.refs.pending.add("post:" + id)); want.events.forEach((id) => st.refs.pending.add("event:" + id));
    const [p, e] = await Promise.all([
      want.posts.length ? supabase.from("posts").select("id, title, category, summary, body, link, cover_image, published_at, published").in("id", want.posts) : null,
      want.events.length ? supabase.from("events").select("id, title, event_type, start_date, end_date, location, description, register_url, time, cta_label, platform, published").in("id", want.events) : null,
    ]);
    ((p && p.data) || []).forEach((x) => st.refs.posts.set(x.id, x));
    ((e && e.data) || []).forEach((x) => st.refs.events.set(x.id, x));
    want.posts.forEach((id) => st.refs.pending.delete("post:" + id)); want.events.forEach((id) => st.refs.pending.delete("event:" + id));
    return true;
  }
  function renderEmail(editor) {
    const c = campaign();
    const theme = themeFor(d.content.theme_id);
    // Posts/events picked from the lists but not yet loaded in full render from the list rows (title, dates) until the full row arrives.
    const posts = new Map(st.refs.posts), events = new Map(st.refs.events);
    (st.posts || []).forEach((x) => { if (!posts.has(x.id)) posts.set(x.id, x); });
    (st.events || []).forEach((x) => { if (!events.has(x.id)) events.set(x.id, x); });
    return renderCampaign(c, posts, events, theme, editor ? { editor: true } : undefined);
  }
  /* PDF preview: the exact email that will be sent (same renderer, no editor markers) in a hidden frame,
     handed to the browser's print dialog, where "Save as PDF" writes the file. Mailchimp fills its merge
     tags (*|UNSUB|* …) only when sending, so they are blanked here. The document title becomes the file name. */
  /* Copy HTML: the full email document exactly as it will be sent (same renderer, no editor markers).
     Mailchimp's merge tags (*|UNSUB|* …) stay in, since Mailchimp fills them when it sends. */
  async function copyHtml() {
    let html;
    try { html = String(renderEmail(false).html || ""); } catch (e) { notice("Couldn’t build the HTML: " + ((e && e.message) || e), "error"); return; }
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(html); ok = true; } } catch (_) { ok = false; }
    if (!ok) {
      // Older browsers / non-secure pages: copy through a hidden text box.
      const ta = el("textarea", { "aria-hidden": "true", style: "position:fixed;left:-10000px;top:0;width:10px;height:10px;opacity:0;" });
      ta.value = html; document.body.append(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
      ta.remove();
    }
    model.lastCopiedHtml = ok ? html : null;
    notice(ok ? "Email HTML copied (" + Math.round(html.length / 1024) + " KB). Mailchimp tags like *|UNSUB|* are filled in only when Mailchimp sends it." : "Your browser blocked copying. Use Download PDF, or try again.", ok ? "ok" : "error", 7000);
  }
  function downloadPdf() {
    let out;
    try { out = renderEmail(false); } catch (e) { notice("Couldn’t build the preview: " + ((e && e.message) || e), "error"); return; }
    const name = ((d.title || d.subject || (isTpl ? "Template" : "Campaign")).trim() || "Email").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120);
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    let html = String(out.html || "")
      .replace(/href="\*\|[A-Z0-9_:]+\|\*"/g, 'href="#"')
      .replace(/\*\|[A-Z0-9_:]+\|\*/g, "");
    const printCss = "<style>@page{size:auto;margin:8mm}html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>";
    html = /<title>[\s\S]*?<\/title>/i.test(html) ? html.replace(/<title>[\s\S]*?<\/title>/i, "<title>" + esc(name) + "</title>") : html.replace(/<head[^>]*>/i, (m) => m + "<title>" + esc(name) + "</title>");
    html = html.replace(/<\/head>/i, printCss + "</head>");
    const old = document.getElementById("nlePdfFrame"); if (old) old.remove();
    const frame = el("iframe", { id: "nlePdfFrame", title: "PDF preview", "aria-hidden": "true", tabindex: "-1", style: "position:fixed;left:-10000px;top:0;width:720px;height:1000px;border:0;visibility:hidden;" });
    document.body.append(frame);
    const doc = frame.contentDocument; doc.open(); doc.write(html); doc.close();
    const outerTitle = document.title;
    const go = () => {
      // Some browsers name the PDF after the top page's title, so borrow it for the moment of printing.
      document.title = name;
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { notice("Your browser blocked printing. Try again, or use Send test.", "error"); }
      setTimeout(() => { document.title = outerTitle; }, 1000);
    };
    const imgs = [...doc.images].filter((i) => !i.complete);
    notice("Choose “Save as PDF” as the destination to download the preview.", "ok", 6000);
    if (!imgs.length) setTimeout(go, 100);
    else { let left = imgs.length; const done = () => { if (--left <= 0) go(); }; imgs.forEach((i) => { i.addEventListener("load", done, { once: true }); i.addEventListener("error", done, { once: true }); }); setTimeout(() => { if (left > 0) { left = 0; go(); } }, 4000); }
    model.lastPdf = { name, html };
  }

  // ---------------- canvas ----------------
  const views = el("div", { class: "nle-views", role: "radiogroup", "aria-label": "Preview width" });
  const viewBtn = (v, label, path, px) => { const b = el("button", { type: "button", class: "nle-view", role: "radio", "aria-checked": E.view === v ? "true" : "false", onclick: () => setView(v) }, svg(path), label, el("small", null, " · " + px + "px")); views.append(b); return b; };
  const desktopBtn = viewBtn("desktop", "Desktop", ICON.desktop, 640), mobileBtn = viewBtn("mobile", "Mobile", ICON.mobile, 375);
  views.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setView(E.view === "desktop" ? "mobile" : "desktop"); (E.view === "desktop" ? desktopBtn : mobileBtn).focus(); } });
  const checksBtn = el("button", { type: "button", class: "nle-checks-btn", id: "nleChecks", onclick: () => { select(null); openInsp(); const c = document.getElementById("nleChecksList"); if (c) c.scrollIntoView({ block: "nearest" }); } });
  const addBlockNarrow = btn([svg(ICON.blocks), "Add block"], "nle-btn--sm nle-only-narrow", () => openLib(), { id: "nleAddNarrow" });
  const canvasBar = el("div", { class: "nle-canvas-bar" }, views, addBlockNarrow, el("span", { class: "nle-canvas-status" }, checksBtn));
  const frame = el("iframe", { class: "nle-frame", id: "nlpFrame", title: "Email preview", sandbox: "allow-same-origin", tabindex: "-1", "aria-hidden": "true" });
  try { frame.inert = true; } catch (_) {}
  const overlay = el("div", { class: "nle-overlay", id: "nleOverlay" });
  // Row targets: one focusable, transparent element per email section (listbox semantics).
  const rowsEl = el("div", { class: "nle-rows", id: "nleRows", role: "listbox", "aria-label": "Email sections. Use the arrow keys to move between them." });
  const selTag = el("span", { class: "nle-sel-tag", "aria-hidden": "true", hidden: true });
  const tool = el("div", { class: "nle-tool", id: "nleTool", hidden: true, role: "toolbar", "aria-label": "Block actions" });
  const zonesEl = el("div", { class: "nle-zones" });
  const pop = el("div", { class: "nle-pop", id: "nlePop", hidden: true, role: "dialog", "aria-label": "Add a block" });
  overlay.append(rowsEl);
  const chrome = el("div", { class: "nle-chrome", id: "nleChrome" }, selTag, tool, zonesEl, pop);
  const scaler = el("div", { class: "nle-scaler" }, frame, el("div", { class: "nle-frame-shadow", "aria-hidden": "true" }), overlay);
  const paper = el("div", { class: "nle-paper" + (E.view === "mobile" ? " is-mobile" : ""), id: "nlePaper" }, scaler, chrome);
  const stage = el("div", { class: "nle-stage" }, paper);
  canvas.append(canvasBar, stage);
  E.scale = 1;
  const EMAIL_W = { desktop: 640, mobile: 375 };

  function setView(v) {
    E.view = v; remember("nle-view", v);
    desktopBtn.setAttribute("aria-checked", v === "desktop" ? "true" : "false"); mobileBtn.setAttribute("aria-checked", v === "mobile" ? "true" : "false");
    paper.classList.toggle("is-mobile", v === "mobile");
    fitPaper(); sizeFrame(); setTimeout(() => { fitPaper(); sizeFrame(); }, 230);
  }
  /** Scale the paper down when the column cannot fit the email at its real width. */
  function fitPaper() {
    const avail = stage.clientWidth - (isPhone() ? 16 : 48);
    const w = EMAIL_W[E.view];
    const scale = avail > 0 && avail < w ? Math.max(0.4, avail / w) : 1;
    E.scale = scale;
    paper.style.width = Math.round(w * scale) + "px";
    scaler.style.width = w + "px";
    scaler.style.transform = scale === 1 ? "" : "scale(" + scale + ")";
    paper.style.height = scale === 1 ? "" : Math.round(frame.offsetHeight * scale) + "px";
    canvasBar.querySelector(".nle-scale-note") && canvasBar.querySelector(".nle-scale-note").remove();
    if (scale < 1) canvasBar.querySelector(".nle-canvas-status").prepend(el("span", { class: "nle-scale-note nle-hide-sm" }, "Shown at " + Math.round(scale * 100) + "%"));
  }
  let paintSeq = 0;
  function paintNow() {
    const out = renderEmail(true);
    E.warnings = out.warnings || [];
    st.preview = { html: out.html, warnings: E.warnings, subject: d.subject };
    const seq = ++paintSeq;
    const doc = frame.contentDocument;
    if (E.frameReady && doc && doc.body) {
      // Swap the document's contents in place (no reload, no flicker, images stay cached).
      const next = new DOMParser().parseFromString(out.html, "text/html");
      if (doc.head.innerHTML !== next.head.innerHTML) doc.head.innerHTML = next.head.innerHTML;
      doc.body.setAttribute("style", next.body.getAttribute("style") || "");
      doc.body.innerHTML = next.body.innerHTML;
      afterPaint(doc, seq);
    } else {
      frame.srcdoc = out.html;
    }
    paintChecks();
  }
  function afterPaint(doc, seq) {
    doc.querySelectorAll("img").forEach((im) => { if (!im.complete) im.addEventListener("load", () => { if (seq === paintSeq) sizeFrame(); }, { once: true }); });
    sizeFrame();
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => { if (seq === paintSeq) sizeFrame(); }).catch(() => {});
  }
  frame.addEventListener("load", () => {
    const doc = frame.contentDocument; if (!doc) return;
    E.frameReady = true;
    if (typeof ResizeObserver === "function") { try { const ro = new ResizeObserver(() => sizeFrame()); ro.observe(doc.body); } catch (_) {} }
    afterPaint(doc, paintSeq);
  });
  function schedulePaint() { clearTimeout(E.paintTimer); E.paintTimer = setTimeout(() => { E.paintTimer = null; paintNow(); }, 200); }
  function sizeFrame() {
    const doc = frame.contentDocument; if (!doc || !doc.body) return;
    const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 200);
    if (Math.abs(parseFloat(frame.style.height || "0") - h) > 1) frame.style.height = h + "px";
    if (E.scale !== 1) paper.style.height = Math.round(h * E.scale) + "px";
    relayout();
  }
  const rowRect = (row) => { const b = row.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height }; };
  function rowsNow() {
    const doc = frame.contentDocument; if (!doc || !doc.body) return [];
    return [...doc.querySelectorAll("[data-nl]")].map((n) => ({ key: n.getAttribute("data-nl"), rect: rowRect(n), empty: n.hasAttribute("data-nl-empty") }));
  }
  function relayout() {
    E.rows = rowsNow();
    const byKey = Object.fromEntries(E.rows.map((x) => [x.key, x]));
    // One target per row: position, name, selected state, roving tabindex.
    const focused = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("nle-row") ? document.activeElement.dataset.key : null;
    const existing = new Map([...rowsEl.children].map((n) => [n.dataset.key, n]));
    const keep = new Set();
    E.rows.forEach((x) => {
      let n = existing.get(x.key);
      if (!n) { n = el("div", { class: "nle-row", role: "option", "data-key": x.key }); n.addEventListener("click", (e) => { e.preventDefault(); select(x.key, { fromCanvas: true }); }); n.addEventListener("keydown", onKey); n.addEventListener("focus", () => { if (!E.quietFocus && E.sel !== n.dataset.key) select(n.dataset.key, { quiet: true, fromKeyboard: true }); }); rowsEl.append(n); }
      keep.add(x.key);
      n.style.top = x.rect.top + "px"; n.style.height = x.rect.height + "px";
      const selected = E.sel === x.key;
      n.setAttribute("aria-selected", selected ? "true" : "false");
      n.setAttribute("aria-label", selName(x.key) + (x.empty ? " (empty)" : "") + (selected ? ". Selected" : ""));
      n.tabIndex = selected || (!E.sel && x.key === "header") ? 0 : -1;
    });
    existing.forEach((n, k) => { if (!keep.has(k)) n.remove(); });
    if (focused && E.sel && focused !== E.sel) { const n = rowsEl.querySelector('.nle-row[data-key="' + E.sel + '"]'); if (n) n.focus({ preventScroll: true }); }
    // Selection tag + block toolbar
    const s = E.sel && byKey[E.sel];
    const k = E.scale || 1;   // the chrome layer is not scaled; the rows are
    if (s) {
      const first = s.rect.top < 24;
      selTag.hidden = false; selTag.style.top = (s.rect.top * k) + "px"; selTag.textContent = selName(E.sel); selTag.classList.toggle("is-first", first);
      const isBlock = /^block:/.test(E.sel);
      tool.hidden = !isBlock || locked();
      if (!tool.hidden) { tool.style.top = (s.rect.top * k) + "px"; tool.classList.toggle("is-first", first); const bb = d.content.blocks[Number(E.sel.slice(6))]; const dup = tool.querySelector("#nleDup"); if (dup) dup.disabled = !!(bb && (bb.type === "post" || bb.type === "event")); placeToolbar(); }
    } else { selTag.hidden = true; tool.hidden = true; }
    // Insertion zones: before block 0 (after the lead), after each block.
    zonesEl.innerHTML = "";
    const blocks = E.rows.filter((x) => /^block:/.test(x.key));
    const lead = byKey.lead, closing = byKey.closing, footer = byKey.footer;
    const bounds = [];
    const topOf = (i) => (i < blocks.length ? blocks[i].rect.top : closing ? closing.rect.top : footer ? footer.rect.top : (lead ? lead.rect.bottom : 0));
    for (let i = 0; i <= blocks.length; i++) {
      const prevBottom = i === 0 ? (lead ? lead.rect.bottom : 0) : blocks[i - 1].rect.bottom;
      bounds.push({ at: i, y: (prevBottom + topOf(i)) / 2 });
    }
    E.bounds = bounds;
    if (locked()) return;
    const selIdx = E.sel && /^block:/.test(E.sel) ? Number(E.sel.slice(6)) : -1;
    bounds.forEach((bd, zi) => {
      const last = zi === bounds.length - 1;
      const z = el("div", { class: "nle-zone" + (last && !blocks.length ? " is-shown" : "") + (bd.at === selIdx + 1 && selIdx >= 0 ? " is-shown" : ""), style: "top:" + (bd.y * k) + "px", "data-at": String(bd.at) });
      const b = el("button", { type: "button", class: "nle-zone-btn", "aria-label": "Add a block here (position " + (bd.at + 1) + ")", onclick: (e) => openPop(bd.at, e.currentTarget) }, svg(ICON.plus), last ? "Add block" : null);
      z.append(el("span", { class: "nle-zone-line", "aria-hidden": "true" }), b);
      zonesEl.append(z);
    });
    // Empty state: the "Add block" control stays visible and the canvas bar says what to do.
    const hint = canvasBar.querySelector(".nle-empty-hint");
    if (!blocks.length && !locked()) { if (!hint) canvasBar.querySelector(".nle-canvas-status").prepend(el("span", { class: "nle-empty-hint nle-hide-sm", id: "nleEmptyHint" }, "No content yet: add a block from the library, or use + below the headline.")); }
    else if (hint) hint.remove();
  }
  /** Keep the toolbar reachable: when its usual spot (above the row) is hidden under the sticky bars, put it inside the row. */
  function placeToolbar() {
    if (tool.hidden || tool.classList.contains("is-first")) return;
    const sc = document.querySelector(".p-main"); if (!sc) return;
    const limit = sc.getBoundingClientRect().top + head.offsetHeight + canvasBar.offsetHeight;
    const rowTop = paper.getBoundingClientRect().top + parseFloat(tool.style.top || "0");
    tool.classList.toggle("is-inside", rowTop - 44 < limit);
  }
  const selName = (key) => key === "header" ? "Header" : key === "lead" ? "Headline and intro" : key === "closing" ? "Closing" : key === "footer" ? "Footer" : /^block:/.test(key) ? (d.content.blocks[Number(key.slice(6))] ? blockName(d.content.blocks[Number(key.slice(6))], Number(key.slice(6)), d.content.blocks) : "Block") : "";
  function select(key, opts) {
    const o = opts || {};
    if (key && /^block:/.test(key) && !d.content.blocks[Number(key.slice(6))]) key = null;
    const was = E.sel;
    E.sel = key; E.pick = null;
    relayout(); renderInspector();
    if (key && o.fromCanvas && isNarrow()) openInsp();
    if (key && (o.focus || (!o.fromCanvas && !o.quiet && !o.fromKeyboard))) { const n = rowsEl.querySelector('.nle-row[data-key="' + key + '"]'); if (n) { try { n.focus({ preventScroll: true }); } catch (_) {} } }
    if (key && (o.scroll || o.fromKeyboard)) { const row = E.rows.find((x) => x.key === key); if (row) { const top = paper.getBoundingClientRect().top + row.rect.top * E.scale; const sc = document.querySelector(".p-main"); if (sc) { const r2 = sc.getBoundingClientRect(); const lim = r2.top + head.offsetHeight + canvasBar.offsetHeight + 48; if (top < lim || top > r2.bottom - 120) sc.scrollBy({ top: top - lim, behavior: "smooth" }); } } }
    if (key && was !== key && !o.fromKeyboard && !o.fromCanvas && !o.quiet) announce(selName(key) + " selected.");
  }
  const ORDER = () => ["header", "lead", ...d.content.blocks.map((_, i) => "block:" + i), "closing", "footer"];
  function onKey(e) {
    const order = ORDER();
    const cur = E.sel || (e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : null);
    const i = order.indexOf(cur);
    const isBlock = /^block:/.test(cur || ""), bi = isBlock ? Number(cur.slice(6)) : -1;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (E.sel) { select(null); const n = rowsEl.querySelector(".nle-row"); if (n) { E.quietFocus = true; n.focus({ preventScroll: true }); E.quietFocus = false; } } return; }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && isBlock && !locked()) { e.preventDefault(); moveBlock(bi, e.key === "ArrowUp" ? -1 : 1); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Home" || e.key === "End") { e.preventDefault(); const j = e.key === "Home" ? 0 : e.key === "End" ? order.length - 1 : e.key === "ArrowUp" ? Math.max(0, i - 1) : Math.min(order.length - 1, i + 1); select(order[j], { fromKeyboard: true, focus: true }); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && isBlock && !locked()) { e.preventDefault(); removeBlock(bi); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D") && isBlock && !locked()) { e.preventDefault(); duplicateBlock(bi); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!E.sel) select(cur, { quiet: true }); openInsp(); const f = insp.querySelector("input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button.nle-pick, button.nle-btn"); if (f) f.focus(); }
  }
  // Block toolbar
  const grip = el("button", { type: "button", class: "nle-icon nle-grip", "aria-label": "Drag to move (or use Move up / Move down)", title: "Drag to move" }, svg(ICON.grip));
  tool.append(grip,
    iconBtn(ICON.up, "Move up (Alt+Up)", () => E.sel && moveBlock(Number(E.sel.slice(6)), -1), { id: "nleUp", "aria-keyshortcuts": "Alt+ArrowUp" }),
    iconBtn(ICON.down, "Move down (Alt+Down)", () => E.sel && moveBlock(Number(E.sel.slice(6)), 1), { id: "nleDown", "aria-keyshortcuts": "Alt+ArrowDown" }),
    iconBtn(ICON.dup, "Duplicate (Ctrl+D)", () => E.sel && duplicateBlock(Number(E.sel.slice(6))), { id: "nleDup", "aria-keyshortcuts": "Control+D" }),
    iconBtn(ICON.del, "Remove (Delete)", () => E.sel && removeBlock(Number(E.sel.slice(6))), { id: "nleRemove", class: "nle-icon nle-icon--danger", "aria-keyshortcuts": "Delete" }),
    iconBtn(ICON.settings, "Edit settings", () => openInsp(), { id: "nleEditNarrow", class: "nle-icon nle-only-narrow" }));

  // ---------------- block operations ----------------
  const announce = (t) => { live.textContent = ""; setTimeout(() => { live.textContent = t; }, 30); };
  function changed(opts) { refreshSaveState(); schedulePaint(); if (!(opts && opts.keepInspector)) renderInspector(); }
  function insertBlock(b, at) {
    const i = at == null ? d.content.blocks.length : Math.max(0, Math.min(d.content.blocks.length, at));
    d.content.blocks.splice(i, 0, b);
    paintNow(); refreshSaveState();
    select("block:" + i, { quiet: true, scroll: true });
    announce(BLOCK_LABEL[b.type] + " added at position " + (i + 1) + ".");
    if (isNarrow()) openInsp();
    const f = insp.querySelector("input:not([disabled]), textarea:not([disabled]), select:not([disabled])"); if (f) f.focus({ preventScroll: true });
    ensureRefs().then((got) => { if (got) paintNow(); });
  }
  // Where a library click lands: after the selected block; at the top when the
  // header or lead is selected; at the end otherwise.
  const insertAt = () => (E.sel && /^block:/.test(E.sel) ? Number(E.sel.slice(6)) + 1 : (E.sel === "header" || E.sel === "lead") ? 0 : d.content.blocks.length);
  function addBlock(type, at) {
    if (locked()) return;
    if (isPhone()) closeDrawers();   // the library sheet gives way to the inspector
    const pos = at != null ? at : insertAt();
    if (type === "post" || type === "event") { closeDrawers(); E.pick = { kind: type, at: pos }; E.sel = null; relayout(); renderInspector(); openInsp(); return; }
    insertBlock(blankBlock(type), pos);
  }
  function moveBlock(i, dir) {
    const j = i + dir; if (j < 0 || j >= d.content.blocks.length) return;
    const b = d.content.blocks; [b[i], b[j]] = [b[j], b[i]];
    const keepFocus = document.activeElement && (tool.contains(document.activeElement) || rowsEl.contains(document.activeElement));
    E.sel = "block:" + j; paintNow(); refreshSaveState(); renderInspector();
    announce(BLOCK_LABEL[b[j].type] + " moved " + (dir < 0 ? "up" : "down") + ", now " + (j + 1) + " of " + b.length + ".");
    if (keepFocus && rowsEl.contains(document.activeElement) === false) { const t = tool.querySelector(dir < 0 ? "#nleUp" : "#nleDown"); if (t && !t.disabled) t.focus({ preventScroll: true }); }
  }
  function moveBlockTo(from, at) {
    const to = at > from ? at - 1 : at;
    if (to === from) return;
    const [b] = d.content.blocks.splice(from, 1); d.content.blocks.splice(to, 0, b);
    E.sel = "block:" + to; paintNow(); refreshSaveState(); renderInspector();
    announce(BLOCK_LABEL[b.type] + " moved to position " + (to + 1) + ".");
  }
  function duplicateBlock(i) {
    const b = d.content.blocks[i]; if (!b) return;
    if (b.type === "post" || b.type === "event") { announce("A post or event can appear once; add another from the library."); return; }
    d.content.blocks.splice(i + 1, 0, JSON.parse(JSON.stringify(b)));
    E.sel = "block:" + (i + 1); paintNow(); refreshSaveState(); renderInspector();
    announce(BLOCK_LABEL[b.type] + " duplicated.");
  }
  async function removeBlock(i) {
    const b = d.content.blocks[i]; if (!b) return;
    if (hasContent(b)) { const ok = await confirmDialog({ kicker: "Remove block", title: "Remove this " + BLOCK_LABEL[b.type].toLowerCase() + "?", body: "There is no undo; you can add it again from the library.", confirmLabel: "Remove", danger: true }); if (!ok) return; }
    d.content.blocks.splice(i, 1);
    const next = d.content.blocks.length ? "block:" + Math.min(i, d.content.blocks.length - 1) : "lead";
    E.sel = next; paintNow(); refreshSaveState(); renderInspector();
    announce(BLOCK_LABEL[b.type] + " removed. " + selName(next) + " selected.");
    const n = rowsEl.querySelector('.nle-row[data-key="' + next + '"]'); if (n) setTimeout(() => n.focus({ preventScroll: true }), 0);
  }

  // "+" popover with the block tiles at an insertion point.
  function openPop(at, opener) {
    pop.innerHTML = "";
    const y = (E.bounds.find((b) => b.at === at) || { y: 0 }).y * (E.scale || 1);
    pop.style.top = (y + 14) + "px"; pop.style.left = "50%"; pop.style.transform = "translateX(-50%)";
    const close = () => { pop.hidden = true; document.removeEventListener("pointerdown", outside, true); if (opener && opener.isConnected) opener.focus(); };
    const outside = (e) => { if (!pop.contains(e.target)) close(); };
    pop.append(el("div", { class: "nle-pop-head" }, "Add a block", iconBtn(ICON.close, "Close", close)));
    const tiles = el("div", { class: "nle-tiles" });
    BLOCKS.forEach(([type, label, desc, path]) => tiles.append(el("button", { type: "button", class: "nle-tile", title: desc, onclick: () => { close(); addBlock(type, at); } }, svg(path), label)));
    pop.append(tiles);
    pop.hidden = false;
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    const f = tiles.querySelector("button"); if (f) f.focus();
  }

  // ---------------- drag: library tile → canvas, toolbar grip → new position ----------------
  let drag = null;
  function nearestBound(clientY) {
    const pr = paper.getBoundingClientRect(); const y = (clientY - pr.top) / (E.scale || 1);
    let best = null; (E.bounds || []).forEach((b) => { const dist = Math.abs(b.y - y); if (!best || dist < best.dist) best = { at: b.at, dist }; });
    const inside = clientY >= pr.top - 40 && clientY <= pr.bottom + 40 && (drag && drag.x >= pr.left - 80 && drag.x <= pr.right + 80);
    return inside && best ? best.at : null;
  }
  function markDrop(at) { zonesEl.querySelectorAll(".nle-zone").forEach((z) => z.classList.toggle("is-drop", at != null && Number(z.dataset.at) === at)); }
  function pressable(node, spec) {
    node.addEventListener("pointerdown", (e) => { if (locked() || e.button !== 0) return; drag = Object.assign({ x0: e.clientX, y0: e.clientY, x: e.clientX, moved: false, ghost: null, pointerId: e.pointerId, el: node, at: null }, spec); try { node.setPointerCapture(e.pointerId); } catch (_) {} });
    node.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag.x = e.clientX;
      if (!drag.moved) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return; drag.moved = true; drag.ghost = el("div", { class: "nle-ghost" }, drag.kind === "move" ? "Move: " + drag.label : "Add: " + drag.label); document.body.append(drag.ghost); document.body.classList.add("nle-dragging"); if (isPhone()) closeDrawers(); }
      e.preventDefault();
      drag.ghost.style.transform = "translate(" + (e.clientX + 12) + "px," + (e.clientY + 12) + "px)";
      const sc = document.querySelector(".p-main"); if (sc) { const r2 = sc.getBoundingClientRect(); if (e.clientY < r2.top + 56) sc.scrollTop -= 14; else if (e.clientY > r2.bottom - 56) sc.scrollTop += 14; }
      drag.at = nearestBound(e.clientY); markDrop(drag.at);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d0 = drag; drag = null;
      try { node.releasePointerCapture(e.pointerId); } catch (_) {}
      document.body.classList.remove("nle-dragging"); if (d0.ghost) d0.ghost.remove(); markDrop(null);
      if (!d0.moved) return;
      node.dataset.suppressClick = "1"; setTimeout(() => { delete node.dataset.suppressClick; }, 0);
      if (d0.at == null) return;
      if (d0.kind === "new") addBlock(d0.type, d0.at); else moveBlockTo(d0.from(), d0.at);
    };
    node.addEventListener("pointerup", end); node.addEventListener("pointercancel", end);
    node.addEventListener("click", (e) => { if (node.dataset.suppressClick) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    return node;
  }
  pressable(grip, { kind: "move", from: () => Number(E.sel.slice(6)), label: "block" });

  // ---------------- left: library ----------------
  const tabs = el("div", { class: "nle-tabs", role: "tablist", "aria-label": "Library" });
  const tabBtn = (key, label) => el("button", { type: "button", class: "nle-tab", role: "tab", id: "nleTab-" + key, "aria-selected": E.tab === key ? "true" : "false", "aria-controls": "nlePanel-" + key, onclick: () => setTab(key) }, label);
  const blocksTab = tabBtn("blocks", "Blocks"), designTab = tabBtn("design", "Design");
  tabs.append(blocksTab, designTab);
  const blocksPanel = el("div", { class: "nle-tabpanel", id: "nlePanel-blocks", role: "tabpanel", "aria-labelledby": "nleTab-blocks", hidden: E.tab !== "blocks" });
  const designPanel = el("div", { class: "nle-tabpanel", id: "nlePanel-design", role: "tabpanel", "aria-labelledby": "nleTab-design", hidden: E.tab !== "design" });
  const tiles = el("div", { class: "nle-tiles", role: "list" });
  BLOCKS.forEach(([type, label, desc, path]) => {
    const t = el("button", { type: "button", role: "listitem", class: "nle-tile", id: "nlpAdd" + type.charAt(0).toUpperCase() + type.slice(1), title: desc + " Click to add, or drag onto the email.", disabled: locked(), onclick: () => addBlock(type) }, svg(path), label);
    pressable(t, { kind: "new", type, label });
    tiles.append(t);
  });
  blocksPanel.append(tiles, el("p", { class: "nle-lib-help" }, "Click to add after the selected block, or drag a tile onto the email."));
  lib.append(el("div", { class: "nle-insp-head" }, el("h2", { class: "nle-side-title" }, "Library"), iconBtn(ICON.close, "Close", () => closeDrawers(), { class: "nle-icon nle-lib-close" })), tabs, blocksPanel, designPanel);
  function setTab(key) { E.tab = key; remember("nle-tab", key); blocksTab.setAttribute("aria-selected", key === "blocks" ? "true" : "false"); designTab.setAttribute("aria-selected", key === "design" ? "true" : "false"); blocksPanel.hidden = key !== "blocks"; designPanel.hidden = key !== "design"; }
  tabs.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const k = E.tab === "blocks" ? "design" : "blocks"; setTab(k); (k === "blocks" ? blocksTab : designTab).focus(); } });

  // Design tab: layout, theme, mode; colors and header logo collapsed.
  const ap = d.content.appearance = Object.assign({ mode: "light", background: "", card: "", logo: "auto", logoPlate: "auto" }, d.content.appearance || {});
  function renderDesign() {
    designPanel.innerHTML = "";
    const tplSel = control("select", { id: "nl_template" });
    Object.entries(model.TEMPLATES).forEach(([v, t]) => tplSel.append(el("option", { value: v }, t.label)));
    tplSel.value = d.template;
    const tplHelp = el("span", { class: "nle-help", id: "nlTplHelp" }, model.TEMPLATES[d.template].desc);
    tplSel.addEventListener("change", () => { d.template = tplSel.value; tplHelp.textContent = model.TEMPLATES[d.template].desc; changed({ keepInspector: true }); });
    const tplField = field("Layout", tplSel); tplField.append(tplHelp);
    const themeSel = control("select", { id: "nl_theme" }); themeSel.append(el("option", { value: "" }, "Proving Ground Capital (default)"), ...(st.themes || []).map((t) => el("option", { value: t.id }, t.name)));
    themeSel.value = (st.themes || []).some((t) => t.id === d.content.theme_id) ? d.content.theme_id : "";
    const swatch = el("span", { class: "nle-swatch", id: "nlSwatch" });
    const paintSwatch = () => { swatch.innerHTML = ""; const t = (st.themes || []).find((x) => x.id === themeSel.value); const c = t ? (t.configuration || {}) : { primary: "#279643", secondary: "#1f3655", accent: "#a8c9ef", dark: "#13201a", surface: "#f3f5f4" }; ["primary", "secondary", "accent", "dark", "surface"].forEach((k) => swatch.append(el("span", { class: "evb-swatch-dot", title: k, style: "background:" + (c[k] || "#ccc") }))); swatch.append(el("span", { class: "evb-swatch-font" }, t ? [c.font_heading, c.font_body].filter(Boolean).join(" / ") : "Arial")); };
    themeSel.addEventListener("change", () => { d.content.theme_id = themeSel.value; paintSwatch(); repaintKits(); syncLogoMeta(); changed({ keepInspector: true }); });
    paintSwatch();
    const themeField = field("Theme", themeSel, { help: "Colors, fonts and logo from the event website builder." }); themeField.insertBefore(swatch, themeField.querySelector(".nle-help"));
    const seg = el("div", { class: "nle-segment", role: "radiogroup", "aria-label": "Mode" });
    ["light", "dark"].forEach((v) => { const i = el("input", { type: "radio", name: "nl_mode", id: "nl_mode_" + v, value: v, disabled: locked() }); i.checked = ap.mode === v; i.addEventListener("change", () => { if (i.checked) { ap.mode = v; paintColors(); changed({ keepInspector: true }); } }); seg.append(el("label", null, i, el("span", null, v === "light" ? "Light email" : "Dark email"))); });
    const modeField = el("div", { class: "nle-field" }, el("span", { class: "nle-label" }, "Mode"), seg, el("span", { class: "nle-help" }, "Dark: deep background, light type."));
    // `optional` keys (text, accent) stay off the draft until set, so an untouched campaign is not "changed".
    const colorField = (key, label, fbLight, fbDark, optional) => {
      const inp = el("input", { type: "color", id: "nl_" + key, disabled: locked(), "aria-label": label });
      const val = el("span", { class: "nle-color-val" });
      const reset = btn("Theme default", "nle-btn--sm", () => { if (optional) delete ap[key]; else ap[key] = ""; paint(); changed({ keepInspector: true }); });
      const chips = kitChips(() => ap[key], (hex) => { ap[key] = hex; paint(); changed({ keepInspector: true }); }, label.toLowerCase());
      function paint() { const custom = !!ap[key]; inp.value = custom ? ap[key] : (ap.mode === "dark" ? fbDark : fbLight); val.textContent = custom ? ap[key] : "Following the theme"; reset.hidden = !custom; chips.paint(); }
      inp.addEventListener("input", () => { ap[key] = inp.value; paint(); changed({ keepInspector: true }); });
      const w = el("div", { class: "nle-field" }, el("label", { class: "nle-label", for: "nl_" + key }, label), el("div", { class: "nle-color" }, inp, val, reset), chips);
      w.paint = paint; paint(); return w;
    };
    const cardC = colorField("card", "Email background", "#ffffff", "#0f1613"), pageC = colorField("background", "Page background", "#f3f5f4", "#050807");
    // Type colors: the fix when a chosen background matches the type. Text = headings and body copy in every item; accent = links and labels.
    const textC = colorField("text", "Text", "#13201a", "#ffffff", true), accentC = colorField("accent", "Links & labels", "#1f3655", "#93d9a4", true);
    textC.append(el("span", { class: "nle-help" }, "Headings and body copy in every item. Pick white or black when the text vanishes into the background."));
    const paintColors = () => { cardC.paint(); pageC.paint(); textC.paint(); accentC.paint(); };
    const colors = el("details", { class: "nle-details", id: "nleColors", open: !!(ap.card || ap.background || ap.text || ap.accent) }, el("summary", null, "Colors"), el("div", { class: "nle-details-body" }, cardC, pageC, textC, accentC));
    const logoSel = control("select", { id: "nl_logo" }); [["auto", "Automatic"], ["pgc-dark", "PGC logo (dark, for light emails)"], ["pgc-mint", "PGC logo (mint, for dark emails)"], ["pgc-mark-dark", "PGC mark (dark)"], ["pgc-mark-mint", "PGC mark (mint)"]].forEach(([v, l]) => logoSel.append(el("option", { value: v }, l)));
    logoSel.value = ap.logo || "auto"; logoSel.addEventListener("change", () => { ap.logo = logoSel.value; changed({ keepInspector: true }); });
    const plateSel = control("select", { id: "nl_plate" }); [["auto", "Automatic"], ["none", "None"], ["dark", "Dark"], ["light", "White"]].forEach(([v, l]) => plateSel.append(el("option", { value: v }, l)));
    plateSel.value = ap.logoPlate || "auto"; plateSel.addEventListener("change", () => { ap.logoPlate = plateSel.value; changed({ keepInspector: true }); });
    const logoDetails = el("details", { class: "nle-details", id: "nleLogo", open: !!((ap.logo && ap.logo !== "auto") || (ap.logoPlate && ap.logoPlate !== "auto")) }, el("summary", null, "Header logo"), el("div", { class: "nle-details-body" }, field("Logo", logoSel, { help: "Automatic: the theme's logo, or ARI to suit the background." }), field("Plate", plateSel, { help: "A panel behind the logo. Automatic adds one only when the logo would vanish." })));
    // Buttons: shape and colors for every button in the email (blocks, featured posts and events).
    // Kept off the draft until something is set, so an untouched campaign is not "changed".
    const bt = Object.assign({ shape: "", color: "", text: "", width: 0 }, ap.button || {});
    const syncBt = () => { if (bt.shape || bt.color || bt.text || bt.width) ap.button = Object.assign({}, bt); else delete ap.button; };
    const shapeSel = control("select", { id: "nl_btn_shape" }); [["", "Pill (theme default)"], ["pill", "Pill"], ["rounded", "Rounded"], ["square", "Square"]].forEach(([v, l]) => shapeSel.append(el("option", { value: v }, l)));
    shapeSel.value = bt.shape || ""; shapeSel.addEventListener("change", () => { bt.shape = shapeSel.value; syncBt(); changed({ keepInspector: true }); });
    const btnColor = (key, labelText, fbLight, fbDark) => {
      const inp = el("input", { type: "color", id: "nl_btn_" + key, disabled: locked(), "aria-label": labelText });
      const val = el("span", { class: "nle-color-val" });
      const reset = btn("Theme default", "nle-btn--sm", () => { bt[key] = ""; syncBt(); paint(); changed({ keepInspector: true }); });
      const chips = kitChips(() => bt[key], (hex) => { bt[key] = hex; syncBt(); paint(); changed({ keepInspector: true }); }, labelText.toLowerCase());
      function paint() { const custom = !!bt[key]; inp.value = custom ? bt[key] : (ap.mode === "dark" ? fbDark : fbLight); val.textContent = custom ? bt[key] : "Following the theme"; reset.hidden = !custom; chips.paint(); }
      inp.addEventListener("input", () => { bt[key] = inp.value; syncBt(); paint(); changed({ keepInspector: true }); });
      const w = el("div", { class: "nle-field" }, el("label", { class: "nle-label", for: inp.id }, labelText), el("div", { class: "nle-color" }, inp, val, reset), chips); w.paint = paint; paint(); return w;
    };
    const btnFill = btnColor("color", "Button color", "#1f3655", "#93d9a4"), btnText = btnColor("text", "Button text", "#ffffff", "#0b1410");
    // Width: as wide as the label, the full content column, or a px value (80–536).
    const widthF = widthControl("nl_btn_width", () => bt.width || 0, (w) => { bt.width = w; syncBt(); changed({ keepInspector: true }); }, "Fits the label");
    const buttons = el("details", { class: "nle-details", id: "nleButtons", open: !!(bt.shape || bt.color || bt.text || bt.width) }, el("summary", null, "Buttons"), el("div", { class: "nle-details-body" }, field("Shape", shapeSel), widthF, btnFill, btnText, el("p", { class: "nle-help" }, "Applies to every button in the email. A button block can override its own style.")));
    designPanel.append(tplField, themeField, modeField, colors, buttons, logoDetails);
  }
  async function syncLogoMeta() {
    const keys = model.themeLogoKeys((st.themes || []).find((x) => x.id === d.content.theme_id));
    const before = JSON.stringify(ap.logoMeta || null);
    const meta = {};
    await Promise.all(keys.map(async (k) => { const m = await model.measureLogo(k); if (m) meta[k] = m; }));
    if (Object.keys(meta).length) ap.logoMeta = meta; else delete ap.logoMeta;
    if (st.draft === d && JSON.stringify(ap.logoMeta || null) !== before) { schedulePaint(); refreshSaveState(); }
  }
  renderDesign();

  // ---------------- right: inspector ----------------
  const bindText = (input, get, set, opts) => { input.value = get() || ""; input.addEventListener("input", () => { set(input.value); changed({ keepInspector: true }); if (opts && opts.after) opts.after(); }); return input; };
  function renderInspector() {
    insp.innerHTML = "";
    const closeBtn = iconBtn(ICON.close, "Close settings", () => closeDrawers(), { class: "nle-icon nle-insp-close" });
    const form = el("form", { class: "nle-form", id: "nlpForm", novalidate: true, onsubmit: (e) => { e.preventDefault(); if (isTpl) saveTemplate(); else save(); } });
    if (E.pick) { renderPicker(form); insp.append(el("div", { class: "nle-insp-head" }, el("h2", { class: "nle-insp-title" }, E.pick.kind === "post" ? "Add a newsroom post" : "Add an event"), closeBtn), form); return; }
    if (!E.sel) { renderCampaignSettings(form); insp.append(el("div", { class: "nle-insp-head" }, el("h2", { class: "nle-insp-title" }, isTpl ? "Template settings" : "Campaign settings"), closeBtn), form); return; }
    const back = btn([svg(ICON.back), "Campaign settings"], "nle-btn--ghost nle-btn--sm", () => select(null), { id: "nleInspBack" });
    insp.append(el("div", { class: "nle-insp-head" }, back, closeBtn), el("h2", { class: "nle-insp-title" }, selName(E.sel)));
    const key = E.sel;
    if (key === "header") {
      renderHeaderSettings(form);
    } else if (key === "lead") {
      const heading = bindText(control("input", { type: "text", id: "nl_heading", maxlength: "200", placeholder: "Defaults to the subject line" }), () => d.content.heading, (v) => (d.content.heading = v));
      const intro = bindText(control("textarea", { id: "nl_intro", rows: "5", placeholder: "A short opening. Blank lines start new paragraphs; links are picked up automatically." }), () => d.content.intro, (v) => (d.content.intro = v));
      form.append(field("Headline", heading), field("Intro", intro, { format: true }));
    } else if (key === "closing") {
      const closing = bindText(control("textarea", { id: "nl_closing", rows: "4", placeholder: "Optional sign-off" }), () => d.content.closing, (v) => (d.content.closing = v));
      form.append(field("Closing", closing, { format: true, help: "Shown after the last block. Leave it empty to skip it." }));
    } else if (key === "footer") {
      renderFooterSettings(form);
    } else if (/^block:/.test(key)) {
      renderBlockSettings(form, Number(key.slice(6)));
    }
    insp.append(form);
  }
  function renderCampaignSettings(form) {
    const banner = st.fromTemplate && !r && !isTpl ? el("p", { class: "nle-note" }, "Started from “" + st.fromTemplate + "”. Give it a name and save.") : null;
    const title = bindText(control("input", { type: "text", id: "nl_title", maxlength: "200", required: true, placeholder: isTpl ? "Monthly digest" : "October digest" }), () => d.title, (v) => (d.title = v), { after: () => { const n = document.getElementById("nleName"); if (n && n.value !== d.title) n.value = d.title; } });
    const titleField = field(isTpl ? "Template name" : "Internal name", title, { required: true, help: isTpl ? "Shown on the Templates page." : "Only the team sees this." });
    const subject = bindText(control("input", { type: "text", id: "nl_subject", maxlength: "200", placeholder: "PGC in October: …" }), () => d.subject, (v) => (d.subject = v), { after: () => paintChecks() });
    const subjectField = field("Subject line", subject);
    const preview = bindText(control("input", { type: "text", id: "nl_preview", maxlength: "300", placeholder: "Shown next to the subject in most inboxes" }), () => d.preview_text, (v) => (d.preview_text = v), { after: () => paintChecks() });
    const previewField = field("Preview text", preview);
    const details = el("div", { class: "nle-group" }, el("h3", { class: "nle-group-title" }, isTpl ? "Template details" : "Campaign details"), banner, titleField);
    if (isTpl) details.append(field("Description", bindText(control("textarea", { id: "nl_tdesc", rows: "2", maxlength: "500", placeholder: "When to use this template" }), () => d.description, (v) => (d.description = v))));
    details.append(subjectField, previewField);
    const fromName = bindText(control("input", { type: "text", id: "nl_from", maxlength: "100" }), () => d.from_name, (v) => (d.from_name = v));
    const replyTo = bindText(control("input", { type: "email", id: "nl_reply", maxlength: "200" }), () => d.reply_to, (v) => (d.reply_to = v), { after: () => replyField.setError(d.reply_to && !EMAIL_RE.test(d.reply_to.trim()) ? "Enter a valid email address." : "") });
    const replyField = field("Reply-to", replyTo, { help: "Must be on a domain verified in Mailchimp." });
    const sender = el("div", { class: "nle-group" }, el("h3", { class: "nle-group-title" }, "Sender"), field("From name", fromName), replyField);
    form.append(details, sender);
    if (!isTpl) form.append(renderDelivery());
    form.append(el("div", { class: "nle-group", id: "nleChecksList" }, el("h3", { class: "nle-group-title" }, "Checks"), el("div", { id: "nleChecksBody" })));
    E.fieldRefs = { subject: subjectField, preview: previewField, title: titleField };
    paintChecks();
  }
  function renderDelivery() {
    const g = el("div", { class: "nle-group" }, el("h3", { class: "nle-group-title" }, "Delivery"));
    const s = status();
    const line = el("div", { class: "nle-status-line" }, model.statusPill(s));
    if (!r) line.append(el("span", null, "Not saved yet. Save to send tests or submit it for review."));
    else if (s === "sent") line.append(el("span", null, "Sent " + fmtDateTime(r.sent_at) + (r.emails_sent != null ? " to " + Number(r.emails_sent).toLocaleString("en-US") + " recipients." : ".")));
    else if (s === "scheduled") line.append(el("span", null, "Scheduled for " + fmtDateTime(r.scheduled_for) + "."));
    else if (s === "in_review") line.append(el("span", null, "Waiting for a publisher to review."));
    else if (s === "changes_requested") line.append(el("span", null, "A publisher asked for changes. Edit and submit again."));
    else line.append(el("span", null, r.updated_by ? "Last edited by " + r.updated_by + " " + fmtDateTime(r.updated_at) + "." : "Draft."));
    g.append(line);
    // Send to: everyone, or one group (a Mailchimp tag or saved segment) kept on the row.
    const sendTo = control("select", { id: "nl_segment" });
    const fillSendTo = () => { sendTo.innerHTML = ""; sendTo.append(el("option", { value: "" }, "Everyone in the audience")); (st.groups || []).forEach((gr) => sendTo.append(el("option", { value: String(gr.id) }, gr.name + " · " + Number(gr.count).toLocaleString("en-US") + (gr.type === "static" ? "" : " (segment)")))); if (d.segment_id && !(st.groups || []).some((gr) => gr.id === d.segment_id)) sendTo.append(el("option", { value: String(d.segment_id) }, (d.segment_name || "Group") + " (no longer in Mailchimp)")); sendTo.value = d.segment_id ? String(d.segment_id) : ""; };
    fillSendTo();
    sendTo.addEventListener("change", () => { const gr = (st.groups || []).find((x) => String(x.id) === sendTo.value); d.segment_id = gr ? gr.id : null; d.segment_name = gr ? gr.name : ""; changed({ keepInspector: true }); paintAudience(); });
    g.append(field("Send to", sendTo, { help: "Groups are the separate lists on Email Lists. Everyone = every subscribed contact." }));
    const kv = el("dl", { class: "nle-kv" });
    const aud = st.audience;
    const audienceText = () => { const gr = d.segment_id ? (st.groups || []).find((x) => x.id === d.segment_id) : null; if (gr) return gr.name + " · " + Number(gr.count).toLocaleString("en-US") + " contacts"; if (d.segment_id) return (d.segment_name || "Group") + " (not found in Mailchimp)"; const a = st.audience; return a ? (a.name || "Mailchimp audience") + (a.members != null ? " · " + Number(a.members).toLocaleString("en-US") + " contacts" : "") : "Loading…"; };
    const paintAudience = () => { const n = document.getElementById("nleAudience"); if (n) n.textContent = audienceText(); };
    kv.append(el("dt", null, "Audience"), el("dd", { id: "nleAudience" }, audienceText()));
    if (!st.groups) loadGroups().then(() => { fillSendTo(); paintAudience(); });
    const tested = model.testedAfterSave(r);
    kv.append(el("dt", null, "Last test"), el("dd", null, r && r.test_sent_at ? fmtDateTime(r.test_sent_at) + " to " + (r.test_sent_to || "you") + (tested ? "" : " (before the last save)") : "Not sent yet"));
    g.append(kv);
    const rowBtns = el("div", { class: "nle-btnrow", style: "margin-top:16px" });
    if (r && !locked()) rowBtns.append(btn("Send test…", "nle-btn--sm", () => openTestDialog(), { id: "nleTestOpen" }), btn(canPublish ? "Review & send…" : "Review & submit…", "nle-btn--sm nle-btn--primary", () => openReviewDialog(), { id: "nleReviewOpen" }));
    if (r && s === "scheduled" && canPublish) rowBtns.append(btn("Unschedule", "nle-btn--sm", () => unschedule(), { id: "nleInspUnschedule" }));
    if (r && s === "sent" && r.mailchimp_id) rowBtns.append(btn("View report", "nle-btn--sm nle-btn--primary", () => model.openReport(r.mailchimp_id), { id: "nleInspReport" }));
    if (rowBtns.children.length) g.append(rowBtns);
    if (!aud) loadAudience().then(paintAudience);
    return g;
  }
  // Groups (tags + saved segments) for Send to; cached per workspace session.
  async function loadGroups() {
    if (st.groups || isTpl) return st.groups || [];
    try { const s = await mc("segments"); st.groups = (s && s.segments) || []; } catch (e) { st.groups = []; }
    return st.groups;
  }
  // The audience a saved row goes to, for the review and confirm dialogs.
  function audienceFor(src) {
    const gr = src && src.segment_id ? (st.groups || []).find((x) => x.id === Number(src.segment_id)) : null;
    if (gr) return { label: gr.name + " · " + Number(gr.count).toLocaleString("en-US") + " contacts", count: gr.count, group: gr.name };
    if (src && src.segment_id) return { label: (src.segment_name || "Group") + " (not found in Mailchimp)", count: null, group: src.segment_name || "Group" };
    const a = st.audience; return { label: a ? (a.name || "Mailchimp audience") + (a.members != null ? " · " + Number(a.members).toLocaleString("en-US") + " contacts" : "") : "Loading…", count: a ? a.members : null, group: "" };
  }
  async function loadAudience() {
    if (st.audience || isTpl) return st.audience;
    try { const s = await mc("stats"); st.audience = { name: s && s.audience ? s.audience.name : "", members: s && s.stats ? s.stats.members : null, configured: s ? s.configured !== false : false }; }
    catch (e) { st.audience = { name: "", members: null, configured: false, error: e.message }; }
    return st.audience;
  }
  // Checks: renderer warnings mapped to the field or block they concern.
  function checkTarget(w) {
    const m = w.match(/^(Post|Event|Button|Heading|Image) #(\d+)/);
    if (m) return { block: Number(m[2]) - 1 };
    if (/subject line/.test(w)) return { field: "subject" }; if (/preview text/i.test(w)) return { field: "preview" }; if (/no content blocks/.test(w)) return { library: true };
    return {};
  }
  function paintChecks() {
    const ws = E.warnings || [];
    checksBtn.innerHTML = ""; checksBtn.classList.toggle("is-ok", !ws.length);
    checksBtn.append(ws.length ? (ws.length + (ws.length === 1 ? " check" : " checks")) : "No issues");
    checksBtn.setAttribute("aria-label", ws.length ? ws.length + " checks need attention; open the list" : "No issues found");
    const body = document.getElementById("nleChecksBody");
    if (body) {
      body.innerHTML = "";
      if (!ws.length) body.append(el("div", { class: "nle-check nle-check--ok" }, el("span", { class: "nle-check-dot" }), "Nothing to fix. Send yourself a test before sending."));
      ws.forEach((w) => {
        const t = checkTarget(w);
        const fix = btn("Fix", "nle-btn--sm nle-btn--ghost", () => { if (t.block != null) select("block:" + t.block, { scroll: true }); else if (t.field && E.fieldRefs && E.fieldRefs[t.field]) focusField(E.fieldRefs[t.field].querySelector("input").id); else if (t.library) { setTab("blocks"); openLib(); const f = tiles.querySelector("button"); if (f) f.focus(); } });
        body.append(el("div", { class: "nle-check" }, el("span", { class: "nle-check-dot" }), el("span", null, w), fix));
      });
    }
    if (E.fieldRefs) { E.fieldRefs.subject.setError(ws.some((w) => /subject line/.test(w)) ? "Add a subject line before sending." : ""); E.fieldRefs.preview.setError(""); }
  }
  function renderPicker(form) {
    const P = E.pick, kind = P.kind;
    const q = el("input", { type: "search", class: "nle-input", id: "nlePickSearch", placeholder: kind === "post" ? "Search published posts…" : "Search upcoming events…", "aria-label": "Search" });
    const list = el("div", { class: "nle-picklist", id: "nlpPicker" });
    const items = kind === "post" ? (st.posts || []) : (st.events || []);
    const paint = () => {
      list.innerHTML = "";
      const needle = q.value.trim().toLowerCase();
      const shown = items.filter((x) => !needle || (x.title || "").toLowerCase().includes(needle)).slice(0, 30);
      if (!shown.length) list.append(el("p", { class: "nle-empty" }, kind === "post" ? "No published posts match." : "No upcoming published events match."));
      shown.forEach((x) => {
        const used = d.content.blocks.some((b, i) => b.type === kind && b.id === x.id && i !== P.replace);
        list.append(el("button", { type: "button", class: "nle-pick nlp-pick" + (used ? " is-used" : ""), disabled: used, onclick: () => {
          if (P.replace != null) { d.content.blocks[P.replace] = { type: kind, id: x.id }; E.pick = null; paintNow(); refreshSaveState(); select("block:" + P.replace, { quiet: true }); ensureRefs().then((got) => { if (got) paintNow(); }); }
          else { E.pick = null; insertBlock({ type: kind, id: x.id }, P.at); }
        } }, el("span", { class: "nle-pick-title nlp-pick-title" }, x.title), el("span", { class: "nle-pick-meta nlp-pick-meta" }, kind === "post" ? [x.category, fmtDate(x.published_at)].filter(Boolean).join(" · ") : [model.eventDate(x.start_date, x.end_date), x.location].filter(Boolean).join(" · ")), used ? el("span", { class: "pstatus pstatus--read" }, "Added") : null));
      });
    };
    q.addEventListener("input", paint);
    form.append(q, list, el("div", { class: "nle-btnrow", style: "margin-top:16px" }, btn("Cancel", "nle-btn--sm", () => { const back = P.replace != null ? "block:" + P.replace : null; E.pick = null; select(back, { quiet: true }); }, { id: "nlePickCancel" })));
    paint(); setTimeout(() => q.focus(), 0);
  }
  /** "Quick link": a select of links already on the website that fills a URL field (and an empty button label). */
  function quickLink(urlInput, b, key, labelInput) {
    const sel = el("select", { class: "nle-select nle-quicklink", "aria-label": "Quick link: a page already on the website", disabled: locked() });
    sel.append(el("option", { value: "" }, "Quick link: pick a site…"));
    const fill = (groups) => { groups.forEach((g) => { const og = el("optgroup", { label: g.label }); g.items.forEach(([name, url]) => og.append(el("option", { value: url }, name))); sel.append(og); }); };
    if (st.siteLinks) fill(st.siteLinks); else model.loadSiteLinks().then((g) => { if (sel.isConnected) fill(g); }).catch(() => {});
    sel.addEventListener("change", () => {
      const url = sel.value; if (!url) return;
      const name = sel.selectedOptions[0].textContent;
      b[key] = url; urlInput.value = url; if (urlInput.afterChange) urlInput.afterChange();
      if (labelInput && b.type === "button" && !(b.label || "").trim()) { b.label = name; labelInput.value = name; }
      sel.value = ""; changed({ keepInspector: true }); announce("Link set to " + name + ".");
    });
    return el("div", { class: "nle-quicklink-row" }, sel);
  }
  /* ---- Header and footer: brand-kit or ARI branding, ARI wording optional, footer fully editable ---- */
  const kitOf = () => themeFor(d.content.theme_id);
  const kitLabel = () => kitName(kitOf());
  function useKitBranding() {
    const ap = d.content.appearance; ap.logo = "initiative";
    ap.header = Object.assign({}, ap.header || {}, { powered: false });
    ap.footer = { preset: "kit" };
    changed({ keepInspector: true }); renderInspector();
  }
  function kitButton() {
    const name = kitLabel();
    return name ? el("div", { class: "nle-btnrow" }, btn("Use " + name + " branding", "nle-btn--sm", useKitBranding, { id: "nleUseKit", disabled: locked(), title: "Brand-kit logo without the ARI line, and the " + name + " footer" })) : el("p", { class: "nle-help" }, "Pick a theme (Design → Theme) to use a brand kit's logo and footer.");
  }
  function renderHeaderSettings(form) {
    const ap = d.content.appearance;
    const hd = () => (ap.header = ap.header || {});
    const tidy = () => { const h = ap.header; if (h && h.powered !== false && h.viewOnline !== false && !h.tagline && !h.link) delete ap.header; };
    const logo = control("select", { id: "nl_hd_logo" });
    [["auto", "Automatic"], ["pgc-dark", "PGC logo (dark, for light emails)"], ["pgc-mint", "PGC logo (mint, for dark emails)"], ["pgc-mark-dark", "PGC mark (dark)"], ["pgc-mark-mint", "PGC mark (mint)"]].forEach(([v, l]) => logo.append(el("option", { value: v }, l)));
    logo.value = ap.logo || "auto";
    logo.addEventListener("change", () => { ap.logo = logo.value; const dl = document.getElementById("nl_logo"); if (dl) dl.value = logo.value; changed({ keepInspector: true }); });
    const check = (id, label, on, set) => { const c = el("input", { type: "checkbox", id, disabled: locked() }); c.checked = on; c.addEventListener("change", () => { set(c.checked); tidy(); changed({ keepInspector: true }); }); return el("label", { class: "nle-check", for: id }, c, el("span", null, label)); };
    const h0 = ap.header || {};
    const tagline = bindText(control("input", { type: "text", id: "nl_hd_tagline", maxlength: "120", placeholder: "Optional, e.g. Monthly update" }), () => (ap.header && ap.header.tagline) || "", (v) => { hd().tagline = v; tidy(); });
    const link = bindText(control("input", { type: "url", id: "nl_hd_link", maxlength: "300", placeholder: "https://pgc.capital/" }), () => (ap.header && ap.header.link) || "", (v) => { hd().link = v.trim(); tidy(); });
    form.append(kitButton(),
      field("Logo", logo, { help: "Brand-kit logos come from the theme chosen under Design → Theme. Plate and colors are under Design." }),
      check("nl_hd_powered", "Show “An Applied Research Institute company” under a theme logo", h0.powered !== false, (v) => { hd().powered = v; }),
      check("nl_hd_view", "Show “View in browser”", h0.viewOnline !== false, (v) => { hd().viewOnline = v; }),
      field("Line under the logo", tagline),
      field("Logo links to", link, { help: "Leave blank for pgc.capital." }));
  }
  function renderFooterSettings(form) {
    const ap = d.content.appearance, kit = kitOf(), name = kitLabel();
    const preset = ap.footer && ap.footer.preset ? ap.footer.preset : "ari";
    const sel = control("select", { id: "nl_footer" });
    sel.append(el("option", { value: "ari" }, "PGC footer"), el("option", { value: "kit", disabled: !name }, name ? name + " footer" : "Brand-kit footer (pick a theme first)"), el("option", { value: "custom" }, "Custom (edit below)"));
    sel.value = preset;
    // Switching to Custom starts from whatever the footer says now, so editing feels like editing it.
    sel.addEventListener("change", () => {
      if (sel.value === "ari") delete ap.footer;
      else if (sel.value === "kit") ap.footer = { preset: "kit" };
      else ap.footer = Object.assign({ preset: "custom" }, JSON.parse(JSON.stringify(footerPreset(preset === "kit" ? "kit" : "ari", kit))));
      changed({ keepInspector: true }); renderInspector();
    });
    form.append(kitButton(), field("Footer", sel));
    if (preset !== "custom") {
      const p = footerPreset(preset, kit);
      form.append(el("div", { class: "nle-picked", id: "nleFooterPreview" }, el("b", null, p.name || "(no name)"), p.tagline ? el("span", null, p.tagline) : null, el("span", null, p.note), p.links.length ? el("span", null, p.links.map((l) => l.label).join(" · ")) : null),
        el("div", { class: "nle-btnrow" }, btn("Edit this footer", "nle-btn--sm", () => { sel.value = "custom"; sel.dispatchEvent(new Event("change")); }, { id: "nleFooterEdit", disabled: locked() })));
    } else {
      const f = ap.footer; f.links = Array.isArray(f.links) ? f.links : [];
      const txt = (id, key, attrs) => bindText(control(attrs && attrs.rows ? "textarea" : "input", Object.assign({ id }, attrs && attrs.rows ? {} : { type: "text" }, attrs || {})), () => f[key] || "", (v) => { f[key] = v; });
      form.append(field("Name", txt("nl_ft_name", "name", { maxlength: "120", placeholder: "Organization name" })),
        field("Line under the name", txt("nl_ft_tagline", "tagline", { maxlength: "160", placeholder: "Optional" })),
        field("Note", txt("nl_ft_note", "note", { rows: "3", maxlength: "300", placeholder: "Why they receive this email" }), { format: "inline" }));
      const links = el("div", { class: "nle-ft-links", id: "nleFooterLinks" });
      const paintLinks = () => {
        links.innerHTML = "";
        f.links.forEach((l, i) => {
          const lab = control("input", { type: "text", maxlength: "40", placeholder: "Label", "aria-label": "Link " + (i + 1) + " label", class: "nle-input nl-ft-label" }); lab.value = l.label || "";
          const url = control("input", { type: "url", maxlength: "300", placeholder: "https://", "aria-label": "Link " + (i + 1) + " address", class: "nle-input nl-ft-url" }); url.value = l.url || "";
          lab.addEventListener("input", () => { l.label = lab.value; changed({ keepInspector: true }); });
          url.addEventListener("input", () => { l.url = url.value.trim(); changed({ keepInspector: true }); });
          links.append(el("div", { class: "nle-ft-link" }, lab, url, btn("Remove", "nle-btn--sm nle-btn--ghost", () => { f.links.splice(i, 1); changed({ keepInspector: true }); paintLinks(); }, { disabled: locked(), "aria-label": "Remove link " + (i + 1) })));
        });
        if (f.links.length < 4) links.append(el("div", { class: "nle-btnrow" }, btn("Add link", "nle-btn--sm", () => { f.links.push({ label: "", url: "" }); paintLinks(); const u = links.querySelectorAll(".nl-ft-label"); if (u.length) u[u.length - 1].focus(); }, { id: "nleFooterAddLink", disabled: locked() })));
      };
      paintLinks();
      form.append(el("div", { class: "nle-field" }, el("span", { class: "nle-label" }, "Links"), links));
    }
    form.append(el("p", { class: "nle-help" }, "The mailing address, “Update preferences” and “Unsubscribe” are always added. Mailchimp requires them and fills them in when sending."));
  }
  function renderBlockSettings(form, i) {
    const b = d.content.blocks[i]; if (!b) return;
    const input = (attrs, key, tag) => { const n = control(tag || "input", attrs); if (tag === "textarea") n.value = b[key] || ""; else if (tag === "select") n.value = b[key] == null ? "" : String(b[key]); else n.value = b[key] == null ? "" : b[key]; n.addEventListener(tag === "select" ? "change" : "input", () => { b[key] = attrs.type === "number" ? Number(n.value) : n.value; changed({ keepInspector: true }); if (n.afterChange) n.afterChange(); }); return n; };
    const opt = (v, l) => el("option", { value: v }, l);
    const featured = (b.type === "post" && i === 0 && d.template === "release") || (b.type === "event" && i === 0 && d.template === "event");
    if (b.type === "post" || b.type === "event") {
      const x = b.type === "post" ? (st.posts || []).find((p) => p.id === b.id) || st.refs.posts.get(b.id) : (st.events || []).find((e) => e.id === b.id) || st.refs.events.get(b.id);
      form.append(el("div", { class: "nle-picked" }, el("b", null, x ? x.title : (b.type === "post" ? "This post is no longer available." : "This event is no longer upcoming or available.")), x ? el("span", null, b.type === "post" ? [x.category, fmtDate(x.published_at)].filter(Boolean).join(" · ") : [model.eventDate(x.start_date, x.end_date), x.location].filter(Boolean).join(" · ")) : null, featured ? el("span", null, "Featured: shown large at the top of this layout.") : null));
      if (!locked()) form.append(el("div", { class: "nle-btnrow" }, btn(b.type === "post" ? "Choose another post" : "Choose another event", "nle-btn--sm", () => { E.pick = { kind: b.type, replace: i }; renderInspector(); })));
      // Words for this email only: blank fields show the site's own text; the post or event itself is never changed.
      const bodyKey = b.type === "post" ? "summary" : "description";
      const origBody = x ? String(x[bodyKey] || (b.type === "post" ? x.body : "") || "").replace(/\s+/g, " ").trim().slice(0, 160) : "";
      const titleIn = input({ type: "text", id: "nleBlockTitle", maxlength: "200", placeholder: x ? x.title : "" }, "title");
      const bodyIn = input({ id: "nleBlockSummary", rows: "4", maxlength: "2000", placeholder: origBody || (b.type === "post" ? "The post's summary" : "The event's description") }, bodyKey, "textarea");
      const ctaIn = input({ type: "text", id: "nleBlockCta", maxlength: "80", placeholder: b.type === "post" ? (featured ? "Read the full story" : "Read more") : ((x && x.cta_label) || "Register") }, "cta");
      const reset = btn("Use the site's text", "nle-btn--sm nle-btn--ghost", () => { delete b.title; delete b[bodyKey]; delete b.cta; titleIn.value = ""; bodyIn.value = ""; ctaIn.value = ""; changed({ keepInspector: true }); }, { id: "nleBlockReset", disabled: locked() });
      form.append(el("div", { class: "nle-group" }, el("h3", { class: "nle-group-title" }, "Text in this email"),
        field("Title", titleIn, { help: "Leave blank to use the " + (b.type === "post" ? "newsroom" : "calendar") + " title." }),
        field(b.type === "post" ? "Summary" : "Description", bodyIn, { format: "inline", help: "Leave blank to use the site's text. Blank lines start new paragraphs." }),
        field(b.type === "post" ? "Link label" : "Button label", ctaIn), el("div", { class: "nle-btnrow" }, reset),
        el("p", { class: "nle-help" }, b.type === "post" ? "The cover image and link still come from the newsroom; the post itself is not changed." : "Date, location and the register link still come from the calendar; the event itself is not changed.")));
    } else if (b.type === "heading") {
      const text = input({ type: "text", id: "nleBlockText", maxlength: "200", placeholder: "Section title", class: "nle-input" }, "text");
      const size = input({ id: "nleBlockSize" }, "size", "select"); size.append(opt("large", "Large"), opt("small", "Small")); size.value = b.size === "small" ? "small" : "large";
      const align = input({ id: "nleBlockAlign" }, "align", "select"); align.append(opt("left", "Left"), opt("center", "Center"), opt("right", "Right")); align.value = b.align || "left";
      form.append(field("Heading", text), el("details", { class: "nle-details", open: b.size === "small" || (b.align && b.align !== "left") }, el("summary", null, "Style"), el("div", { class: "nle-details-body" }, field("Size", size), field("Alignment", align))));
    } else if (b.type === "text") {
      form.append(field("Section heading", input({ type: "text", id: "nleBlockHeading", maxlength: "200", placeholder: "Optional" }, "heading")), field("Text", input({ id: "nleBlockBody", rows: "7", placeholder: "Blank lines start new paragraphs. Links are picked up automatically." }, "body", "textarea"), { format: true }));
    } else if (b.type === "image") {
      const thumb = el("div", { class: "nle-thumb" });
      const paintThumb = () => { thumb.innerHTML = ""; thumb.classList.toggle("is-dark", b.plate === "dark" || (b.plate !== "light" && ap.mode === "dark")); if (b.url) thumb.append(el("img", { src: absUrl(b.url), alt: "" })); else thumb.append(el("span", null, "No image yet")); };
      paintThumb();
      const urlIn = input({ type: "text", id: "nleBlockUrl", maxlength: "1000", placeholder: "https://… or assets/partners/name.png" }, "url"); urlIn.afterChange = paintThumb;
      const altIn = input({ type: "text", id: "nleBlockAlt", maxlength: "200", placeholder: "Describe the image" }, "alt");
      const fileIn = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true, id: "nleBlockFile" });
      const upMsg = el("span", { class: "nle-help", id: "nleUpMsg" });
      const upBtn = btn("Upload image", "nle-btn--sm", () => fileIn.click(), { disabled: locked() });
      fileIn.addEventListener("change", async () => {
        const file = fileIn.files && fileIn.files[0]; if (!file) return;
        if (file.size > 2 * 1024 * 1024) { upMsg.textContent = "Keep images under 2 MB."; return; }
        upMsg.textContent = "Uploading…"; upBtn.disabled = true;
        try {
          const ext = ((file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "")) || "png";
          const path = `campaigns/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const up = await supabase.storage.from("pgc-media").upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type || undefined });
          if (up.error) throw up.error;
          b.url = supabase.storage.from("pgc-media").getPublicUrl(path).data.publicUrl; urlIn.value = b.url; paintThumb(); upMsg.textContent = "Uploaded."; changed({ keepInspector: true });
        } catch (err) { upMsg.textContent = "Upload failed: " + (err.message || err); }
        finally { upBtn.disabled = locked(); fileIn.value = ""; }
      });
      const libBox = el("div", { id: "nleLibBox", hidden: true });
      const libBtn = btn("Choose a logo from the website", "nle-btn--sm", async () => {
        libBox.hidden = false; libBox.innerHTML = ""; libBox.append(el("p", { class: "nle-help" }, "Loading…"));
        const items = await model.loadLibrary();
        libBox.innerHTML = "";
        const grid = el("div", { class: "nle-lib-grid" });
        items.forEach((it) => grid.append(el("button", { type: "button", class: "nle-lib-item nlp-lib-item", title: it.name, onclick: () => { b.url = it.url; if (it.name && !b.alt) { b.alt = it.name; altIn.value = it.name; } urlIn.value = it.url; b.plate = it.ink === "light" && ap.mode !== "dark" ? "dark" : it.ink === "dark" && ap.mode === "dark" ? "light" : "none"; plateSel.value = b.plate; libBox.hidden = true; paintThumb(); changed({ keepInspector: true }); } }, el("span", { class: "nle-lib-img" + (it.ink === "light" ? " is-dark" : "") }, el("img", { src: it.preview, alt: "" })), el("span", { class: "nlp-lib-name" }, it.name))));
        libBox.append(grid, el("div", { class: "nle-btnrow", style: "margin-top:8px" }, btn("Cancel", "nle-btn--sm nle-btn--ghost", () => { libBox.hidden = true; })));
      }, { disabled: locked() });
      const widthSel = input({ id: "nleBlockWidth" }, "width", "select"); widthSel.append(opt("160", "Small (160px)"), opt("240", "Logo (240px)"), opt("360", "Medium (360px)"), opt("536", "Full width")); widthSel.value = String([160, 240, 360, 536].includes(Number(b.width)) ? b.width : 240); widthSel.addEventListener("change", () => { b.width = Number(widthSel.value); });
      const alignSel = input({ id: "nleBlockAlign" }, "align", "select"); alignSel.append(opt("left", "Left"), opt("center", "Center"), opt("right", "Right")); alignSel.value = b.align || "center";
      const plateSel = input({ id: "nleBlockPlate" }, "plate", "select"); plateSel.append(opt("none", "No plate"), opt("dark", "Dark plate"), opt("light", "White plate")); plateSel.value = b.plate || "none"; plateSel.afterChange = paintThumb;
      form.append(el("div", { class: "nle-field" }, el("span", { class: "nle-label" }, "Picture"), thumb, el("div", { class: "nle-btnrow" }, libBtn, upBtn, fileIn), upMsg, libBox),
        field("Image address", urlIn), field("Alt text", altIn, { help: "Read by screen readers and shown when images are blocked." }),
        el("details", { class: "nle-details", open: !!(b.link || (b.align && b.align !== "center") || (b.plate && b.plate !== "none") || (b.width && Number(b.width) !== 240)) }, el("summary", null, "Options"), el("div", { class: "nle-details-body" }, (() => { const linkIn = input({ type: "url", id: "nleBlockLink", maxlength: "1000", placeholder: "https://…" }, "link"); const f = field("Link when clicked", linkIn); f.append(quickLink(linkIn, b, "link")); return f; })(), field("Width", widthSel), field("Alignment", alignSel), field("Plate", plateSel, { help: "A colored panel behind the picture: for white logos on light emails or dark logos on dark emails." }))));
    } else if (b.type === "button") {
      const label = input({ type: "text", id: "nleBlockLabel", maxlength: "80", placeholder: "Learn more" }, "label");
      const url = input({ type: "url", id: "nleBlockUrl", maxlength: "1000", placeholder: "https://…" }, "url");
      const urlField = field("Link", url, { required: true }); urlField.append(quickLink(url, b, "url", label));
      url.afterChange = () => urlField.setError(url.value && !/^https?:\/\//i.test(url.value.trim()) ? "Links start with https://" : "");
      // Style for this button; blank means the campaign's button style (Design → Buttons).
      const colorPick = (key, labelText, help) => {
        const inp = el("input", { type: "color", id: "nleBlock" + key.charAt(0).toUpperCase() + key.slice(1), disabled: locked(), "aria-label": labelText });
        const val = el("span", { class: "nle-color-val" });
        const reset = btn("Default", "nle-btn--sm", () => { delete b[key]; paint(); changed({ keepInspector: true }); }, { disabled: locked() });
        const fallback = key === "color" ? ((ap.button && ap.button.color) || "#1f3655") : "#ffffff";
        const chips = kitChips(() => b[key], (hex) => { b[key] = hex; paint(); changed({ keepInspector: true }); }, labelText.toLowerCase());
        function paint() { const custom = !!b[key]; inp.value = custom ? b[key] : fallback; val.textContent = custom ? b[key] : "Campaign default"; reset.hidden = !custom; chips.paint(); }
        inp.addEventListener("input", () => { b[key] = inp.value; paint(); changed({ keepInspector: true }); });
        paint();
        const w = el("div", { class: "nle-field" }, el("label", { class: "nle-label", for: inp.id }, labelText), el("div", { class: "nle-color" }, inp, val, reset), chips); if (help) w.append(el("span", { class: "nle-help" }, help)); return w;
      };
      const sel = (key, id, opts, fallback) => { const n = input({ id }, key, "select"); opts.forEach(([v, l]) => n.append(opt(v, l))); n.value = b[key] || fallback; n.addEventListener("change", () => { if (n.value === fallback && fallback === "") delete b[key]; }); return n; };
      const styleSel = sel("style", "nleBlockStyle", [["", "Filled"], ["outline", "Outline"]], "");
      const shapeSel = sel("shape", "nleBlockShape", [["", "Campaign default"], ["pill", "Pill"], ["rounded", "Rounded"], ["square", "Square"]], "");
      const sizeSel = sel("size", "nleBlockSize", [["", "Regular"], ["large", "Large"]], "");
      const alignSel = sel("align", "nleBlockAlign", [["center", "Center"], ["left", "Left"], ["right", "Right"]], "center");
      const campW = ap.button && ap.button.width;
      const widthF = widthControl("nleBlockWidth", () => (b.width === "full" ? "full" : clampBtnWidth(b.width)), (w) => { if (w) b.width = w; else delete b.width; changed({ keepInspector: true }); }, "Campaign default" + (campW === "full" ? " (full width)" : campW ? " (" + campW + "px)" : " (fits the label)"));
      form.append(field("Label", label), urlField,
        el("details", { class: "nle-details", open: !!(b.color || b.text || b.shape || b.size || b.style || (b.align && b.align !== "center")) }, el("summary", null, "Style"), el("div", { class: "nle-details-body" },
          colorPick("color", "Fill color"), colorPick("text", "Text color", "Automatic: white on dark fills, dark on light fills."),
          field("Style", styleSel), field("Shape", shapeSel), field("Size", sizeSel), widthF, field("Alignment", alignSel),
          el("p", { class: "nle-help" }, "The campaign-wide button shape, width and colors live under Design → Buttons."))));
    } else if (b.type === "divider") {
      form.append(el("p", { class: "nle-note" }, "A thin rule in the theme's border color. Nothing to set."));
    } else if (b.type === "spacer") {
      const h = input({ type: "number", id: "nleBlockHeight", min: "8", max: "120", step: "4" }, "height"); h.value = String(b.height || 24);
      form.append(field("Height (px)", h, { help: "8 to 120 pixels." }));
    }
    if (!locked()) form.append(el("div", { class: "nle-group", style: "margin-top:24px;padding-top:24px;border-top:1px solid var(--pa-border);border-bottom:0" }, el("h3", { class: "nle-group-title" }, "Arrange"), el("div", { class: "nle-arrange" },
      btn([svg(ICON.up), "Up"], "nle-btn--sm", () => moveBlock(i, -1), { "aria-label": "Move up", disabled: i === 0 }), btn([svg(ICON.down), "Down"], "nle-btn--sm", () => moveBlock(i, 1), { "aria-label": "Move down", disabled: i === d.content.blocks.length - 1 }),
      btn([svg(ICON.dup), "Duplicate"], "nle-btn--sm", () => duplicateBlock(i), { "aria-label": "Duplicate", disabled: b.type === "post" || b.type === "event" }), btn([svg(ICON.del), "Remove"], "nle-btn--sm nle-btn--danger", () => removeBlock(i), { "aria-label": "Remove" }))));
  }

  // ---------------- drawers (narrow screens) ----------------
  function openInsp() { if (!isNarrow()) return; E.insp = true; E.drawerOpener = document.activeElement; root.classList.add("is-insp-open"); scrim.hidden = false; const f = insp.querySelector("button, input, select, textarea"); if (f) setTimeout(() => f.focus({ preventScroll: true }), 50); }
  function openLib() { if (!isPhone()) { const f = lib.querySelector(".nle-tile, select"); if (f) f.focus(); return; } E.lib = true; E.drawerOpener = document.activeElement; root.classList.add("is-lib-open"); scrim.hidden = false; const f = lib.querySelector(".nle-tile"); if (f) setTimeout(() => f.focus({ preventScroll: true }), 50); }
  function closeDrawers() {
    const wasOpen = E.insp || E.lib;
    E.insp = false; E.lib = false; root.classList.remove("is-insp-open", "is-lib-open"); scrim.hidden = true;
    if (wasOpen) { const back = (E.sel && rowsEl.querySelector('.nle-row[data-key="' + E.sel + '"]')) || (E.drawerOpener && E.drawerOpener.isConnected ? E.drawerOpener : null); if (back) { try { back.focus({ preventScroll: true }); } catch (_) {} } }
    E.drawerOpener = null;
  }
  root.addEventListener("keydown", (e) => { if (e.key === "Escape" && (E.insp || E.lib)) { e.stopPropagation(); closeDrawers(); } });
  /** Open the inspector (on narrow screens) and focus a field in it. */
  function focusField(id) { openInsp(); setTimeout(() => { const n = document.getElementById(id); if (n && !n.disabled) { n.focus({ preventScroll: true }); n.scrollIntoView({ block: "nearest" }); } }, E.insp ? 60 : 0); }

  // ---------------- header ----------------
  function refreshSaveState() {
    const dirty = isDirty();
    if (dirty && E.saveState !== "saving") E.saveText = "";   // an edit replaces "Saved" / "Campaign created." at once
    if (E.saveState !== "saving" && E.saveState !== "error") E.saveState = dirty ? "dirty" : (r ? "saved" : "new");
    else if (E.saveState === "error" && !dirty) E.saveState = "saved";
    paintSaveState();
  }
  function paintSaveState() {
    const n = document.getElementById("nlpMsg"); if (!n) return;
    const s = E.saveState;
    n.className = "nle-savestate is-" + s;
    n.textContent = E.saveText || (s === "saving" ? "Saving…" : s === "saved" ? "Saved" : s === "error" ? "Save failed" : s === "dirty" ? "Unsaved changes" : "Not saved yet");
    const saveBtn = document.getElementById(isTpl ? "nlpSaveTemplate" : "nlpSave");
    if (saveBtn) saveBtn.classList.toggle("nle-btn--primary", s === "dirty" || s === "new");
  }
  function renderHeader() {
    head.innerHTML = "";
    const back = btn([svg(ICON.back), isTpl ? "Templates" : "Campaigns"], "nle-btn--ghost nle-back nlp-back", () => leave());
    const name = el("input", { type: "text", class: "nle-name", id: "nleName", maxlength: "200", placeholder: isTpl ? "Template name" : "Untitled campaign", "aria-label": isTpl ? "Template name" : "Campaign name", disabled: locked() });
    name.value = d.title || "";
    name.addEventListener("input", () => { d.title = name.value; name.classList.remove("is-invalid"); const t = document.getElementById("nl_title"); if (t && t.value !== d.title) t.value = d.title; refreshSaveState(); });
    const main = el("div", { class: "nle-head-main" }, back, name);
    if (!isTpl) main.append(model.statusPill(status())); else main.append(el("span", { class: "pstatus pstatus--read" }, "Template"));
    main.append(el("span", { class: "nle-savestate", id: "nlpMsg", role: "status" }));
    const actions = el("div", { class: "nle-head-actions" });
    const menuBtn = iconBtn(ICON.more, "More actions", () => toggleMenu(), { id: "nleMore", "aria-haspopup": "menu", "aria-expanded": "false", class: "nle-icon", style: "width:40px;height:40px" });
    const menuList = el("ul", { class: "nle-menu-list", role: "menu", hidden: true, id: "nleMenu" });
    const item = (label, fn, attrs) => el("li", { role: "none" }, el("button", Object.assign({ type: "button", class: "nle-menu-item", role: "menuitem", onclick: () => { toggleMenu(false); fn(); } }, attrs || {}), label));
    function toggleMenu(force) { const open = force != null ? force : menuList.hidden; menuList.hidden = !open; menuBtn.setAttribute("aria-expanded", open ? "true" : "false"); if (open) { const f = menuList.querySelector("button:not([disabled])"); if (f) f.focus(); document.addEventListener("pointerdown", onOut, true); } else document.removeEventListener("pointerdown", onOut, true); }
    const onOut = (e) => { if (!menuList.contains(e.target) && e.target !== menuBtn) toggleMenu(false); };
    menuList.addEventListener("keydown", (e) => { const bs = [...menuList.querySelectorAll("button:not([disabled])")]; const i = bs.indexOf(document.activeElement); if (e.key === "Escape") { toggleMenu(false); menuBtn.focus(); } else if (e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length].focus(); } else if (e.key === "ArrowUp") { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); } });
    if (isTpl) {
      actions.append(el("button", { type: "submit", form: "nlpForm", class: "nle-btn nle-btn--primary", id: "nlpSaveTemplate" }, r ? "Save template" : "Create template"));
      menuList.append(item("Download PDF", () => downloadPdf(), { id: "nlePdf" }), item("Copy HTML", () => copyHtml(), { id: "nleCopyHtml" }));
      if (r) { menuList.append(item("Start a campaign from this", () => model.useTemplate(r), { id: "nlpUseTemplate" }), item("Delete template", () => model.deleteTemplate(r), { id: "nlpDeleteTemplate", class: "nle-menu-item nle-menu-item--danger" })); actions.append(el("div", { class: "nle-menu" }, menuBtn, menuList)); }
    } else if (locked()) {
      if (status() === "scheduled" && canPublish) actions.append(btn("Unschedule", "", () => unschedule(), { id: "nlpUnschedule" }));
      actions.append(btn("Download PDF", "", () => downloadPdf(), { id: "nlePdf" }), btn("Copy HTML", "", () => copyHtml(), { id: "nleCopyHtml" }));
      if (status() === "sent" && r.mailchimp_id) actions.append(btn("View report", "nle-btn--primary", () => model.openReport(r.mailchimp_id), { id: "nlpViewReport" }));
    } else {
      actions.append(el("button", { type: "submit", form: "nlpForm", class: "nle-btn", id: "nlpSave" }, r ? "Save" : "Create campaign"));
      actions.append(btn("Send test", "nle-hide-sm", () => openTestDialog(), { id: "nleSendTest", disabled: !r, title: r ? "" : "Save the campaign first" }));
      actions.append(btn(canPublish ? "Review & send" : "Review & submit", "nle-btn--primary", () => openReviewDialog(), { id: "nleReviewSend" }));
      menuList.append(item("Send test…", () => openTestDialog(), { class: "nle-menu-item nle-only-narrow", disabled: !r }));
      menuList.append(item("Download PDF", () => downloadPdf(), { id: "nlePdf" }), item("Copy HTML", () => copyHtml(), { id: "nleCopyHtml" }));
      menuList.append(item("Save as template", () => saveAsTemplate(), { id: "nlpSaveAsTemplate", disabled: !r }));
      const mayDelete = !!r && ((canPublish && status() !== "sent") || (status() === "draft" && String(r.created_by || "").toLowerCase() === String(access.email || "").toLowerCase()));
      if (mayDelete) menuList.append(item("Delete", () => remove(), { id: "nlpDelete", class: "nle-menu-item nle-menu-item--danger" }));
      actions.append(el("div", { class: "nle-menu" }, menuBtn, menuList));
    }
    actions.append(btn([svg(ICON.settings), "Settings"], "nle-only-narrow", () => { if (E.insp) closeDrawers(); else openInsp(); }, { id: "nleSettingsBtn", "aria-label": "Open settings" }));
    head.append(main, actions);
    paintSaveState();
  }
  async function leave() {
    if (isDirty() && !locked()) {
      const choice = await confirmDialog({ kicker: "Unsaved changes", title: "Save before leaving?", body: "You have changes that aren't saved yet.", escValue: "cancel", buttons: [{ label: "Save and continue", value: "save", cls: "btn btn-primary" }, { label: "Leave without saving", value: "discard", cls: "btn pbtn-danger" }, { label: "Cancel", value: "cancel", cls: "btn btn-secondary" }] });
      if (choice === "cancel") return;
      if (choice === "save") { const ok = isTpl ? await saveTemplate() : await save(); if (!ok) return; }
    }
    destroy(); model.leave();
  }

  // ---------------- actions ----------------
  function markSaved(data) {
    r = data;
    if (isTpl) { st.tpl = data; model.replaceTemplate(data); } else model.replaceRow(data, { keepDraft: true });
    E.lastSaved = snapshot();
    E.saveState = "saved"; E.savedAt = Date.now();
  }
  async function save(opts) {
    if (E.busy) return false;
    const p = model.payload();
    if (!p.title) { const n = document.getElementById("nleName"); if (n) { n.classList.add("is-invalid"); n.focus(); } E.saveText = "Give the campaign a name first."; E.saveState = "error"; paintSaveState(); setTimeout(() => { E.saveText = ""; refreshSaveState(); }, 4000); return false; }
    const isNew = !r;
    if (r && !isDirty()) { E.saveState = "saved"; E.saveText = "Nothing to save."; paintSaveState(); setTimeout(() => { if (E.saveText === "Nothing to save.") { E.saveText = ""; paintSaveState(); } }, 2500); return true; }
    E.busy = true; E.saveState = "saving"; E.saveText = ""; paintSaveState();
    try {
      const q = r ? supabase.from("pgc_campaigns").update(p).eq("id", r.id).select("*").single() : supabase.from("pgc_campaigns").insert(p).select("*").single();
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      markSaved(data);
      E.saveText = isNew ? "Campaign created." : ""; paintSaveState(); setTimeout(() => { if (E.saveText === "Campaign created.") { E.saveText = ""; paintSaveState(); } }, 3000);
      renderHeader(); if (!E.sel && !E.pick) renderInspector();
      if (!(opts && opts.quiet)) announce(isNew ? "Campaign created." : "Saved.");
      return true;
    } catch (e) { E.saveState = "error"; E.saveText = "Save failed: " + (e.message || e); paintSaveState(); notice("Couldn't save: " + (e.message || e), "error", 8000); return false; }
    finally { E.busy = false; }
  }
  async function saveTemplate() {
    if (E.busy) return false;
    const p = model.templatePayload();
    if (!d.title.trim()) { const n = document.getElementById("nleName"); if (n) { n.classList.add("is-invalid"); n.focus(); } E.saveText = "Give the template a name first."; E.saveState = "error"; paintSaveState(); setTimeout(() => { E.saveText = ""; refreshSaveState(); }, 4000); return false; }
    if (r && !isDirty()) { E.saveState = "saved"; E.saveText = "Nothing to save."; paintSaveState(); setTimeout(() => { if (E.saveText === "Nothing to save.") { E.saveText = ""; paintSaveState(); } }, 2500); return true; }
    E.busy = true; E.saveState = "saving"; paintSaveState();
    try {
      const q = r ? supabase.from("pgc_campaign_templates").update(p).eq("id", r.id).select("*").single() : supabase.from("pgc_campaign_templates").insert(p).select("*").single();
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      markSaved(data); await model.loadTemplates(true);
      E.saveText = "Template saved."; paintSaveState(); setTimeout(() => { if (E.saveText === "Template saved.") { E.saveText = ""; paintSaveState(); } }, 3000);
      renderHeader(); if (!E.sel && !E.pick) renderInspector();
      return true;
    } catch (e) { E.saveState = "error"; E.saveText = "Save failed: " + (e.message || e); paintSaveState(); notice("Couldn't save: " + (e.message || e), "error", 8000); return false; }
    finally { E.busy = false; }
  }
  async function saveAsTemplate() {
    if (!r || E.busy) return;
    E.busy = true;
    try {
      const p = model.templatePayload(); p.name = (d.title.trim() || "Untitled") + " template";
      const { data, error } = await supabase.from("pgc_campaign_templates").insert(p).select("*").single();
      if (error) throw new Error(error.message);
      await model.loadTemplates(true);
      notice("Saved as template “" + data.name + "”. Find it under Marketing → Templates.", "ok", 8000);
    } catch (e) { notice(e.message || String(e), "error", 8000); }
    finally { E.busy = false; }
  }
  async function setStatus(s) {
    if (!r || E.busy) return false;
    E.busy = true;
    try {
      const { data, error } = await supabase.from("pgc_campaigns").update(Object.assign(model.payload(), { status: s })).eq("id", r.id).select("*").single();
      if (error) throw new Error(error.message);
      markSaved(data); renderHeader(); if (!E.sel && !E.pick) renderInspector();
      notice(s === "in_review" ? "Submitted for review." : s === "changes_requested" ? "Changes requested." : "Back to draft.", "ok");
      return true;
    } catch (e) { notice(e.message || String(e), "error", 8000); return false; }
    finally { E.busy = false; }
  }
  async function remove() {
    if (!r) return;
    const ok = await confirmDialog({ kicker: "Delete campaign", title: "Delete “" + (r.title || "this campaign") + "”?", body: "This removes the draft from the portal. Anything already in Mailchimp stays there.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      const { data, error } = await supabase.from("pgc_campaigns").delete().eq("id", r.id).select("id");
      if (error) throw new Error(error.message);
      if (Array.isArray(data) && !data.length) throw new Error("You can't delete this campaign (it isn't your draft).");
      model.removeRow(r.id); E.lastSaved = snapshot();
      destroy(); model.leave(); notice("Campaign deleted.", "ok");
    } catch (e) { notice(e.message || String(e), "error", 8000); }
  }
  async function unschedule() {
    const ok = await confirmDialog({ kicker: "Unschedule", title: "Cancel the scheduled send?", body: "The campaign goes back to a draft you can edit and reschedule.", confirmLabel: "Unschedule", danger: false });
    if (!ok) return;
    try { const out = await mc("unschedule", { campaign_id: r.id }); if (out.row) { model.replaceRow(out.row, { keepDraft: true }); } notice("Unscheduled.", "ok"); model.reopen(out.row || r); }
    catch (e) { notice(e.message || String(e), "error", 8000); }
  }

  // ---------------- dialogs ----------------
  function openDialog(o) {
    const opener = document.activeElement;
    const modal = el("div", { class: "nle-modal", role: "presentation" });
    const card = el("div", { class: "nle-dialog" + (o.wide ? " nle-dialog--wide" : ""), role: "dialog", "aria-modal": "true", "aria-labelledby": "nleDlgTitle" });
    const close = () => { if (!modal.isConnected) return; document.removeEventListener("keydown", onKeyDlg); modal.remove(); const back = opener && opener.isConnected ? opener : (opener && opener.id ? document.getElementById(opener.id) : null); if (back && typeof back.focus === "function") back.focus({ preventScroll: true }); if (o.onClose) o.onClose(); };
    const onKeyDlg = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); return; } if (e.key === "Tab") { const fs = [...card.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]")].filter((x) => x.offsetParent !== null); if (!fs.length) return; const i = fs.indexOf(document.activeElement); if (e.shiftKey && (i <= 0)) { e.preventDefault(); fs[fs.length - 1].focus(); } else if (!e.shiftKey && i === fs.length - 1) { e.preventDefault(); fs[0].focus(); } } };
    card.append(el("p", { class: "nle-dialog-kicker" }, o.kicker || ""), el("h3", { class: "nle-dialog-title", id: "nleDlgTitle" }, o.title), iconBtn(ICON.close, "Close", close, { class: "nle-icon nle-dialog-close" }));
    const body = el("div", { class: "nle-dialog-body" }); card.append(body);
    modal.append(card);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    document.body.append(modal);
    document.addEventListener("keydown", onKeyDlg);
    o.build(body, close);
    const f = card.querySelector("[autofocus]") || card.querySelector("input:not([disabled]), textarea:not([disabled]), button:not(.nle-dialog-close):not([disabled])"); if (f) setTimeout(() => f.focus(), 0);
    return { close, body, card };
  }
  function openTestDialog() {
    if (!r) { notice("Save the campaign first, then send a test.", "error", 5000); return; }
    openDialog({ kicker: "Test email", title: "Send a test", build(body, close) {
      const remembered = (r.test_sent_to || "").trim();
      const to = el("input", { type: "text", class: "nle-input", id: "nl_test_to", placeholder: "you@theari.us, colleague@theari.us", autocomplete: "off", autofocus: true });
      to.value = remembered || (access.email || "");
      const toField = field("Send to", to, { help: "Up to 10 addresses, separated by commas. The campaign is saved first, so the test matches what's on screen." });
      const msg = el("p", { class: "nle-msg", id: "nleTestMsg", role: "status" });
      const last = el("p", { class: "nle-help" }, r.test_sent_at ? "Last test " + fmtDateTime(r.test_sent_at) + " to " + (r.test_sent_to || "you") + "." : "No test sent yet.");
      const diagBox = el("div", { id: "nlpDiag" });
      const sendBtn = btn("Send test", "nle-btn--primary", async () => {
        const emails = [...new Set(String(to.value || "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
        const bad = emails.filter((x) => !EMAIL_RE.test(x));
        if (!emails.length) { toField.setError("Enter at least one address."); return; }
        if (bad.length) { toField.setError("Check these addresses: " + bad.join(", ")); return; }
        if (emails.length > 10) { toField.setError("Up to 10 test addresses at a time."); return; }
        toField.setError(""); sendBtn.disabled = true; msg.className = "nle-msg"; msg.textContent = "Saving and sending…";
        try {
          if (isDirty()) { const { data, error } = await supabase.from("pgc_campaigns").update(model.payload()).eq("id", r.id).select("*").single(); if (error) throw new Error(error.message); markSaved(data); }
          const out = await mc("test_send", { campaign_id: r.id, emails });
          if (out.row) markSaved(out.row);
          renderHeader(); if (!E.sel && !E.pick) renderInspector();
          msg.textContent = "Test email sent to " + out.sentTo + ". Check the inbox (and spam) before sending to the audience.";
          last.textContent = "Last test " + fmtDateTime(r.test_sent_at) + " to " + (r.test_sent_to || "you") + ".";
          notice("Test email sent to " + out.sentTo + ".", "ok", 6000);
        } catch (e) { msg.className = "nle-msg is-error"; msg.textContent = e.message || String(e); }
        finally { sendBtn.disabled = false; }
      }, { id: "nlpTest" });
      const diagBtn = btn("Check sending setup", "", async () => { diagBox.innerHTML = ""; diagBox.append(el("p", { class: "nle-help" }, "Asking Mailchimp…")); try { const D = await mc("diagnose", { campaign_id: r.id }); st.diag = Object.assign({ campaignId: r.id }, D); model.renderDiag(diagBox, st.diag); } catch (e) { diagBox.innerHTML = ""; diagBox.append(el("p", { class: "nle-msg is-error" }, e.message || String(e))); } }, { id: "nlpDiagnose" });
      body.append(toField, last, msg, diagBox, el("div", { class: "nle-dialog-actions" }, sendBtn, diagBtn, el("span", { class: "nle-spacer" }), btn("Close", "nle-btn--ghost", close)));
      if (st.diag && st.diag.campaignId === r.id) model.renderDiag(diagBox, st.diag);
    } });
  }
  function openReviewDialog() {
    openDialog({ kicker: canPublish ? "Review & send" : "Review & submit", title: d.subject || d.title || "Untitled campaign", wide: true, build(body, close) {
      const s = status(), tested = model.testedAfterSave(r), dirty = isDirty();
      // The summary describes what will be sent: the saved row (the draft on screen when nothing is saved yet).
      const src = r && dirty ? r : r || d;
      const kv = el("dl", { class: "nle-kv" });
      const row = (k, v) => kv.append(el("dt", null, k), el("dd", null, v));
      row("Subject", (src.subject || "").trim() || el("span", { class: "nle-error", style: "display:inline" }, "Missing"));
      row("Preview text", (src.preview_text || "").trim() || el("em", null, "None (inboxes show the first line instead)"));
      row("From", (src.from_name || "Proving Ground Capital (PGC)") + " <" + (src.reply_to || "innovations@theari.us") + ">");
      // Who it goes to: chosen here. A publisher's choice travels with Send / Schedule (no new test needed);
      // a contributor's choice is saved on the draft for the publisher to see.
      if (!E.rvAud || E.rvAud.row !== (r && r.id)) E.rvAud = { row: r && r.id, id: src.segment_id ? Number(src.segment_id) : null, name: src.segment_name || "" };
      const editable = !locked() && !!r;
      const pick = control("select", { id: "nleRvSendTo", "aria-label": "Send to", disabled: !editable });
      const fillPick = () => { pick.innerHTML = ""; pick.append(el("option", { value: "" }, "Everyone in the audience" + (st.audience && st.audience.members != null ? " · " + Number(st.audience.members).toLocaleString("en-US") : ""))); (st.groups || []).forEach((gr) => pick.append(el("option", { value: String(gr.id) }, gr.name + " · " + Number(gr.count).toLocaleString("en-US") + (gr.type === "static" ? "" : " (segment)")))); if (E.rvAud.id && !(st.groups || []).some((x) => x.id === E.rvAud.id)) pick.append(el("option", { value: String(E.rvAud.id) }, (E.rvAud.name || "Group") + " (no longer in Mailchimp)")); pick.value = E.rvAud.id ? String(E.rvAud.id) : ""; };
      fillPick();
      pick.addEventListener("change", () => {
        const gr = (st.groups || []).find((x) => String(x.id) === pick.value);
        E.rvAud = { row: r && r.id, id: gr ? gr.id : null, name: gr ? gr.name : "" };
        if (!canPublish) { d.segment_id = E.rvAud.id; d.segment_name = E.rvAud.name; changed({ keepInspector: true }); close(); openReviewDialog(); return; }
        const n = document.getElementById("nleRvAudNote"); if (n) n.textContent = rvAudienceText();
        const h = document.getElementById("nleRvSendHelp"); if (h && /^Goes to /.test(h.textContent)) h.textContent = h.textContent.replace(/^Goes to [^.]*\./, "Goes to " + (E.rvAud.id ? "the subscribed contacts in “" + E.rvAud.name + "”" : "every subscribed contact") + ".");
      });
      const audCell = el("div", { class: "nle-rv-aud" }, pick);
      if (canPublish && editable) audCell.append(btn("Upload a CSV…", "nle-btn--sm", () => { E.rvUpload = !E.rvUpload; close(); openReviewDialog(); }, { id: "nleRvUploadBtn", "aria-expanded": E.rvUpload ? "true" : "false" }));
      audCell.append(el("span", { class: "nle-help", id: "nleRvAudNote" }, rvAudienceText()));
      row("Send to", audCell);
      row("Last test", r && r.test_sent_at ? fmtDateTime(r.test_sent_at) + " to " + (r.test_sent_to || "you") + (tested ? "" : " (before the last save — send a new one)") : "Not sent yet");
      row("Status", model.statusPill(s));
      body.append(el("div", { class: "nle-group" }, el("h3", { class: "nle-group-title" }, "Summary"), kv,
        el("div", { class: "nle-btnrow" }, btn("Download PDF preview", "nle-btn--sm", () => downloadPdf(), { id: "nleRvPdf" }))));
      const checks = el("div", { id: "nleRvChecks" });
      const localW = (renderEmail(false).warnings || []);
      const paintW = (ws, extra) => { checks.innerHTML = ""; if (!ws.length && !extra.length) checks.append(el("div", { class: "nle-check nle-check--ok" }, el("span", { class: "nle-check-dot" }), "Nothing to fix.")); ws.forEach((w) => checks.append(el("div", { class: "nle-check" }, el("span", { class: "nle-check-dot" }), el("span", null, w)))); extra.forEach((w) => checks.append(el("div", { class: "nle-check nle-check--error" }, el("span", { class: "nle-check-dot" }), el("span", null, w)))); };
      paintW(localW, dirty ? ["You have unsaved changes. The summary above describes the saved version; save before sending so the email matches what is on screen."] : []);
      const svc = el("div", { class: "nle-check", id: "nleRvService", hidden: !(r && !dirty) }, el("span", { class: "nle-check-dot" }), el("span", null, "Checking with the sending service…"));
      body.append(el("div", { class: "nle-group" }, el("h3", { class: "nle-group-title" }, "Checks"), checks, svc));
      if (r && !dirty) {
        // The sending service renders the same source on the server; compare so a stale deployment shows here, not after sending.
        const run = async () => {
          svc.hidden = false; svc.className = "nle-check"; svc.innerHTML = ""; svc.append(el("span", { class: "nle-check-dot" }), el("span", null, "Checking with the sending service…"));
          try {
            const out = await mc("preview", { campaign_id: r.id });
            const theirs = out && out.renderer, same = out && out.html === renderEmail(false).html;
            const serverW = (out && out.warnings) || [];
            paintW([...new Set([...localW, ...serverW])], []);
            if (same) { svc.className = "nle-check nle-check--ok"; svc.innerHTML = ""; svc.append(el("span", { class: "nle-check-dot" }), el("span", null, "The sending service renders this campaign exactly as shown.")); }
            else { svc.className = "nle-check"; svc.innerHTML = ""; svc.append(el("span", { class: "nle-check-dot" }), el("span", null, theirs && theirs !== RENDER_VERSION ? "The sending service runs renderer v" + theirs + " (this page: v" + RENDER_VERSION + "), so the email can differ slightly from the canvas. Send yourself a test to see exactly what the audience receives." : !theirs ? "The sending service runs an older renderer than this page, so the email can differ slightly from the canvas. Send yourself a test to see exactly what the audience receives." : "The sending service renders this campaign slightly differently from the canvas. Send yourself a test to see exactly what the audience receives.")); }
          } catch (e) { svc.className = "nle-check nle-check--error"; svc.innerHTML = ""; svc.append(el("span", { class: "nle-check-dot" }), el("span", null, "Couldn't check with the sending service (" + (e.message || e) + "). You can still send a test."), btn("Retry", "nle-btn--sm nle-btn--ghost", run)); }
        };
        run();
      }
      if (canPublish && E.rvUpload && !locked() && r) body.append(rvUploadPanel(close));
      if (!st.audience || !st.groups) Promise.all([loadAudience(), loadGroups()]).then(() => { if (pick.isConnected) { fillPick(); const n = document.getElementById("nleRvAudNote"); if (n) n.textContent = rvAudienceText(); } });
      const msg = el("p", { class: "nle-msg", role: "status" });
      const actions = el("div", { class: "nle-dialog-actions" });
      if (!r) {
        body.append(el("p", { class: "nle-note" }, "Save the campaign to send tests, submit it for review, or send it."));
        actions.append(btn("Save campaign", "nle-btn--primary", async () => { const ok = await save(); if (ok) { close(); openReviewDialog(); } }), el("span", { class: "nle-spacer" }), btn("Close", "nle-btn--ghost", close));
      } else if (locked()) {
        actions.append(el("span", { class: "nle-spacer" }), btn("Close", "nle-btn--ghost", close));
      } else {
        if (canPublish) {
          const sendBtn = btn("Send now", "nle-btn--primary", async () => { close(); const ok = await sendNow(); if (!ok) openReviewDialog(); }, { id: "nlpSendNow", disabled: !tested || dirty, title: tested && !dirty ? "" : "Send yourself a test after your last save first" });
          const when = el("input", { type: "datetime-local", class: "nle-input", id: "nl_when", step: "900", disabled: !tested || dirty });
          when.value = E.whenValue || "";
          when.addEventListener("input", () => { E.whenValue = when.value; });
          const schedBtn = btn("Schedule", "", async () => {
            const v = when.value; const bad = (t) => { msg.className = "nle-msg is-error"; msg.textContent = t; };
            if (!v) { bad("Pick a date and time first."); return; }
            const at = new Date(v); if (isNaN(at.getTime()) || at.getTime() < Date.now() + 5 * 60000) { bad("Choose a time at least a few minutes from now."); return; }
            close();   // one dialog at a time: the confirmation takes over, and the review reopens if it is cancelled
            const ok = await schedule(v, (t) => notice(t, "error", 6000));
            if (!ok) openReviewDialog();
          }, { id: "nlpSchedule", disabled: !tested || dirty });
          body.append(el("div", { class: "nle-group" }, el("h3", { class: "nle-group-title" }, "Send"), el("p", { class: "nle-help", id: "nleRvSendHelp", style: "margin:0 0 12px" }, tested && !dirty ? "Goes to " + (E.rvAud && E.rvAud.id ? "the subscribed contacts in “" + E.rvAud.name + "”" : "every subscribed contact") + ". Mailchimp sends on the quarter hour; scheduled times are rounded up (your local time zone)." : dirty ? "Save first, then send a test, before sending to the audience." : "Send yourself a test after your last save before sending to the audience."),
            el("div", { class: "nle-schedule" }, sendBtn, el("span", { class: "nle-help", style: "margin:0 4px" }, "or"), el("div", { class: "nle-field" }, el("label", { class: "nle-label", for: "nl_when" }, "Schedule for"), when), schedBtn)));
          if (!tested && !dirty) actions.append(btn("Send test…", "", () => { close(); openTestDialog(); }));
        } else {
          body.append(el("p", { class: "nle-note" }, "A newsletter publisher sends or schedules campaigns. Submit for review when it's ready."));
        }
        if (dirty) actions.append(btn("Save", "nle-btn--primary", async () => { const ok = await save(); if (ok) { close(); openReviewDialog(); } }));
        if (s !== "in_review") actions.append(btn("Submit for review", canPublish ? "" : "nle-btn--primary", async () => { if (await setStatus("in_review")) close(); }, { id: "nlpReview", disabled: dirty }));
        if (canPublish && s === "in_review") actions.append(btn("Request changes", "", async () => { if (await setStatus("changes_requested")) close(); }, { id: "nlpChanges", disabled: dirty }));
        if (s !== "draft") actions.append(btn("Back to draft", "nle-btn--ghost", async () => { if (await setStatus("draft")) close(); }, { id: "nlpDraft", disabled: dirty }));
        actions.append(el("span", { class: "nle-spacer" }), btn("Close", "nle-btn--ghost", close));
      }
      body.append(msg, actions);
    } });
  }
  /* Review & send audience: what was picked in the dialog (falls back to the saved row). */
  const rvSource = () => (E.rvAud && r && E.rvAud.row === r.id ? { segment_id: E.rvAud.id, segment_name: E.rvAud.name } : r);
  const rvPayload = () => { const s = rvSource() || {}; return { segment_id: s.segment_id ? Number(s.segment_id) : 0, segment_name: s.segment_name || "" }; };
  function rvAudienceText() {
    const a = audienceFor(rvSource() || d);
    return a.group ? "Only the subscribed contacts in this group receive it." : "Every subscribed contact receives it.";
  }
  /* Upload a CSV from Review & send: the contacts become a new group (a Mailchimp tag) that is then picked. */
  function rvUploadPanel(closeDialog) {
    const U = E.rvUp || (E.rvUp = { imp: null, rows: null, notes: null, status: "pending", name: "", busy: false });
    if (!U.name) U.name = ((d.title || "Campaign").trim() + " " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })).slice(0, 60);
    const box = el("div", { class: "nle-group nle-rv-upload", id: "nleRvUpload" }, el("h3", { class: "nle-group-title" }, "Upload a list for this campaign"),
      el("p", { class: "nle-help", style: "margin:0 0 10px" }, "A CSV with a header row and an email column (first and last name too, if you have them). The contacts are added to the Mailchimp audience as a new group, and this campaign is set to send to that group."));
    const msg = el("p", { class: "nle-msg", id: "nleRvUploadMsg", role: "status" });
    const file = el("input", { type: "file", id: "nleRvFile", accept: ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" });
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0]; if (!f) return;
      const imp = await model.readContacts(f);
      if (!imp) { msg.className = "nle-msg is-error"; msg.textContent = "That file is empty."; return; }
      const { out, notes } = model.contactRows(imp);
      U.imp = imp; U.rows = out; U.notes = notes; closeDialog(); openReviewDialog();
    });
    box.append(el("div", { class: "nle-field" }, el("label", { class: "nle-label", for: "nleRvFile" }, "File"), file));
    if (U.imp) {
      const skipped = U.notes ? U.notes.invalid + U.notes.dup + U.notes.blank : 0;
      box.append(el("p", { class: "nle-help", id: "nleRvFound" }, el("b", null, U.imp.name), " · " + U.rows.length.toLocaleString("en-US") + " contact" + (U.rows.length === 1 ? "" : "s") + " found" + (skipped ? " (" + skipped + " row" + (skipped === 1 ? "" : "s") + " skipped: no valid email or a duplicate)" : "") + "."));
      const name = control("input", { type: "text", id: "nleRvGroupName", maxlength: "60" }); name.value = U.name; name.addEventListener("input", () => { U.name = name.value; });
      box.append(field("Group name", name, { help: "Kept on Email Lists, so you can send to these people again." }));
      const radio = (v, label, help) => { const x = el("input", { type: "radio", name: "nleRvStatus", id: "nleRvStatus_" + v, value: v }); x.checked = U.status === v; x.addEventListener("change", () => { if (x.checked) U.status = v; }); return el("label", { class: "nle-radio" }, x, el("span", null, el("b", null, label), el("br"), el("span", { class: "nle-help" }, help))); };
      box.append(el("div", { class: "nle-field", role: "radiogroup", "aria-label": "Consent" },
        radio("pending", "Send them a confirmation email first", "Safest. They get this campaign only after they confirm, so anyone who hasn't confirmed by send time won't receive it."),
        radio("subscribed", "They already asked to hear from Proving Ground Capital", "Added as subscribed, so they receive this campaign. Only for people who opted in.")));
      const go = btn("Add " + U.rows.length.toLocaleString("en-US") + " and send to this group", "nle-btn--primary", async () => {
        const groupName = (U.name || "").trim().slice(0, 60);
        if (groupName.length < 2) { msg.className = "nle-msg is-error"; msg.textContent = "Name the group (2 to 60 characters)."; name.focus(); return; }
        if (!U.rows.length || U.busy) return;
        U.busy = true; go.disabled = true;
        let added = 0, updated = 0, errors = 0;
        try {
          for (let i = 0; i < U.rows.length; i += 500) {
            msg.className = "nle-msg"; msg.textContent = "Adding " + Math.min(i + 500, U.rows.length).toLocaleString("en-US") + " of " + U.rows.length.toLocaleString("en-US") + "…";
            const res = await mc("import_members", { members: U.rows.slice(i, i + 500), status: U.status, tags: [groupName] });
            added += res.added || 0; updated += res.updated || 0; errors += (res.errors || []).length;
          }
          st.groups = null; await loadGroups();
          const gr = (st.groups || []).find((x) => x.name.toLowerCase() === groupName.toLowerCase());
          E.rvAud = { row: r && r.id, id: gr ? gr.id : null, name: gr ? gr.name : "" };
          E.rvUpload = false; E.rvUp = null;
          notice(added.toLocaleString("en-US") + " added, " + updated.toLocaleString("en-US") + " already in the audience" + (errors ? ", " + errors + " rejected" : "") + ". " + (gr ? "This campaign now goes to “" + gr.name + "”." : "Pick the new group under Send to once Mailchimp lists it."), gr ? "ok" : "error", 9000);
          closeDialog(); openReviewDialog();
        } catch (e) { U.busy = false; go.disabled = false; msg.className = "nle-msg is-error"; msg.textContent = "Upload stopped: " + ((e && e.message) || e); }
      }, { id: "nleRvUploadGo", disabled: !U.rows.length });
      box.append(el("div", { class: "nle-btnrow" }, go, btn("Cancel", "nle-btn--ghost", () => { E.rvUpload = false; E.rvUp = null; closeDialog(); openReviewDialog(); })));
    }
    box.append(msg);
    return box;
  }
  async function sendNow() {
    if (!st.audience || !st.groups) await Promise.all([loadAudience(), loadGroups()]);
    const a = audienceFor(rvSource()), n = a.count;
    const ok = await confirmDialog({ kicker: a.group ? "Send to a group" : "Send to the audience", title: "Send “" + (r.subject || r.title) + "” now?", body: (a.group ? "This goes to the subscribed contacts in the “" + a.group + "” group" : "This goes to every subscribed contact in the Mailchimp audience") + (n != null ? " (" + Number(n).toLocaleString("en-US") + " people)" : "") + " and cannot be recalled.", confirmLabel: "Send now", danger: true });
    if (!ok) return false;
    try { const out = await mc("send", Object.assign({ campaign_id: r.id }, rvPayload())); if (out.row) model.replaceRow(out.row, { keepDraft: true }); notice("Campaign sent. Reports fill in over the next few hours.", "ok", 8000); model.reopen(out.row || r); return true; }
    catch (e) { notice(e.message || String(e), "error", 8000); return false; }
  }
  async function schedule(v, fail) {
    const when = new Date(v);
    if (isNaN(when.getTime())) { fail("Choose a valid date and time."); return false; }
    const ok = await confirmDialog({ kicker: "Schedule", title: "Schedule “" + (r.subject || r.title) + "”?", body: "Mailchimp will send it at " + fmtDateTime(when.toISOString()) + " (rounded up to the quarter hour). You can unschedule until then.", confirmLabel: "Schedule", danger: false });
    if (!ok) return false;
    try { const out = await mc("send", Object.assign({ campaign_id: r.id, schedule_time: when.toISOString() }, rvPayload())); if (out.row) model.replaceRow(out.row, { keepDraft: true }); notice("Scheduled for " + fmtDateTime(out.scheduledFor) + ".", "ok", 8000); model.reopen(out.row || r); return true; }
    catch (e) { fail(e.message || String(e)); return false; }
  }

  // ---------------- lifecycle ----------------
  const onBeforeUnload = (e) => { if (isDirty() && !locked()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", onBeforeUnload);
  const onResize = () => { fitPaper(); sizeFrame(); if (!isNarrow() && E.insp) closeDrawers(); if (!isPhone() && E.lib) closeDrawers(); };
  window.addEventListener("resize", onResize);
  const scroller = document.querySelector(".p-main");
  let scrollRaf = 0; const onScroll = () => { if (scrollRaf) return; scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; placeToolbar(); }); };
  if (scroller) scroller.addEventListener("scroll", onScroll, { passive: true });
  const stageRO = typeof ResizeObserver === "function" ? new ResizeObserver(() => { fitPaper(); }) : null;
  if (stageRO) stageRO.observe(stage);
  const headRO = typeof ResizeObserver === "function" ? new ResizeObserver(() => { root.style.setProperty("--nle-head-h", head.offsetHeight + "px"); }) : null;
  if (headRO) headRO.observe(head);
  // The portal's scroll container sits under its top bar: size the sticky panels from its real height.
  const vhRO = typeof ResizeObserver === "function" && scroller ? new ResizeObserver(() => { root.style.setProperty("--nle-vh", scroller.clientHeight + "px"); }) : null;
  if (vhRO) vhRO.observe(scroller); if (scroller) root.style.setProperty("--nle-vh", scroller.clientHeight + "px");
  function destroy() {
    window.removeEventListener("beforeunload", onBeforeUnload); window.removeEventListener("resize", onResize);
    if (scroller) scroller.removeEventListener("scroll", onScroll);
    if (headRO) headRO.disconnect(); if (stageRO) stageRO.disconnect(); if (vhRO) vhRO.disconnect();
    closeDrawers(); document.querySelectorAll(".nle-modal").forEach((m) => m.remove());
    if (panel) panel.classList.remove("is-nle");
    root.remove();
  }

  renderHeader(); renderInspector(); fitPaper(); paintNow();
  syncLogoMeta();
  ensureRefs().then((got) => { if (got) paintNow(); });
  if (!isTpl) loadAudience();
  return {
    destroy, isDirty, select, state: E, draft: d,
    refresh: () => { renderHeader(); renderInspector(); paintNow(); },
    /** The row changed elsewhere (a status refresh from Mailchimp): reflect it without remounting. */
    rowUpdated: (u) => { if (!u || !r || u.id !== r.id) return; r = u; if (locked()) { model.reopen(u); return; } renderHeader(); if (!E.sel && !E.pick) renderInspector(); },
    /** The portal shell's leave guard: save, report success. */
    saveFromShell: () => (isTpl ? saveTemplate() : save()),
    /** The user chose to leave without saving: stop guarding this draft. */
    markClean: () => { E.lastSaved = snapshot(); E.saveState = r ? "saved" : "new"; paintSaveState(); },
  };
}
