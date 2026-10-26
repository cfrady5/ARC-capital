// Headless checks for /portal/ against the Supabase stub, per role:
//   signed out · employee without the module · suspended · contributor
//   (draft + submit, cannot publish) · publisher (publish, unpublish, undo).
// Usage: python3 -m http.server 8765 &  then
//   PLAYWRIGHT_MODULE=… CHROME_PATH=… BASE=http://127.0.0.1:8765 node tests/portal.headless.mjs
// Prints one JSON object; passes when no `"ok": false`, errors is [] and FATAL is absent.
import fs from "node:fs";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.mjs");
const BASE = process.env.BASE || "http://127.0.0.1:8765";
const OUT = process.env.OUT_DIR || path.join(process.cwd(), "tests", "out");
fs.mkdirSync(OUT, { recursive: true });
const stub = fs.readFileSync(new URL("./fixtures/supabase-stub.js", import.meta.url), "utf8");

const seed = {
  pgc_pages: [
    { id: "pg-home", slug: "home", path: "/", title: "Home title", nav_label: "Home", meta_description: "Home meta", sort_order: 10, published: true, review_state: "draft", updated_at: "2026-10-20T10:00:00Z", updated_by: "ada@theari.us" },
    { id: "pg-thesis", slug: "thesis", path: "/thesis/", title: "Thesis title", nav_label: "Investment Thesis", meta_description: "Thesis meta", sort_order: 20, published: false, review_state: "draft", updated_at: "2026-10-21T10:00:00Z" },
  ],
  pgc_sections: [
    { id: "s-hero", page_id: "pg-home", section_key: "hero", kind: "hero", heading: "Capital built for critical technology.", lead: "Live lead.", items: [{ label: "Partner", href: "/contact/" }], bullets: [], band: "default", sort_order: 10, published: true, review_state: "draft" },
    { id: "s-why", page_id: "pg-home", section_key: "why", kind: "rich", eyebrow: "Why Proving Ground Capital (PGC)", heading: "Our edge is structural access —", heading_accent: "not capital.", lead: "Live why lead.", items: [{ eyebrow: "01", title: "Live card one", text: "Card one text." }, { eyebrow: "02", title: "Live card two", text: "Card two text." }], bullets: [], band: "default", sort_order: 40, published: true, review_state: "draft" },
    { id: "s-thesis-hero", page_id: "pg-thesis", section_key: "hero", kind: "hero", eyebrow: "Investment Thesis", heading: "Three domains.", heading_accent: "One security imperative.", lead: "Draft thesis lead.", items: [], bullets: [], band: "default", sort_order: 10, published: false, review_state: "draft" },
    { id: "s-thesis-market", page_id: "pg-thesis", section_key: "market-scale", kind: "rich", eyebrow: "Market Scale", heading: "Security and growth", heading_accent: "are the same bet.", lead: "Draft market lead.", items: [{ eyebrow: "/ 01", title: "$2.3T", text: "Stat one." }], bullets: [], band: "alt", sort_order: 20, published: false, review_state: "draft" },
  ],
  pgc_team: [
    { id: "tm-1", name: "Jeron Peoples", role: "President & Chief Executive Officer", bio: "Live bio.", photo_url: "/assets/img/team-jeron-peoples.webp", linkedin_url: "https://www.linkedin.com/in/x/", email: "j@theari.us", team_group: "principals", sort_order: 10, published: true, review_state: "draft" },
    { id: "tm-2", name: "Draft Person", role: "Associate", bio: "Draft bio.", photo_url: "", team_group: "bench", sort_order: 10, published: false, review_state: "draft" },
  ],
  pgc_settings: [{ id: "st-1", key: "footer_tagline", label: "Footer tagline", value: "Live tagline", published: true, review_state: "draft" }],
  content_revisions: [
    { id: 1, table_name: "pgc_sections", record_id: "s-why", operation: "update", snapshot: { id: "s-why", page_id: "pg-home", section_key: "why", kind: "rich", eyebrow: "Why Proving Ground Capital (PGC)", heading: "OLD why heading", heading_accent: "not capital.", lead: "Old lead.", items: [{ eyebrow: "01", title: "Old card", text: "Old." }], bullets: [], band: "default", sort_order: 40, published: true, review_state: "draft" }, label: "OLD why heading", changed_by: "ada@theari.us", changed_at: "2026-10-19T09:00:00Z" },
  ],
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const results = {}; const errors = [];
process.on("uncaughtException", (e) => { results.FATAL = String(e.stack || e).slice(0, 800); results.errors = errors; console.log(JSON.stringify(results, null, 1)); process.exit(1); });
const check = (obj, key, ok, note) => { obj[key] = { ok: !!ok, ...(note !== undefined ? { note } : {}) }; };

async function session(name, cfg) {
  const ctx = await browser.newContext({ viewport: { width: cfg.width || 1300, height: 950 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(name + ": " + e));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_|net::|Failed to load resource/.test(m.text())) errors.push(name + " console: " + m.text().slice(0, 200)); });
  p.on("dialog", (d) => d.accept());
  await p.addInitScript((c) => {
    window.__SEED = c.seed; window.__ROLE = c.role || "employee"; window.__ROLE_EMAIL = c.email || "test@theari.us"; window.__ROLE_NAME = c.name || "Terry Tester";
    window.__STATUS = c.status || "active"; window.__MODULES = c.modules || {};
    if (c.anon) window.__ANON = true; if (c.notEmployee) window.__NOT_EMPLOYEE = true; if (c.pw) window.__PW_OK = c.pw;
  }, Object.assign({ seed: JSON.parse(JSON.stringify(seed)) }, cfg));
  await p.route("**/assets/js/supabase.js*", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: stub }));
  await p.route(/jsdelivr|fonts\.googleapis|fonts\.gstatic/, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await p.goto(BASE + "/portal/" + (cfg.hash || ""), { waitUntil: "networkidle" });
  return { ctx, p };
}
/* "Visible" means laid out and painted, not just lacking the hidden attribute:
   a display rule on the element could otherwise override `hidden`. */
