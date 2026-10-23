/* Proving Ground Capital (PGC) — website editor (/portal/).
   ---------------------------------------------------------------------------
   Accounts, permissions and data all live in ARI's Supabase project. The
   server is the authority: Row Level Security decides what a person may read
   or change, and the triggers decide who may publish or request changes. This
   file only decides what to show and sends plain inserts/updates.

   Access comes from rpc("my_access"): administrators may do everything; the
   "pgc" module grants contributor (edit drafts, submit for review) or
   publisher (publish, unpublish, delete, undo). Anyone else sees nothing.
*/
import { supabase, PGC_MODULE, PGC_BUCKET } from "./supabase.js";
import { readPage, readTeamGrid } from "./content.js";

/* ------------------------------------------------------------- constants */
const PAGE_DEFS = [
  { slug: "home", path: "/", title: "Proving Ground Capital (PGC) — Capital Built for Critical Technology", nav_label: "Home" },
  { slug: "thesis", path: "/thesis/", title: "Investment Thesis | Proving Ground Capital (PGC)", nav_label: "Investment Thesis" },
  { slug: "investors", path: "/investors/", title: "For Investors | Proving Ground Capital (PGC)", nav_label: "For Investors" },
  { slug: "founders", path: "/founders/", title: "For Founders & Companies | Proving Ground Capital (PGC)", nav_label: "Founders & Companies" },
  { slug: "team", path: "/team/", title: "Team | Proving Ground Capital (PGC)", nav_label: "Team" },
  { slug: "contact", path: "/contact/", title: "Contact | Proving Ground Capital (PGC)", nav_label: "Contact" },
];
const KINDS = { hero: "Hero", rich: "Text block", cards: "Cards", ticks: "Checklist cards", statement: "Statement / quote", cta: "Call to action" };
const STATE_LABEL = { draft: "Draft", in_review: "In review", changes_requested: "Changes requested", published: "Published" };
const TABLES = ["pgc_pages", "pgc_sections", "pgc_team", "pgc_settings"];
const SETTING_DEFS = [
  { key: "footer_tagline", label: "Footer tagline" },
  { key: "footer_disclaimer", label: "Footer disclosure" },
  { key: "contact_email", label: "Contact email address" },
];

/* ---------------------------------------------------------------- utils */
const $ = (sel, root) => (root || document).querySelector(sel);
const el = (tag, attrs, ...children) => {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, v);
  });
  children.flat().forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return n;
};
let uid = 0;
const nextId = (p) => p + "-" + (++uid);
const stateOf = (row) => (row.published ? "published" : row.review_state || "draft");
const pill = (row) => el("span", { class: "p-pill p-pill--" + stateOf(row), text: STATE_LABEL[stateOf(row)] });
const fmtTime = (iso) => { try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso || ""; } };
const bulletsToText = (arr) => (arr || []).map((b) => (typeof b === "string" ? b : [b.name, b.detail].filter(Boolean).join(" — "))).join("\n");
const textToBullets = (s, structured) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => { if (!structured) return l; const i = l.indexOf(" — "); return i < 0 ? { name: l, detail: "" } : { name: l.slice(0, i).trim(), detail: l.slice(i + 3).trim() }; });
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const errText = (e) => (e && (e.message || e.error_description || e.msg)) || String(e || "Something went wrong.");

function notice(msg, isError) {
  const n = $("#pNotice");
  if (!msg) { n.hidden = true; n.textContent = ""; return; }
  n.hidden = false; n.textContent = msg; n.classList.toggle("is-error", !!isError);
}

/* --------------------------------------------------------------- access */
function buildAccess(raw) {
  const role = (raw && raw.role) || null;
  const status = (raw && raw.status) || null;
  const modules = (raw && raw.modules) || {};
  const active = status === "active";
  const isAdmin = active && role === "admin";
  const level = isAdmin ? "publisher" : active ? modules[PGC_MODULE] || null : null;
  return {
    email: (raw && raw.email) || "", fullName: (raw && raw.full_name) || "", role, status, isAdmin,
    level, isEmployee: !!raw, active,
    canEdit: level === "contributor" || level === "publisher",
    canPublish: level === "publisher",
  };
}

/* ------------------------------------------------------------------ state */
const state = { access: null, pages: [], route: null, page: null, sections: [], team: [], settings: [], dirty: false, saving: false };

/* ------------------------------------------------------------------ boot */
let booting = false;
async function boot() {
  if (booting) return;
  booting = true;
  try { await bootInner(); } finally { booting = false; }
}
async function bootInner() {
  const boot = $("#pBoot"), signin = $("#pSignin"), denied = $("#pDenied"), app = $("#pApp");
  [signin, denied, app].forEach((x) => (x.hidden = true));
  boot.hidden = false;
  const { data } = await supabase.auth.getSession();
  const session = data && data.session;
  if (!session) { boot.hidden = true; signin.hidden = false; $("#pEmail").focus(); return; }

  const res = await supabase.rpc("my_access");
  if (res.error) {
    boot.hidden = true; denied.hidden = false;
    $("#pDeniedMsg").textContent = "The access check failed (" + errText(res.error) + "). Try again in a moment.";
    return;
  }
  const access = buildAccess(res.data);
  state.access = access;
  boot.hidden = true;
  if (!access.isEmployee || !access.active) {
    denied.hidden = false;
    $("#pDeniedMsg").textContent = !access.isEmployee
      ? "This sign-in is not linked to an Applied Research Institute employee account."
      : "This account is suspended. Nothing on this site can be edited with it.";
    return;
  }
  if (!access.canEdit) {
    denied.hidden = false;
    $("#pDeniedMsg").textContent = "Your account is active but does not have the “Proving Ground Capital pages” permission.";
    return;
  }
  app.hidden = false;
  $("#pWho").textContent = access.fullName || access.email;
  $("#pLevel").textContent = access.isAdmin ? "Administrator" : access.level === "publisher" ? "Publisher" : "Contributor";
  await loadPages();
  renderNav();
  if (!bootInner.routed) { window.addEventListener("hashchange", onRoute); bootInner.routed = true; }
  await onRoute();
}

