// The public site against the Supabase stub: published rows replace the
// repository markup; drafts never reach the page; a failed fetch leaves the
// page exactly as shipped. Also checks that reading a page back out of the
// DOM and writing it in again is lossless (what the seed migration relies on).
// Usage: python3 -m http.server 8765 &  then
//   PLAYWRIGHT_MODULE=… CHROME_PATH=… BASE=http://127.0.0.1:8765 node tests/public-content.headless.mjs
import fs from "node:fs";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.mjs");
const BASE = process.env.BASE || "http://127.0.0.1:8765";
const OUT = process.env.OUT_DIR || path.join(process.cwd(), "tests", "out");
fs.mkdirSync(OUT, { recursive: true });
const stub = fs.readFileSync(new URL("./fixtures/supabase-stub.js", import.meta.url), "utf8");

const seed = {
  pgc_pages: [
    { id: "pg-home", slug: "home", path: "/", title: "Home", meta_description: "Published meta description.", sort_order: 10, published: true, review_state: "draft" },
    { id: "pg-team", slug: "team", path: "/team/", title: "Team", sort_order: 50, published: true, review_state: "draft" },
    { id: "pg-thesis", slug: "thesis", path: "/thesis/", title: "Thesis", sort_order: 20, published: false, review_state: "in_review" },
  ],
  pgc_sections: [
    // Home: hero + why (reordered: why first), values removed (no row), a new published CTA, and a draft that must not show.
    { id: "s-why", page_id: "pg-home", section_key: "why", kind: "rich", eyebrow: "Why PGC, from the database", heading: "Published headline", heading_accent: "mint clause.", lead: "First lead paragraph.\n\nSecond lead paragraph.", items: [{ eyebrow: "01", title: "Card A", text: "Text A." }, { eyebrow: "02", title: "Card B", text: "Text B." }, { eyebrow: "03", title: "Card C", text: "Text C." }, { eyebrow: "04", title: "Card D", text: "Text D." }, { eyebrow: "05", title: "Card E (cloned)", text: "Text E." }], bullets: [], band: "alt", sort_order: 10, published: true, review_state: "draft" },
    { id: "s-hero", page_id: "pg-home", section_key: "hero", kind: "hero", heading: "Hero from the database.", kicker: "Rigor / Reach / Resolve", lead: "Hero lead from the database.", items: [{ label: "Only button", href: "/contact/?intent=db" }], bullets: [], band: "default", sort_order: 20, published: true, review_state: "draft" },
    { id: "s-new", page_id: "pg-home", kind: "cta", eyebrow: "New Section", heading: "Added in the portal", heading_accent: "and published.", lead: "A section with no markup in the repository.", items: [{ label: "Go", href: "/thesis/" }], bullets: [], band: "default", sort_order: 30, published: true, review_state: "draft" },
    { id: "s-draft", page_id: "pg-home", kind: "rich", eyebrow: "DRAFT ONLY", heading: "This draft must never render", items: [], bullets: [], band: "default", sort_order: 40, published: false, review_state: "in_review" },
    { id: "s-closing", page_id: "pg-home", section_key: "closing", kind: "statement", heading: "“A new quote.", heading_accent: "In mint.”", note: "Someone · Title", items: [{ label: "Partner", href: "/contact/" }], bullets: [], band: "default", sort_order: 50, published: true, review_state: "draft" },
    { id: "s-thesis-hero", page_id: "pg-thesis", section_key: "hero", kind: "hero", heading: "Draft thesis hero", items: [], bullets: [], band: "default", sort_order: 10, published: false, review_state: "in_review" },
    // Team page sections
    { id: "s-team-hero", page_id: "pg-team", section_key: "hero", kind: "hero", eyebrow: "Team", heading: "Built for", heading_accent: "execution.", lead: "Team lead.", items: [], bullets: [], band: "default", sort_order: 10, published: true, review_state: "draft" },
    { id: "s-team-principals", page_id: "pg-team", section_key: "principals", kind: "rich", items: [], bullets: [], band: "default", sort_order: 20, published: true, review_state: "draft" },
    { id: "s-team-bench", page_id: "pg-team", section_key: "bench", kind: "rich", eyebrow: "Execution Bench", heading: "The team behind", heading_accent: "the pipeline.", items: [], bullets: [], band: "alt", sort_order: 30, published: true, review_state: "draft" },
  ],
  pgc_team: [
    { id: "tm-1", name: "Published Principal", role: "Role One", bio: "Bio para one.\n\nBio para two.", photo_url: "https://stub.local/storage/v1/object/public/pgc-media/p1.png", photo_alt: "Published Principal", linkedin_url: "https://www.linkedin.com/in/pp/", email: "pp@theari.us", team_group: "principals", sort_order: 10, published: true, review_state: "draft" },
    { id: "tm-2", name: "Second Principal", role: "Role Two", bio: "Bio.", photo_url: "", linkedin_url: "", email: "", team_group: "principals", sort_order: 20, published: true, review_state: "draft" },
    { id: "tm-3", name: "Draft Hire", role: "Must not show", bio: "Draft.", team_group: "bench", sort_order: 10, published: false, review_state: "draft" },
    { id: "tm-4", name: "Bench One", role: "Associate", bio: "Bench bio.", team_group: "bench", sort_order: 20, published: true, review_state: "draft" },
  ],
  pgc_settings: [
    { id: "st-1", key: "footer_tagline", label: "Footer tagline", value: "Tagline from the database.", published: true, review_state: "draft" },
    { id: "st-2", key: "contact_email", label: "Contact email", value: "hello@provinggroundcapital.example", published: true, review_state: "draft" },
    { id: "st-3", key: "footer_disclaimer", label: "Footer disclosure", value: "DRAFT DISCLAIMER", published: false, review_state: "draft" },
    { id: "st-4", key: "hq_location", label: "HQ line", value: "HQ / Test City, IN", published: true, review_state: "draft" },
  ],
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const results = {}; const errors = [];
process.on("uncaughtException", (e) => { results.FATAL = String(e.stack || e).slice(0, 800); results.errors = errors; console.log(JSON.stringify(results, null, 1)); process.exit(1); });
const check = (obj, key, ok, note) => { obj[key] = { ok: !!ok, ...(note !== undefined ? { note } : {}) }; };

async function open(name, url, cfg) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(name + ": " + e));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_|net::|Failed to load resource/.test(m.text())) errors.push(name + " console: " + m.text().slice(0, 200)); });
  await p.addInitScript((c) => { window.__SEED = c.seed; window.__ANON = true; if (c.fail) window.__FAIL_TABLES = c.fail; if (c.noHydrate) window.__PGC_NO_HYDRATE = true; }, Object.assign({ seed: JSON.parse(JSON.stringify(seed)) }, cfg || {}));
  await p.route("**/assets/js/supabase.js*", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: stub }));
  await p.route(/jsdelivr|fonts\.googleapis|fonts\.gstatic|stub\.local/, (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await p.goto(BASE + url, { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  return { ctx, p };
}
const sectionKeys = (p) => p.evaluate(() => [...document.querySelectorAll("main [data-pgc-section]")].map((s) => s.dataset.pgcSection));
const bodyText = (p) => p.evaluate(() => document.body.textContent);

// ---------------- 1. Home: published rows replace the markup ----------------
{
  const r = {}; results.homePublished = r;
  const { ctx, p } = await open("home", "/");
  const keys = await sectionKeys(p);
  check(r, "orderFollowsPublishedRows", keys[0] === "why" && keys[1] === "hero" && keys[3] === "closing" && keys.length === 4, keys);
  check(r, "sectionsWithoutRowsRemoved", !keys.includes("values") && !keys.includes("about") && !keys.includes("bridge"), keys);
  const why = await p.evaluate(() => {
    const s = document.querySelector('[data-pgc-section="why"]');
    return {
      alt: s.classList.contains("section--alt"),
      eyebrow: s.querySelector(".section-head .eyebrow").textContent,
      h2: s.querySelector("h2").textContent, accent: s.querySelector("h2 .accent").textContent,
      leads: [...s.querySelectorAll(".section-head .lead")].map((x) => x.textContent),
      cards: [...s.querySelectorAll(".card")].map((c) => [c.querySelector(".eyebrow").textContent.replace(/\s+/g, " ").trim(), c.querySelector("h3").textContent, c.querySelector("p:not(.eyebrow)").textContent, c.classList.contains("is-visible") || c.classList.contains("card")]),
      motif: s.querySelector(".section-head .eyebrow").innerHTML.includes("aria-hidden"),
    };
  });
  check(r, "bandPatched", why.alt);
  check(r, "eyebrowPatchedKeepsMotif", /Why PGC, from the database/.test(why.eyebrow) && why.motif, why.eyebrow);
  check(r, "headingSplitKept", /^Published headline/.test(why.h2) && why.accent === "mint clause.", why.h2);
  check(r, "leadParagraphsGrow", why.leads.length === 2 && why.leads[1] === "Second lead paragraph.", why.leads);
  check(r, "cardsClonedForExtraItems", why.cards.length === 5 && why.cards[4][1] === "Card E (cloned)" && /05/.test(why.cards[4][0]) && why.cards[4][2] === "Text E.", why.cards);
  const hero = await p.evaluate(() => { const s = document.querySelector('[data-pgc-section="hero"]'); return { h1: s.querySelector("h1").textContent, sub: s.querySelector(".sub").textContent, btns: [...s.querySelectorAll(".btn-row a")].map((a) => [a.textContent.replace(/\s+/g, " ").trim(), a.getAttribute("href"), !!a.querySelector(".arrow")]) }; });
  check(r, "heroPatched", hero.h1 === "Hero from the database." && hero.sub === "Hero lead from the database.", hero);
  check(r, "buttonsShrinkAndKeepArrow", hero.btns.length === 1 && hero.btns[0][0] === "Only button (↗)" && hero.btns[0][1] === "/contact/?intent=db" && hero.btns[0][2], hero.btns);
  const added = await p.evaluate(() => { const s = document.querySelector("[data-pgc-rendered]"); return s && { eyebrow: s.querySelector(".eyebrow").textContent, h2: s.querySelector("h2").textContent, accent: s.querySelector(".accent").textContent, btn: s.querySelector("a.btn").getAttribute("href") }; });
  check(r, "newSectionRendered", added && /New Section/.test(added.eyebrow) && /Added in the portal/.test(added.h2) && added.accent === "and published." && added.btn === "/thesis/", added);
  // A section that arrived after the first reveal pass still fades in when scrolled to.
  await p.evaluate(() => document.querySelector("[data-pgc-rendered]").scrollIntoView());
  await p.waitForFunction(() => [...document.querySelectorAll("[data-pgc-rendered] [data-reveal]")].every((x) => x.classList.contains("is-visible")), null, { timeout: 4000 }).catch(() => {});
  check(r, "newSectionRevealedOnScroll", await p.evaluate(() => [...document.querySelectorAll("[data-pgc-rendered] [data-reveal]")].every((x) => x.classList.contains("is-visible"))));
  const closing = await p.evaluate(() => { const s = document.querySelector('[data-pgc-section="closing"]'); return { st: s.querySelector(".statement").textContent, accent: s.querySelector(".statement .accent").textContent, note: s.querySelector(".attribution").textContent.replace(/\s+/g, " "), name: (s.querySelector(".attribution .name") || {}).textContent }; });
  check(r, "statementKeepsAccent", /^“A new quote\./.test(closing.st) && closing.accent === "In mint.”" && closing.note === "Someone · Title" && closing.name === "Someone", closing);
  const strip = await p.evaluate(() => document.querySelector('[data-pgc-section="hero"] .values-strip').textContent);
  check(r, "valuesStripKeepsSpacing", strip === "Rigor  /  Reach  /  Resolve", strip);
  const hq = await p.evaluate(() => { const n = document.querySelector("footer [data-pgc-setting=hq_location]"); return { text: n.textContent.replace(/\s+/g, " ").trim(), decor: n.querySelectorAll("[aria-hidden]").length }; });
  check(r, "hqSettingKeepsDecoration", hq.text === "< HQ / Test City, IN >" && hq.decor === 2, hq);
  const body = await bodyText(p);
  check(r, "draftNeverRenders", !/DRAFT ONLY|This draft must never render|DRAFT DISCLAIMER/.test(body));
  const foot = await p.evaluate(() => ({ tag: document.querySelector("[data-pgc-setting=footer_tagline]").textContent, mail: document.querySelector("[data-pgc-setting=contact_email]").getAttribute("href"), mailText: document.querySelector("[data-pgc-setting=contact_email]").textContent, disc: document.querySelector("[data-pgc-setting=footer_disclaimer]").textContent }));
  check(r, "settingsApplied", foot.tag === "Tagline from the database." && foot.mail === "mailto:hello@provinggroundcapital.example" && foot.mailText === "hello@provinggroundcapital.example", foot);
  check(r, "unpublishedSettingKeepsRepoText", /commercial arm of Applied Research Institute/.test(foot.disc), foot.disc);
  check(r, "metaDescriptionUpdated", (await p.evaluate(() => document.querySelector('meta[name="description"]').content)) === "Published meta description.");
  const noOverflow = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(r, "noHorizontalOverflow", noOverflow);
  await p.screenshot({ path: path.join(OUT, "public-home-hydrated.png"), fullPage: false });
  await ctx.close();
}

// ---------------- 2. Thesis: page not published → repository markup untouched ----------------
{
  const r = {}; results.thesisUnpublished = r;
  const { ctx, p } = await open("thesis", "/thesis/");
  const keys = await sectionKeys(p);
  check(r, "allRepoSectionsPresent", keys.join(",") === "hero,market-scale,focus,intersection,sourcing,get-in-touch", keys);
  check(r, "repoHeadingShown", (await p.evaluate(() => document.querySelector("h1").textContent)) === "Three domains. One security imperative.");
  check(r, "draftHeroNotShown", !/Draft thesis hero/.test(await bodyText(p)));
  await ctx.close();
}

// ---------------- 3. Team: published people only, grouped and ordered ----------------
{
  const r = {}; results.team = r;
  const { ctx, p } = await open("team", "/team/");
  const t = await p.evaluate(() => ({
    principals: [...document.querySelectorAll('[data-pgc-team="principals"] .team-card')].map((c) => ({ name: c.querySelector(".name").textContent.replace(/\s+/g, " ").trim(), role: c.querySelector(".role").textContent, bios: [...c.querySelectorAll(".bio")].map((b) => b.textContent), img: c.querySelector("img").getAttribute("src"), alt: c.querySelector("img").getAttribute("alt"), li: c.querySelector(".link-solid").hidden, mail: c.querySelector(".link-outline").hidden, mailHref: c.querySelector(".link-outline").getAttribute("href") })),
    bench: [...document.querySelectorAll('[data-pgc-team="bench"] .team-card')].map((c) => c.querySelector(".name").textContent.replace(/\s+/g, " ").trim()),
    benchHeading: document.querySelector('[data-pgc-section="bench"] h2').textContent,
    body: document.body.textContent,
  }));
  check(r, "principalsPatched", t.principals.length === 2 && /Published Principal/.test(t.principals[0].name) && t.principals[0].role === "Role One" && /Second Principal/.test(t.principals[1].name), t.principals.map((x) => x.name));
  check(r, "bioParagraphs", t.principals[0].bios.length === 2 && t.principals[0].bios[1] === "Bio para two." && t.principals[1].bios.length === 1, t.principals.map((x) => x.bios));
  check(r, "photoAndLinks", /pgc-media\/p1\.png$/.test(t.principals[0].img) && t.principals[0].alt === "Published Principal" && !t.principals[0].li && !t.principals[0].mail && t.principals[0].mailHref === "mailto:pp@theari.us", t.principals[0]);
  check(r, "missingLinksHidden", t.principals[1].li === true && t.principals[1].mail === true);
  check(r, "benchPublishedOnly", t.bench.length === 1 && /Bench One/.test(t.bench[0]) && !/Draft Hire|Must not show/.test(t.body), t.bench);
  check(r, "benchHeadingPatched", /The team behind/.test(t.benchHeading));
  await p.screenshot({ path: path.join(OUT, "public-team-hydrated.png") });
  await ctx.close();
}

// ---------------- 4. Fetch failure → the page as shipped ----------------
{
  const r = {}; results.fetchFails = r;
  const { ctx, p } = await open("home-fail", "/", { fail: ["pgc_pages", "pgc_sections", "pgc_team", "pgc_settings"] });
  const keys = await sectionKeys(p);
  check(r, "repoSectionsIntact", keys.join(",") === "hero,about,bridge,why,values,operating-model,wayfinding,closing", keys);
  check(r, "repoCopyShown", (await p.evaluate(() => document.querySelector("h1").textContent)) === "Capital built for critical technology.");
  check(r, "noDbTextLeaked", !/from the database/.test(await bodyText(p)));
  await ctx.close();
  // Sections fail but the page row loads: still untouched.
  const s2 = await open("home-fail-2", "/", { fail: ["pgc_sections"] });
  check(r, "partialFailureIntact", (await sectionKeys(s2.p)).length === 8);
  await s2.ctx.close();
}

// ---------------- 5. Round trip: read → write → read is lossless on every page ----------------
{
  const r = {}; results.roundTrip = r;
  for (const url of ["/", "/thesis/", "/investors/", "/founders/", "/team/", "/contact/"]) {
    const { ctx, p } = await open("rt" + url, url, { noHydrate: true });
    const out = await p.evaluate(async () => {
      const m = await import("/assets/js/content.js");
      const main = document.querySelector("[data-pgc-page]");
      const before = m.readPage(main);
      const html = main.innerHTML;
      // Write every section back from what was read, then read again.
      main.querySelectorAll("[data-pgc-section]").forEach((el, i) => m.patchSection(el, before.sections[i]));
      const after = m.readPage(main);
      const team = [...main.querySelectorAll("[data-pgc-team]")].map((g) => m.readTeamGrid(g));
      const teamBefore = JSON.stringify(team);
      main.querySelectorAll("[data-pgc-team]").forEach((g, i) => m.patchTeamGrid(g, team[i]));
      const teamAfter = JSON.stringify([...main.querySelectorAll("[data-pgc-team]")].map((g) => m.readTeamGrid(g)));
      return { same: JSON.stringify(before) === JSON.stringify(after), htmlSame: main.innerHTML === html, sections: before.sections.length, teamSame: teamBefore === teamAfter, before: JSON.stringify(before).slice(0, 200) };
    });
    check(r, "rt:" + url, out.same && out.teamSame && out.sections > 0, { sections: out.sections, same: out.same, htmlSame: out.htmlSame, teamSame: out.teamSame });
    await ctx.close();
  }
}

results.errors = errors;
await browser.close();
console.log(JSON.stringify(results, null, 1));
const bad = JSON.stringify(results).includes('"ok":false') || errors.length;
process.exit(bad ? 1 : 0);