const visible = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && !e.closest("[hidden]") && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none"; }, sel);
const text = (p, sel) => p.evaluate((s) => (document.querySelector(s) || {}).textContent || "", sel);
const buttons = (p) => p.evaluate(() => [...document.querySelectorAll(".p-actions .btn")].map((b) => b.textContent.trim()));
const internalMarkup = (p) => p.evaluate(() => { const app = document.getElementById("pApp"); return { appHidden: app.hidden, appHeight: app.offsetHeight, navItems: document.querySelectorAll("#pPageNav li").length, viewText: document.getElementById("pView").textContent.trim() }; });
/* Exactly one of the four screens occupies the page. */
const screens = (p) => p.evaluate(() => Object.fromEntries(["pBoot", "pSignin", "pDenied", "pApp"].map((id) => { const e = document.getElementById(id); return [id, e.offsetHeight > 0 ? Math.round(e.getBoundingClientRect().top) : null]; })));
const onlyScreen = (s, id) => Object.entries(s).every(([k, top]) => (k === id ? top !== null && top <= 1 : top === null));
async function openPage(p, slug) { await p.evaluate((s) => { location.hash = "#/page/" + s; }, slug); await p.waitForSelector(".p-actions", { timeout: 8000 }); await p.waitForTimeout(300); }
async function expand(p, title) {
  await p.evaluate((t) => { const b = [...document.querySelectorAll(".p-toggle")].find((x) => x.textContent.trim() === t); if (b && b.getAttribute("aria-expanded") === "false") b.click(); }, title);
}
/* Set a labelled field; `scope` limits the search to the card with that title. */
async function setField(p, labelText, value, scope) {
  return p.evaluate(({ labelText, value, scope }) => {
    let root = document;
    if (scope) { const t = [...document.querySelectorAll(".p-toggle")].find((x) => x.textContent.trim() === scope); root = t ? t.closest(".p-card") : document; }
    const lab = [...root.querySelectorAll("label")].find((l) => l.textContent.trim() === labelText && !l.closest("[hidden]"));
    if (!lab) return false;
    const inp = document.getElementById(lab.getAttribute("for"));
    if (!inp || inp.readOnly || inp.disabled) return false;
    inp.value = value; inp.dispatchEvent(new Event("input", { bubbles: true })); return true;
  }, { labelText, value, scope });
}
async function clickAction(p, label) {
  const ok = await p.evaluate((l) => { const b = [...document.querySelectorAll(".p-actions .btn")].find((x) => x.textContent.trim() === l); if (!b) return false; b.click(); return true; }, label);
  await p.waitForTimeout(600);
  return ok;
}
const noticeText = (p) => text(p, "#pNotice");