/* ---------------------------------------------------------------- sign-in */
function wireSignin() {
  const form = $("#pSigninForm"), msg = $("#pSigninMsg");
  const say = (t, cls) => { msg.textContent = t; msg.className = "p-msg" + (cls ? " " + cls : ""); };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#pEmail").value.trim(), password = $("#pPassword").value;
    if (!email || !/\S+@\S+\.\S+/.test(email)) { say("Enter your email address.", "is-error"); $("#pEmail").focus(); return; }
    if (!password) { say("Enter your password, or ask for a sign-in link.", "is-error"); $("#pPassword").focus(); return; }
    $("#pSigninBtn").disabled = true; say("Signing in…");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    $("#pSigninBtn").disabled = false;
    if (error) { say(/confirm/i.test(error.message) ? "Confirm your email address first — check your inbox for the confirmation message." : "That email and password did not match.", "is-error"); return; }
    say(""); boot();
  });
  $("#pMagicBtn").addEventListener("click", async () => {
    const email = $("#pEmail").value.trim();
    if (!email || !/\S+@\S+\.\S+/.test(email)) { say("Enter your email address first.", "is-error"); $("#pEmail").focus(); return; }
    $("#pMagicBtn").disabled = true; say("Sending…");
    // shouldCreateUser: false — accounts are created in ARI's portal, never here.
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/portal/", shouldCreateUser: false } });
    $("#pMagicBtn").disabled = false;
    if (error) { say(/signups not allowed|not found|user/i.test(error.message) ? "No account with that address. An ARI administrator can add you." : errText(error), "is-error"); return; }
    say("Check your inbox — the sign-in link is on its way to " + email + ".", "is-ok");
  });
  document.querySelectorAll("[data-signout]").forEach((b) => b.addEventListener("click", async () => {
    await supabase.auth.signOut();
    state.access = null; state.page = null; state.sections = [];
    location.hash = "";
    boot();
  }));
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" && !state.access) boot();
    if (event === "SIGNED_OUT" && state.access) { state.access = null; boot(); }
  });
}

/* ------------------------------------------------------------------ data */
async function loadPages() {
  const { data, error } = await supabase.from("pgc_pages").select("*").order("sort_order", { ascending: true });
  if (error) { notice("Could not load the page list: " + errText(error), true); state.pages = []; return; }
  state.pages = data || [];
}

async function loadPage(slug) {
  const page = state.pages.find((p) => p.slug === slug);
  if (!page) return null;
  const { data, error } = await supabase.from("pgc_sections").select("*").eq("page_id", page.id).order("sort_order", { ascending: true });
  if (error) { notice("Could not load this page: " + errText(error), true); return { page, sections: [] }; }
  return { page: Object.assign({}, page), sections: (data || []).map(normalizeSection) };
}
const normalizeSection = (s) => Object.assign({}, s, { items: Array.isArray(s.items) ? s.items : [], bullets: Array.isArray(s.bullets) ? s.bullets : [] });

/* Everything the live page shows, read straight out of its markup. Used to
   start editing a page that has no rows yet. */
async function readLivePage(def) {
  const res = await fetch(def.path, { cache: "no-store" });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const main = doc.querySelector("[data-pgc-page]");
  if (!main) throw new Error("The live page has no editable markup.");
  const page = readPage(main);
  const meta = doc.querySelector('meta[name="description"]');
  const team = Array.from(main.querySelectorAll("[data-pgc-team]")).flatMap((g) => readTeamGrid(g));
  return { sections: page.sections, meta_description: meta ? meta.getAttribute("content") : null, title: doc.title, team };
}

