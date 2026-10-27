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
import { schemaFor } from "./editor-schema.js";

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
/* `extra` holds one-off pieces such as the Thesis lens banner. It is only sent
   once the column exists, so this file can ship before the migration runs. */
const SECTION_COLS = () => ["page_id", "section_key", "kind", "eyebrow", "heading", "heading_accent", "kicker", "lead", "note", "bullets", "items", "image_url", "image_alt", "band", "sort_order", "published", "review_state"].concat(state.hasExtra ? ["extra"] : []);
const SETTING_DEFS = [
  { key: "footer_tagline", label: "Footer tagline", hint: "Under the logo in the footer of every page." },
  { key: "footer_disclaimer", label: "Footer disclosure", hint: "The small legal line near the bottom of every page." },
  { key: "contact_email", label: "Contact email address", hint: "Footer of every page and the Contact page sidebar." },
  { key: "hq_location", label: "HQ line", hint: "Shown as < HQ / Indianapolis, IN > in the footer and on the Contact page." },
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
const NL_MODULE = "pgc_newsletter";
function buildAccess(raw) {
  const role = (raw && raw.role) || null;
  const status = (raw && raw.status) || null;
  const modules = (raw && raw.modules) || {};
  const active = status === "active";
  const isAdmin = active && role === "admin";
  const level = isAdmin ? "publisher" : active ? modules[PGC_MODULE] || null : null;
  // Email campaigns are a second module; administrators have it implicitly too.
  const nlLevel = isAdmin ? "publisher" : active ? modules[NL_MODULE] || null : null;
  return {
    email: (raw && raw.email) || "", fullName: (raw && raw.full_name) || "", role, status, isAdmin,
    level, nlLevel, isEmployee: !!raw, active,
    canEdit: level === "contributor" || level === "publisher",
    canPublish: level === "publisher",
    canEditNl: nlLevel === "contributor" || nlLevel === "publisher",
    canPublishNl: nlLevel === "publisher",
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
  [signin, $("#pRegister"), $("#pVerify"), denied, app].forEach((x) => (x.hidden = true));
  boot.hidden = false;
  const { data } = await supabase.auth.getSession();
  const session = data && data.session;
  if (!session) { boot.hidden = true; signin.hidden = false; $("#pEmail").focus(); return; }

  let res = await supabase.rpc("my_access");
  // Just verified a new account: the database normally creates the profile at
  // that moment; if it hasn't yet, ask it to (same rules, read from the login itself).
  if (!res.error && !res.data) {
    const made = await supabase.rpc("ensure_my_profile");
    if (!made.error && made.data) res = made;
  }
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
  if (!access.canEdit && !access.canEditNl) {
    denied.hidden = false;
    $("#pDeniedMsg").textContent = "Your account is active but does not have the “Proving Ground Capital pages” or “Proving Ground Capital email campaigns” permission.";
    return;
  }
  app.hidden = false;
  $("#pWho").textContent = access.fullName || access.email;
  $("#pLevel").textContent = access.isAdmin ? "Administrator" : (access.level || access.nlLevel) === "publisher" ? "Publisher" : "Contributor";
  // Each sidebar section follows its own permission.
  ["#pPagesH", "#pPageNav", "#pOtherH", "#pOtherNav"].forEach((s) => ($(s).hidden = !access.canEdit));
  ["#pEmailH", "#pEmailNav"].forEach((s) => ($(s).hidden = !access.canEditNl));
  if (access.canEdit) await loadPages();
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
    if (error) { say(/signups not allowed|not found|user/i.test(error.message) ? "No account with that address. With a @pgc.capital email you can create one below; otherwise an ARI administrator can add you." : errText(error), "is-error"); return; }
    say("Check your inbox — the sign-in link is on its way to " + email + ".", "is-ok");
  });
  document.querySelectorAll("[data-signout]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await ensureClean())) return;
    await supabase.auth.signOut();
    state.access = null; state.page = null; state.sections = [];
    NL.page = null; NL.loading = null; NL.missing = false; NL_VIEWS.forEach((v) => { const p = $("#panel-" + v); if (p) p.innerHTML = ""; });
    location.hash = "";
    boot();
  }));
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" && !state.access) boot();
    if (event === "SIGNED_OUT" && state.access) { state.access = null; boot(); }
  });
}

