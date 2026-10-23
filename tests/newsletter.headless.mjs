// Headless checks for the email campaign pages in /portal/ (Campaigns, Reports,
// Templates, Email lists) against the Supabase stub, with the pgc-mailchimp
// function answered in-page. Roles: website contributor without the module,
// campaigns contributor (compose, save, test, submit; no send), campaigns
// publisher (send, template, lists). Usage:
//   python3 -m http.server 8765 &
//   PLAYWRIGHT_MODULE=… CHROME_PATH=… BASE=http://127.0.0.1:8765 node tests/newsletter.headless.mjs
import fs from "node:fs";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.mjs");
const BASE = process.env.BASE || "http://127.0.0.1:8765";
const OUT = process.env.OUT_DIR || path.join(process.cwd(), "tests", "out");
fs.mkdirSync(OUT, { recursive: true });
const stub = fs.readFileSync(new URL("./fixtures/supabase-stub.js", import.meta.url), "utf8");

const seed = {
  pgc_campaigns: [
    { id: "c-draft", title: "October update", subject: "PGC in October", preview_text: "", from_name: "Proving Ground Capital (PGC)", reply_to: "innovations@theari.us", template: "digest", status: "draft", content: { heading: "Hello", intro: "Intro line", blocks: [{ type: "heading", text: "Existing heading" }], closing: "" }, created_by: "other@theari.us", updated_by: "other@theari.us", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z" },
    { id: "c-review", title: "Investor note", subject: "A note for investors", preview_text: "Preview", from_name: "Proving Ground Capital (PGC)", reply_to: "innovations@theari.us", template: "digest", status: "in_review", content: { heading: "For investors", intro: "", blocks: [{ type: "text", heading: "Update", body: "Body text." }], closing: "" }, created_by: "test@theari.us", updated_by: "test@theari.us", created_at: "2026-10-21T10:00:00Z", updated_at: "2026-10-21T10:00:00Z", test_sent_at: "2026-10-21T10:05:00Z", test_sent_to: "test@theari.us" },
    { id: "c-sent", title: "September issue", subject: "September", template: "newsletter", status: "sent", content: { blocks: [] }, mailchimp_id: "mc-sent", emails_sent: 240, sent_at: "2026-09-30T14:00:00Z", created_by: "test@theari.us", updated_at: "2026-09-30T14:00:00Z" },
  ],
  pgc_campaign_templates: [],
};
const SEGMENTS = { configured: true, audience: { name: "PGC", id: "aud1" }, stats: { members: 42, unsubscribed: 1, cleaned: 0, campaigns: 3, openRate: 0.41, clickRate: 0.08, newSinceSend: 2 }, segments: [{ id: 11, name: "Investors", count: 20, type: "static" }, { id: 12, name: "Founders", count: 15, type: "static" }] };
const MEMBERS = [{ id: "m1", email: "ana@example.com", name: "Ana Investor", status: "subscribed", tags: ["Investors"], changed: "2026-10-01T00:00:00Z" }, { id: "m2", email: "ben@example.com", name: "Ben Founder", status: "pending", tags: ["Founders"], changed: "2026-10-02T00:00:00Z" }];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const results = {}; const errors = [];
process.on("uncaughtException", (e) => { results.FATAL = String(e.stack || e).slice(0, 800); results.errors = errors; console.log(JSON.stringify(results, null, 1)); process.exit(1); });
const check = (obj, key, ok, note) => { obj[key] = { ok: !!ok, ...(note !== undefined ? { note } : {}) }; };

async function session(name, cfg) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(name + ": " + String(e).slice(0, 300)));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_|net::|Failed to load resource/.test(m.text())) errors.push(name + " console: " + m.text().slice(0, 200)); });
  await p.addInitScript((c) => { window.__SEED = c.seed; window.__ROLE = c.role || "employee"; window.__ROLE_EMAIL = c.email || "test@theari.us"; window.__ROLE_NAME = "Terry Tester"; window.__MODULES = c.modules || {}; }, Object.assign({ seed: JSON.parse(JSON.stringify(seed)) }, cfg));
  await p.route("**/assets/js/supabase.js*", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: stub }));
  await p.route(/jsdelivr|fonts\.googleapis|fonts\.gstatic/, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  // The renderer names images by their pgc.capital address; serve them from the repo.
  await p.route(/^https:\/\/pgc\.capital\/(assets\/.*)$/, (r) => { const f = path.resolve(decodeURIComponent(new URL(r.request().url()).pathname.slice(1))); fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: "" }); });
  const calls = [];
  await p.route("**/functions/v1/pgc-mailchimp", async (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    calls.push(body);
    const reply = (status, obj) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(obj) });
    const rows = await p.evaluate(() => window.__TABLES.pgc_campaigns);
    const row = rows.find((x) => x.id === body.campaign_id);
    const publisher = cfg.role === "admin" || (cfg.modules || {}).pgc_newsletter === "publisher";
    const patch = (u) => p.evaluate((x) => Object.assign(window.__TABLES.pgc_campaigns.find((y) => y.id === x.id), x), u);
    switch (body.action) {
      case "stats": return reply(200, { configured: true, audience: SEGMENTS.audience, stats: SEGMENTS.stats, campaigns: [] });
      case "segments": return reply(200, SEGMENTS);
      case "members": { const q = String(body.q || "").toLowerCase(); const m = MEMBERS.filter((x) => (!body.segment_id || x.tags.includes(SEGMENTS.segments.find((g) => g.id === body.segment_id)?.name)) && (!q || x.email.includes(q)) && (!body.status || x.status === body.status)); return reply(200, { configured: true, members: m, total: m.length, offset: 0, search: !!q }); }
      case "reports": return reply(200, body.campaign_id ? { configured: true, campaign: { id: "mc-sent", title: "September issue", subject: "September", emailsSent: 240 }, report: { emailsSent: 240, sentAt: "2026-09-30T14:00:00Z", opens: { total: 300, unique: 120, rate: 0.5 }, clicks: { total: 40, unique: 20, subscribers: 20, rate: 0.08 }, unsubscribed: 1, abuse: 0, bounces: { hard: 0, soft: 1, syntax: 0 }, forwards: 0, listStats: { openRate: 0.41, clickRate: 0.08 }, timeseries: [] }, links: [{ url: "https://pgc.capital/thesis/", total: 30, unique: 15, pct: 0.75 }] } : { configured: true, audience: SEGMENTS.audience, stats: SEGMENTS.stats, campaigns: [{ id: "mc-sent", webId: 1, title: "September issue", subject: "September", status: "sent", sentAt: "2026-09-30T14:00:00Z", emailsSent: 240, openRate: 0.5, clickRate: 0.08 }], growth: [] });
      case "refresh": return reply(200, { ok: true, rows: [] });
      case "preview": return reply(200, { ok: true, html: "<html><body>server</body></html>", text: "", warnings: [], renderer: 1 });
      case "diagnose": return reply(200, { configured: true, account: { name: "PGC", email: "innovations@theari.us", plan: "standard" }, audience: { name: "PGC", members: 42, defaultFrom: "innovations@theari.us" }, from: { email: "innovations@theari.us", domain: "theari.us", verified: true, authenticated: true, known: true }, domains: [], campaign: null, checklist: { ready: true, items: [] } });
      case "test_send": { if (!row) return reply(404, { error: "Campaign not found." }); const to = (body.emails && body.emails.length ? body.emails : [cfg.email || "test@theari.us"]).join(", "); const u = { id: row.id, test_sent_at: new Date(Date.now() + 1000).toISOString(), test_sent_to: to }; await patch(u); return reply(200, { ok: true, sentTo: to, emails: to.split(", "), warnings: [], row: Object.assign({}, row, u) }); }
      case "send": { if (!row) return reply(404, { error: "Campaign not found." }); if (!publisher) return reply(403, { error: "Only an email campaigns publisher can do that." }); const u = body.schedule_time ? { id: row.id, status: "scheduled", scheduled_for: body.schedule_time } : { id: row.id, status: "sent", sent_at: new Date().toISOString(), emails_sent: 42 }; await patch(u); return reply(200, { ok: true, sent: !body.schedule_time, scheduled: !!body.schedule_time, warnings: [], row: Object.assign({}, row, u) }); }
      case "add_member": { if (!publisher) return reply(403, { error: "Only an email campaigns publisher can do that." }); return reply(200, { ok: true, member: { email: body.email }, state: "pending" }); }
      case "create_group": { if (!publisher) return reply(403, { error: "Only an email campaigns publisher can do that." }); const g = { id: 13, name: body.name, count: 0, type: "static" }; SEGMENTS.segments.push(g); return reply(200, { ok: true, group: g }); }
      default: return reply(400, { error: "Unknown action " + body.action });
    }
  });
  await p.goto(BASE + "/portal/" + (cfg.hash || ""), { waitUntil: "networkidle" });
  return { ctx, p, calls };
}
const text = (p, sel) => p.evaluate((s) => (document.querySelector(s) || {}).textContent || "", sel);
const vis = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.offsetHeight > 0; }, sel);
const frameText = (p) => p.evaluate(() => { const f = document.getElementById("nlpFrame"); return f && f.contentDocument ? f.contentDocument.body.textContent.replace(/\s+/g, " ") : ""; });
const frameHtml = (p) => p.evaluate(() => { const f = document.getElementById("nlpFrame"); return f && f.contentDocument ? f.contentDocument.documentElement.outerHTML : ""; });
async function clickText(p, scope, label) {
  const ok = await p.evaluate(({ scope, label }) => { const root = scope ? document.querySelector(scope) : document; if (!root) return false; const b = [...root.querySelectorAll("button")].find((x) => x.textContent.trim() === label && x.offsetHeight > 0 && !x.disabled); if (!b) return false; b.click(); return true; }, { scope, label });
  await p.waitForTimeout(500);
  return ok;
}
const setVal = (p, sel, v) => p.evaluate(({ sel, v }) => { const n = document.querySelector(sel); if (!n || n.disabled) return false; n.value = v; n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true })); return true; }, { sel, v });
const waitEditor = (p) => p.waitForSelector("#nle", { timeout: 10000 }).then(() => p.waitForTimeout(700));