/* -------------------------------------------------------------- routing */
function parseHash() {
  const m = String(location.hash || "").match(/^#\/(page|team|settings|history)(?:\/([a-z0-9-]+))?/);
  if (!m) return { view: "page", slug: (state.pages[0] || PAGE_DEFS[0]).slug };
  return { view: m[1], slug: m[2] || null };
}
async function onRoute() {
  if (state.dirty && !confirm("You have unsaved changes. Leave this page and lose them?")) {
    history.replaceState(null, "", state.route && state.route.hash || "#/");
    return;
  }
  state.dirty = false;
  const r = parseHash();
  r.hash = location.hash;
  state.route = r;
  notice("");
  $("#pSidebar").classList.remove("is-open"); $("#pNavToggle").setAttribute("aria-expanded", "false");
  document.querySelectorAll(".p-nav-item").forEach((b) => b.removeAttribute("aria-current"));
  const view = $("#pView"); view.innerHTML = "";
  if (r.view === "page") {
    const btn = $('.p-nav-item[data-slug="' + r.slug + '"]'); if (btn) btn.setAttribute("aria-current", "page");
    await renderPageEditor(r.slug);
  } else {
    const btn = $('.p-nav-item[data-view="' + r.view + '"]'); if (btn) btn.setAttribute("aria-current", "page");
    if (r.view === "team") await renderTeamEditor();
    if (r.view === "settings") await renderSettingsEditor();
    if (r.view === "history") await renderHistory();
  }
  $("#pmain").focus({ preventScroll: true });
}

function renderNav() {
  const ul = $("#pPageNav"); ul.innerHTML = "";
  const defs = PAGE_DEFS.map((d) => Object.assign({}, d, state.pages.find((p) => p.slug === d.slug) || {}));
  state.pages.filter((p) => !PAGE_DEFS.some((d) => d.slug === p.slug)).forEach((p) => defs.push(p));
  defs.forEach((d) => {
    const b = el("button", { type: "button", class: "p-nav-item", "data-slug": d.slug, onclick: () => (location.hash = "#/page/" + d.slug) },
      el("span", { text: d.nav_label || d.title || d.slug }), d.id ? pill(d) : el("span", { class: "p-pill p-pill--draft", text: "Not set up" }));
    ul.append(el("li", null, b));
  });
  document.querySelectorAll("#pOtherNav .p-nav-item").forEach((b) => (b.onclick = () => (location.hash = "#/" + b.dataset.view)));
  $("#pNavToggle").onclick = () => { const sb = $("#pSidebar"); const open = sb.classList.toggle("is-open"); $("#pNavToggle").setAttribute("aria-expanded", String(open)); };
}

/* ------------------------------------------------------------ page editor */
async function renderPageEditor(slug) {
  const def = PAGE_DEFS.find((d) => d.slug === slug) || { slug, path: "/" + slug + "/", title: slug };
  const view = $("#pView");
  const access = state.access;
  const loaded = await loadPage(slug);

  if (!loaded) {
    view.append(
      el("div", { class: "p-head" }, el("div", null, el("h1", { text: def.nav_label || def.title }), el("p", { class: "p-meta", text: def.path + " — not in the database yet; visitors see the page as it is in the repository." }))),
      el("div", { class: "p-card" },
        el("p", null, "Start editing this page by copying what the live site shows into a draft. Nothing changes for visitors until a publisher publishes it."),
        el("div", { class: "p-add" },
          el("button", { type: "button", class: "btn btn-primary", onclick: () => setupPage(def) }, "Start from the live page"))));
    return;
  }

  state.page = loaded.page; state.sections = loaded.sections;
  const page = state.page;
  const liveLocked = page.published && !access.canPublish;   // ARI rule: contributors cannot touch live rows

  const head = el("div", { class: "p-head" },
    el("div", null, el("h1", { text: page.nav_label || def.nav_label || page.title }), el("p", { class: "p-meta" }, def.path + " · ", pill(page), page.updated_by ? " · last edited by " + page.updated_by + " " + fmtTime(page.updated_at) : "")),
    actionBar());
  view.append(head);
  if (liveLocked) notice("This page is live. Contributors cannot change published content — a publisher can, or can unpublish it so you can edit a draft.");
  else if (page.published && access.canPublish) notice("This page is live. Saving changes updates the public site immediately; every change is kept in the history and can be undone.");
  else if (page.review_state === "changes_requested") notice("A publisher asked for changes to this page. Edit and submit it for review again.");

  const editor = el("div", { class: "p-editor" });
  const layout = el("div", { class: "p-layout" }, editor, previewPanel(def.path));
  view.append(layout);

  // Page-level fields
  editor.append(card("Page", null, [
    field("Browser title", "input", page.title || "", (v) => (page.title = v), { wide: true, readonly: liveLocked }),
    field("Menu label", "input", page.nav_label || "", (v) => (page.nav_label = v), { readonly: liveLocked }),
    field("Search description", "textarea", page.meta_description || "", (v) => (page.meta_description = v), { wide: true, readonly: liveLocked, hint: "Shown by search engines under the page title. About 150 characters." }),
  ], { open: false }));

  const list = el("div", { class: "p-sections" });
  editor.append(list);
  const addRow = el("div", { class: "p-add" });
  if (!liveLocked) {
    const sel = el("select", { "aria-label": "Kind of section to add" }, ...Object.entries(KINDS).filter(([k]) => k !== "hero").map(([k, v]) => el("option", { value: k, text: v })));
    addRow.append(sel, el("button", { type: "button", class: "btn btn-ghost", onclick: () => { state.sections.push(blankSection(sel.value)); markDirty(); drawSections(); } }, "Add section"));
  }
  editor.append(addRow);

  function drawSections() {
    list.innerHTML = "";
    state.sections.forEach((s, i) => list.append(sectionCard(s, i, liveLocked, drawSections)));
  }
  drawSections();
  schedulePreview();
}

function blankSection(kind) {
  return { id: null, page_id: state.page.id, section_key: null, kind, eyebrow: "", heading: "", heading_accent: "", kicker: "", lead: "", note: "",
    bullets: [], items: kind === "cards" || kind === "ticks" ? [{ eyebrow: "", title: "", text: "" }] : kind === "cta" ? [{ label: "", href: "" }] : [],
    band: "default", sort_order: (state.sections.length + 1) * 10, published: false, review_state: "draft", _new: true };
}

function sectionCard(s, i, locked, redraw) {
  const title = s.heading || s.eyebrow || (s.section_key ? s.section_key : KINDS[s.kind] || "Section");
  const tools = el("div", { class: "p-card-tools" },
    el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move section up", disabled: locked || i === 0, onclick: () => { move(state.sections, i, -1); markDirty(); redraw(); } }, "↑"),
    el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move section down", disabled: locked || i === state.sections.length - 1, onclick: () => { move(state.sections, i, 1); markDirty(); redraw(); } }, "↓"),
    (state.access.canPublish || s._new) && !locked
      ? el("button", { type: "button", class: "p-icon-btn", "aria-label": "Remove section", onclick: async () => {
          if (!confirm("Remove the section “" + title + "”?")) return;
          if (s.id) { const { error } = await supabase.from("pgc_sections").delete().eq("id", s.id); if (error) { notice("Could not remove it: " + errText(error), true); return; } }
          state.sections.splice(i, 1); markDirty(); redraw(); schedulePreview();
        } }, "Remove")
      : null);
  const fields = [
    field("Eyebrow", "input", s.eyebrow || "", (v) => (s.eyebrow = v), { readonly: locked, hint: "The small // label // above the headline." }),
    field("Band", "select", s.band || "default", (v) => (s.band = v), { readonly: locked, options: [["default", "Teal (default)"], ["alt", "Grey band"]] }),
    field("Headline", "input", s.heading || "", (v) => (s.heading = v), { wide: true, readonly: locked }),
    field("Headline — mint clause", "input", s.heading_accent || "", (v) => (s.heading_accent = v), { wide: true, readonly: locked, hint: "Starts a new line in mint." }),
    s.kind === "hero" ? field("Kicker", "input", s.kicker || "", (v) => (s.kicker = v), { wide: true, readonly: locked }) : null,
    field(s.kind === "statement" ? "Statement" : "Lead paragraph(s)", "textarea", s.lead || "", (v) => (s.lead = v), { wide: true, readonly: locked, hint: "Leave a blank line between paragraphs." }),
    s.kind === "statement" || s.note ? field("Attribution / note", "input", s.note || "", (v) => (s.note = v), { wide: true, readonly: locked }) : null,
    (s.bullets && s.bullets.length) || (!s.items.length && s.kind === "rich" && !s.section_key)
      ? field("Bullets", "textarea", bulletsToText(s.bullets), (v) => (s.bullets = textToBullets(v, s.bullets.some((b) => typeof b === "object"))), { wide: true, readonly: locked, hint: "One per line. For name + detail write “Name — Detail”." })
      : null,
    itemsEditor(s, locked),
  ];
  const sub = [KINDS[s.kind] || s.kind, s.section_key ? "key: " + s.section_key : "added in the editor"].join(" · ");
  return card(title, sub, fields, { tools, state: s, open: !!s._new });
}

function itemsEditor(s, locked) {
  const supports = s.items.length || ["cards", "ticks", "cta", "hero"].includes(s.kind);
  if (!supports) return null;
  const isLink = (it) => it && "label" in it && !("title" in it);
  const wrap = el("div", { class: "p-items" });
  const draw = () => {
    wrap.innerHTML = "";
    wrap.append(el("div", { class: "p-items-h" }, el("h3", { text: s.kind === "cta" || s.kind === "hero" || (s.items[0] && isLink(s.items[0])) ? "Buttons" : "Items" }),
      locked ? null : el("button", { type: "button", class: "p-icon-btn", onclick: () => { s.items.push(s.items[0] ? Object.fromEntries(Object.keys(s.items[0]).map((k) => [k, Array.isArray(s.items[0][k]) ? [] : ""])) : { title: "", text: "" }); markDirty(); draw(); } }, "Add item")));
    s.items.forEach((it, j) => {
      const box = el("div", { class: "p-item" });
      box.append(el("div", { class: "p-item-h" }, el("span", { text: "Item " + (j + 1) }),
        el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move item up", disabled: locked || j === 0, onclick: () => { move(s.items, j, -1); markDirty(); draw(); } }, "↑"),
        el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move item down", disabled: locked || j === s.items.length - 1, onclick: () => { move(s.items, j, 1); markDirty(); draw(); } }, "↓"),
        locked ? null : el("button", { type: "button", class: "p-icon-btn", "aria-label": "Remove item", onclick: () => { s.items.splice(j, 1); markDirty(); draw(); } }, "Remove")));
      if (isLink(it)) {
        box.append(ifield("Button text", "input", it.label || "", (v) => (it.label = v), locked), ifield("Link", "input", it.href || "", (v) => (it.href = v), locked, { placeholder: "/contact/ or https://…" }));
      } else {
        if ("eyebrow" in it) box.append(ifield("Eyebrow", "input", it.eyebrow || "", (v) => (it.eyebrow = v), locked));
        box.append(ifield("Title", "input", it.title || "", (v) => (it.title = v), locked));
        if ("subtitle" in it) box.append(ifield("Subtitle", "input", it.subtitle || "", (v) => (it.subtitle = v), locked));
        box.append(ifield("Text", "textarea", it.text || "", (v) => (it.text = v), locked, { wide: true }));
        if ("bullets" in it || s.kind === "ticks") box.append(ifield("Bullets", "textarea", bulletsToText(it.bullets), (v) => (it.bullets = textToBullets(v, (it.bullets || []).some((b) => typeof b === "object"))), locked, { wide: true, hint: "One per line." }));
        if ("label" in it || "href" in it) box.append(ifield("Button text", "input", it.label || "", (v) => (it.label = v), locked), ifield("Button link", "input", it.href || "", (v) => (it.href = v), locked));
        if ("image" in it) box.append(imageField("Image", it.image || "", it.image_alt || "", (url, alt) => { it.image = url; it.image_alt = alt; }, locked));
      }
      wrap.append(box);
    });
  };
  draw();
  return wrap;
}

/* ------------------------------------------------------------- team editor */
async function renderTeamEditor() {
  const view = $("#pView"), access = state.access;
  const { data, error } = await supabase.from("pgc_team").select("*").order("team_group").order("sort_order");
  if (error) { notice("Could not load the team: " + errText(error), true); return; }
  state.team = data || [];
  state.page = null; state.sections = [];
  const anyLive = state.team.some((p) => p.published);
  const liveLocked = anyLive && !access.canPublish;

  view.append(el("div", { class: "p-head" }, el("div", null, el("h1", { text: "Team" }), el("p", { class: "p-meta", text: "/team/ · " + state.team.length + " people" })), actionBar("team")));
  if (liveLocked) notice("People who are already live can only be changed by a publisher. You can still add and edit drafts.");

  const editor = el("div", { class: "p-editor" });
  view.append(el("div", { class: "p-layout" }, editor, previewPanel("/team/")));

  if (!state.team.length) {
    editor.append(el("div", { class: "p-card" }, el("p", null, "No people in the database yet; visitors see the team as it is in the repository."),
      el("div", { class: "p-add" }, el("button", { type: "button", class: "btn btn-primary", onclick: async () => {
        try { const live = await readLivePage(PAGE_DEFS.find((d) => d.slug === "team")); state.team = live.team.map((p) => Object.assign(p, { id: null, published: false, review_state: "draft", _new: true })); markDirty(); renderList(); schedulePreview(); }
        catch (e) { notice(errText(e), true); }
      } }, "Start from the live page"))));
  }
  const list = el("div"); editor.append(list);
  const addRow = el("div", { class: "p-add" },
    el("button", { type: "button", class: "btn btn-ghost", onclick: () => { state.team.push({ id: null, name: "", role: "", bio: "", photo_url: "", photo_alt: "", linkedin_url: "", email: "", team_group: "bench", sort_order: (state.team.length + 1) * 10, published: false, review_state: "draft", _new: true }); markDirty(); renderList(); } }, "Add person"));
  editor.append(addRow);

  function renderList() {
    list.innerHTML = "";
    ["principals", "bench"].forEach((g) => {
      const rows = state.team.filter((p) => p.team_group === g);
      if (!rows.length) return;
      list.append(el("p", { class: "p-sidebar-h", text: g === "principals" ? "Principals" : "Execution bench" }));
      rows.forEach((p) => {
        const idx = state.team.indexOf(p);
        const locked = p.published && !access.canPublish;
        const tools = el("div", { class: "p-card-tools" },
          el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move up", disabled: locked || rows.indexOf(p) === 0, onclick: () => { swapOrder(rows, rows.indexOf(p), -1); markDirty(); renderList(); schedulePreview(); } }, "↑"),
          el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move down", disabled: locked || rows.indexOf(p) === rows.length - 1, onclick: () => { swapOrder(rows, rows.indexOf(p), 1); markDirty(); renderList(); schedulePreview(); } }, "↓"),
          (access.canPublish || p._new) ? el("button", { type: "button", class: "p-icon-btn", onclick: async () => {
            if (!confirm("Remove " + (p.name || "this person") + " from the team page?")) return;
            if (p.id) { const { error } = await supabase.from("pgc_team").delete().eq("id", p.id); if (error) { notice("Could not remove: " + errText(error), true); return; } }
            state.team.splice(idx, 1); markDirty(); renderList(); schedulePreview();
          } }, "Remove") : null);
        list.append(card(p.name || "New person", p.role || "", [
          field("Name", "input", p.name || "", (v) => (p.name = v), { readonly: locked }),
          field("Role", "input", p.role || "", (v) => (p.role = v), { readonly: locked }),
          field("Group", "select", p.team_group, (v) => (p.team_group = v), { readonly: locked, options: [["principals", "Principals"], ["bench", "Execution bench"]] }),
          field("LinkedIn", "input", p.linkedin_url || "", (v) => (p.linkedin_url = v), { readonly: locked }),
          field("Email", "input", p.email || "", (v) => (p.email = v), { readonly: locked, type: "email" }),
          field("Bio", "textarea", p.bio || "", (v) => (p.bio = v), { wide: true, readonly: locked, hint: "Leave a blank line between paragraphs." }),
          el("div", { class: "p-field p-field--wide" }, imageField("Headshot (4:5 portrait)", p.photo_url || "", p.photo_alt || p.name || "", (url, alt) => { p.photo_url = url; p.photo_alt = alt; }, locked)),
        ], { tools, state: p, open: !!p._new }));
      });
    });
  }
  renderList();
  schedulePreview();
}

/* --------------------------------------------------------- settings editor */
async function renderSettingsEditor() {
  const view = $("#pView"), access = state.access;
  const { data, error } = await supabase.from("pgc_settings").select("*").order("key");
  if (error) { notice("Could not load the settings: " + errText(error), true); return; }
  state.settings = SETTING_DEFS.map((d) => Object.assign({ id: null, key: d.key, label: d.label, value: "", published: false, review_state: "draft", _new: true }, (data || []).find((r) => r.key === d.key) || {}));
  (data || []).filter((r) => !SETTING_DEFS.some((d) => d.key === r.key)).forEach((r) => state.settings.push(r));
  state.page = null; state.sections = [];
  view.append(el("div", { class: "p-head" }, el("div", null, el("h1", { text: "Site settings" }), el("p", { class: "p-meta", text: "Footer and contact details shown on every page." })), actionBar("settings")));
  const editor = el("div", { class: "p-editor" });
  view.append(el("div", { class: "p-layout" }, editor, previewPanel("/")));
  state.settings.forEach((s) => {
    const locked = s.published && !access.canPublish;
    editor.append(card(s.label, s.key, [field("Value", s.key === "footer_disclaimer" ? "textarea" : "input", s.value || "", (v) => (s.value = v), { wide: true, readonly: locked })], { state: s, open: true }));
  });
  schedulePreview();
}

/* ------------------------------------------------------------- history */
async function renderHistory(filterIds) {
  const view = $("#pView");
  view.append(el("div", { class: "p-head" }, el("div", null, el("h1", { text: "Change history" }), el("p", { class: "p-meta", text: "Every save, publish and removal. A publisher can put any earlier version back." }))));
  const q = supabase.from("content_revisions").select("id,table_name,record_id,operation,label,changed_by,changed_at,snapshot").in("table_name", TABLES).order("changed_at", { ascending: false }).limit(150);
  const { data, error } = await q;
  if (error) { notice("Could not load the history: " + errText(error), true); return; }
  const rows = (data || []).filter((r) => !filterIds || filterIds.includes(r.record_id));
  if (!rows.length) { view.append(el("p", { class: "p-empty", text: "No changes recorded yet." })); return; }
  const table = el("table", { class: "p-table" }, el("thead", null, el("tr", null, el("th", { text: "When" }), el("th", { text: "What" }), el("th", { text: "Change" }), el("th", { text: "By" }), el("th", { text: "" }))));
  const tb = el("tbody");
  rows.forEach((r) => {
    const what = { pgc_pages: "Page", pgc_sections: "Section", pgc_team: "Team", pgc_settings: "Setting" }[r.table_name] || r.table_name;
    const canUndo = state.access.canPublish && r.operation !== "delete";
    tb.append(el("tr", null,
      el("td", { class: "p-nowrap", text: fmtTime(r.changed_at) }),
      el("td", null, el("b", { text: r.label || what }), el("span", { class: "p-sub", text: " · " + what })),
      el("td", { text: { insert: "Created", update: "Edited", delete: "Removed", restore: "Restored" }[r.operation] || r.operation }),
      el("td", { text: r.changed_by || "—" }),
      el("td", null, canUndo ? el("button", { type: "button", class: "p-icon-btn", onclick: async (e) => {
        if (!confirm("Put this version of “" + (r.label || what) + "” back? The current version stays in the history.")) return;
        e.target.disabled = true;
        const res = await supabase.rpc("pgc_restore_revision", { rev_id: r.id });
        if (res.error) { notice("Could not restore: " + errText(res.error), true); e.target.disabled = false; return; }
        notice("Restored “" + (r.label || what) + "”.");
        await loadPages(); renderNav();
        $("#pView").innerHTML = ""; renderHistory(filterIds);
      } }, r.operation === "restore" ? "Restore again" : "Undo to this") : el("span", { class: "p-sub", text: r.operation === "delete" ? "Removed rows can be recreated from an earlier version" : "" }))));
  });
  table.append(tb); view.append(table);
}

/* ------------------------------------------------------------- actions */
function actionBar(mode) {
  const access = state.access;
  const bar = el("div", { class: "p-actions" });
  const rows = () => (mode === "team" ? state.team : mode === "settings" ? state.settings : [state.page].concat(state.sections));
  const anyUnpublished = () => rows().some((r) => !r.published);
  const anyPublished = () => rows().some((r) => r.published);
  const liveLocked = () => !access.canPublish && rows().some((r) => r.published) && mode !== "team" && mode !== "settings";

  const save = el("button", { type: "button", class: "btn btn-ghost", onclick: () => saveAll(mode, {}) }, access.canPublish && anyPublished() ? "Save" : "Save draft");
  bar.append(save);
  if (!liveLocked()) {
    if (anyUnpublished()) {
      const inReview = rows().filter((r) => !r.published).every((r) => r.review_state === "in_review");
      bar.append(inReview
        ? el("button", { type: "button", class: "btn btn-ghost", onclick: () => saveAll(mode, { review_state: "draft" }) }, "Withdraw from review")
        : el("button", { type: "button", class: "btn btn-ghost", onclick: () => saveAll(mode, { review_state: "in_review" }) }, "Submit for review"));
    }
    if (access.canPublish) {
      if (anyUnpublished()) bar.append(el("button", { type: "button", class: "btn btn-primary", onclick: () => { if (confirm("Publish to the public site now?")) saveAll(mode, { published: true }); } }, "Publish"));
      if (anyUnpublished() && rows().some((r) => !r.published && r.review_state === "in_review"))
        bar.append(el("button", { type: "button", class: "btn btn-ghost", onclick: () => saveAll(mode, { review_state: "changes_requested" }) }, "Request changes"));
      if (anyPublished()) bar.append(el("button", { type: "button", class: "btn btn-danger", onclick: () => { if (confirm("Unpublish? Visitors will see the version built into the site until this is published again.")) saveAll(mode, { published: false }); } }, "Unpublish"));
    }
  }
  return bar;
}

/* Save every row of the current view. `change` is merged into each row:
   {} save as-is · {review_state} · {published:true|false}. */
async function saveAll(mode, change) {
  if (state.saving) return;
  state.saving = true;
  notice("Saving…");
  try {
    const stamp = (r) => {
      const out = Object.assign({}, r, change);
      if (change.published === true) out.review_state = "draft";
      if (change.published === false) out.review_state = out.review_state === "changes_requested" ? "changes_requested" : "draft";
      return out;
    };
    let saved = 0, refused = 0;
    if (mode === "team") {
      for (const [i, p] of state.team.entries()) { p.sort_order = (i + 1) * 10; const r = await upsert("pgc_team", stamp(p), ["name", "role", "bio", "photo_url", "photo_alt", "linkedin_url", "email", "team_group", "sort_order", "published", "review_state"]); if (r.ok) { Object.assign(p, r.row, { _new: false }); saved++; } else refused++; }
    } else if (mode === "settings") {
      for (const s of state.settings) { if (!s.value && s._new) continue; const r = await upsert("pgc_settings", stamp(s), ["key", "label", "value", "published", "review_state"]); if (r.ok) { Object.assign(s, r.row, { _new: false }); saved++; } else refused++; }
    } else {
      const pr = await upsert("pgc_pages", stamp(state.page), ["slug", "path", "title", "nav_label", "meta_description", "sort_order", "published", "review_state"]);
      if (pr.ok) { Object.assign(state.page, pr.row); saved++; } else refused++;
      for (const [i, s] of state.sections.entries()) {
        s.sort_order = (i + 1) * 10; s.page_id = state.page.id;
        const r = await upsert("pgc_sections", stamp(s), ["page_id", "section_key", "kind", "eyebrow", "heading", "heading_accent", "kicker", "lead", "note", "bullets", "items", "image_url", "image_alt", "band", "sort_order", "published", "review_state"]);
        if (r.ok) { Object.assign(s, r.row, { _new: false }); saved++; } else { refused++; if (r.error) notice(r.error, true); }
      }
    }
    state.dirty = false;
    await loadPages(); renderNav();
    const verb = change.published === true ? "Published" : change.published === false ? "Unpublished" : change.review_state === "in_review" ? "Submitted for review" : change.review_state === "changes_requested" ? "Changes requested" : "Saved";
    if (refused) notice(verb + " " + saved + " of " + (saved + refused) + " items. The rest were refused — you may not have permission for live content.", true);
    else notice(verb + " (" + saved + " items).");
    // Redraw so pills and buttons reflect the new state.
    const hash = location.hash; state.route = null;
    $("#pView").innerHTML = "";
    if (mode === "team") await renderTeamEditor(); else if (mode === "settings") await renderSettingsEditor(); else await renderPageEditor(parseHash().slug);
    state.route = Object.assign(parseHash(), { hash });
  } catch (e) {
    notice("Save failed: " + errText(e), true);
  } finally { state.saving = false; }
}

async function upsert(table, row, cols) {
  const payload = {};
  cols.forEach((c) => { if (row[c] !== undefined) payload[c] = row[c] === "" ? null : row[c]; });
  if (table === "pgc_sections") { payload.items = row.items || []; payload.bullets = row.bullets || []; }
  if (payload.published == null) payload.published = false;
  if (!payload.review_state) payload.review_state = "draft";
  if (row.id) {
    const { data, error } = await supabase.from(table).update(payload).eq("id", row.id).select();
    if (error) return { ok: false, error: errText(error) };
    if (!data || !data.length) return { ok: false, error: "A live item was not changed: it needs a publisher." };
    return { ok: true, row: data[0] };
  }
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) return { ok: false, error: errText(error) };
  return { ok: true, row: data };
}