/* ----------------------------------------------------------- create account */
// Only @pgc.capital here (ARI staff register in the ARI portal). The database
// enforces the domain and grants the starting access (website + email campaigns
// contributor) once the email is verified; the browser's data can't change it.
const REG_DOMAIN = "pgc.capital";
function wireRegister() {
  const reg = $("#pRegister"), ver = $("#pVerify"), signin = $("#pSignin");
  const say = (node, t, cls) => { node.textContent = t; node.className = "p-msg" + (cls ? " " + cls : ""); };
  const regMsg = $("#pRegMsg"), verMsg = $("#pVerifyMsg");
  let pending = "", lastSent = 0;
  const show = (v) => { [signin, reg, ver].forEach((x) => (x.hidden = x !== v)); };
  $("#pShowRegister").addEventListener("click", () => {
    say(regMsg, "");
    const typed = $("#pEmail").value.trim().toLowerCase();
    if (typed.endsWith("@" + REG_DOMAIN)) $("#pRegEmail").value = typed;
    show(reg); $("#pRegName").focus();
  });
  document.querySelectorAll("[data-show-signin]").forEach((b) => b.addEventListener("click", () => { show(signin); $("#pEmail").focus(); }));

  $("#pRegisterForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#pRegName").value.trim(), email = $("#pRegEmail").value.trim().toLowerCase();
    const p1 = $("#pRegPw1").value, p2 = $("#pRegPw2").value;
    const fail = (t, field) => { say(regMsg, t, "is-error"); field.focus(); };
    if (!name) return fail("Enter your full name.", $("#pRegName"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter your work email address.", $("#pRegEmail"));
    const dom = email.split("@")[1];
    if (dom === "theari.us") return fail("@theari.us accounts are created in the ARI portal. If you already have one, go back and sign in with it.", $("#pRegEmail"));
    if (dom !== REG_DOMAIN) return fail("Accounts can only be created with a @pgc.capital email address. If you don’t have one, ask an administrator to add you.", $("#pRegEmail"));
    if (p1.length < 10) return fail("Use at least 10 characters for your password.", $("#pRegPw1"));
    if (p1 !== p2) return fail("Those passwords don’t match.", $("#pRegPw2"));
    $("#pRegSubmit").disabled = true; say(regMsg, "Creating your account…");
    try {
      // site: "pgc" lets the confirmation email template show PGC wording.
      const { data, error } = await supabase.auth.signUp({ email, password: p1, options: { data: { full_name: name, site: "pgc" }, emailRedirectTo: location.origin + "/portal/" } });
      if (error) throw error;
      // Supabase doesn't say whether an address exists; an empty identities list is its signal.
      if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        say(regMsg, "This email already has an account. Go back and sign in, or use “Email me a sign-in link” if you’ve forgotten the password.", "is-error");
        return;
      }
      if (data && data.session) { say(regMsg, ""); await boot(); return; }
      pending = email; lastSent = Date.now();
      $("#pVerifyEmail").textContent = email; $("#pVerifyCode").value = ""; say(verMsg, "");
      show(ver); $("#pVerifyCode").focus();
    } catch (err) {
      const m = (err && err.message) || "";
      say(regMsg, /already (registered|exists)/i.test(m) ? "This email already has an account. Go back and sign in."
        : /database error|register/i.test(m) ? "That address can’t create an account. Use your @pgc.capital email, or ask an administrator."
        : /rate limit|security purposes|too many/i.test(m) ? "Too many attempts. Wait a minute and try again."
        : /password/i.test(m) ? m
        : "Couldn’t create the account right now (" + (m || "unknown error") + ").", "is-error");
    } finally { $("#pRegSubmit").disabled = false; }
  });

  // The code works even when a mail filter (e.g. Microsoft Safe Links) opens or rewrites the link.
  $("#pVerifyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("#pVerifyCode").value.replace(/\D/g, "");
    if (code.length !== 6) { say(verMsg, "Enter the 6-digit code from the email.", "is-error"); $("#pVerifyCode").focus(); return; }
    $("#pVerifySubmit").disabled = true; say(verMsg, "Checking…");
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: pending, token: code, type: "signup" });
      if (error) throw error;
      say(verMsg, "");
      if (data && data.session) { await boot(); return; }
      show(signin); say($("#pSigninMsg"), "Your email is confirmed. Sign in with your password.", "is-ok");
      $("#pEmail").value = pending; $("#pPassword").focus();
    } catch (err) {
      say(verMsg, /expired|invalid|not found|otp|token/i.test((err && err.message) || "") ? "That code isn’t right or has expired. Use the code from the newest email, or send a new one." : ((err && err.message) || "Couldn’t check the code right now."), "is-error");
    } finally { $("#pVerifySubmit").disabled = false; }
  });
  $("#pVerifyResend").addEventListener("click", async () => {
    const wait = 60000 - (Date.now() - lastSent);
    if (wait > 0) { say(verMsg, "You can ask for a new code in " + Math.ceil(wait / 1000) + " seconds."); return; }
    $("#pVerifyResend").disabled = true;
    const { error } = await supabase.auth.resend({ type: "signup", email: pending, options: { emailRedirectTo: location.origin + "/portal/" } });
    $("#pVerifyResend").disabled = false;
    if (error) { say(verMsg, /rate limit|security purposes|too many/i.test(error.message) ? "Too many attempts. Wait a minute and try again." : errText(error), "is-error"); return; }
    lastSent = Date.now();
    say(verMsg, "A new code is on its way to " + pending + ". Use the newest email.", "is-ok");
  });
}