// ---------------- 1. Website contributor without the campaigns module ----------------
{
  const r = {}; results.noModule = r;
  const { ctx, p } = await session("noModule", { modules: { pgc: "contributor" }, hash: "#/page/home" });
  await p.waitForSelector("#pApp:not([hidden])", { timeout: 8000 }); await p.waitForTimeout(500);
  check(r, "emailNavHidden", !(await vis(p, "#pEmailNav")) && !(await vis(p, "#pEmailH")));
  await p.evaluate(() => { location.hash = "#/campaigns"; }); await p.waitForTimeout(800);
  check(r, "campaignsRouteRefused", (await p.evaluate(() => location.hash)) !== "#/campaigns" && /don’t have access to email campaigns/.test(await text(p, "#pNotice")), await text(p, "#pNotice"));
  check(r, "marketingHidden", !(await vis(p, "#pMarketing")));
  const direct = await p.evaluate(async () => { const m = await import("/assets/js/supabase.js"); const a = await m.supabase.from("pgc_campaigns").select("*"); const b = await m.supabase.from("pgc_campaigns").insert({ title: "x" }).select().single(); return { rows: (a.data || []).length, insert: b.error ? "refused" : "ok" }; });
  check(r, "directAccessRefused", direct.rows === 0 && direct.insert === "refused", direct);
  await ctx.close();
}