/* Create a page's rows from the markup the public site already serves. */
async function setupPage(def) {
  notice("Reading the live page…");
  try {
    const live = await readLivePage(def);
    const page = { slug: def.slug, path: def.path, title: live.title || def.title, nav_label: def.nav_label, meta_description: live.meta_description, sort_order: (PAGE_DEFS.findIndex((d) => d.slug === def.slug) + 1) * 10, published: false, review_state: "draft" };
    const pr = await upsert("pgc_pages", page, ["slug", "path", "title", "nav_label", "meta_description", "sort_order", "published", "review_state"]);
    if (!pr.ok) throw new Error(pr.error);
    for (const s of live.sections) {
      const r = await upsert("pgc_sections", Object.assign(s, { page_id: pr.row.id, published: false, review_state: "draft" }), ["page_id", "section_key", "kind", "eyebrow", "heading", "heading_accent", "kicker", "lead", "note", "bullets", "items", "band", "sort_order", "published", "review_state"]);
      if (!r.ok) throw new Error(r.error);
    }
    await loadPages(); renderNav();
    notice("Draft created from the live page. Nothing is published yet.");
    $("#pView").innerHTML = ""; await renderPageEditor(def.slug);
  } catch (e) { notice("Could not set the page up: " + errText(e), true); }
}