// ---------------- 1. Signed out ----------------
{
  const r = {}; results.signedOut = r;
  const { ctx, p } = await session("signedOut", { anon: true });
  check(r, "signinShown", await visible(p, "#pSignin"));
  let scr = await screens(p);
  check(r, "signinIsTheOnlyScreen", onlyScreen(scr, "pSignin"), scr);
  const m = await internalMarkup(p);
  check(r, "nothingInternal", m.appHidden && m.appHeight === 0 && m.navItems === 0 && m.viewText === "", m);
  check(r, "noindex", await p.evaluate(() => (document.querySelector('meta[name="robots"]') || {}).content || ""), "noindex, nofollow, noarchive");
  check(r, "deniedHidden", !(await visible(p, "#pDenied")));
  // Validation
  await p.click("#pSigninBtn");
  check(r, "emailRequired", /email/i.test(await text(p, "#pSigninMsg")));
  await p.fill("#pEmail", "person@theari.us"); await p.click("#pSigninBtn");
  check(r, "passwordRequired", /password/i.test(await text(p, "#pSigninMsg")));
  await p.fill("#pPassword", "wrong"); await p.click("#pSigninBtn"); await p.waitForTimeout(300);
  check(r, "badPasswordMessage", /did not match/i.test(await text(p, "#pSigninMsg")));
  check(r, "stillSignedOut", await visible(p, "#pSignin"));
  // Magic link never creates accounts here
  await p.click("#pMagicBtn"); await p.waitForTimeout(300);
  const otp = await p.evaluate(() => window.__OTP || []);
  check(r, "magicLinkSent", otp.length === 1 && otp[0].email === "person@theari.us" && otp[0].options && otp[0].options.shouldCreateUser === false && /\/portal\/$/.test(otp[0].options.emailRedirectTo), otp[0]);
  check(r, "magicLinkCopy", /check your inbox/i.test(await text(p, "#pSigninMsg")));
  // Focus is visible on the primary control (keyboard users)
  await p.focus("#pEmail");
  check(r, "focusRing", await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none"));
  await p.screenshot({ path: path.join(OUT, "portal-signin.png") });
  await ctx.close();
}

// ---------------- 2. Successful password sign-in, then employee without the module ----------------
{
  const r = {}; results.employeeNoModule = r;
  const { ctx, p } = await session("employee", { anon: true, role: "employee", pw: "correct horse" });
  await p.fill("#pEmail", "test@theari.us"); await p.fill("#pPassword", "correct horse"); await p.click("#pSigninBtn");
  await p.waitForSelector("#pDenied:not([hidden])", { timeout: 8000 });
  check(r, "deniedShown", true);
  const scr = await screens(p);
  check(r, "deniedIsTheOnlyScreen", onlyScreen(scr, "pDenied"), scr);
  check(r, "deniedCopy", /does not have the “Proving Ground Capital pages” or “Proving Ground Capital email campaigns” permission/.test(await text(p, "#pDeniedMsg")), await text(p, "#pDeniedMsg"));
  const m = await internalMarkup(p);
  check(r, "nothingInternal", m.appHidden && m.appHeight === 0 && m.navItems === 0 && m.viewText === "", m);
  check(r, "mentionsUsersAccess", /Users & Access/.test(await text(p, "#pDenied")));
  await p.click("#pDenied [data-signout]"); await p.waitForSelector("#pSignin:not([hidden])", { timeout: 8000 });
  check(r, "signOutReturnsToSignin", true);
  await ctx.close();
}
// Suspended account with a publisher grant, and a sign-in not linked to an employee
{
  const r = {}; results.suspended = r;
  const { ctx, p } = await session("suspended", { role: "employee", status: "suspended", modules: { pgc: "publisher" } });
  await p.waitForSelector("#pDenied:not([hidden])", { timeout: 8000 });
  check(r, "deniedCopy", /suspended/i.test(await text(p, "#pDeniedMsg")));
  const m = await internalMarkup(p);
  check(r, "nothingInternal", m.appHidden && m.navItems === 0 && m.viewText === "", m);
  await ctx.close();
  const s2 = await session("stranger", { notEmployee: true });
  await s2.p.waitForSelector("#pDenied:not([hidden])", { timeout: 8000 });
  check(r, "strangerDenied", /not linked to an Applied Research Institute employee/.test(await text(s2.p, "#pDeniedMsg")));
  await s2.ctx.close();
}

// ---------------- 3. Contributor ----------------
{
  const r = {}; results.contributor = r;
  const { ctx, p } = await session("contributor", { role: "employee", modules: { pgc: "contributor" }, hash: "#/page/thesis" });
  await p.waitForSelector("#pApp:not([hidden])", { timeout: 8000 });
  await p.waitForSelector(".p-actions", { timeout: 8000 });
  check(r, "levelBadge", (await text(p, "#pLevel")) === "Contributor");
  const scr = await screens(p);
  check(r, "editorIsTheOnlyScreen", onlyScreen(scr, "pApp"), scr);
  // The page starts with the editor's top bar, not a sign-in card above it.
  check(r, "editorStartsAtTop", await p.evaluate(() => Math.round(document.querySelector(".p-topbar").getBoundingClientRect().top) === 0 && document.getElementById("pSignin").offsetHeight === 0 && document.getElementById("pDenied").offsetHeight === 0));
  // Collapsed section cards take no space; an expanded one does.
  const collapsed = await p.evaluate(() => [...document.querySelectorAll(".p-sections .p-card-body")].map((b) => [b.hidden, b.offsetHeight]));
  check(r, "collapsedCardsTakeNoSpace", collapsed.length > 0 && collapsed.every(([h, px]) => h ? px === 0 : px > 0), collapsed);
  const nav = await p.evaluate(() => [...document.querySelectorAll("#pPageNav .p-nav-item")].map((b) => b.textContent.trim()));
  check(r, "pageListShowsSixPages", nav.length === 6 && nav.some((t) => /Home.*Published/.test(t)) && nav.some((t) => /Investment Thesis.*Draft/.test(t)) && nav.filter((t) => /Not set up/.test(t)).length === 4, nav);
  // Draft page: can edit, submit, but no Publish
  let b = await buttons(p);
  check(r, "draftActions", b.includes("Save draft") && b.includes("Submit for review") && !b.includes("Publish") && !b.includes("Unpublish") && !b.includes("Request changes"), b);
  // Cards are titled "<what the section is> — <its headline>" (editor-schema.js).
  await expand(p, "Market scale — Security and growth");
  check(r, "expandedCardHasHeight", await p.evaluate(() => { const t = [...document.querySelectorAll(".p-toggle")].find((x) => x.textContent.trim() === "Market scale — Security and growth"); return t.closest(".p-card").querySelector(".p-card-body").offsetHeight > 100; }));
  check(r, "schemaDrivenFields", await p.evaluate(() => { const t = [...document.querySelectorAll(".p-toggle")].find((x) => x.textContent.trim() === "Market scale — Security and growth"); const body = t.closest(".p-card").querySelector(".p-card-body"); const labels = [...body.querySelectorAll("label")].map((l) => l.textContent.trim()); return /Grey band/.test(body.textContent) && labels.includes("Headline — white part") && labels.includes("Big number") && labels.includes("What the number means") && !labels.includes("Kicker"); }));
  check(r, "editsDraftField", await setField(p, "Headline — white part", "Security and growth, edited"));
  check(r, "editsItemField", await setField(p, "Big number", "$9.9T"));
  // Add a section + reorder with keyboard-reachable buttons
  await p.selectOption(".p-add select", "cards");
  await p.click(".p-add .btn");
  const count = await p.evaluate(() => document.querySelectorAll(".p-sections .p-card").length);
  check(r, "addsSection", count === 3, count);
  await p.evaluate(() => [...document.querySelectorAll(".p-sections .p-card")].pop().querySelector('[aria-label="Move section up"]').click());
  const order = await p.evaluate(() => [...document.querySelectorAll(".p-sections .p-card .p-toggle")].map((x) => x.textContent.trim()));
  check(r, "reordersSections", order[1] === "Cards" && order[2] === "Market scale — Security and growth, edited", order);
  // Live preview received the draft
  const previewHeading = await p.evaluate(async () => {
    const f = document.querySelector(".p-preview iframe");
    for (let i = 0; i < 40; i++) { try { const h = f.contentDocument && f.contentDocument.querySelector('[data-pgc-section="market-scale"] h2'); if (h && /edited/.test(h.textContent)) return h.textContent.trim(); } catch {} await new Promise((r) => setTimeout(r, 100)); }
    return (f.contentDocument && f.contentDocument.querySelector('[data-pgc-section="market-scale"] h2') || {}).textContent || "";
  });
  check(r, "livePreviewReflectsDraft", /Security and growth, edited/.test(previewHeading) && /are the same bet\./.test(previewHeading), previewHeading);
  const previewStat = await p.evaluate(() => { const f = document.querySelector(".p-preview iframe"); return (f.contentDocument.querySelector('[data-pgc-section="market-scale"] .stat-n') || {}).textContent; });
  check(r, "livePreviewReflectsItem", previewStat === "$9.9T", previewStat);
  // The preview is debounced; give the post-reorder message time to land.
  await p.waitForFunction(() => { const f = document.querySelector(".p-preview iframe"); return f && f.contentDocument && f.contentDocument.querySelectorAll("[data-pgc-rendered]").length > 0; }, null, { timeout: 4000 }).catch(() => {});
  const previewNew = await p.evaluate(() => { const f = document.querySelector(".p-preview iframe"); return f.contentDocument.querySelectorAll("[data-pgc-rendered]").length; });
  check(r, "livePreviewRendersNewSection", previewNew === 1, previewNew);
  // Save draft
  check(r, "saveClicked", await clickAction(p, "Save draft"));
  await p.waitForSelector(".p-actions", { timeout: 8000 });
  const saved = await p.evaluate(() => window.__TABLES.pgc_sections.filter((s) => s.page_id === "pg-thesis").map((s) => ({ key: s.section_key, kind: s.kind, heading: s.heading, order: s.sort_order, pub: s.published, state: s.review_state, by: s.updated_by })));
  check(r, "savedDraftRows", saved.length === 3 && saved.every((s) => s.pub === false) && saved.find((s) => s.key === "market-scale").heading === "Security and growth, edited" && saved.find((s) => s.kind === "cards").order === 20, saved);
  check(r, "savedStampsUpdatedBy", saved.every((s) => s.by === "test@theari.us"), saved.map((s) => s.by));
  check(r, "saveNotice", /Saved/.test(await noticeText(p)), await noticeText(p));
  // Submit for review
  check(r, "submitClicked", await clickAction(p, "Submit for review"));
  await p.waitForSelector(".p-actions", { timeout: 8000 });
  const states = await p.evaluate(() => [window.__TABLES.pgc_pages.find((x) => x.id === "pg-thesis").review_state].concat(window.__TABLES.pgc_sections.filter((s) => s.page_id === "pg-thesis").map((s) => s.review_state)));
  check(r, "submittedForReview", states.every((s) => s === "in_review"), states);
  b = await buttons(p);
  check(r, "afterSubmitActions", b.includes("Withdraw from review") && !b.includes("Publish"), b);
  const pills = await p.evaluate(() => [...document.querySelectorAll(".p-head .p-pill")].map((x) => x.textContent));
  check(r, "inReviewPill", pills.includes("In review"), pills);
  // Direct attempts to publish are refused by the (stub) database
  const direct = await p.evaluate(async () => {
    const m = await import("/assets/js/supabase.js");
    const a = await m.supabase.from("pgc_sections").update({ published: true }).eq("id", "s-thesis-hero").select();
    const bq = await m.supabase.from("pgc_sections").update({ heading: "hack" }).eq("id", "s-why").select();
    const c = await m.supabase.from("pgc_sections").delete().eq("id", "s-thesis-hero").select();
    const d = await m.supabase.rpc("pgc_restore_revision", { rev_id: 1 });
    return { publish: a.error ? "refused" : a.data.length, liveEdit: bq.error ? "refused" : bq.data.length, del: c.error ? "refused" : c.data.length, restore: d.error ? d.error.message : "ok" };
  });
  check(r, "directPublishRefused", direct.publish === "refused" && direct.liveEdit === 0 && direct.del === 0 && direct.restore === "Not authorized.", direct);
  // Live page is locked for a contributor
  await openPage(p, "home");
  check(r, "livePageLockedNotice", /Contributors cannot change published content/.test(await noticeText(p)));
  await expand(p, "Why PGC — Our edge is structural access");
  check(r, "livePageFieldsReadonly", !(await setField(p, "Headline — white part", "x")));
  b = await buttons(p);
  check(r, "livePageActions", b.length === 1 && b[0] === "Save draft", b);
  const removeBtns = await p.evaluate(() => document.querySelectorAll('.p-sections [aria-label="Remove section"]').length);
  check(r, "noRemoveOnLivePage", removeBtns === 0);
  // History visible, no undo
  await p.evaluate(() => { location.hash = "#/history"; }); await p.waitForSelector(".p-table, .p-empty", { timeout: 8000 });
  const hist = await p.evaluate(() => ({ rows: document.querySelectorAll(".p-table tbody tr").length, undo: document.querySelectorAll(".p-table .p-icon-btn").length }));
  check(r, "historyVisibleNoUndo", hist.rows > 0 && hist.undo === 0, hist);
  // Team: live person locked, can add a draft
  await p.evaluate(() => { location.hash = "#/team"; }); await p.waitForSelector(".p-actions", { timeout: 8000 });
  await expand(p, "Jeron Peoples");
  check(r, "teamLiveLocked", !(await setField(p, "Role", "x", "Jeron Peoples")));
  await expand(p, "Draft Person");
  check(r, "teamDraftEditable", await setField(p, "Role", "Senior Associate", "Draft Person"));
  await p.screenshot({ path: path.join(OUT, "portal-contributor.png"), fullPage: false });
  await ctx.close();
}

// ---------------- 4. Publisher ----------------
{
  const r = {}; results.publisher = r;
  const { ctx, p } = await session("publisher", { role: "employee", modules: { pgc: "publisher" }, hash: "#/page/thesis" });
  await p.waitForSelector(".p-actions", { timeout: 8000 });
  check(r, "levelBadge", (await text(p, "#pLevel")) === "Publisher");
  let b = await buttons(p);
  check(r, "draftActions", b.includes("Publish") && b.includes("Submit for review") && !b.includes("Unpublish"), b);
  await expand(p, "Market scale — Security and growth");
  await setField(p, "Headline — white part", "Published heading");
  check(r, "publishClicked", await clickAction(p, "Publish"));
  await p.waitForSelector(".p-actions", { timeout: 8000 });
  const pub = await p.evaluate(() => ({ page: window.__TABLES.pgc_pages.find((x) => x.id === "pg-thesis"), secs: window.__TABLES.pgc_sections.filter((s) => s.page_id === "pg-thesis").map((s) => [s.published, s.review_state, s.heading]) }));
  check(r, "publishedAll", pub.page.published === true && pub.page.review_state === "draft" && pub.secs.every((s) => s[0] === true && s[1] === "draft") && pub.secs.some((s) => s[2] === "Published heading"), pub);
  b = await buttons(p);
  check(r, "liveActions", b.includes("Unpublish") && b.includes("Save") && !b.includes("Publish"), b);
  // The save result stays on screen after the redraw (and says the public site changed).
  check(r, "publishNotice", /Published \(\d+ items\) — the public site now shows this version\./.test(await noticeText(p)), await noticeText(p));
  await openPage(p, "home"); await openPage(p, "thesis");
  check(r, "liveNotice", /Saving changes updates the public site immediately/.test(await noticeText(p)), await noticeText(p));
  // Request changes on something in review: seed state via the home page's draft? Use the stub: set s-why to draft+in_review
  await p.evaluate(() => { const s = window.__TABLES.pgc_sections.find((x) => x.id === "s-why"); s.published = false; s.review_state = "in_review"; });
  await openPage(p, "home");
  b = await buttons(p);
  check(r, "requestChangesOffered", b.includes("Request changes") && b.includes("Publish"), b);
  check(r, "requestChangesClicked", await clickAction(p, "Request changes"));
  await p.waitForSelector(".p-actions", { timeout: 8000 });
  const why = await p.evaluate(() => window.__TABLES.pgc_sections.find((x) => x.id === "s-why").review_state);
  check(r, "changesRequestedStored", why === "changes_requested", why);
  // Unpublish the thesis page
  await openPage(p, "thesis");
  check(r, "unpublishClicked", await clickAction(p, "Unpublish"));
  await p.waitForSelector(".p-actions", { timeout: 8000 });
  const unpub = await p.evaluate(() => window.__TABLES.pgc_sections.filter((s) => s.page_id === "pg-thesis").map((s) => s.published).concat([window.__TABLES.pgc_pages.find((x) => x.id === "pg-thesis").published]));
  check(r, "unpublishedAll", unpub.every((x) => x === false), unpub);
  // Remove a section (publisher only)
  const before = await p.evaluate(() => window.__TABLES.pgc_sections.length);
  await p.evaluate(() => document.querySelector('.p-sections [aria-label="Remove section"]').click());
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => window.__TABLES.pgc_sections.length);
  check(r, "removesSection", after === before - 1, [before, after]);
  // Undo from the history
  await p.evaluate(() => { location.hash = "#/history"; }); await p.waitForSelector(".p-table", { timeout: 8000 });
  const undoLabel = await p.evaluate(() => { const row = [...document.querySelectorAll(".p-table tbody tr")].find((tr) => /OLD why heading/.test(tr.textContent)); const btn = row && row.querySelector(".p-icon-btn"); if (btn) btn.click(); return btn ? btn.textContent : null; });
  check(r, "undoButtonPresent", undoLabel === "Undo to this", undoLabel);
  await p.waitForTimeout(600);
  const restored = await p.evaluate(() => window.__TABLES.pgc_sections.find((x) => x.id === "s-why"));
  check(r, "undoRestoredOldVersion", restored && restored.heading === "OLD why heading" && restored.items[0].title === "Old card", restored && restored.heading);
  const restoreLogged = await p.evaluate(() => window.__TABLES.content_revisions.some((x) => x.operation === "restore" && x.record_id === "s-why"));
  check(r, "undoLogged", restoreLogged);
  check(r, "undoNotice", /Restored/.test(await noticeText(p)), await noticeText(p));
  // Team: upload a headshot goes to pgc-media and publishes
  await p.evaluate(() => { location.hash = "#/team"; }); await p.waitForSelector(".p-actions", { timeout: 8000 });
  await expand(p, "Draft Person");
  await p.setInputFiles('.p-card-body:not([hidden]) input[type="file"]', { name: "head shot.PNG", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
  await p.waitForTimeout(400);
  const up = await p.evaluate(() => (window.__LOG.find((l) => l[0] === "upload") || []));
  check(r, "uploadToPgcMedia", up[1] === "pgc-media" && /head-shot\.png$/.test(up[2]) && up[3] === "image/png", up);
  const urlVal = await p.evaluate(() => [...document.querySelectorAll('.p-card-body:not([hidden]) input[type="text"]')].map((i) => i.value).find((v) => /storage\/v1/.test(v)));
  check(r, "uploadFillsUrl", /pgc-media\/.*head-shot\.png$/.test(urlVal || ""), urlVal);
  check(r, "teamPublishClicked", await clickAction(p, "Publish"));
  await p.waitForSelector(".p-actions", { timeout: 8000 });
  const team = await p.evaluate(() => window.__TABLES.pgc_team.map((t) => [t.name, t.published, t.photo_url]));
  check(r, "teamPublished", team.every((t) => t[1] === true) && /head-shot\.png$/.test(team.find((t) => t[0] === "Draft Person")[2]), team);
  // Settings
  await p.evaluate(() => { location.hash = "#/settings"; }); await p.waitForSelector(".p-actions", { timeout: 8000 });
  check(r, "settingsEditable", await setField(p, "Value", "New tagline"));
  check(r, "settingsPublish", await clickAction(p, "Publish"));
  await p.waitForSelector(".p-actions", { timeout: 8000 });
  const st = await p.evaluate(() => window.__TABLES.pgc_settings.find((s) => s.key === "footer_tagline"));
  check(r, "settingSaved", st.value === "New tagline" && st.published === true, st);
  // Phone width: no sideways scroll, menu toggle works
  await p.setViewportSize({ width: 390, height: 800 });
  await openPage(p, "home");
  const mobile = await p.evaluate(() => ({ overflow: document.documentElement.scrollWidth <= window.innerWidth + 1, toggle: !!document.getElementById("pNavToggle").offsetParent }));
  await p.click("#pNavToggle");
  mobile.open = await p.evaluate(() => document.getElementById("pSidebar").classList.contains("is-open") && document.getElementById("pNavToggle").getAttribute("aria-expanded") === "true");
  check(r, "mobile", mobile.overflow && mobile.toggle && mobile.open, mobile);
  await p.screenshot({ path: path.join(OUT, "portal-publisher-mobile.png") });
  await ctx.close();
}

// ---------------- 5. Administrator: implicit publisher; "Start from the live page" ----------------
{
  const r = {}; results.admin = r;
  const { ctx, p } = await session("admin", { role: "admin", hash: "#/page/founders" });
  await p.waitForSelector("#pApp:not([hidden])", { timeout: 8000 });
  await p.waitForSelector("#pView .p-card", { timeout: 8000 });
  check(r, "levelBadge", (await text(p, "#pLevel")) === "Administrator");
  check(r, "notSetUpCopy", /not in the database yet/.test(await text(p, "#pView")));
  await p.click("#pView .btn-primary"); // Start from the live page
  await p.waitForSelector(".p-actions", { timeout: 15000 });
  const rows = await p.evaluate(() => window.__TABLES.pgc_sections.filter((s) => window.__TABLES.pgc_pages.find((pg) => pg.slug === "founders" && pg.id === s.page_id)).map((s) => [s.section_key, s.kind, s.published, (s.items || []).length]));
  check(r, "liveImportCreatesDrafts", rows.length === 3 && rows.every((x) => x[2] === false) && rows.find((x) => x[0] === "services")[3] === 4, rows);
  const b = await buttons(p);
  check(r, "adminCanPublish", b.includes("Publish"), b);
  await ctx.close();
}

results.errors = errors;
await browser.close();
console.log(JSON.stringify(results, null, 1));
const bad = JSON.stringify(results).includes('"ok":false') || errors.length;
process.exit(bad ? 1 : 0);
