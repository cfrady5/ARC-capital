/* Email campaigns for Proving Ground Capital (PGC): composed in the portal and
   sent through Mailchimp, plus reports, reusable templates and the audience
   (email lists). Adapted from ARI's assets/newsletter.js (cfrady5/ARI).
   Drafts live in public.pgc_campaigns and public.pgc_campaign_templates
   (RLS: the pgc_newsletter module). Preview, test sends, scheduling, sending,
   reports and audience reads go through the `pgc-mailchimp` edge function,
   which holds the API key and re-checks the caller's access on every call.
   One instance drives four portal panels: campaigns, nlreports, nltemplates,
   nllists. */

import { mountEditor } from "./newsletter-editor.js";

export const STATUS = { draft: "Draft", in_review: "In review", changes_requested: "Changes requested", scheduled: "Scheduled", sent: "Sent" };
const STATUS_CLS = { draft: "pstatus--draft", in_review: "pstatus--review", changes_requested: "pstatus--changes", scheduled: "pstatus--new", sent: "pstatus--published" };
export const TEMPLATES = {
  digest: { label: "Digest", desc: "Headline, intro, then your sections in order. The monthly update." },
  release: { label: "Announcement", desc: "A single story: headline, intro, image and a button." },
  event: { label: "Invitation", desc: "One event or meeting with the details and a Register button." },
  newsletter: { label: "Newsletter", desc: "An issue line with the month and an “In this issue” list built from your headings." },
};

function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
const pct = (v) => (Math.round(Number(v || 0) * 1000) / 10) + "%";
const num = (v) => Number(v || 0).toLocaleString("en-US");
export function statusPill(s) { return el("span", { class: "pstatus " + (STATUS_CLS[s] || "pstatus--read") }, STATUS[s] || s); }
function field(label, input, help) { const l = el("label", { class: "portal-field" }, label, input); if (help) l.append(el("span", { class: "pform-help" }, help)); return l; }
function eventDate(start, end) {
  if (!start) return "";
  const s = new Date(start + "T00:00:00");
  const full = { month: "long", day: "numeric", year: "numeric" };
  if (!end || end === start) return s.toLocaleDateString("en-US", full);
  const e = new Date(end + "T00:00:00");
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) return s.toLocaleDateString("en-US", { month: "long", day: "numeric" }) + "–" + e.getDate() + ", " + e.getFullYear();
  return s.toLocaleDateString("en-US", full) + " – " + e.toLocaleDateString("en-US", full);
}
// Appearance holds nested settings (button, header, footer with its links): copy it whole so the draft
// on screen and the saved row never share objects.
const clone = (v) => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);
const testedAfterSave = (r) => !!(r && r.test_sent_at && new Date(r.test_sent_at).getTime() >= new Date(r.updated_at).getTime() - 5000);

const PANEL_META = {
  campaigns: ["Campaigns", "Email campaigns for the Proving Ground Capital audience, sent through Mailchimp. Compose, test on a few people, then send or schedule."],
  nlreports: ["Reports", "How each campaign performed and how the audience is growing."],
  nltemplates: ["Templates", "Reusable starting points: the built-in layouts and designs you save from a campaign."],
  nllists: ["Email Lists", "Who is in the Mailchimp audience, its tags and segments, and adding contacts."],
};
const DEFAULT_VIEW = { campaigns: "list", nlreports: "reports", nltemplates: "tlist", nllists: "lists" };
const SITE = "https://pgc.capital";
const FROM_NAME = "Proving Ground Capital (PGC)";
const REPLY_TO = "innovations@theari.us";