/* ------------------------------------------------------------------ data */
async function loadPages() {
  const { data, error } = await supabase.from("pgc_pages").select("*").order("sort_order", { ascending: true });
  if (error) { notice("Could not load the page list: " + errText(error), true); state.pages = []; return; }
  state.pages = data || [];
  if (state.hasExtra == null) {
    const probe = await supabase.from("pgc_sections").select("extra").limit(1);
    state.hasExtra = !probe.error;
  }
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
const NL_VIEWS = ["campaigns", "nlreports", "nltemplates", "nllists"];
function parseHash() {
  const m = String(location.hash || "").match(/^#\/(page|team|settings|history|campaigns|nlreports|nltemplates|nllists)(?:\/([a-z0-9-]+))?/);
  if (!m) return state.access && !state.access.canEdit && state.access.canEditNl ? { view: "campaigns", slug: null } : { view: "page", slug: (state.pages[0] || PAGE_DEFS[0]).slug };
  return { view: m[1], slug: m[2] || null };
}
/* Unsaved work anywhere (page editor or an open campaign) is settled before the route changes. */
async function ensureClean() {
  if (NL.page && NL.page.isDirty()) {
    const choice = await confirmDialog({ kicker: "Unsaved changes", title: "Save this campaign before leaving?", body: "Your edits are not saved yet.",
      buttons: [{ label: "Save and leave", value: "save", cls: "btn btn-primary" }, { label: "Leave without saving", value: "discard", cls: "btn btn-danger" }, { label: "Stay", value: "stay", cls: "btn btn-ghost" }], escValue: "stay" });
    if (choice === "stay") return false;
    if (choice === "save") return await NL.page.save();
    NL.page.discard();
    return true;
  }
  if (state.dirty) return confirm("You have unsaved changes. Leave this page and lose them?");
  return true;
}
async function onRoute() {
  // Signed out (e.g. the hash reset during sign-out): boot() shows the sign-in screen.
  if (!state.access) return;
  if (!(await ensureClean())) {
    history.replaceState(null, "", state.route && state.route.hash || "#/");
    return;
  }
  state.dirty = false;
  const r = parseHash();
  r.hash = location.hash;
  const access = state.access;
  if ((r.view === "page" || r.view === "team" || r.view === "settings" || r.view === "history") && !access.canEdit) { location.hash = "#/campaigns"; return; }
  if (NL_VIEWS.includes(r.view) && !access.canEditNl) { state.flash = "You don’t have access to email campaigns."; location.hash = "#/"; return; }
  state.route = r;
  notice("");
  // A message set just before a redirect survives the route change.
  if (state.flash) { notice(state.flash, true); state.flash = null; }
  $("#pSidebar").classList.remove("is-open"); $("#pNavToggle").setAttribute("aria-expanded", "false");
  document.querySelectorAll(".p-nav-item").forEach((b) => b.removeAttribute("aria-current"));
  const view = $("#pView"); view.innerHTML = "";
  const marketing = NL_VIEWS.includes(r.view);
  $("#pMarketing").hidden = !marketing; view.hidden = marketing;
  if (marketing) {
    state.page = null; state.sections = [];
    const btn = $('.p-nav-item[data-view="' + r.view + '"]'); if (btn) btn.setAttribute("aria-current", "page");
    NL_VIEWS.forEach((v) => { const p = $("#panel-" + v); if (p) p.hidden = v !== r.view; });
    const opts = NL.pendingOpts || {}; NL.pendingOpts = null;
    try {
      await initNewsletter();
      if (NL.missing) renderEmailSetup($("#panel-" + r.view));
      else if (NL.page) await NL.page.show(r.view, opts);
    } catch (e) { notice("The email campaigns pages could not load: " + errText(e), true); }
  } else if (r.view === "page") {
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

/* ------------------------------------------------- email campaigns (Mailchimp) */
const NL = { page: null, pendingOpts: null, loading: null, missing: false };
async function initNewsletter() {
  if (NL.page || NL.missing || !state.access || !state.access.canEditNl) return;
  if (NL.loading) return NL.loading;
  NL.loading = (async () => {
    const probe = await supabase.from("pgc_campaigns").select("id").limit(1);
    if (probe.error && missingTable(probe.error)) { NL.missing = true; return; }
    const mod = await import("./newsletter.js");
    const access = state.access;
    NL.page = mod.initMarketing({
      supabase,
      roots: { campaigns: $("#panel-campaigns"), nlreports: $("#panel-nlreports"), nltemplates: $("#panel-nltemplates"), nllists: $("#panel-nllists") },
      // The module asks per module name; here only pgc_newsletter is ever asked for.
      access: { email: access.email, canEdit: (m) => (m === NL_MODULE ? access.canEditNl : false), canPublish: (m) => (m === NL_MODULE ? access.canPublishNl : false) },
      edgeCall, confirmDialog, fmtDate, fmtDateTime,
      notice: (text, kind, ms) => { notice(text, kind === "error"); clearTimeout(notice.t); notice.t = setTimeout(() => notice(""), ms || (kind === "error" ? 8000 : 5000)); },
      navigate: (tab, opts) => { NL.pendingOpts = opts || null; if (location.hash === "#/" + tab) onRoute(); else location.hash = "#/" + tab; },
    });
  })();
  await NL.loading;
}
/* Call the pgc-mailchimp edge function with the signed-in person's token. */
async function edgeCall(fn, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("You’re signed out. Sign in again.");
  let r;
  try {
    r = await fetch(supabase.supabaseUrl + "/functions/v1/" + fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabase.supabaseKey, Authorization: "Bearer " + session.access_token },
      body: JSON.stringify(body || {}),
    });
  } catch {
    // A missing function fails its CORS preflight, which the browser reports as "Failed to fetch".
    throw new Error("Couldn’t reach the sending service (" + fn + "). Either it isn’t deployed yet (see README → Email campaigns) or your connection dropped — try again.");
  }
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 && !d.error) throw new Error("The sending service (" + fn + ") isn’t deployed yet. An administrator deploys it — see README → Email campaigns.");
  if (!r.ok) throw Object.assign(new Error(d.error || "Request failed (" + r.status + ")"), { checklist: d.checklist });
  return d;
}

/* The Email pages need the 20261024_pgc_newsletter.sql tables. Until they exist,
   say so in plain words instead of showing PostgREST's schema-cache error. */
const missingTable = (e) => !!e && (/PGRST205|42P01/.test(String(e.code || "")) || /schema cache|does not exist/i.test(String(e.message || "")));
function renderEmailSetup(panel) {
  panel.replaceChildren(
    el("div", { class: "p-head" }, el("div", { class: "p-head-main" }, el("h1", { text: "Email campaigns" }),
      el("p", { class: "p-meta" }, el("span", { class: "p-pill p-pill--draft", text: "Not set up" })))),
    el("div", { class: "p-card p-setup" },
      el("h2", { text: "The campaign tables haven’t been created yet" }),
      el("p", null, "Nothing is wrong with your account: the database for email campaigns hasn’t been switched on. Once it has, this page lists your campaigns."),
      el("ol", null,
        el("li", null, "Apply ", el("code", { text: "supabase/migrations/20261024_pgc_newsletter.sql" }), " in Supabase (SQL editor, or the migrations tool)."),
        el("li", null, "Create or pick the PGC audience in Mailchimp and verify the From domain."),
        el("li", null, "Add the ", el("code", { text: "PGC_MAILCHIMP_AUDIENCE_ID" }), " secret under Edge Functions → Secrets."),
        el("li", null, "Deploy the ", el("code", { text: "pgc-mailchimp" }), " function."),
        el("li", null, "Reload this page.")),
      el("p", { class: "p-hint", text: "The same steps are in the repository README under “Email campaigns (Mailchimp) in the portal”." })));
}
/* An accessible confirm dialog: resolves with the chosen button's value (false / escValue on Escape). */
let pendingConfirm = null;
function confirmDialog(opts) {
  if (pendingConfirm) pendingConfirm.cancel();
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const escValue = opts.escValue !== undefined ? opts.escValue : false;
    const kicker = el("p", { class: "p-modal-kicker", text: opts.kicker || "Please confirm" });
    const title = el("h2", { class: "p-modal-title", id: "pModalTitle", text: opts.title || "Are you sure?" });
    const body = el("p", { class: "p-modal-body", id: "pModalBody", text: opts.body || "" });
    const actions = el("div", { class: "p-modal-actions" });
    const card = el("div", { class: "p-modal-card", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "pModalTitle", "aria-describedby": "pModalBody" }, kicker, title, body, actions);
    const modal = el("div", { class: "p-modal" }, card);
    let settled = false;
    const done = (v) => {
      if (settled) return; settled = true; pendingConfirm = null;
      document.removeEventListener("keydown", onKey); modal.remove();
      if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true });
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); done(escValue); return; }
      if (e.key === "Tab") { const bs = [...actions.querySelectorAll("button")]; const i = bs.indexOf(document.activeElement); if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === bs.length - 1)) { e.preventDefault(); bs[e.shiftKey ? bs.length - 1 : 0].focus(); } }
    };
    (opts.buttons || [
      { label: opts.confirmLabel || "Delete", value: true, cls: opts.danger === false ? "btn btn-primary" : "btn btn-danger" },
      { label: "Cancel", value: false, cls: "btn btn-ghost" },
    ]).forEach((b) => actions.append(el("button", { type: "button", class: b.cls || "btn btn-ghost", onclick: () => done(b.value) }, b.label)));
    modal.addEventListener("click", (e) => { if (e.target === modal) done(escValue); });
    document.addEventListener("keydown", onKey);
    document.body.append(modal);
    pendingConfirm = { cancel: () => done(escValue) };
    const first = actions.querySelector("button"); if (first) first.focus();
  });
}
function fmtDate(ts) { if (!ts) return ""; const d = new Date(ts); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function fmtDateTime(ts) { if (!ts) return ""; const d = new Date(ts); return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }

function renderNav() {
  const ul = $("#pPageNav"); ul.innerHTML = "";
  const defs = PAGE_DEFS.map((d) => Object.assign({}, d, state.pages.find((p) => p.slug === d.slug) || {}));
  state.pages.filter((p) => !PAGE_DEFS.some((d) => d.slug === p.slug)).forEach((p) => defs.push(p));
  defs.forEach((d) => {
    // A status dot keeps every label on one line; the page's own header shows the full pill.
    const st = d.id ? stateOf(d) : "none";
    const label = d.id ? STATE_LABEL[st] : "Not set up";
    const b = el("button", { type: "button", class: "p-nav-item", "data-slug": d.slug, title: label, onclick: () => (location.hash = "#/page/" + d.slug) },
      el("span", { class: "p-nav-label", text: d.nav_label || d.title || d.slug }),
      el("span", { class: "p-dot p-dot--" + st, "aria-hidden": "true" }), el("span", { class: "p-sr", text: label }));
    ul.append(el("li", null, b));
  });
  document.querySelectorAll("#pOtherNav .p-nav-item, #pEmailNav .p-nav-item").forEach((b) => (b.onclick = () => { if (location.hash === "#/" + b.dataset.view) onRoute(); else location.hash = "#/" + b.dataset.view; }));
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
  try {
    const live = await readLivePage(def);
    state.sections.forEach((s) => {
      const base = s.section_key && live.sections.find((x) => x.section_key === s.section_key);
      if (base) fillFromBaseline(s, base, schemaFor(slug, s));
    });
  } catch { /* the editor still works on the database copy alone */ }
  const liveLocked = page.published && !access.canPublish;   // ARI rule: contributors cannot touch live rows

  const head = el("div", { class: "p-head" },
    el("div", { class: "p-head-main" },
      el("h1", { text: page.nav_label || def.nav_label || page.title }),
      el("p", { class: "p-meta" }, pill(page),
        el("a", { href: def.path, target: "_blank", rel: "noopener", class: "p-meta-link", text: "pgc.capital" + def.path }),
        page.updated_by ? el("span", { text: "Edited " + fmtTime(page.updated_at) + " by " + page.updated_by }) : null)),
    actionBar());
  view.append(head);
  if (liveLocked) notice("This page is live. Contributors cannot change published content — a publisher can, or can unpublish it so you can edit a draft.");
  else if (page.published && access.canPublish) notice("This page is live. Saving changes updates the public site immediately; every change is kept in the history and can be undone.");
  else if (page.review_state === "changes_requested") notice("A publisher asked for changes to this page. Edit and submit it for review again.");

  const editor = el("div", { class: "p-editor" });
  const layout = el("div", { class: "p-layout" }, editor, previewPanel(def.path));
  view.append(layout);

  // Page-level fields
  editor.append(card("Page settings", "Browser title, menu label, search description", [
    field("Browser title", "input", page.title || "", (v) => (page.title = v), { wide: true, readonly: liveLocked }),
    field("Menu label", "input", page.nav_label || "", (v) => (page.nav_label = v), { readonly: liveLocked }),
    field("Search description", "textarea", page.meta_description || "", (v) => (page.meta_description = v), { wide: true, readonly: liveLocked, hint: "Shown by search engines under the page title. About 150 characters." }),
  ], { open: false }));

  const listHead = el("h2", { class: "p-list-h" });
  const list = el("div", { class: "p-sections" });
  editor.append(listHead, list);
  const addRow = el("div", { class: "p-add" });
  if (!liveLocked) {
    const sel = el("select", { "aria-label": "Kind of section to add" }, ...Object.entries(KINDS).filter(([k]) => k !== "hero").map(([k, v]) => el("option", { value: k, text: v })));
    addRow.append(sel, el("button", { type: "button", class: "btn btn-ghost", onclick: () => { state.sections.push(blankSection(sel.value)); markDirty(); drawSections(); } }, "Add section"));
  }
  editor.append(addRow);

  function drawSections() {
    list.innerHTML = "";
    listHead.replaceChildren("Sections", el("span", { class: "p-count", text: String(state.sections.length) }));
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

/* ------------------------------------------------- section editor (schema) */
/* Every section is drawn from its entry in editor-schema.js, so each field is
   named after what it changes on the page and only the fields the design has
   are shown. */
const normNl = (v) => String(v == null ? "" : v).replace(/\r\n?/g, "\n");
const splitParas = (v) => normNl(v).split(/\n{2,}/);
function getVal(obj, f) {
  if (f.key.startsWith("extra.")) return (obj.extra || {})[f.key.slice(6)];
  if (f.para != null) { const p = splitParas(obj[f.key]); return p[f.para] || ""; }
  return obj[f.key];
}
function setVal(obj, f, v) {
  if (f.key.startsWith("extra.")) { obj.extra = Object.assign({}, obj.extra || {}, { [f.key.slice(6)]: v }); return; }
  if (f.para != null) {
    const p = splitParas(obj[f.key]);
    while (p.length <= f.para) p.push("");
    p[f.para] = String(v || "").replace(/\n{2,}/g, "\n").trim();
    obj[f.key] = p.map((x) => x.trim()).filter(Boolean).join("\n\n");
    return;
  }
  obj[f.key] = v;
}

/* Fill gaps from the page's own markup: a value the database does not hold
   yet is still on the live site (the markup stays when a value is empty). */
function fillFromBaseline(row, base, schema) {
  if (!base) return;
  (schema.fields || []).forEach((f) => {
    if (!f.key || f.type === "band") return;
    // The mint part is written together with the white part, so an empty one
    // really is empty on the site whenever the white part is set.
    if (f.key === "heading_accent" && row.heading) return;
    const cur = getVal(row, f), b = getVal(base, f);
    if ((cur == null || cur === "" || (Array.isArray(cur) && !cur.length)) && b != null && b !== "") setVal(row, f, b);
  });
  if (schema.items && Array.isArray(base.items)) {
    if (!row.items.length && base.items.length) row.items = JSON.parse(JSON.stringify(base.items));
    row.items.forEach((it, j) => {
      const bi = base.items[j]; if (!bi) return;
      schema.items.fields.forEach((f) => {
        const cur = getVal(it, f), b = getVal(bi, f);
        if ((cur == null || cur === "" || (Array.isArray(cur) && !cur.length)) && b != null && b !== "") setVal(it, f, b);
      });
    });
  }
}

function sectionCard(s, i, locked, redraw) {
  const schema = schemaFor(state.page.slug, s);
  // The white part of a headline often ends mid-phrase ("…access —", "Patient capital,"): trim that for the title.
  const preview = String(s.heading || s.eyebrow || "").replace(/[\s,;:—–-]+$/, "");
  const title = schema.name + (preview && preview !== schema.name ? " — " + preview : "");
  const tools = el("div", { class: "p-card-tools" },
    el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move section up", disabled: locked || i === 0, onclick: () => { move(state.sections, i, -1); markDirty(); redraw(); } }, "↑"),
    el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move section down", disabled: locked || i === state.sections.length - 1, onclick: () => { move(state.sections, i, 1); markDirty(); redraw(); } }, "↓"),
    (state.access.canPublish || s._new) && !locked
      ? el("button", { type: "button", class: "p-icon-btn", "aria-label": "Remove section", onclick: async () => {
          if (!confirm("Remove the section “" + title + "”? It disappears from the public page when you save.")) return;
          if (s.id) { const { error } = await supabase.from("pgc_sections").delete().eq("id", s.id); if (error) { notice("Could not remove it: " + errText(error), true); return; } }
          state.sections.splice(i, 1); markDirty(); redraw(); schedulePreview();
        } }, "Remove")
      : null);

  const body = [el("p", { class: "p-where", text: schema.where })];
  (schema.fields || []).forEach((f) => body.push(schemaField(s, f, locked)));
  if (schema.items) body.push(itemsEditor(s, schema.items, locked));
  if (schema.people) body.push(el("div", { class: "p-callout" },
    el("p", null, "The people in this section — photos, names, roles, bios and links — are edited on the Team screen."),
    el("button", { type: "button", class: "btn btn-ghost", onclick: () => (location.hash = "#/team") }, "Edit people")));

  const sub = "Section " + (i + 1) + " of " + state.sections.length + (s.section_key ? "" : " · added in the editor");
  return card(title, sub, body, { tools, state: s, open: !!s._new, focusKey: s.section_key || null });
}

function schemaField(obj, f, locked, compact) {
  if (f.group) return el("div", { class: "p-group" }, el("h3", { text: f.group }), f.hint ? el("p", { class: "p-hint", text: f.hint }) : null);
  const mk = compact ? ifield : (label, type, value, onChange, lk, opts) => field(label, type, value, onChange, Object.assign({ readonly: lk }, opts));
  const val = getVal(obj, f);
  const wideText = ["textarea", "paras", "list"].includes(f.type);
  if (f.type === "band")
    return field(f.label, "select", obj.band || "default", (v) => (obj.band = v), { readonly: locked, options: [["default", "Dark teal"], ["alt", "Grey band"]], hint: "Alternating grey bands separate neighbouring sections." });
  if (f.type === "pairs") return pairsField(obj, f, locked);
  if (f.type === "list") {
    const structured = Array.isArray(val) && val.some((b) => typeof b === "object");
    return mk(f.label, "textarea", bulletsToText(val), (v) => setVal(obj, f, textToBullets(v, structured)), locked, { wide: true, hint: f.hint });
  }
  if (f.key.startsWith("extra.") && !state.hasExtra)
    return mk(f.label, f.type === "textarea" ? "textarea" : "input", normNl(val), () => {}, true,
      { wide: true, hint: "Not editable yet: the database needs the one-time “extra” column update (see the deploy notes)." });
  const type = f.type === "textarea" || f.type === "paras" ? "textarea" : "input";
  return mk(f.label, type, normNl(val), (v) => setVal(obj, f, v), locked,
    { wide: compact ? wideText : f.key !== "eyebrow", hint: f.hint, placeholder: f.type === "link" ? "/contact/ or https://…" : null });
}

/* Rows of two inputs, e.g. "EW & spectrum" + "Electromagnetic warfare, sensing". */
function pairsField(obj, f, locked) {
  const wrap = el("div", { class: "p-item-field p-item-field--wide" });
  const rows = () => (Array.isArray(obj[f.key]) ? obj[f.key] : (obj[f.key] = []));
  const draw = () => {
    wrap.innerHTML = "";
    wrap.append(el("label", { text: f.label }));
    const list = el("div", { class: "p-pairs" });
    rows().forEach((r, j) => {
      if (typeof r === "string") rows()[j] = r = { name: r, detail: "" };
      const a = el("input", { type: "text", readonly: locked, "aria-label": f.label + " " + (j + 1) + " — " + f.columns[0], placeholder: f.columns[0] }); a.value = r.name || "";
      const b = el("input", { type: "text", readonly: locked, "aria-label": f.label + " " + (j + 1) + " — " + f.columns[1], placeholder: f.columns[1] }); b.value = r.detail || "";
      a.addEventListener("input", () => { r.name = a.value; markDirty(); });
      b.addEventListener("input", () => { r.detail = b.value; markDirty(); });
      list.append(el("div", { class: "p-pair" }, a, b,
        el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move up", disabled: locked || j === 0, onclick: () => { move(rows(), j, -1); markDirty(); draw(); } }, "↑"),
        locked ? null : el("button", { type: "button", class: "p-icon-btn", "aria-label": "Remove row", onclick: () => { rows().splice(j, 1); markDirty(); draw(); } }, "×")));
    });
    wrap.append(list);
    if (!locked) wrap.append(el("button", { type: "button", class: "p-icon-btn", onclick: () => { rows().push({ name: "", detail: "" }); markDirty(); draw(); } }, "Add row"));
    if (f.hint) wrap.append(el("p", { class: "p-hint", text: f.hint }));
  };
  draw();
  return wrap;
}

function itemsEditor(s, spec, locked) {
  const wrap = el("div", { class: "p-items" });
  const blank = () => Object.fromEntries(spec.fields.filter((f) => !f.group).map((f) => [f.key, f.type === "list" || f.type === "pairs" ? [] : ""]));
  const draw = () => {
    wrap.innerHTML = "";
    const canAdd = !locked && s.items.length < (spec.max || 99);
    wrap.append(el("div", { class: "p-items-h" },
      el("h3", { text: spec.label + " (" + s.items.length + (spec.max ? " of " + spec.max : "") + ")" }),
      canAdd ? el("button", { type: "button", class: "p-icon-btn", onclick: () => {
        // Copy the shape of an existing block so the site renders it the same way.
        const like = s.items[s.items.length - 1];
        const fresh = like ? Object.fromEntries(Object.keys(like).map((k) => [k, Array.isArray(like[k]) ? [] : typeof like[k] === "object" && like[k] ? {} : ""])) : blank();
        if (like && like.href != null) fresh.href = "";
        s.items.push(fresh); markDirty(); draw();
      } }, "Add " + spec.noun.toLowerCase()) : null));
    if (spec.hint) wrap.append(el("p", { class: "p-hint", text: spec.hint }));
    s.items.forEach((it, j) => {
      const box = el("div", { class: "p-item" });
      const canRemove = !locked && s.items.length > (spec.min || 0);
      box.append(el("div", { class: "p-item-h" }, el("span", { text: spec.noun + " " + (j + 1) + (it.title || it.label ? " — " + (it.title || it.label) : "") }),
        el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move " + spec.noun + " up", disabled: locked || j === 0, onclick: () => { move(s.items, j, -1); markDirty(); draw(); } }, "↑"),
        el("button", { type: "button", class: "p-icon-btn", "aria-label": "Move " + spec.noun + " down", disabled: locked || j === s.items.length - 1, onclick: () => { move(s.items, j, 1); markDirty(); draw(); } }, "↓"),
        canRemove ? el("button", { type: "button", class: "p-icon-btn", "aria-label": "Remove " + spec.noun, onclick: () => { if (!confirm("Remove " + spec.noun.toLowerCase() + " " + (j + 1) + "?")) return; s.items.splice(j, 1); markDirty(); draw(); } }, "Remove") : null));
      spec.fields.forEach((f) => box.append(schemaField(it, f, locked, true)));
      if ("image" in it) box.append(imageField("Image", it.image || "", it.image_alt || "", (url, alt) => { it.image = url; it.image_alt = alt; }, locked));
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
  const list = el("div", { class: "p-stack" }); editor.append(list);
  const addRow = el("div", { class: "p-add" },
    el("button", { type: "button", class: "btn btn-ghost", onclick: () => { state.team.push({ id: null, name: "", role: "", bio: "", photo_url: "", photo_alt: "", linkedin_url: "", email: "", team_group: "bench", sort_order: (state.team.length + 1) * 10, published: false, review_state: "draft", _new: true }); markDirty(); renderList(); } }, "Add person"));
  editor.append(addRow);

  function renderList() {
    list.innerHTML = "";
    ["principals", "bench"].forEach((g) => {
      const rows = state.team.filter((p) => p.team_group === g);
      if (!rows.length) return;
      const cards = el("div", { class: "p-sections" });
      list.append(el("section", { class: "p-team-group", "aria-label": g === "principals" ? "Principals" : "Execution bench" },
        el("h2", { class: "p-list-h" }, g === "principals" ? "Principals" : "Execution bench", el("span", { class: "p-count", text: String(rows.length) })), cards));
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
        cards.append(card(p.name || "New person", p.role || "", [
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
  // What the site shows when a setting has no published value: read it off the contact page.
  const baseline = {};
  try {
    const html = await (await fetch("/contact/", { cache: "no-store" })).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("[data-pgc-setting]").forEach((n) => { if (!baseline[n.dataset.pgcSetting]) baseline[n.dataset.pgcSetting] = Array.from(n.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join("").replace(/\s+/g, " ").trim() || n.textContent.trim(); });
  } catch { /* fine: fields just start empty */ }
  view.append(el("div", { class: "p-head" }, el("div", null, el("h1", { text: "Site settings" }), el("p", { class: "p-meta", text: "Footer and contact details shown on every page." })), actionBar("settings")));
  const editor = el("div", { class: "p-editor" });
  view.append(el("div", { class: "p-layout" }, editor, previewPanel("/")));
  state.settings.forEach((s) => {
    const locked = s.published && !access.canPublish;
    const def = SETTING_DEFS.find((d) => d.key === s.key) || {};
    if (!s.value && baseline[s.key]) s.value = baseline[s.key];
    editor.append(card(def.label || s.label, def.hint || s.key, [field("Value", s.key === "footer_disclaimer" ? "textarea" : "input", s.value || "", (v) => (s.value = v), { wide: true, readonly: locked })], { state: s, open: true }));
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
  table.append(tb); view.append(el("div", { class: "p-table-wrap" }, table));
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
    const rows = () => (mode === "team" ? state.team : mode === "settings" ? state.settings : [state.page].concat(state.sections));
    if (mode === "team") {
      for (const [i, p] of state.team.entries()) { p.sort_order = (i + 1) * 10; const r = await upsert("pgc_team", stamp(p), ["name", "role", "bio", "photo_url", "photo_alt", "linkedin_url", "email", "team_group", "sort_order", "published", "review_state"]); if (r.ok) { Object.assign(p, r.row, { _new: false }); saved++; } else refused++; }
    } else if (mode === "settings") {
      for (const s of state.settings) { if (!s.value && s._new) continue; const r = await upsert("pgc_settings", stamp(s), ["key", "label", "value", "published", "review_state"]); if (r.ok) { Object.assign(s, r.row, { _new: false }); saved++; } else refused++; }
    } else {
      const pr = await upsert("pgc_pages", stamp(state.page), ["slug", "path", "title", "nav_label", "meta_description", "sort_order", "published", "review_state"]);
      if (pr.ok) { Object.assign(state.page, pr.row); saved++; } else refused++;
      for (const [i, s] of state.sections.entries()) {
        s.sort_order = (i + 1) * 10; s.page_id = state.page.id;
        const r = await upsert("pgc_sections", stamp(s), SECTION_COLS());
        if (r.ok) { Object.assign(s, r.row, { _new: false }); saved++; } else { refused++; if (r.error) notice(r.error, true); }
      }
    }
    state.dirty = false;
    await loadPages(); renderNav();
    const verb = change.published === true ? "Published" : change.published === false ? "Unpublished" : change.review_state === "in_review" ? "Submitted for review" : change.review_state === "changes_requested" ? "Changes requested" : "Saved";
    const done = refused
      ? [verb + " " + saved + " of " + (saved + refused) + " items. The rest were refused — you may not have permission for live content.", true]
      : [verb + " (" + saved + " items)" + (change.published === true || (change.published == null && rows().some((r) => r.published)) ? " — the public site now shows this version." : "."), false];
    notice(...done);
    // Redraw so pills and buttons reflect the new state.
    const hash = location.hash; state.route = null;
    $("#pView").innerHTML = "";
    if (mode === "team") await renderTeamEditor(); else if (mode === "settings") await renderSettingsEditor(); else await renderPageEditor(parseHash().slug);
    state.route = Object.assign(parseHash(), { hash });
    notice(...done);   // the redraw above replaces the notice; keep the save result visible
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
      const r = await upsert("pgc_sections", Object.assign(s, { page_id: pr.row.id, published: false, review_state: "draft" }), SECTION_COLS());
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
  // Title over subtitle on the left; status and tools keep their size on the right.
  const head = el("div", { class: "p-card-h" }, el("div", { class: "p-card-title" }, el("h2", null, toggle), sub ? el("span", { class: "p-sub", text: sub }) : null), opts.state ? pill(opts.state) : null);
  if (opts.tools) head.append(opts.tools);
  const box = el("div", { class: "p-card" }, head, body);
  if (opts.focusKey) {
    // Point the preview at the section being edited.
    const show = () => { if (previewFrame && previewReady) previewFrame.contentWindow.postMessage({ type: "pgc:focus", key: opts.focusKey }, location.origin); };
    toggle.addEventListener("click", () => { if (!body.hidden) show(); });
    box.addEventListener("focusin", show);
  }
  return box;
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
wireRegister();
boot();
window.addEventListener("beforeunload", (e) => { if (state.dirty || (NL.page && NL.page.isDirty())) { e.preventDefault(); e.returnValue = ""; } });