/* -------------------------------------------------------------- preview */
let previewFrame = null, previewReady = false;
function previewPanel(path) {
  previewReady = false;
  const frame = el("iframe", { title: "Live preview of the page", src: path + "?pgc_preview=1" });
  previewFrame = frame;
  const wrap = el("div", { class: "p-preview" });
  const toggle = el("button", { type: "button", class: "p-icon-btn", "aria-pressed": "false", onclick: () => { const m = wrap.classList.toggle("is-mobile"); toggle.setAttribute("aria-pressed", String(m)); } }, "Phone width");
  wrap.append(el("div", { class: "p-preview-h" }, el("h2", { text: "Live preview" }), toggle, el("a", { class: "p-link-btn", href: path, target: "_blank", rel: "noopener", text: "Open page" })), frame);
  return wrap;
}
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data) return;
  if (e.data.type === "pgc:preview-ready") { previewReady = true; sendPreview(); }
});
function sendPreview() {
  if (!previewFrame || !previewReady || !previewFrame.contentWindow) return;
  const msg = { type: "pgc:preview" };
  if (state.page) msg.sections = state.sections.map((s, i) => Object.assign({}, s, { sort_order: (i + 1) * 10 }));
  if (state.route && state.route.view === "team") msg.team = state.team;
  if (state.route && state.route.view === "settings") msg.settings = state.settings;
  previewFrame.contentWindow.postMessage(msg, location.origin);
}
const schedulePreview = debounce(sendPreview, 250);