export function initMarketing({ supabase, roots, access, edgeCall, confirmDialog, notice, fmtDate, fmtDateTime, navigate, onChange }) {
  const canPublish = !!access.canPublish("pgc_newsletter");
  const st = { rows: [], panel: "campaigns", view: "list", viewOf: {}, mode: "campaign", tpl: null, templates: null, filter: "all", row: null, draft: null, posts: null, events: null, picker: null, reports: null, report: null, busy: false, loaded: false, library: null, themes: null,
    lists: { members: [], total: 0, offset: 0, q: "", status: "", loading: false, segments: null, stats: null, audience: null, error: null, configured: true, group: null, newGroup: "", contactsOpen: false } };
  const mc = (action, payload) => edgeCall("pgc-mailchimp", Object.assign({ action }, payload || {}));

  /* ---------- shell: one head + body per panel ---------- */
  const panels = {};
  Object.entries(PANEL_META).forEach(([id, [title, desc]]) => {
    const root = roots[id]; if (!root) return;
    const actions = el("div", { class: "ppage-actions" });
    const b = el("div", { class: "nlp-body", id: "nlpBody-" + id });
    root.innerHTML = "";
    // A live region that survives re-renders, so state changes (a group opened, rows loaded) are announced.
    const live = el("p", { class: "sr-only", role: "status", "aria-live": "polite", id: "nlpLive-" + id });
    root.append(el("div", { class: "ppage-head" }, el("div", null, el("h1", { class: "ppage-title" }, title), el("p", { class: "ppage-desc" }, desc)), actions), b, live);
    panels[id] = { root, actions, body: b, live };
  });
  let body = panels.campaigns.body, headActions = panels.campaigns.actions;
  function activate(id) {
    if (!panels[id]) return;
    if (st.panel !== id && panels[st.panel]) {
      // One editor at a time: leaving a page that shows the composer closes it,
      // so two forms with the same field ids never coexist.
      const v = st.viewOf[st.panel];
      if (v === "edit" || v === "tedit") { if (st.editor) { st.editor.destroy(); st.editor = null; } st.viewOf[st.panel] = DEFAULT_VIEW[st.panel]; st.draft = null; st.row = null; st.tpl = null; st.mode = "campaign"; st.preview = null; panels[st.panel].body.innerHTML = ""; panels[st.panel].actions.innerHTML = ""; }
    }
    if (st.panel !== id) st.focusNext = null;
    st.panel = id; body = panels[id].body; headActions = panels[id].actions; st.view = st.viewOf[id] || DEFAULT_VIEW[id];
  }
  const renderIf = (id) => { if (st.panel === id) render(); };
  function announce(text) { const n = panels[st.panel] && panels[st.panel].live; if (!n) return; n.textContent = ""; requestAnimationFrame(() => { n.textContent = text; }); }

  function flashErr(e) { notice((e && e.message) || String(e), "error", 8000); }
  function setView(v) { st.view = v; st.viewOf[st.panel] = v; render(); }
  const go = (tab, opts) => (navigate ? navigate(tab, opts) : show(tab, opts));

  function renderHead() {
    headActions.innerHTML = "";
    if (st.panel === "campaigns" && st.view === "list") headActions.append(el("button", { type: "button", class: "btn btn-primary", id: "nlpNew", onclick: () => newCampaign() }, "New campaign"));
    if (st.panel === "nltemplates" && st.view === "tlist") headActions.append(el("button", { type: "button", class: "btn btn-primary", id: "nlpNewTemplate", onclick: () => editTemplate(null) }, "New template"));
    if (st.panel === "nlreports") headActions.append(el("button", { type: "button", class: "portal-mini", id: "nlpReportsRefresh", onclick: () => { st.reports = null; openReports(); } }, "Refresh"));
    if (st.panel === "nllists") { headActions.append(el("button", { type: "button", class: "portal-mini", id: "nlpListsRefresh", onclick: () => loadLists(true) }, "Refresh")); if (canPublish) headActions.append(el("button", { type: "button", class: "btn btn-secondary", id: "nlpImportList", onclick: () => { st.lists.importing = !st.lists.importing; st.lists.adding = false; render(); } }, "Upload a list"), el("button", { type: "button", class: "btn btn-primary", id: "nlpAddContact", onclick: () => { st.lists.adding = !st.lists.adding; st.lists.importing = false; render(); } }, "Add contact")); }
  }

  /* ---------- data ---------- */
  async function load() {
    const { data, error } = await supabase.from("pgc_campaigns").select("*").order("updated_at", { ascending: false });
    if (error) { body.innerHTML = ""; body.append(el("p", { class: "portal-empty" }, "Couldn’t load campaigns: " + error.message)); return; }
    st.rows = data || [];
    st.loaded = true;
    if (onChange) onChange(st.rows);
    render();
    // Scheduled/sent rows: let Mailchimp tell us if anything changed.
    const ids = st.rows.filter((r) => r.status === "scheduled" || (r.status === "sent" && r.emails_sent == null)).map((r) => r.id);
    if (ids.length) mc("refresh", { ids }).then((d) => { if (d && d.rows && d.rows.length) { d.rows.forEach((u) => { const i = st.rows.findIndex((r) => r.id === u.id); if (i >= 0) st.rows[i] = u; if (st.row && st.row.id === u.id) { st.row = u; if (st.editor) st.editor.rowUpdated(u); } }); render(); } }).catch(() => {});
  }
  async function loadLibrary() {
    if (st.library) return st.library;
    const abs = (u) => (/^https?:\/\//i.test(u) ? u : SITE + "/" + String(u).replace(/^(\.\.\/|\.\/|\/)+/, ""));
    // ink: the color of the artwork itself (a light logo gets a dark plate on
    // light emails). PNG copies of the site's SVG logos, rendered for email clients.
    const items = [
      { name: "PGC logo (dark)", url: "assets/img/email/pgc-logo-dark.png", ink: "dark" },
      { name: "PGC logo (mint)", url: "assets/img/email/pgc-logo-mint.png", ink: "light" },
      { name: "PGC mark (dark)", url: "assets/img/email/pgc-mark-dark.png", ink: "dark" },
      { name: "PGC mark (mint)", url: "assets/img/email/pgc-mark-mint.png", ink: "light" },
      { name: "Wordmark (mint)", url: "assets/img/email/pgc-wordmark-mint.png", ink: "light" },
    ];
    st.library = items.map((x) => Object.assign({ preview: abs(x.url) }, x));
    await Promise.all(st.library.map(async (it) => { const m = await measureLogo(logoKey(it.url)); if (m && m.ink) it.ink = m.ink; }));
    return st.library;
  }
  /** Links already on the website: the pgc.capital pages and the contact routes. */
  async function loadSiteLinks() {
    if (st.siteLinks) return st.siteLinks;
    st.siteLinks = [
      { label: "pgc.capital", items: [["Home", SITE + "/"], ["Investment Thesis", SITE + "/thesis/"], ["For Investors", SITE + "/investors/"], ["Founders & Companies", SITE + "/founders/"], ["Team", SITE + "/team/"], ["Contact", SITE + "/contact/"]] },
      { label: "Contact routes", items: [["Partner with PGC", SITE + "/contact/?intent=partner"], ["Investor conversation", SITE + "/contact/?type=lp&intent=conversation"], ["Submit a company", SITE + "/contact/?type=founder&intent=submit"], ["Scope an advisory engagement", SITE + "/contact/?type=founder&intent=advisory"]] },
    ];
    return st.siteLinks;
  }
  // PGC has one brand and no event-builder themes: the renderer's PGC palette is the only look.
  async function loadThemes() { st.themes = st.themes || []; return st.themes; }
  // ---- Logo facts for the email renderer: the color of the artwork and its
  // pixel size, measured here because the renderer cannot look at pixels.
  // Keyed by absolute URL, the way the renderer names files.
  const logoKey = (u) => (/^https?:\/\//i.test(u) ? String(u).trim() : SITE + "/" + String(u).trim().replace(/^(\.\.\/|\.\/|\/)+/, ""));
  const measured = new Map();
  function measureLogo(key) {
    if (measured.has(key)) return measured.get(key);
    const pr = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const out = { ink: "", w: img.naturalWidth, h: img.naturalHeight };
        try {
          const cv = document.createElement("canvas"); cv.width = 64; cv.height = 64;
          const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 64, 64);
          const d = g.getImageData(0, 0, 64, 64).data; let n = 0, light = 0;
          for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 170) continue; n++; if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 200) light++; }
          if (n >= 20) out.ink = light / n > 0.6 ? "light" : light / n < 0.25 ? "dark" : "";
        } catch (e) { /* a file this origin may not read: size only */ }
        resolve(out.w && out.h ? out : null);
      };
      img.onerror = () => resolve(null);
      // Site files are read through this origin so the canvas may inspect them.
      img.src = /^https:\/\/(www\.)?pgc\.capital\//i.test(key) ? location.origin + key.replace(/^https:\/\/(www\.)?pgc\.capital/i, "") : key;
    });
    measured.set(key, pr);
    return pr;
  }
  // The files the renderer may put in the header for a theme: the kit's light- and dark-surface logos and the initiative's site logo.
  const themeLogoKeys = (t) => { const c = (t && t.configuration) || {}; return [c.logo_url, c.logo_dark_url, t && t.initiative && t.initiative.logo_image].filter((u) => typeof u === "string" && u.trim()).map(logoKey).filter((k, i, a) => a.indexOf(k) === i); };
  // No newsroom or events on this site: the post/event pickers stay empty.
  async function loadPickers() { await loadThemes(); st.posts = st.posts || []; st.events = st.events || []; }

  /* ---------- list ---------- */
  function renderList() {
    const chips = el("div", { class: "portal-filters nlp-filters" });
    [["all", "All"], ["draft", "Drafts"], ["in_review", "In review"], ["changes_requested", "Changes requested"], ["scheduled", "Scheduled"], ["sent", "Sent"]].forEach(([v, l]) => {
      const n = v === "all" ? st.rows.length : st.rows.filter((r) => r.status === v).length;
      chips.append(el("button", { type: "button", class: "portal-mini" + (st.filter === v ? " is-active" : ""), onclick: () => { st.filter = v; render(); } }, l + (n ? " (" + n + ")" : "")));
    });
    const list = el("div", { class: "portal-list nlp-list", id: "nlpList" });
    const rows = st.rows.filter((r) => st.filter === "all" || r.status === st.filter);
    // Multi-select: keep only ids that still exist, then a bar to select what is shown and delete it.
    const sel = st.selected = new Set([...(st.selected || [])].filter((id) => st.rows.some((r) => r.id === id && canDeleteCampaign(r))));
    const deletable = rows.filter(canDeleteCampaign);
    let bar = null;
    if (deletable.length) {
      const shownSel = deletable.filter((r) => sel.has(r.id)).length;
      const all = el("input", { type: "checkbox", id: "nlpSelectAll", "aria-label": "Select every campaign shown that can be deleted" });
      all.checked = shownSel > 0 && shownSel === deletable.length; all.indeterminate = shownSel > 0 && shownSel < deletable.length;
      all.addEventListener("change", () => { deletable.forEach((r) => (all.checked ? sel.add(r.id) : sel.delete(r.id))); render(); });
      bar = el("div", { class: "nlp-selbar" + (sel.size ? " is-on" : ""), id: "nlpSelBar" },
        el("label", { class: "nlp-selall" }, all, el("span", null, sel.size ? sel.size + " selected" : "Select")),
        sel.size ? el("button", { type: "button", class: "portal-mini", id: "nlpSelClear", onclick: () => { sel.clear(); render(); } }, "Clear") : null,
        el("button", { type: "button", class: "portal-mini portal-mini--danger", id: "nlpDeleteSelected", disabled: !sel.size, onclick: () => deleteCampaigns([...sel]) }, sel.size ? "Delete " + sel.size : "Delete"),
        el("span", { class: "nlp-selnote" }, "Sent and scheduled campaigns can’t be deleted" + (canPublish ? "" : "; contributors can delete their own drafts") + "."));
    }
    if (!st.rows.length) list.append(el("p", { class: "portal-empty" }, "No campaigns yet. Start with New campaign: pick a layout, add headings, text, images and buttons, send yourself a test, then send or schedule."));
    else if (!rows.length) list.append(el("p", { class: "portal-empty" }, "Nothing with that status."));
    rows.forEach((r) => {
      const meta = r.status === "sent" ? "Sent " + fmtDateTime(r.sent_at) + (r.emails_sent != null ? " · " + num(r.emails_sent) + " recipients" : "")
        : r.status === "scheduled" ? "Scheduled for " + fmtDateTime(r.scheduled_for)
        : "Updated " + fmtDateTime(r.updated_at) + (r.updated_by ? " by " + r.updated_by : "");
      const can = canDeleteCampaign(r);
      const box = el("input", { type: "checkbox", class: "nlp-rowcheck", "data-id": r.id, "aria-label": can ? "Select “" + r.title + "”" : "“" + r.title + "” can’t be deleted (" + (STATUS[r.status] || r.status).toLowerCase() + ")", title: can ? "Select" : (r.status === "sent" ? "Sent campaigns are kept as the record of what went out" : r.status === "scheduled" ? "Unschedule it first" : "Only a publisher or the person who started this draft can delete it"), disabled: !can });
      box.checked = can && sel.has(r.id);
      box.addEventListener("change", () => { if (box.checked) sel.add(r.id); else sel.delete(r.id); render(); });
      list.append(el("div", { class: "nlp-rowwrap" + (box.checked ? " is-selected" : "") }, el("span", { class: "nlp-rowcheck-wrap" }, box),
        el("button", { type: "button", class: "nlp-row", onclick: () => openCampaign(r) },
          el("span", { class: "nlp-row-main" }, el("span", { class: "nlp-row-title" }, r.title), el("span", { class: "nlp-row-sub" }, r.subject || "(no subject yet)"), el("span", { class: "nlp-row-meta" }, meta)),
          el("span", { class: "nlp-row-side" }, el("span", { class: "pstatus pstatus--read nlp-tpl" }, (TEMPLATES[r.template] || TEMPLATES.digest).label), statusPill(r.status)))));
    });
    body.append(chips, ...(bar ? [bar] : []), list);
  }
  /* Mirrors the delete policy: publishers delete anything not sent; contributors their own drafts. Scheduled
     campaigns are excluded too, because deleting the row would leave Mailchimp's scheduled send in place. */
  function canDeleteCampaign(r) {
    if (!r || r.status === "sent" || r.status === "scheduled") return false;
    if (canPublish) return true;
    return r.status === "draft" && String(r.created_by || "").toLowerCase() === String(access.email || "").toLowerCase();
  }
  async function deleteCampaigns(ids) {
    const rows = st.rows.filter((r) => ids.includes(r.id) && canDeleteCampaign(r));
    if (!rows.length) return;
    const n = rows.length, names = rows.slice(0, 5).map((r) => "“" + r.title + "”").join(", ") + (n > 5 ? " and " + (n - 5) + " more" : "");
    const synced = rows.some((r) => r.mailchimp_id);
    const ok = await confirmDialog({ kicker: "Delete campaigns", title: "Delete " + n + " campaign" + (n === 1 ? "" : "s") + "?", body: names + ". This can’t be undone." + (synced ? " A draft copy already created in Mailchimp stays there; delete it in Mailchimp if you don’t want it." : ""), confirmLabel: "Delete " + n, danger: true });
    if (!ok) return;
    await busy(async () => {
      const { data, error } = await supabase.from("pgc_campaigns").delete().in("id", rows.map((r) => r.id)).select("id");
      if (error) throw error;
      const gone = new Set((data || []).map((r) => r.id));
      st.rows = st.rows.filter((r) => !gone.has(r.id));
      gone.forEach((id) => st.selected.delete(id));
      if (onChange) onChange(st.rows);
      const missed = n - gone.size;
      notice(gone.size + " campaign" + (gone.size === 1 ? "" : "s") + " deleted." + (missed ? " " + missed + " couldn’t be deleted (you may not have permission, or it changed status)." : ""), missed ? "error" : "ok", missed ? 8000 : 4000);
      render();
    });
  }

  /* ---------- composer ---------- */
  function blankDraft() {
    return { title: "", subject: "", preview_text: "", from_name: FROM_NAME, reply_to: REPLY_TO, template: "digest", content: { heading: "", intro: "", blocks: [], closing: "", theme_id: "", appearance: { mode: "light", background: "", card: "", logo: "auto", logoPlate: "auto" } } };
  }
  function draftFrom(r) {
    const c = (r.content && typeof r.content === "object") ? r.content : {};
    return { title: r.title || r.name || "", description: r.description || "", subject: r.subject || "", preview_text: r.preview_text || "", from_name: r.from_name || FROM_NAME, reply_to: r.reply_to || REPLY_TO, template: r.template || "digest", segment_id: Number(r.segment_id) > 0 ? Number(r.segment_id) : null, segment_name: r.segment_name || "",
      content: { heading: c.heading || "", intro: c.intro || "", closing: c.closing || "", theme_id: c.theme_id || "", appearance: Object.assign({ mode: "light", background: "", card: "", logo: "auto", logoPlate: "auto" }, clone(c.appearance) || {}), blocks: Array.isArray(c.blocks) ? c.blocks.map((b) => Object.assign({}, b)) : [] } };
  }
  async function newCampaign(preset) {
    st.mode = "campaign"; st.tpl = null; st.row = null; st.draft = blankDraft(); st.preview = null;
    if (preset && preset.template) st.draft.template = preset.template;
    if (preset && preset.fromTemplate) {
      const t = preset.fromTemplate;
      const d = draftFrom(t); d.title = ""; d.subject = t.subject || ""; d.preview_text = t.preview_text || ""; st.draft = d; st.fromTemplate = t.name;
    } else st.fromTemplate = null;
    if (st.panel !== "campaigns") activate("campaigns");
    await openEditor("edit");
  }
  async function openCampaign(r) { st.mode = "campaign"; st.tpl = null; st.row = r; st.draft = draftFrom(r); st.preview = null; await openEditor("edit"); }
  /** Show the workspace once the pickers (posts, events, themes) are loaded, so it mounts exactly once. */
  async function openEditor(view) {
    st.view = view; st.viewOf[st.panel] = view; renderHead();
    if (!st.posts || !st.events || !st.themes) { body.innerHTML = ""; body.append(el("p", { class: "portal-empty" }, "Loading…")); }
    await loadPickers(); render();
  }

  function renderEdit() {
    // The canvas workspace (assets/newsletter-editor.js) owns the editing UI; one instance per open draft.
    if (st.editor) { st.editor.destroy(); st.editor = null; }
    st.editor = mountEditor({ st, el, supabase, access, canPublish, mc, confirmDialog, notice, fmtDate, fmtDateTime, host: body, panel: panels[st.panel] && panels[st.panel].root, model });
  }
  /* What the workspace needs from this module. */
  const model = {
    TEMPLATES, statusPill, eventDate, testedAfterSave,
    payload: () => payload(), templatePayload: () => templatePayload(),
    replaceRow, removeRow: (id) => { st.rows = st.rows.filter((r) => r.id !== id); if (st.row && st.row.id === id) st.row = null; if (onChange) onChange(st.rows); },
    replaceTemplate: (t) => { st.tpl = t; if (st.templates) { const i = st.templates.findIndex((x) => x.id === t.id); if (i >= 0) st.templates[i] = t; else st.templates.unshift(t); } },
    loadTemplates, deleteTemplate, useTemplate, openReport, renderDiag, loadLibrary, loadSiteLinks, measureLogo, themeLogoKeys,
    leave: () => { const tpl = st.mode === "template"; st.editor = null; st.row = null; st.draft = null; st.preview = null; if (tpl) { st.tpl = null; st.mode = "campaign"; setView("tlist"); } else setView("list"); },
    reopen: (row) => { if (st.editor) st.editor.destroy(); st.editor = null; openCampaign(row || st.row); },
    // The Email Lists CSV reader, for uploading a list from Review & send.
    readContacts: (file) => readContacts(file), contactRows: (imp) => importRows(imp),
  };
  // A post/event block keeps its id plus any words overridden for this email (blank = the site's text).
  function refBlock(b) { const o = { type: b.type, id: b.id }; ["title", b.type === "post" ? "summary" : "description", "cta"].forEach((k) => { const v = typeof b[k] === "string" ? b[k].trim() : ""; if (v) o[k] = v; }); return o; }
  function payload() {
    const d = st.draft;
    return { title: d.title.trim(), subject: d.subject.trim(), preview_text: d.preview_text.trim(), from_name: d.from_name.trim() || FROM_NAME, reply_to: d.reply_to.trim() || REPLY_TO, template: d.template, segment_id: d.segment_id || null, segment_name: d.segment_id ? (d.segment_name || "") : "",
      content: { heading: d.content.heading.trim(), intro: d.content.intro, closing: d.content.closing, theme_id: d.content.theme_id || "", appearance: clone(d.content.appearance) || {}, blocks: d.content.blocks.map((b) => (b.type === "post" || b.type === "event" ? refBlock(b) : Object.assign({}, b))) } };
  }
  function flash(t, err) { const m = document.getElementById("nlpMsg"); if (!m) { notice(t, err ? "error" : "ok", err ? 8000 : 4000); return; } m.textContent = t; m.classList.toggle("err", !!err); clearTimeout(flash.t); flash.t = setTimeout(() => { m.textContent = ""; m.classList.remove("err"); }, err ? 8000 : 3000); }
  async function busy(fn) { if (st.busy) return; st.busy = true; try { await fn(); } catch (e) { flash(e.message || String(e), true); } finally { st.busy = false; } }
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  /** Keep a saved row in the list and as the open row; the workspace keeps its own draft object unless asked otherwise. */
  function replaceRow(u, opts) { const i = st.rows.findIndex((r) => r.id === u.id); if (i >= 0) st.rows[i] = u; else st.rows.unshift(u); st.row = u; if (!(opts && opts.keepDraft)) st.draft = draftFrom(u); if (onChange) onChange(st.rows); }
  function renderDiag(box, D) {
    box.innerHTML = "";
    if (!D) return;
    if (D.loading) { box.append(el("p", { class: "pform-help" }, "Asking Mailchimp…")); return; }
    if (D.error) { box.append(el("p", { class: "nle-msg is-error" }, D.error)); return; }
    if (D.configured === false) {
      const miss = D.missing || [];
      box.append(el("p", { class: "nle-msg is-error" }, "Mailchimp isn’t connected yet" + (miss.length ? " — set the " + miss.join(", ") + " secret" + (miss.length > 1 ? "s" : "") + " on the pgc-mailchimp function." : ".")));
      if ((D.audiences || []).length) {
        box.append(el("p", { class: "pform-help" }, "Audiences in this Mailchimp account — use the ID of the one PGC should send to:"));
        const ul = el("ul", { class: "nlp-diag" });
        D.audiences.forEach((a) => ul.append(el("li", { class: "nlp-diag-info" }, el("b", null, a.name), el("span", null, "ID " + a.id + " · " + a.members + " contacts"))));
        box.append(ul);
      }
      return;
    }
    const rows = [];
    const f = D.from || {};
    if (!f.known || !f.verified) rows.push(["error", "From address " + f.email + " is not verified in Mailchimp.", "Mailchimp accepts the request but does not deliver tests or campaigns from an unverified address. In Mailchimp go to Website → Domains, add " + f.domain + ", click the confirmation link it emails to an address at that domain, then send the test again."]);
    else if (!f.authenticated) rows.push(["warn", f.domain + " is verified but not authenticated.", "Mailchimp sends from its own domain instead of " + f.domain + ", so mail is more likely to land in spam or quarantine. Add the DKIM and DMARC records shown under Website → Domains → Authenticate."]);
    else rows.push(["ok", f.domain + " is verified and authenticated.", "Mailchimp signs mail as " + f.email + "."]);
    ((D.checklist && D.checklist.items) || []).filter((i) => i.type === "error" || i.type === "warning").forEach((i) => rows.push([i.type === "error" ? "error" : "warn", i.heading, i.details]));
    if (D.checklist && D.checklist.ready) rows.push(["ok", "Mailchimp’s send checklist is clear.", ""]);
    if (D.account) rows.push(["info", "Mailchimp account: " + (D.account.name || D.account.email) + (D.account.plan ? " · " + D.account.plan + " plan" : ""), D.audience ? "Audience “" + D.audience.name + "” · default From " + (D.audience.defaultFrom || "not set") : ""]);
    if (D.campaign && D.campaign.testSentAt) rows.push(["info", "Last test " + fmtDateTime(D.campaign.testSentAt) + " to " + D.campaign.testSentTo + ".", "If Mailchimp accepted it and nothing arrived, check spam and quarantine, then try a personal address (Gmail) to tell a Mailchimp problem from a company mail-filter problem."]);
    const ul = el("ul", { class: "nlp-diag" });
    rows.forEach(([k, h, d]) => ul.append(el("li", { class: "nlp-diag-" + k }, el("b", null, h), d ? el("span", null, d) : null)));
    box.append(ul);
  }

  /* ---------- templates ---------- */
  async function loadTemplates(force) {
    if (st.templates && !force) return st.templates;
    const { data, error } = await supabase.from("pgc_campaign_templates").select("*").order("updated_at", { ascending: false });
    if (error) { st.templates = []; notice("Couldn’t load templates: " + error.message, "error", 8000); return st.templates; }
    st.templates = data || [];
    return st.templates;
  }
  function templatePayload() {
    const p = payload();
    return { name: p.title || "Untitled template", description: (st.draft.description || "").trim(), template: p.template, from_name: p.from_name, reply_to: p.reply_to, subject: p.subject, preview_text: p.preview_text, content: p.content };
  }
  async function editTemplate(t) {
    st.mode = "template"; st.tpl = t || null; st.row = null; st.preview = null;
    st.draft = t ? draftFrom(t) : Object.assign(blankDraft(), { description: "" });
    if (st.panel !== "nltemplates") activate("nltemplates");
    await openEditor("tedit");
  }
  async function deleteTemplate(t) {
    const ok = await confirmDialog({ kicker: "Delete template", title: "Delete “" + t.name + "”?", body: "Campaigns already started from it are not affected.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await busy(async () => {
      const { error } = await supabase.from("pgc_campaign_templates").delete().eq("id", t.id);
      if (error) throw new Error(error.message);
      await loadTemplates(true);
      if (st.editor) { st.editor.destroy(); st.editor = null; }
      st.tpl = null; st.mode = "campaign"; st.draft = null; setView("tlist"); notice("Template deleted.", "ok");
    });
  }
  function useTemplate(t) { go("campaigns", { fromTemplate: t.id }); }
  function renderTemplates() {
    const builtIn = el("div", { class: "nlp-tpl-grid" });
    Object.entries(TEMPLATES).forEach(([key, t]) => builtIn.append(el("div", { class: "nlp-tpl-card" },
      el("span", { class: "nlp-block-kind" }, "Built-in layout"), el("b", { class: "nlp-tpl-name" }, t.label), el("p", { class: "nlp-tpl-desc" }, t.desc),
      el("div", { class: "nlp-add" }, el("button", { type: "button", class: "portal-mini portal-mini--go", onclick: () => go("campaigns", { create: true, template: key }) }, "Start a campaign")))));
    body.append(el("h2", { class: "psection-title nlp-first" }, "Layouts"), builtIn, el("h2", { class: "psection-title" }, "Saved templates"));
    const list = el("div", { class: "nlp-tpl-grid", id: "nlpTemplates" });
    if (!st.templates) list.append(el("p", { class: "portal-empty" }, "Loading…"));
    else if (!st.templates.length) list.append(el("p", { class: "portal-empty nlp-empty" }, "No saved templates yet. Open any campaign and choose “Save as template”, or start one with New template."));
    else st.templates.forEach((t) => list.append(el("div", { class: "nlp-tpl-card" },
      el("span", { class: "nlp-block-kind" }, (TEMPLATES[t.template] || TEMPLATES.digest).label + " · " + ((t.content && t.content.appearance && t.content.appearance.mode === "dark") ? "dark" : "light")),
      el("b", { class: "nlp-tpl-name" }, t.name), el("p", { class: "nlp-tpl-desc" }, t.description || "No description."),
      el("span", { class: "nlp-row-meta" }, "Updated " + fmtDateTime(t.updated_at) + (t.updated_by ? " by " + t.updated_by : "")),
      el("div", { class: "nlp-add" }, el("button", { type: "button", class: "portal-mini portal-mini--go", onclick: () => useTemplate(t) }, "Use"), el("button", { type: "button", class: "portal-mini", onclick: () => editTemplate(t) }, "Edit"), el("button", { type: "button", class: "portal-mini nlp-danger", onclick: () => deleteTemplate(t) }, "Delete")))));
    body.append(list);
  }

  /* ---------- email lists (Mailchimp audience) ---------- */
  async function loadLists(force, focus) {
    const L = st.lists;
    // The latest request wins: a search typed while a page is loading replaces it.
    const seq = (L.seq = (L.seq || 0) + 1);
    L.loading = true; L.error = null; if (force) { L.segments = null; L.offset = 0; }
    renderIf("nllists");
    // Groups and contacts load independently: a failing members page still leaves the groups band usable.
    const [segR, memR] = await Promise.allSettled([L.segments && !force ? Promise.resolve(null) : mc("segments"), mc("members", { q: L.group ? "" : L.q, status: L.status, offset: L.offset, segment_id: L.group ? L.group.id : undefined })]);
    if (seq !== L.seq) return;
    const seg = segR.status === "fulfilled" ? segR.value : null, mem = memR.status === "fulfilled" ? memR.value : null;
    if (seg) { L.segments = seg.segments || []; L.stats = seg.stats || null; L.audience = seg.audience || null; L.configured = seg.configured !== false; }
    if (mem) {
      if (mem.configured === false) L.configured = false;
      L.members = L.offset && !mem.search ? L.members.concat(mem.members || []) : (mem.members || []);
      L.total = mem.total || 0; L.search = !!mem.search;
    }
    const err = segR.status === "rejected" ? segR.reason : memR.status === "rejected" ? memR.reason : null;
    if (err) { L.error = (err && err.message) || String(err); L.contactsOpen = true; }
    L.loading = false; if (st.panel !== "nllists") return;
    if (focus) st.focusNext = focus; render();
    if (err) announce("Couldn’t load contacts: " + L.error);
    else if (mem && L.offset) announce("Showing " + num(L.members.length) + " of " + num(L.total) + " contacts.");
    else if (mem) announce(L.search ? num(L.total) + " contact" + (L.total === 1 ? "" : "s") + " match." : L.group ? "Showing " + num(L.total) + " contact" + (L.total === 1 ? "" : "s") + " in " + L.group.name + "." : "Showing everyone: " + num(L.total) + " contact" + (L.total === 1 ? "" : "s") + ".");
  }
  async function addContact(email, first, last, group) {
    await busy(async () => {
      const d = await mc("add_member", { email, first_name: first, last_name: last, tags: group ? [group] : [] });
      notice((d.state === "pending" ? "Confirmation email sent to " + email + ". They join once they click it." : email + " is already " + d.state + ".") + (group ? " Added to the “" + group + "” group." : ""), "ok", 8000);
      st.lists.adding = false; st.lists.offset = 0; loadLists(true, ["nlpAddContact"]);
    });
  }
  /* ---- Groups: separate lists kept as Mailchimp tags on the one audience ---- */
  const groupsOf = (L) => (L.segments || []).filter((g) => g.type === "static");
  async function createGroup(name) {
    await busy(async () => {
      const d = await mc("create_group", { name });
      notice("Group “" + d.group.name + "” created. Upload a list or add contacts into it.", "ok", 6000);
      st.lists.newGroup = ""; st.lists.group = d.group; st.lists.offset = 0; st.lists.contactsOpen = true; loadLists(true, ["nlpGroup-" + d.group.id, "nlpGroup-all"]);
    });
  }
  async function deleteGroup(g) {
    const ok = await confirmDialog({ kicker: "Remove a group", title: "Remove the “" + g.name + "” group?", body: "The " + num(g.count) + " contact" + (g.count === 1 ? "" : "s") + " in it stay in the audience; only the group (tag) goes away. Campaigns set to send to this group fall back to everyone.", confirmLabel: "Remove group", danger: true });
    if (!ok) return;
    await busy(async () => { await mc("delete_group", { segment_id: g.id }); if (st.lists.group && st.lists.group.id === g.id) st.lists.group = null; st.lists.offset = 0; loadLists(true, ["nlpGroup-all"]); });
  }
  function groupSelect(id, L, value, allowNew) {
    const sel = el("select", { id }, el("option", { value: "" }, allowNew ? "No group (just “Portal”)" : "No group"), ...groupsOf(L).map((g) => el("option", { value: g.name }, g.name + " (" + num(g.count) + ")")), allowNew ? el("option", { value: "__new" }, "New group…") : null);
    sel.value = value || ""; return sel;
  }
  /* ---- Upload a contact list (CSV/TSV with a header row) → import_members in batches of 500 ---- */
  function parseDelimited(text) {
    const t = String(text || "").replace(/^\uFEFF/, "");
    const first = t.split(/\r?\n/)[0] || "";
    const delim = [",", ";", "\t"].map((d) => [d, (first.match(new RegExp(d === "\t" ? "\t" : "\\" + d, "g")) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
  }
  const IMPORT_COLS = [
    ["email", "Email", ["email", "e-mail", "email address", "e-mail address", "mail", "address"]],
    ["first_name", "First name", ["first name", "first", "given name", "forename", "fname"]],
    ["last_name", "Last name", ["last name", "last", "surname", "family name", "lname"]],
    ["name", "Full name", ["name", "full name", "contact", "contact name", "person"]],
  ];
  const normHdr = (h) => String(h || "").toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  function importRows(imp) {
    const { grid, map } = imp;
    const data = imp.header ? grid.slice(1) : grid;
    const seen = new Set(); const out = []; const notes = { invalid: 0, dup: 0, blank: 0 };
    data.forEach((cells) => {
      const get = (k) => (map[k] >= 0 && map[k] < cells.length ? cells[map[k]] : "");
      const email = get("email").toLowerCase();
      if (!email) { if (cells.some((c) => c)) notes.blank++; return; }
      if (!EMAIL_RE.test(email)) { notes.invalid++; return; }
      if (seen.has(email)) { notes.dup++; return; }
      seen.add(email);
      let first = get("first_name"), last = get("last_name");
      if (!first && !last && get("name")) { const parts = get("name").split(/\s+/); first = parts.shift() || ""; last = parts.join(" "); }
      out.push({ email, first_name: first.slice(0, 120), last_name: last.slice(0, 120) });
    });
    return { out, notes };
  }
  /** A CSV/TSV file → { name, grid, map, header } with the columns matched by heading (as on Email Lists). */
  async function readContacts(f) {
    const grid = parseDelimited(await f.text());
    if (!grid.length) return null;
    const hdr = grid[0].map(normHdr); const map = {}; IMPORT_COLS.forEach(([k, , al]) => { map[k] = hdr.findIndex((h) => al.includes(h)); });
    const header = map.email >= 0 || !grid[0].some((c) => EMAIL_RE.test(c));
    if (map.email < 0) map.email = grid[0].findIndex((c) => EMAIL_RE.test(c)) >= 0 ? grid[0].findIndex((c) => EMAIL_RE.test(c)) : hdr.findIndex((h) => /mail/.test(h));
    return { name: f.name, grid, map, header };
  }
  function renderImport(L) {
    const imp = L.imp;
    const box = el("div", { class: "nlp-send nlp-import", id: "nlpImport" });
    box.append(el("h2", { class: "portal-form-title" }, "Upload a contact list"), el("p", { class: "portal-sub" }, "A CSV with a header row: an email column, plus first and last name (or one name column) if you have them. Saving an Excel sheet as CSV works. Columns are matched by their headings and you check the result before anything is sent to Mailchimp."));
    if (!imp) {
      const file = el("input", { type: "file", id: "nl_import_file", accept: ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" });
      file.addEventListener("change", async () => { const f = file.files && file.files[0]; if (!f) return; const grid = parseDelimited(await f.text()); if (!grid.length) { notice("That file is empty.", "error"); return; }
        const hdr = grid[0].map(normHdr); const map = {}; IMPORT_COLS.forEach(([k, , al]) => { map[k] = hdr.findIndex((h) => al.includes(h)); });
        const header = map.email >= 0 || !grid[0].some((c) => EMAIL_RE.test(c));
        if (map.email < 0) map.email = grid[0].findIndex((c) => EMAIL_RE.test(c)) >= 0 ? grid[0].findIndex((c) => EMAIL_RE.test(c)) : hdr.findIndex((h) => /mail/.test(h));
        L.imp = { name: f.name, grid, map, header, status: "pending", group: L.group ? L.group.name : "", groupNew: "", result: null, busy: false }; render(); });
      box.append(el("div", { class: "nlp-send-row" }, file, el("button", { type: "button", class: "btn btn-secondary", onclick: () => { L.importing = false; render(); } }, "Cancel")));
      return box;
    }
    if (imp.result) {
      const R = imp.result;
      box.append(el("p", { class: "portal-sub", id: "nlpImportResult" }, R.added + " added" + (R.status === "pending" ? " (confirmation emails sent)" : "") + ", " + R.updated + " already in the audience and updated" + (R.errors.length ? ", " + R.errors.length + " rejected." : ".") + (R.group ? " All of them are in the “" + R.group + "” group." : "")));
      if (R.errors.length) box.append(el("ul", { class: "nlp-diag" }, ...R.errors.slice(0, 20).map((e) => el("li", { class: "nlp-diag-error" }, el("b", null, e.email), el("span", null, e.error))), R.errors.length > 20 ? el("li", { class: "nlp-diag-info" }, el("b", null, "…and " + (R.errors.length - 20) + " more.")) : null));
      box.append(el("div", { class: "nlp-send-row" }, el("button", { type: "button", class: "btn btn-primary", onclick: () => { L.imp = null; L.importing = false; render(); } }, "Done")));
      return box;
    }
    const sel = (k, label) => { const n = el("select", { id: "nl_import_" + k }); n.append(el("option", { value: "-1" }, "— not in this file —")); imp.grid[0].forEach((h, i) => n.append(el("option", { value: String(i) }, h || "(column " + (i + 1) + ")"))); n.value = String(imp.map[k] >= 0 ? imp.map[k] : -1); n.addEventListener("change", () => { imp.map[k] = Number(n.value); render(); }); return el("label", { class: "portal-field nlp-import-col" }, label, n); };
    const { out, notes } = importRows(imp);
    const prev = el("table", { class: "nlp-table" }, el("thead", null, el("tr", null, el("th", null, "Email"), el("th", null, "First name"), el("th", null, "Last name"))));
    const tb = el("tbody"); out.slice(0, 8).forEach((r) => tb.append(el("tr", null, el("td", null, r.email), el("td", null, r.first_name), el("td", null, r.last_name)))); prev.append(tb);
    const warn = [];
    if (notes.invalid) warn.push(notes.invalid + " row" + (notes.invalid === 1 ? "" : "s") + " without a valid email address skipped.");
    if (notes.dup) warn.push(notes.dup + " duplicate email" + (notes.dup === 1 ? "" : "s") + " in the file skipped.");
    if (notes.blank) warn.push(notes.blank + " row" + (notes.blank === 1 ? "" : "s") + " with an empty email cell skipped.");
    const consent = (v, label, help) => { const r = el("input", { type: "radio", name: "nl_import_status", id: "nl_import_" + v, value: v }); r.checked = imp.status === v; r.addEventListener("change", () => { if (r.checked) imp.status = v; }); return el("label", { class: "portal-check nlp-import-consent" }, r, el("span", null, el("b", null, label), el("span", { class: "pform-help" }, help))); };
    // Group: an existing one, or a new one typed here (Mailchimp creates the tag on first use).
    const group = groupSelect("nl_import_group", L, imp.group, true);
    const groupNew = el("input", { type: "text", id: "nl_import_group_new", maxlength: "60", placeholder: "New group name", hidden: imp.group !== "__new" }); groupNew.value = imp.groupNew;
    group.addEventListener("change", () => { imp.group = group.value; groupNew.hidden = group.value !== "__new"; if (group.value === "__new") groupNew.focus(); });
    groupNew.addEventListener("input", () => { imp.groupNew = groupNew.value; });
    const groupName = () => (imp.group === "__new" ? imp.groupNew.trim().slice(0, 60) : imp.group);
    const msg = el("p", { class: "pform-help", id: "nlpImportMsg" });
    const go = el("button", { type: "button", class: "btn btn-primary", id: "nlpImportSubmit", disabled: !out.length || imp.busy }, out.length ? "Add " + num(out.length) + " contact" + (out.length === 1 ? "" : "s") : "Nothing to add");
    go.addEventListener("click", async () => {
      if (imp.busy || !out.length) return;
      if (imp.group === "__new" && groupName().length < 2) { msg.textContent = "Name the new group (2 to 60 characters) or pick an existing one."; groupNew.focus(); return; }
      const ok = await confirmDialog({ kicker: "Upload a list", title: "Add " + num(out.length) + " contact" + (out.length === 1 ? "" : "s") + " to the Mailchimp audience?", body: imp.status === "subscribed" ? "They will be added as subscribed without a confirmation email. Only do this for people who asked to hear from Proving Ground Capital." : "Each person gets Mailchimp’s confirmation email and joins once they click it.", confirmLabel: "Add contacts", danger: imp.status === "subscribed" });
      if (!ok) return;
      imp.busy = true; go.disabled = true;
      const result = { added: 0, updated: 0, errors: [], status: imp.status, group: groupName() };
      const tagList = groupName() ? [groupName()] : [];
      try {
        for (let i = 0; i < out.length; i += 500) {
          msg.textContent = "Sending " + num(Math.min(i + 500, out.length)) + " of " + num(out.length) + "…";
          const d = await mc("import_members", { members: out.slice(i, i + 500), status: imp.status, tags: tagList });
          result.added += d.added || 0; result.updated += d.updated || 0; (d.errors || []).forEach((e) => result.errors.push(e));
        }
        imp.result = result; L.offset = 0; render(); loadLists(true);
      } catch (e) { imp.busy = false; msg.textContent = "Upload stopped: " + (e.message || e) + (result.added || result.updated ? " (" + num(result.added) + " added, " + num(result.updated) + " updated so far)" : ""); go.disabled = false; }
    });
    box.append(...[el("p", { class: "portal-sub" }, el("b", null, imp.name), " · " + num(imp.grid.length - (imp.header ? 1 : 0)) + " rows"),
      el("div", { class: "portal-row nlp-import-cols" }, sel("email", "Email"), sel("first_name", "First name"), sel("last_name", "Last name"), sel("name", "Full name (if one column)")),
      el("p", { class: "portal-sub evb-import-count", id: "nlpImportCount" }, out.length ? num(out.length) + " contact" + (out.length === 1 ? "" : "s") + " will be added" + (out.length > 8 ? " (first 8 shown)." : ".") : "No contacts found — check the Email column above."),
      out.length ? prev : null,
      warn.length ? el("ul", { class: "nlp-diag", id: "nlpImportNotes" }, ...warn.map((w) => el("li", { class: "nlp-diag-warn" }, el("b", null, w)))) : null,
      el("div", { class: "nlp-import-options" }, consent("pending", "Send a confirmation email", "They join the audience after clicking it (double opt-in). The safe default."), consent("subscribed", "They already asked to hear from Proving Ground Capital — add as subscribed", "No confirmation email. Use only for people who opted in elsewhere (event registrations, sign-up sheets)."),
        el("label", { class: "portal-field" }, "Group", group, groupNew, el("span", { class: "pform-help" }, "Keeps this list as its own group (a Mailchimp tag) so you can browse it here and send campaigns to just these people. Everyone is also tagged “Portal”."))),
      el("div", { class: "nlp-send-row" }, go, el("button", { type: "button", class: "btn btn-secondary", onclick: () => { L.imp = null; render(); } }, "Choose another file"), msg)].filter(Boolean));
    return box;
  }
  const STATUS_PILL = { subscribed: "pstatus--published", pending: "pstatus--review", unsubscribed: "pstatus--archived", cleaned: "pstatus--changes", transactional: "pstatus--read" };
  function renderLists() {
    const L = st.lists;
    if (!L.configured) { body.append(el("p", { class: "portal-empty" }, "Mailchimp isn’t connected yet. An administrator needs to add the Mailchimp secrets to the edge function.")); return; }
    const s = L.stats || {};
    body.append(el("div", { class: "pnl-grid nlp-tiles" }, tile(num(s.members), "Subscribers", L.audience && L.audience.name ? L.audience.name : null), tile(num(s.newSinceSend), "New since last send"), tile(num(s.unsubscribed), "Unsubscribed"), tile(num(s.cleaned), "Cleaned (bounced)")));
    if (L.importing && canPublish) body.append(renderImport(L));
    if (L.adding && canPublish) {
      const em = el("input", { type: "email", id: "nl_add_email", placeholder: "person@example.com", required: true }), fn = el("input", { type: "text", id: "nl_add_first", placeholder: "First name" }), ln = el("input", { type: "text", id: "nl_add_last", placeholder: "Last name" });
      const addGroup = groupSelect("nl_add_group", L, L.group ? L.group.name : "", false); addGroup.title = "Group";
      const f = el("form", { class: "nlp-send nlp-addcontact", novalidate: true, onsubmit: (e) => { e.preventDefault(); if (!EMAIL_RE.test(em.value.trim())) { notice("Enter a valid email address.", "error"); return; } addContact(em.value.trim(), fn.value.trim(), ln.value.trim(), addGroup.value); } },
        el("h2", { class: "portal-form-title" }, "Add a contact"), el("p", { class: "portal-sub" }, "They receive Mailchimp’s confirmation email and join the audience only after clicking it (double opt-in). Only add people who asked to hear from ARI."),
        el("div", { class: "nlp-send-row" }, em, fn, ln, addGroup, el("button", { type: "submit", class: "btn btn-primary", id: "nlpAddContactSubmit" }, "Send confirmation"), el("button", { type: "button", class: "btn btn-secondary", onclick: () => { L.adding = false; render(); } }, "Cancel")));
      body.append(f);
    }
    // Groups: a band across the top (one tile per group), then the contacts in a panel that expands.
    const groupsBand = el("section", { class: "pdash-card nlp-groups", "aria-labelledby": "nlpGroupsTitle" });
    const head = el("div", { class: "nlp-groups-head" }, el("h2", { class: "pdash-card-title", id: "nlpGroupsTitle" }, "Groups"));
    if (!L.segments) groupsBand.append(head, el("p", { class: "pdash-empty" }, L.error ? "Groups couldn’t load: " + L.error : "Loading…"), L.error ? el("button", { type: "button", class: "portal-mini", onclick: () => loadLists(true) }, "Try again") : null);
    else {
      const groups = groupsOf(L), saved = (L.segments || []).filter((g) => g.type !== "static");
      if (canPublish) {
        const name = el("input", { type: "text", id: "nl_group_name", maxlength: "60", placeholder: "New group name", "aria-label": "New group name" }); name.value = L.newGroup; name.addEventListener("input", () => { L.newGroup = name.value; });
        const mk = el("button", { type: "button", class: "portal-mini portal-mini--go", id: "nlpGroupCreate", onclick: () => { const n = name.value.trim(); if (n.length < 2) { notice("Give the group a name (2 to 60 characters).", "error"); name.focus(); return; } createGroup(n); } }, "Create group");
        name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); mk.click(); } });
        head.append(el("div", { class: "nlp-group-new" }, name, mk));
      }
      const grid = el("div", { class: "nlp-group-grid", id: "nlpGroups", role: "list" });
      const pick = (g) => { L.group = g; L.offset = 0; L.contactsOpen = true; loadLists(false, ["nlpGroup-" + (g ? g.id : "all")]); };
      const tileFor = (g, label, count, removable) => { const on = g ? (L.group && L.group.id === g.id) : !L.group, x = removable && canPublish;
        // Name then count for assistive tech ("Portal, 12 contacts"); the visual stack puts the count first.
        const b = el("button", { type: "button", class: "nlp-group" + (on ? " is-on" : ""), id: "nlpGroup-" + (g ? g.id : "all"), "aria-label": label + ", " + num(count) + " contact" + (count === 1 ? "" : "s"), "aria-current": on ? "true" : null, title: label, onclick: () => pick(g) }, el("span", { class: "nlp-group-count", "aria-hidden": "true" }, num(count)), el("span", { class: "nlp-group-name", "aria-hidden": "true" }, label));
        const r = el("div", { class: "nlp-group-row" + (x ? " has-x" : ""), role: "listitem" }, b); if (x) r.append(el("button", { type: "button", class: "portal-mini nlp-group-x", id: "nlpGroupX-" + g.id, "aria-label": "Remove group " + label, title: "Remove group", onclick: () => deleteGroup(g) }, "×")); return r; };
      grid.append(tileFor(null, "Everyone", (L.stats && L.stats.members) || 0, false));
      groups.forEach((g) => grid.append(tileFor(g, g.name, g.count, !["Website", "Portal"].includes(g.name))));
      groupsBand.append(head, grid);
      if (!groups.length) groupsBand.append(el("p", { class: "pdash-empty" }, "No groups yet. Create one, then upload a list or add contacts into it."));
      if (saved.length) groupsBand.append(el("p", { class: "pform-help" }, "Mailchimp segments (managed there): " + saved.map((g) => g.name + " (" + num(g.count) + ")").join(", ") + "."));
      groupsBand.append(el("p", { class: "pform-help" }, "A contact can be in several groups. “Website” holds footer sign-ups; “Portal” everyone added here. Click a group to see who is in it; when sending a campaign, choose Everyone or one group under Delivery."));
    }
    // Contacts: an expandable panel (closed until you open it, pick a group or search).
    const det = el("details", { class: "pdash-card nlp-contacts", id: "nlpContacts" }); det.open = !!L.contactsOpen;
    det.addEventListener("toggle", () => { L.contactsOpen = det.open; const h = det.querySelector(".nlp-contacts-hint"); if (h) h.textContent = det.open ? "Hide" : "Show"; });
    const title = L.search ? "Search results" : (L.group ? "Contacts in “" + L.group.name + "”" : "Contacts") + (L.total ? " (" + num(L.total) + ")" : "");
    det.append(el("summary", { class: "nlp-contacts-sum", id: "nlpContactsToggle" }, el("h2", { class: "pdash-card-title", id: "nlpMembersTitle" }, title), el("span", { class: "nlp-contacts-hint", "aria-hidden": "true" }, det.open ? "Hide" : "Show"), el("span", { class: "nlp-contacts-chev", "aria-hidden": "true" }, "⌄")));
    const mw = el("div", { class: "nlp-contacts-body" });
    if (L.group) mw.append(el("p", { class: "portal-sub nlp-group-note" }, "Showing one group; searching or filtering by status looks across everyone. ", el("button", { type: "button", class: "portal-mini", id: "nlpGroupAll", onclick: () => { L.group = null; L.offset = 0; loadLists(false, ["nlpGroup-all"]); } }, "Show everyone")));
    const q = el("input", { type: "search", class: "portal-search", id: "nl_list_q", placeholder: L.group ? "Search everyone by email or name…" : "Search by email or name…", value: L.q });
    const status = el("select", { id: "nl_list_status" }, el("option", { value: "" }, "All statuses"), el("option", { value: "subscribed" }, "Subscribed"), el("option", { value: "pending" }, "Pending confirmation"), el("option", { value: "unsubscribed" }, "Unsubscribed"), el("option", { value: "cleaned" }, "Cleaned (bounced)"));
    status.value = L.status;
    const run = () => { L.q = q.value.trim(); L.status = status.value; L.offset = 0; L.contactsOpen = true; if (L.group && (L.q || L.status)) L.group = null; loadLists(false); };
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
    status.addEventListener("change", run);
    const exportBtn = el("button", { type: "button", class: "portal-mini", id: "nlpExportCsv", disabled: !L.members.length, onclick: () => exportCsv(L.members) }, "Export loaded rows (CSV)");
    mw.append(el("div", { class: "portal-filters nlp-filters nlp-list-controls" }, q, el("button", { type: "button", class: "portal-mini", id: "nlpListSearch", onclick: run }, "Search"), status, exportBtn));
    if (L.error) mw.append(el("p", { class: "pdash-empty" }, L.error), el("button", { type: "button", class: "portal-mini", onclick: () => loadLists(true) }, "Try again"));
    else if (L.loading && !L.members.length) mw.append(el("p", { class: "pdash-empty" }, "Loading contacts from Mailchimp…"));
    else if (!L.members.length) mw.append(el("p", { class: "pdash-empty" }, L.q ? "No contacts match." : L.group ? "Nobody is in this group yet. Use Upload a list or Add contact and pick it as the group." : "No contacts yet. The footer form on theari.us adds people here after they confirm."));
    else {
      const t = el("table", { class: "nlp-table nlp-members" }, el("thead", null, el("tr", null, el("th", null, "Contact"), el("th", null, "Status"), el("th", null, "Tags"), el("th", null, "Joined"))));
      const tb = el("tbody");
      L.members.forEach((m) => tb.append(el("tr", null, el("td", null, el("b", null, m.email), m.name ? el("span", { class: "nlp-cell-sub" }, m.name) : null), el("td", null, el("span", { class: "pstatus " + (STATUS_PILL[m.status] || "pstatus--read") }, m.status)), el("td", { class: "nlp-tags" }, (m.tags || []).join(", ") || "—"), el("td", null, fmtDate(m.optedIn)))));
      t.append(tb); mw.append(t);
      if (!L.search && L.members.length < L.total) mw.append(el("div", { class: "nlp-add", style: "margin-top:10px" }, el("button", { type: "button", class: "portal-mini", id: "nlpLoadMore", disabled: L.loading, onclick: () => { L.offset = L.members.length; loadLists(false, ["nlpLoadMore", "nlpContactsToggle"]); } }, L.loading ? "Loading…" : "Load more")));
    }
    det.append(mw);
    body.append(groupsBand, det, el("div", { class: "pdash-shortcuts nlp-reports-actions" }, el("a", { class: "portal-mini portal-mini--go", href: "https://" + ((L.audience && L.audience.server) || "login") + ".admin.mailchimp.com/audience/", target: "_blank", rel: "noopener" }, "Open the audience in Mailchimp")));
  }
  function exportCsv(rows) {
    const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const csv = ["email,name,status,tags,joined"].concat(rows.map((m) => [m.email, m.name, m.status, (m.tags || []).join("; "), m.optedIn || ""].map(esc).join(","))).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "ari-audience-" + new Date().toISOString().slice(0, 10) + ".csv"; document.body.append(a); a.click(); a.remove();
  }

  /* ---------- reports ---------- */
  async function openReports() {
    st.report = null; setView("reports");
    if (st.reports) return;
    try { st.reports = await mc("reports"); } catch (e) { st.reports = { error: e.message }; }
    renderIf("nlreports");
  }
  async function openReport(id) {
    // Reports live on their own page; from a campaign, switch there first.
    if (st.panel !== "nlreports") { go("nlreports", { report: id }); return; }
    st.report = { loading: true, id }; setView("report");
    try { st.report = await mc("reports", { campaign_id: id }); } catch (e) { st.report = { error: e.message, id }; }
    renderIf("nlreports");
  }
  function tile(value, label, sub) { return el("div", { class: "pnl-stat" }, el("span", { class: "pnl-stat-value" }, value), el("span", { class: "pnl-stat-label" }, label), sub ? el("span", { class: "pnl-stat-sub" }, sub) : null); }
  function bar(v, max, cls) { const w = max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0; return el("span", { class: "nlp-bar" }, el("span", { class: "nlp-bar-fill " + (cls || ""), style: "width:" + w + "%" })); }
  function renderReports() {
    const R = st.reports;
    if (!R) { body.append(el("p", { class: "portal-empty" }, "Loading reports from Mailchimp…")); return; }
    if (R.error) { body.append(el("p", { class: "portal-empty" }, R.error), el("button", { type: "button", class: "portal-mini", onclick: () => { st.reports = null; openReports(); } }, "Try again")); return; }
    if (!R.configured) { body.append(el("p", { class: "portal-empty" }, "Mailchimp isn’t connected yet. An administrator needs to add the Mailchimp secrets to the edge function.")); return; }
    const s = R.stats || {};
    body.append(el("div", { class: "pnl-grid nlp-tiles" }, tile(num(s.members), "Subscribers", s.newSinceSend ? "+" + num(s.newSinceSend) + " since last send" : null), tile(pct(s.openRate), "Average open rate"), tile(pct(s.clickRate), "Average click rate"), tile(num(s.unsubscribed), "Unsubscribed", num(s.cleaned) + " cleaned")));
    // Campaigns
    const cw = el("div", { class: "pdash-card" }, el("h2", { class: "pdash-card-title" }, "Sent campaigns"));
    const camps = R.campaigns || [];
    if (!camps.length) cw.append(el("p", { class: "pdash-empty" }, "No campaigns have been sent yet."));
    else {
      const maxOpen = Math.max(...camps.map((c) => c.openRate), 0.01);
      const t = el("table", { class: "nlp-table" }, el("thead", null, el("tr", null, el("th", null, "Campaign"), el("th", null, "Sent"), el("th", { class: "num" }, "Recipients"), el("th", null, "Opens"), el("th", { class: "num" }, "Clicks"))));
      const tb = el("tbody");
      camps.forEach((c) => {
        const local = st.rows.find((r) => r.mailchimp_id === c.id);
        tb.append(el("tr", { class: "is-link", tabindex: "0", onclick: () => openReport(c.id), onkeydown: (e) => { if (e.key === "Enter") openReport(c.id); } },
          el("td", null, el("b", null, c.title), el("span", { class: "nlp-cell-sub" }, c.subject), local ? el("span", { class: "pstatus pstatus--read" }, "Portal") : null),
          el("td", null, fmtDate(c.sentAt)), el("td", { class: "num" }, num(c.emailsSent)),
          el("td", null, el("span", { class: "nlp-barcell" }, bar(c.openRate, maxOpen), pct(c.openRate))), el("td", { class: "num" }, pct(c.clickRate))));
      });
      t.append(tb); cw.append(t);
    }
    // Growth
    const gw = el("div", { class: "pdash-card" }, el("h2", { class: "pdash-card-title" }, "Audience growth (last 12 months)"));
    const g = R.growth || [];
    if (!g.length) gw.append(el("p", { class: "pdash-empty" }, "No growth history yet."));
    else {
      const max = Math.max(...g.map((m) => Math.max(m.subscribed, m.unsubscribed)), 1);
      const t = el("table", { class: "nlp-table" }, el("thead", null, el("tr", null, el("th", null, "Month"), el("th", null, "New subscribers"), el("th", { class: "num" }, "Unsubscribed"), el("th", { class: "num" }, "Net"))));
      const tb = el("tbody");
      g.forEach((m) => {
        const label = new Date(m.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
        tb.append(el("tr", null, el("td", null, label), el("td", null, el("span", { class: "nlp-barcell" }, bar(m.subscribed, max, "is-good"), num(m.subscribed))), el("td", { class: "num" }, num(m.unsubscribed)), el("td", { class: "num" }, (m.subscribed - m.unsubscribed >= 0 ? "+" : "") + num(m.subscribed - m.unsubscribed))));
      });
      t.append(tb); gw.append(t);
    }
    const open = el("a", { class: "portal-mini portal-mini--go", href: "https://" + ((R.audience && R.audience.server) || "login") + ".admin.mailchimp.com/", target: "_blank", rel: "noopener" }, "Open Mailchimp");
    const refresh = el("button", { type: "button", class: "portal-mini", onclick: () => { st.reports = null; openReports(); } }, "Refresh");
    body.append(el("div", { class: "nlp-reports-grid" }, cw, gw), el("div", { class: "pdash-shortcuts nlp-reports-actions" }, open, refresh));
  }
  function renderReport() {
    const R = st.report;
    body.append(el("button", { type: "button", class: "portal-mini nlp-back", onclick: () => openReports() }, "← All reports"));
    if (!R || R.loading) { body.append(el("p", { class: "portal-empty" }, "Loading the report…")); return; }
    if (R.error) { body.append(el("p", { class: "portal-empty" }, R.error)); return; }
    const c = R.campaign || {}, r = R.report || {};
    body.append(el("div", { class: "nlp-report-head" }, el("h2", { class: "psection-title" }, c.title || "Campaign"), el("p", { class: "portal-sub" }, (c.subject ? "“" + c.subject + "” · " : "") + "sent " + fmtDateTime(r.sentAt) + (c.archiveUrl ? " · " : ""), c.archiveUrl ? el("a", { class: "portal-link--inline", href: c.archiveUrl, target: "_blank", rel: "noopener" }, "View the email") : null)));
    const ls = r.listStats;
    body.append(el("div", { class: "pnl-grid nlp-tiles" },
      tile(num(r.emailsSent), "Recipients"),
      tile(pct(r.opens && r.opens.rate), "Open rate", num(r.opens && r.opens.unique) + " unique" + (ls ? " · audience avg " + pct(ls.openRate) : "")),
      tile(pct(r.clicks && r.clicks.rate), "Click rate", num(r.clicks && r.clicks.subscribers) + " people clicked" + (ls ? " · audience avg " + pct(ls.clickRate) : "")),
      tile(num(r.unsubscribed), "Unsubscribed", num((r.bounces && (r.bounces.hard + r.bounces.soft)) || 0) + " bounced · " + num(r.abuse) + " spam reports")));
    const lw = el("div", { class: "pdash-card" }, el("h2", { class: "pdash-card-title" }, "Most clicked links"));
    const links = R.links || [];
    if (!links.length) lw.append(el("p", { class: "pdash-empty" }, "No clicks recorded yet."));
    else {
      const max = Math.max(...links.map((l) => l.unique), 1);
      const t = el("table", { class: "nlp-table" }, el("thead", null, el("tr", null, el("th", null, "Link"), el("th", null, "Unique clicks"), el("th", { class: "num" }, "Total"))));
      const tb = el("tbody");
      links.forEach((l) => tb.append(el("tr", null, el("td", { class: "nlp-url" }, el("a", { href: l.url, target: "_blank", rel: "noopener" }, l.url.replace(/^https?:\/\//, "").replace(/\*\|.*?\|\*/g, "(merge tag)"))), el("td", null, el("span", { class: "nlp-barcell" }, bar(l.unique, max), num(l.unique))), el("td", { class: "num" }, num(l.total)))));
      t.append(tb); lw.append(t);
    }
    const tw = el("div", { class: "pdash-card" }, el("h2", { class: "pdash-card-title" }, "First 24 hours"));
    const ts = (r.timeseries || []).slice(0, 24);
    if (!ts.length) tw.append(el("p", { class: "pdash-empty" }, "The hourly timeline appears once Mailchimp has processed the send."));
    else {
      const max = Math.max(...ts.map((t) => t.opens), 1);
      const chart = el("div", { class: "nlp-timeline", role: "img", "aria-label": "Unique opens per hour for the first 24 hours" });
      ts.forEach((t, i) => chart.append(el("span", { class: "nlp-tl-col", title: "Hour " + (i + 1) + ": " + num(t.opens) + " opens, " + num(t.clicks) + " clicks" }, el("span", { class: "nlp-tl-bar", style: "height:" + Math.max(2, Math.round((t.opens / max) * 100)) + "%" }))));
      tw.append(chart, el("p", { class: "pform-help" }, "Unique opens by hour after sending. Hover a bar for the numbers."));
    }
    body.append(el("div", { class: "nlp-reports-grid" }, lw, tw));
  }

  /* ---------- render ---------- */
  function render() {
    // A data load finishing mid-keystroke must not wipe what is being typed:
    // remember the focused text field and restore it after the re-render.
    const ae = document.activeElement;
    const texty = ae && body.contains(ae) && ae.id && ((ae.tagName === "INPUT" && /^(text|search|email|url|number|datetime-local)$/.test(ae.type)) || ae.tagName === "TEXTAREA");
    const keep = texty ? { id: ae.id, value: ae.value, s: ae.selectionStart, e: ae.selectionEnd } : null;
    // Any other focused control with an id (a group tile, Load more…) gets focus back after the rebuild,
    // or an action can name where focus should land next (st.focusNext: ids in order of preference).
    const keepId = !texty && ae && body.contains(ae) && ae.id ? ae.id : null;
    const next = st.focusNext || null; st.focusNext = null;
    const editing = (st.panel === "campaigns" && st.view === "edit") || (st.panel === "nltemplates" && st.view === "tedit");
    if (editing && st.editor && st.editor.draft === st.draft && st.draft) { renderHead(); return; }
    if (st.editor) { st.editor.destroy(); st.editor = null; }
    renderHead();
    body.innerHTML = "";
    if (st.panel === "campaigns") {
      if (!st.loaded && st.view === "list") body.append(el("p", { class: "portal-empty" }, "Loading…"));
      else if (st.view === "edit") renderEdit(); else renderList();
    } else if (st.panel === "nlreports") { if (st.view === "report") renderReport(); else renderReports(); }
    else if (st.panel === "nltemplates") { if (st.view === "tedit") renderEdit(); else renderTemplates(); }
    else if (st.panel === "nllists") renderLists();
    const root = panels[st.panel] ? panels[st.panel].root : body;
    const target = next ? next.map((id) => document.getElementById(id)).find((n) => n && !n.disabled && root.contains(n)) : null;
    if (target) { try { target.focus({ preventScroll: true }); } catch (_) {} }
    else if (keep) { const n = document.getElementById(keep.id); if (n && n !== ae && !n.disabled) { n.value = keep.value; n.dispatchEvent(new Event("input", { bubbles: true })); try { n.focus({ preventScroll: true }); if (keep.s != null) n.setSelectionRange(keep.s, keep.e); } catch (_) {} } }
    else if (keepId) { const n = document.getElementById(keepId); if (n && n !== ae && !n.disabled) { try { n.focus({ preventScroll: true }); } catch (_) {} } }
  }
  /* Entry point from the portal shell: which panel is being shown, with options. */
  async function show(id, opts) {
    opts = opts || {};
    activate(id);
    if (id === "campaigns") {
      if (!st.loaded) await load(); else render();
      if (opts.create) await newCampaign({ template: opts.template });
      else if (opts.open) { const r = st.rows.find((x) => x.id === opts.open); if (r) openCampaign(r); }
      else if (opts.fromTemplate) { const ts = await loadTemplates(); const t = ts.find((x) => x.id === opts.fromTemplate); if (t) await newCampaign({ fromTemplate: t }); }
      else if (st.view === "edit" && !st.draft) setView("list");
    } else if (id === "nlreports") { if (opts.report) openReport(opts.report); else if (st.view === "report" && st.report) render(); else openReports(); }
    else if (id === "nltemplates") { render(); if (!st.templates) { await loadTemplates(); render(); } }
    else if (id === "nllists") { if (!st.lists.segments) loadLists(false); else render(); }
  }
  activate("campaigns"); render();
  return { show, load, open: (id) => { const r = st.rows.find((x) => x.id === id); if (r) openCampaign(r); }, create: newCampaign, reports: openReports, rows: () => st.rows,
    isDirty: () => !!(st.editor && st.editor.isDirty()), save: () => (st.editor ? st.editor.saveFromShell() : Promise.resolve(true)), discard: () => { if (st.editor) st.editor.markClean(); } };
}