// ---------------- 2. Campaigns contributor (no website module) ----------------
{
  const r = {}; results.contributor = r;
  const { ctx, p, calls } = await session("contributor", { modules: { pgc_newsletter: "contributor" } });
  await p.waitForSelector("#pApp:not([hidden])", { timeout: 8000 });
  await p.waitForSelector("#panel-campaigns .nlp-row", { timeout: 10000 }); await p.waitForTimeout(400);
  check(r, "landsOnCampaigns", (await p.evaluate(() => location.hash)) === "#/campaigns" || (await vis(p, "#panel-campaigns")));
  check(r, "pagesNavHidden", !(await vis(p, "#pPageNav")) && !(await vis(p, "#pOtherNav")));
  check(r, "emailNavShown", await vis(p, "#pEmailNav"));
  check(r, "levelBadge", (await text(p, "#pLevel")) === "Contributor");
  const list = await p.evaluate(() => ({ rows: [...document.querySelectorAll("#panel-campaigns .nlp-row-title")].map((x) => x.textContent), pills: [...document.querySelectorAll("#panel-campaigns .nlp-row-side .pstatus:last-child")].map((x) => x.textContent), checks: [...document.querySelectorAll("#panel-campaigns .nlp-rowcheck")].map((x) => x.disabled) }));
  check(r, "listShowsThreeCampaigns", list.rows.length === 3 && list.pills.includes("Sent") && list.pills.includes("In review"), list);
  check(r, "canOnlySelectOwnDrafts", list.checks.every((d) => d === true), list.checks);
  // Staff email addresses (…@theari.us) are data; ARI wording in the interface is not.
  check(r, "noAriWording", !/\bARI\b|(?<!@)theari\.us/.test(await text(p, "#panel-campaigns")));
  // New campaign → composer
  await p.click("#nlpNew"); await waitEditor(p);
  check(r, "composerOpens", await vis(p, "#nle"));
  const tiles = await p.evaluate(() => [...document.querySelectorAll(".nle-tile")].map((t) => t.textContent.trim()));
  check(r, "pgcBlockTiles", tiles.join(",") === "Heading,Text,Image / logo,Button,Divider,Spacer", tiles);
  check(r, "nameSubject", (await setVal(p, "#nleName", "November update")) && (await setVal(p, "#nl_subject", "PGC in November")));
  await p.evaluate(() => [...document.querySelectorAll(".nle-tile")].find((t) => /Heading/.test(t.textContent)).click()); await p.waitForTimeout(400);
  check(r, "headingInspector", await vis(p, "#nleBlockText"));
  await setVal(p, "#nleBlockText", "Market scale"); await p.waitForTimeout(600);
  await p.evaluate(() => [...document.querySelectorAll(".nle-tile")].find((t) => /^Text/.test(t.textContent)).click()); await p.waitForTimeout(400);
  await setVal(p, "#nleBlockBody", "Three domains, **one** lens."); await p.waitForTimeout(700);
  const ft = await frameText(p);
  check(r, "canvasShowsBlocks", /Market scale/.test(ft) && /Three domains, one lens\./.test(ft), ft.slice(0, 200));
  const fh = await frameHtml(p);
  check(r, "canvasPgcBranding", /pgc-logo-dark\.png/.test(fh) && /Proving Ground Capital \(PGC\)/.test(fh) && /#3cdbc0/.test(fh) && !/theari\.us|ari-logo/.test(fh));
  check(r, "canvasBoldApplied", /<strong style="font-weight:bold;">one<\/strong>/.test(fh));
  const saveState = await text(p, ".nle-savestate");
  check(r, "unsavedIndicator", /Unsaved/.test(saveState), saveState);
  check(r, "sendTestNeedsSave", await p.evaluate(() => document.getElementById("nleSendTest").disabled && document.getElementById("nlpSave").textContent.trim() === "Create campaign"));
  await p.click("#nlpSave");
  await p.waitForTimeout(900);
  const saved = await p.evaluate(() => window.__TABLES.pgc_campaigns.find((x) => x.title === "November update"));
  check(r, "draftSaved", saved && saved.status === "draft" && saved.created_by === "test@theari.us" && saved.subject === "PGC in November" && saved.content.blocks.length === 2 && saved.content.blocks[0].type === "heading" && saved.content.blocks[0].text === "Market scale", saved && { status: saved.status, by: saved.created_by, blocks: saved.content.blocks.length });
  check(r, "savedIndicator", /Saved|created/.test(await text(p, ".nle-savestate")) && (await p.evaluate(() => document.getElementById("nlpSave").textContent.trim())) === "Save", await text(p, ".nle-savestate"));
  // Send test
  await p.click("#nleSendTest");
  await p.waitForSelector("#nl_test_to", { timeout: 5000 });
  check(r, "sendTestOpens", true);
  await setVal(p, "#nl_test_to", "me@theari.us, colleague@theari.us");
  check(r, "sendTestClicked", await clickText(p, ".nle-modal", "Send test"));
  await p.waitForTimeout(800);
  const tcall = calls.find((c) => c.action === "test_send");
  check(r, "testSendCalled", tcall && tcall.campaign_id === saved.id && tcall.emails.length === 2, tcall);
  await clickText(p, ".nle-modal", "Close");
  // Review: a contributor submits for review and cannot send
  check(r, "reviewIsSubmit", (await p.evaluate(() => document.getElementById("nleReviewSend").textContent.trim())) === "Review & submit");
  await p.click("#nleReviewSend");
  await p.waitForSelector(".nle-modal", { timeout: 5000 }); await p.waitForTimeout(500);
  const rv = await p.evaluate(() => ({ buttons: [...document.querySelectorAll(".nle-modal button")].map((b) => b.textContent.trim()), text: document.querySelector(".nle-modal").textContent }));
  check(r, "contributorCannotSend", !rv.buttons.includes("Send now") && !rv.buttons.includes("Schedule") && rv.buttons.includes("Submit for review"), rv.buttons);
  check(r, "submitForReview", await clickText(p, ".nle-modal", "Submit for review"));
  await p.waitForTimeout(800);
  const after = await p.evaluate((id) => window.__TABLES.pgc_campaigns.find((x) => x.id === id), saved.id);
  check(r, "statusInReview", after.status === "in_review", after.status);
  // The database refuses the shortcuts
  const direct = await p.evaluate(async (id) => { const m = await import("/assets/js/supabase.js"); const a = await m.supabase.from("pgc_campaigns").update({ status: "sent" }).eq("id", id).select(); const b = await m.supabase.from("pgc_campaigns").update({ status: "changes_requested" }).eq("id", id).select(); const c = await m.supabase.from("pgc_campaigns").delete().eq("id", "c-draft").select(); return { sent: a.error ? "refused" : "ok", changes: b.error ? "refused" : "ok", delOther: c.error ? "refused" : (c.data || []).length }; }, saved.id);
  check(r, "directShortcutsRefused", direct.sent === "refused" && direct.changes === "refused" && direct.delOther === 0, direct);
  // Sent campaigns open locked
  await clickText(p, ".nle-modal", "Close");
  await p.click("#nleHead .nle-back"); await p.waitForTimeout(800);
  await p.evaluate(() => [...document.querySelectorAll("#panel-campaigns .nlp-row")].find((x) => /September issue/.test(x.textContent)).click()); await waitEditor(p);
  check(r, "sentCampaignLocked", await p.evaluate(() => document.getElementById("nle").classList.contains("is-locked") && !!document.querySelector("#nleHead .pstatus--published")));
  await p.screenshot({ path: path.join(OUT, "nl-contributor-sent.png") });
  await ctx.close();
}

// ---------------- 3. Publisher: send, template, reports, lists ----------------
{
  const r = {}; results.publisher = r;
  const { ctx, p, calls } = await session("publisher", { modules: { pgc_newsletter: "publisher", pgc: "publisher" }, hash: "#/campaigns" });
  await p.waitForSelector("#panel-campaigns .nlp-row", { timeout: 10000 }); await p.waitForTimeout(400);
  check(r, "bothNavSections", (await vis(p, "#pPageNav")) && (await vis(p, "#pEmailNav")));
  await p.evaluate(() => [...document.querySelectorAll("#panel-campaigns .nlp-row")].find((x) => /Investor note/.test(x.textContent)).click()); await waitEditor(p);
  check(r, "reviewIsSend", (await p.evaluate(() => document.getElementById("nleReviewSend").textContent.trim())) === "Review & send");
  await p.click("#nleReviewSend");
  await p.waitForSelector(".nle-modal", { timeout: 5000 }); await p.waitForTimeout(600);
  const rv = await p.evaluate(() => [...document.querySelectorAll(".nle-modal button")].map((b) => [b.textContent.trim(), b.disabled]));
  check(r, "publisherSeesSend", rv.some(([t, d]) => t === "Send now" && !d) && rv.some(([t]) => t === "Schedule") && rv.some(([t]) => t === "Request changes"), rv);
  check(r, "sendNowClicked", await clickText(p, ".nle-modal", "Send now"));
  await p.waitForSelector(".p-modal", { timeout: 5000 });
  check(r, "confirmDialogNamesAudience", /Send to the audience/.test(await text(p, ".p-modal-kicker")) && /42/.test(await text(p, ".p-modal")), await text(p, ".p-modal"));
  await p.click(".p-modal .btn-primary, .p-modal .btn-danger"); await p.waitForTimeout(1200);
  const sendCall = calls.find((c) => c.action === "send");
  check(r, "sendCalled", sendCall && sendCall.campaign_id === "c-review" && !sendCall.schedule_time, sendCall);
  const row = await p.evaluate(() => window.__TABLES.pgc_campaigns.find((x) => x.id === "c-review"));
  check(r, "rowSent", row.status === "sent" && row.emails_sent === 42, row.status);
  check(r, "editorLockedAfterSend", await p.evaluate(() => document.getElementById("nle") && document.getElementById("nle").classList.contains("is-locked") && !!document.querySelector("#nleHead .pstatus--published")));
  // Save as template from a draft
  await p.click("#nleHead .nle-back"); await p.waitForTimeout(800);
  await p.evaluate(() => [...document.querySelectorAll("#panel-campaigns .nlp-row")].find((x) => /October update/.test(x.textContent)).click()); await waitEditor(p);
  await p.click("#nleMore"); await p.waitForTimeout(300);
  check(r, "saveAsTemplate", await clickText(p, "#nleMenu", "Save as template"));
  await p.waitForTimeout(800);
  const tpl = await p.evaluate(() => window.__TABLES.pgc_campaign_templates[0]);
  check(r, "templateRow", tpl && /October update/.test(tpl.name) && tpl.created_by === "test@theari.us" && tpl.content.blocks.length === 1, tpl && tpl.name);
  await p.evaluate(() => { location.hash = "#/nltemplates"; }); await p.waitForTimeout(1200);
  const tp = await p.evaluate(() => ({ layouts: [...document.querySelectorAll("#panel-nltemplates .nlp-tpl-name")].map((x) => x.textContent), text: document.getElementById("panel-nltemplates").textContent }));
  check(r, "templatesPage", tp.layouts.includes("Digest") && tp.layouts.includes("Newsletter") && tp.layouts.some((x) => /October update/.test(x)) && !/post|event calendar/i.test(tp.text), tp.layouts);
  // Reports
  await p.evaluate(() => { location.hash = "#/nlreports"; }); await p.waitForTimeout(1200);
  const rp = await text(p, "#panel-nlreports");
  check(r, "reportsPage", /42/.test(rp) && /September issue/.test(rp) && /Subscribers/.test(rp), rp.replace(/\s+/g, " ").slice(0, 160));
  // Email lists: groups, browse a group, add a contact
  await p.evaluate(() => { location.hash = "#/nllists"; }); await p.waitForTimeout(1500);
  const groups = await p.evaluate(() => [...document.querySelectorAll("#nlpGroups .nlp-group-name")].map((x) => x.textContent));
  check(r, "groupsBand", groups.includes("Investors") && groups.includes("Founders"), groups);
  await p.click("#nlpGroup-11"); await p.waitForTimeout(1000);
  const members = await p.evaluate(() => [...document.querySelectorAll("#nlpContacts tbody tr")].map((tr) => tr.textContent));
  check(r, "groupMembers", members.length === 1 && /ana@example\.com/.test(members[0]), members);
  await p.click("#nlpAddContact"); await p.waitForTimeout(400);
  const okEmail = await setVal(p, "#nl_add_email", "new@example.com");
  check(r, "addContactForm", okEmail);
  check(r, "addContactSubmit", await p.evaluate(() => { const b = document.getElementById("nlpAddContactSubmit"); if (!b || b.disabled) return false; b.click(); return true; }));
  await p.waitForTimeout(900);
  const added = calls.find((c) => c.action === "add_member");
  check(r, "addMemberCalled", added && added.email === "new@example.com", added);
  check(r, "noAriWordingOnLists", !/\bARI\b|(?<!@)theari\.us/.test(await text(p, "#panel-nllists")));
  await p.screenshot({ path: path.join(OUT, "nl-lists.png") });
  // Leaving an unsaved campaign asks first
  await p.evaluate(() => { location.hash = "#/campaigns"; }); await p.waitForTimeout(800);
  await p.click("#nlpNew"); await waitEditor(p);
  await setVal(p, "#nleName", "Unsaved thing");
  await p.evaluate(() => { location.hash = "#/nlreports"; }); await p.waitForTimeout(600);
  const guard = await p.evaluate(() => ({ modal: !!document.querySelector(".p-modal"), buttons: [...document.querySelectorAll(".p-modal button")].map((b) => b.textContent.trim()) }));
  check(r, "unsavedGuard", guard.modal && guard.buttons.includes("Save and leave") && guard.buttons.includes("Stay"), guard);
  await p.evaluate(() => [...document.querySelectorAll(".p-modal button")].find((b) => b.textContent.trim() === "Leave without saving").click()); await p.waitForTimeout(800);
  check(r, "leftAfterDiscard", (await p.evaluate(() => location.hash)) === "#/nlreports" && !(await p.evaluate(() => window.__TABLES.pgc_campaigns.some((c) => c.title === "Unsaved thing"))));
  await ctx.close();
}

results.errors = errors;
await browser.close();
console.log(JSON.stringify(results, null, 1));
const bad = JSON.stringify(results).includes('"ok":false') || errors.length;
process.exit(bad ? 1 : 0);
