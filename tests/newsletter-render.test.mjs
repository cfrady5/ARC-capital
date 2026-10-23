// Node-only checks of the PGC email renderer: the committed browser copy
// (assets/js/newsletter-render.js) matches a fresh transpile of
// supabase/functions/pgc-mailchimp/render.ts, and a rendered campaign carries
// the PGC branding with none of ARI's. Usage: node tests/newsletter-render.test.mjs
import { loadTypeScript, build, committed, HEADER } from "../tools/build-newsletter-render.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

let total = 0, failed = 0;
const check = (label, ok, note) => { total++; if (!ok) failed++; console.log((ok ? "PASS" : "FAIL") + "  " + label + (note !== undefined && !ok ? "  → " + JSON.stringify(note).slice(0, 300) : "")); };

const ts = loadTypeScript();
check("typescript available", !!ts);
if (ts) {
  const fresh = build(ts);
  check("assets/js/newsletter-render.js is a fresh transpile of render.ts (run node tools/build-newsletter-render.mjs)", HEADER + committed() === fresh);
}

const tmp = path.join(os.tmpdir(), "pgc-render-" + Date.now() + ".mjs");
fs.copyFileSync(path.resolve("assets/js/newsletter-render.js"), tmp);
const R = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

check("RENDER_VERSION is PGC's own counter", R.RENDER_VERSION === 1, R.RENDER_VERSION);

const campaign = R.normalizeCampaign({
  title: "October update", subject: "PGC in October", preview_text: "What moved this month",
  template: "digest",
  content: { heading: "Capital built for critical technology.", intro: "A line of **bold** intro.", closing: "Thanks for reading.",
    blocks: [{ type: "heading", text: "Market scale" }, { type: "text", heading: "Three domains", body: "Bio, micro, robotics." }, { type: "button", label: "Read the thesis", url: "https://pgc.capital/thesis/" }, { type: "image", url: "assets/img/email/pgc-mark-mint.png", alt: "PGC" }] },
}, true);
const out = R.renderCampaign(campaign, new Map(), new Map(), null);
check("renders html and text", out.html.length > 2000 && out.text.length > 50);
check("no warnings for a complete campaign", out.warnings.length === 0, out.warnings);
check("header shows the PGC lockup from pgc.capital", /https:\/\/pgc\.capital\/assets\/img\/email\/pgc-logo-dark\.png/.test(out.html));
check("mint header rule", /border-bottom:4px solid #3cdbc0/.test(out.html));
check("buttons and footer use PGC dark teal", /background:#072b31/.test(out.html));
check("footer names Proving Ground Capital", /Proving Ground Capital \(PGC\)/.test(out.html) && /pgc\.capital/.test(out.html));
check("Mailchimp merge tags present", /\*\|UNSUB\|\*/.test(out.html) && /\*\|LIST:ADDRESSLINE\|\*/.test(out.html) && /\*\|UPDATE_PROFILE\|\*/.test(out.html));
check("relative image resolved to pgc.capital", /https:\/\/pgc\.capital\/assets\/img\/email\/pgc-mark-mint\.png/.test(out.html));
check("Funnel Sans loaded and used", /fonts\.googleapis\.com\/css2\?family=Funnel\+Sans/.test(out.html) && /font-family:'Funnel Sans'/.test(out.html));
check("bold markup applied, author HTML never interpreted", /<strong style="font-weight:bold;">bold<\/strong>/.test(out.html));
check("no ARI wording or files", !/theari\.us|Applied Research Institute initiative|Warfighter|ari-logo/i.test(out.html), (out.html.match(/theari\.us|Warfighter|ari-logo/gi) || []).slice(0, 3));
check("default From is PGC", campaign.from_name === "Proving Ground Capital (PGC)");

const dark = R.renderCampaign(R.normalizeCampaign({ title: "t", subject: "s", content: { blocks: [{ type: "heading", text: "x" }], appearance: { mode: "dark" } } }, true), new Map(), new Map(), null);
check("dark email uses the mint logo and PGC deep teal card", /pgc-logo-mint\.png/.test(dark.html) && /background:#0a343b/.test(dark.html));

const editor = R.renderCampaign(campaign, new Map(), new Map(), null, { editor: true });
check("editor markers only in editor mode", /data-nl="block:0"/.test(editor.html) && !/data-nl=/.test(out.html));
check("sent email is byte-identical without the editor option", R.renderCampaign(campaign, new Map(), new Map(), null).html === out.html);

const xss = R.renderCampaign(R.normalizeCampaign({ title: "t", subject: "<script>alert(1)</script>", content: { heading: "<img src=x onerror=alert(1)>", blocks: [{ type: "text", body: "<b>hi</b> & <a href='x'>y</a>" }] } }, true), new Map(), new Map(), null);
check("author markup is escaped", !/<script>|<img src=x|<b>hi<\/b>/.test(xss.html) && /&lt;b&gt;hi&lt;\/b&gt;/.test(xss.html) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(xss.html));

console.log(`\n${failed} failures | ${total} total`);
process.exit(failed ? 1 : 0);