/* ------------------------------------------------------------- helpers */
function markDirty() { state.dirty = true; schedulePreview(); }
function move(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }
function swapOrder(rows, i, d) {
  const j = i + d; if (j < 0 || j >= rows.length) return;
  const a = rows[i], b = rows[j];
  const ai = state.team.indexOf(a), bi = state.team.indexOf(b);
  [state.team[ai], state.team[bi]] = [state.team[bi], state.team[ai]];
}

function card(title, sub, fields, opts) {
  opts = opts || {};
  const id = nextId("card");
  const body = el("div", { class: "p-card-body", id, hidden: !opts.open });
  fields.filter(Boolean).forEach((f) => body.append(f));
  const toggle = el("button", { type: "button", class: "p-toggle", "aria-expanded": String(!!opts.open), "aria-controls": id, text: title,
    onclick: () => { body.hidden = !body.hidden; toggle.setAttribute("aria-expanded", String(!body.hidden)); } });
  const head = el("div", { class: "p-card-h" }, el("h2", null, toggle), sub ? el("span", { class: "p-sub", text: sub }) : null, opts.state ? pill(opts.state) : null);
  if (opts.tools) head.append(opts.tools);
  return el("div", { class: "p-card" }, head, body);
}

function field(label, type, value, onChange, opts) {
  opts = opts || {};
  const id = nextId("f");
  let input;
  if (type === "select") {
    input = el("select", { id, disabled: !!opts.readonly }, ...(opts.options || []).map(([v, t]) => el("option", { value: v, text: t, selected: v === value || null })));
  } else {
    input = el(type === "textarea" ? "textarea" : "input", { id, type: type === "input" ? opts.type || "text" : null, readonly: !!opts.readonly, placeholder: opts.placeholder });
    input.value = value || "";
  }
  input.addEventListener("input", () => { onChange(input.value); markDirty(); });
  input.addEventListener("change", () => { onChange(input.value); markDirty(); });
  return el("div", { class: "p-field" + (opts.wide ? " p-field--wide" : "") }, el("label", { for: id, text: label }), input, opts.hint ? el("p", { class: "p-hint", text: opts.hint }) : null);
}
function ifield(label, type, value, onChange, locked, opts) {
  const f = field(label, type, value, onChange, Object.assign({ readonly: locked }, opts || {}));
  f.className = "p-item-field" + (opts && opts.wide ? " p-item-field--wide" : "");
  return f;
}

function imageField(label, url, alt, onChange, locked) {
  const id = nextId("img"), altId = nextId("alt");
  const preview = el("img", { src: url || "/assets/img/avatar-placeholder.svg", alt: "" });
  const urlInput = el("input", { id, type: "text", readonly: locked, placeholder: "https://… or /assets/img/…" }); urlInput.value = url || "";
  const altInput = el("input", { id: altId, type: "text", readonly: locked }); altInput.value = alt || "";
  const status = el("p", { class: "p-hint", role: "status" });
  const apply = () => { onChange(urlInput.value.trim(), altInput.value.trim()); preview.src = urlInput.value.trim() || "/assets/img/avatar-placeholder.svg"; markDirty(); };
  urlInput.addEventListener("input", apply); altInput.addEventListener("input", apply);
  const file = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/avif,image/svg+xml", "aria-label": "Upload an image", disabled: locked });
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0]; if (!f) return;
    if (!/^image\//.test(f.type)) { status.textContent = "Choose an image file."; return; }
    if (f.size > 8 * 1024 * 1024) { status.textContent = "Images must be 8 MB or smaller."; return; }
    status.textContent = "Uploading…";
    const safe = f.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
    const path = new Date().toISOString().slice(0, 10) + "/" + Date.now().toString(36) + "-" + safe;
    const { error } = await supabase.storage.from(PGC_BUCKET).upload(path, f, { contentType: f.type, cacheControl: "31536000", upsert: false });
    if (error) { status.textContent = "Upload failed: " + errText(error); return; }
    const { data } = supabase.storage.from(PGC_BUCKET).getPublicUrl(path);
    urlInput.value = data.publicUrl; apply(); status.textContent = "Uploaded.";
  });
  return el("div", { class: "p-item-field p-item-field--wide" },
    el("label", { for: id, text: label }),
    el("div", { class: "p-image" }, preview, el("div", { style: "flex:1;min-width:200px" }, urlInput, el("label", { for: altId, text: "Alt text", style: "margin-top:8px" }), altInput, locked ? null : file, status)));
}

/* ------------------------------------------------------------------ go */
clearTimeout(window.__pgcBootTimer);
wireSignin();
boot();
window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });
