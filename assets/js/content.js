/* Proving Ground Capital (PGC) — public-site content layer.
   ---------------------------------------------------------------------------
   The HTML in this repository is the site. Supabase holds an editable copy of
   it, and this module replaces what the browser already has with the published
   rows. If the request fails, times out, or the page has no published rows,
   the markup that shipped with the repository stays exactly as it is — so a
   database outage can never blank a page.

   Nothing unpublished can arrive here: anonymous visitors are limited by RLS
   to `published = true`, and the queries below ask for published rows anyway.

   The markup carries three attributes:
     <main data-pgc-page="home">            which page this is
     <section data-pgc-section="why">       a managed block
     <div class="grid" data-pgc-items>      the block's repeating items
     <div class="grid" data-pgc-team="…">   people from pgc_team
   Everything else is found by the selectors in FIELDS / ITEM_FIELDS below, so
   the same module can read a section out of the DOM (used to seed the database
   and to show a "current page" baseline in the portal) and write one back in.
*/

const FIELDS = {
  eyebrow: '[data-pgc="eyebrow"], .section-head > .eyebrow, .container > .eyebrow',
  // The closing quote (.statement) splits into white + mint like a headline.
  heading: '[data-pgc="heading"], h1, .section-head > h2, .statement',
  kicker: '[data-pgc="kicker"], .kicker',
  lead: '[data-pgc="lead"], .sub, .lead',
  note: '[data-pgc="note"], .attribution',
};

const ITEM_FIELDS = {
  eyebrow: '[data-pgc="eyebrow"], .eyebrow, .lens-kicker',
  title: '[data-pgc="title"], h3, h4, .stat-n, .value-word, .org',
  subtitle: '[data-pgc="subtitle"], .org-full, .lens-note',
  text: '[data-pgc="text"], .domain-desc, .domain-scope, .bio',
};
/* Decoration inside an item that is never body copy. */
const ITEM_SKIP = ".team-links, .arrow, .btn, .hq, .email-large";

/* ------------------------------------------------------------------ utils */
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const paras = (s) =>
  String(s == null ? "" : s)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

/* An element belongs to the section itself only when no items container,
   nested inside that section, owns it first. */
function own(root, selector) {
  return Array.from(root.querySelectorAll(selector)).filter((el) => {
    const holder = el.closest("[data-pgc-items], [data-pgc-team]");
    return !holder || holder === root || !root.contains(holder);
  });
}

/* The `// text //` motif: the slashes are decoration, the text is content. */
function readMotif(el) {
  if (!el) return "";
  const direct = Array.from(el.childNodes).filter((n) => n.nodeType === 3);
  const t = direct.map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
  return t || txt(el).replace(/^\/+\s*/, "").replace(/\s*\/+$/, "").trim();
}
function writeMotif(el, value) {
  if (!el) return;
  const decor = Array.from(el.children).filter((c) => c.getAttribute("aria-hidden") === "true");
  if (!decor.length) { el.textContent = value || ""; return; }
  Array.from(el.childNodes).forEach((n) => { if (n.nodeType === 3) n.remove(); });
  const tail = decor[decor.length - 1];
  el.insertBefore(document.createTextNode(value || ""), decor.length > 1 ? tail : tail.nextSibling);
}

/* A headline splits into a white part and a mint `.accent` clause. */
function readHeading(el) {
  if (!el) return { heading: "", accent: "" };
  const a = el.querySelector(".accent");
  if (!a) return { heading: txt(el), accent: "" };
  const clone = el.cloneNode(true);
  clone.querySelector(".accent").remove();
  return { heading: txt(clone), accent: txt(a) };
}
function writeHeading(el, heading, accent) {
  if (!el) return;
  el.innerHTML = accent ? esc(heading) + ' <span class="accent">' + esc(accent) + "</span>" : esc(heading);
}

/* A pill button: the `(↗)` is decoration. */
function readBtn(a) {
  const clone = a.cloneNode(true);
  clone.querySelectorAll(".arrow").forEach((x) => x.remove());
  return { label: txt(clone), href: a.getAttribute("href") || "" };
}
function writeBtn(a, item) {
  if (item.href) a.setAttribute("href", item.href);
  const arrow = a.querySelector(".arrow");
  Array.from(a.childNodes).forEach((n) => { if (n.nodeType === 3) n.remove(); });
  const node = document.createTextNode((item.label || "") + (arrow ? " " : ""));
  a.insertBefore(node, arrow || null);
}

function readBullet(li) {
  const name = li.querySelector(".focus-name");
  const detail = li.querySelector(".focus-detail");
  if (name || detail) return { name: txt(name), detail: txt(detail) };
  return txt(li);
}
function writeBullet(li, value) {
  const v = typeof value === "string" ? { name: value, detail: "" } : value || {};
  const name = li.querySelector(".focus-name");
  const detail = li.querySelector(".focus-detail");
  if (!name && !detail) { li.textContent = v.name || ""; return; }
  if (name) name.textContent = v.name || "";
  if (detail) detail.textContent = v.detail || "";
}

/* Match a list of DOM nodes to a list of values: patch, clone or drop.
   Extra nodes are cloned from the last one, so a block added in the portal
   inherits exactly the markup and classes the designed one already has. */
function fit(container, nodes, count) {
  const out = nodes.slice(0, count);
  while (out.length < count) {
    const last = out[out.length - 1] || nodes[nodes.length - 1];
    if (!last) break;
    const clone = last.cloneNode(true);
    clone.classList.add("is-visible");
    last.after(clone);
    out.push(clone);
  }
  nodes.slice(count).forEach((n) => n.remove());
  return out;
}

/* The paragraphs of an item: everything that is not a claimed field, a list,
   decoration, or a wrapper around one of those. */
function bodyNodes(el, claimedList) {
  const claimed = claimedList.filter(Boolean);
  return Array.from(el.querySelectorAll(ITEM_FIELDS.text + ", p")).filter(
    (p) => !p.closest("ul, ol") && !p.closest(ITEM_SKIP) && !claimed.some((c) => p === c || p.contains(c))
  );
}

/* --------------------------------------------------------------- reading */
export function readItem(el) {
  if (el.matches("a[href]")) return readBtn(el);
  const item = {};
  const first = (sel) => el.querySelector(sel);
  const eyebrow = first(ITEM_FIELDS.eyebrow);
  if (eyebrow) item.eyebrow = readMotif(eyebrow);
  const title = first(ITEM_FIELDS.title);
  if (title) item.title = readMotif(title);
  const subtitle = first(ITEM_FIELDS.subtitle);
  if (subtitle) item.subtitle = txt(subtitle);
  const textNodes = bodyNodes(el, [eyebrow, title, subtitle]);
  if (textNodes.length) item.text = textNodes.map(txt).filter(Boolean).join("\n\n");
  const lis = Array.from(el.querySelectorAll("li"));
  if (lis.length) item.bullets = lis.map(readBullet);
  const img = el.querySelector("img");
  if (img) { item.image = img.getAttribute("src") || ""; item.image_alt = img.getAttribute("alt") || ""; }
  const btn = el.querySelector("a.btn");
  if (btn) Object.assign(item, readBtn(btn));
  return item;
}

export function readSection(el) {
  const row = {
    section_key: el.dataset.pgcSection || null,
    kind: el.dataset.pgcKind || (el.classList.contains("hero") || el.classList.contains("hero-plain") ? "hero" : "rich"),
    band: el.classList.contains("section--alt") ? "alt" : "default",
    bullets: [],
    items: [],
  };
  row.eyebrow = readMotif(own(el, FIELDS.eyebrow)[0]) || null;
  const h = own(el, FIELDS.heading)[0];
  const head = readHeading(h);
  row.heading = head.heading || null;
  row.heading_accent = head.accent || null;
  row.kicker = txt(own(el, FIELDS.kicker)[0]) || null;
  row.lead = own(el, FIELDS.lead).map(txt).filter(Boolean).join("\n\n") || null;
  row.note = txt(own(el, FIELDS.note)[0]) || null;

  const bulletHost = el.querySelector("[data-pgc-bullets]");
  if (bulletHost) row.bullets = Array.from(bulletHost.querySelectorAll("li")).map(readBullet);

  const host = el.querySelector("[data-pgc-items]");
  if (host) row.items = itemNodes(host).map(readItem);
  return row;
}

function itemNodes(host) {
  const sel = host.dataset.pgcItems;
  if (sel === "self") return [host];
  return sel ? Array.from(host.querySelectorAll(sel)) : Array.from(host.children);
}

export function readPage(root) {
  const main = root || document.querySelector("[data-pgc-page]");
  if (!main) return null;
  return {
    slug: main.dataset.pgcPage,
    sections: Array.from(main.querySelectorAll("[data-pgc-section]")).map((el, i) =>
      Object.assign(readSection(el), { sort_order: (i + 1) * 10 })
    ),
  };
}

/* --------------------------------------------------------------- writing */
export function patchItem(el, item) {
  if (!item) return;
  if (el.matches("a[href]")) { writeBtn(el, item); return; }
  const eyebrow = el.querySelector(ITEM_FIELDS.eyebrow);
  if (eyebrow && item.eyebrow != null) writeMotif(eyebrow, item.eyebrow);
  const title = el.querySelector(ITEM_FIELDS.title);
  if (title && item.title != null) writeMotif(title, item.title);
  const subtitle = el.querySelector(ITEM_FIELDS.subtitle);
  if (subtitle && item.subtitle != null) subtitle.textContent = item.subtitle;
  if (item.text != null) {
    const wanted = paras(item.text);
    const nodes = bodyNodes(el, [eyebrow, title, subtitle]);
    if (nodes.length)
      fit(nodes[0].parentNode, nodes, Math.max(wanted.length, 1)).forEach((n, i) => { n.textContent = wanted[i] || ""; });
  }
  if (Array.isArray(item.bullets)) {
    const list = el.querySelector("ul, ol");
    if (list) fit(list, Array.from(list.querySelectorAll("li")), item.bullets.length)
      .forEach((li, i) => writeBullet(li, item.bullets[i]));
  }
  const img = el.querySelector("img");
  if (img && item.image) { img.setAttribute("src", item.image); if (item.image_alt != null) img.setAttribute("alt", item.image_alt); }
  const btn = el.querySelector("a.btn");
  if (btn && (item.label || item.href)) writeBtn(btn, item);
}

export function patchSection(el, row) {
  if (!row) return;
  if (row.band) el.classList.toggle("section--alt", row.band === "alt");
  const eyebrow = own(el, FIELDS.eyebrow)[0];
  if (eyebrow && row.eyebrow != null) writeMotif(eyebrow, row.eyebrow);
  const h = own(el, FIELDS.heading)[0];
  if (h && row.heading != null) writeHeading(h, row.heading, row.heading_accent);
  const kicker = own(el, FIELDS.kicker)[0];
  if (kicker && row.kicker != null) kicker.textContent = row.kicker;
  if (row.lead != null) {
    const nodes = own(el, FIELDS.lead);
    const wanted = paras(row.lead);
    if (nodes.length) fit(nodes[0].parentNode, nodes, Math.max(wanted.length, 1))
      .forEach((n, i) => { n.textContent = wanted[i] || ""; });
  }
  const note = own(el, FIELDS.note)[0];
  if (note && row.note != null) note.textContent = row.note;

  const bulletHost = el.querySelector("[data-pgc-bullets]");
  if (bulletHost && Array.isArray(row.bullets) && row.bullets.length)
    fit(bulletHost, Array.from(bulletHost.querySelectorAll("li")), row.bullets.length)
      .forEach((li, i) => writeBullet(li, row.bullets[i]));

  const host = el.querySelector("[data-pgc-items]");
  if (host && Array.isArray(row.items) && row.items.length) {
    const nodes = itemNodes(host);
    if (host.dataset.pgcItems === "self") patchItem(host, row.items[0]);
    else fit(host, nodes, row.items.length).forEach((n, i) => patchItem(n, row.items[i]));
  }
  return el;
}

/* ------------------------------------------- rendering a brand-new section */
const motif = (t) => '<span aria-hidden="true">//&nbsp;</span>' + esc(t) + '<span aria-hidden="true">&nbsp;//</span>';
const arrow = ' <span class="arrow" aria-hidden="true">(&#8599;)</span>';

function headHtml(row) {
  let h = "";
  if (row.eyebrow) h += '<p class="eyebrow">' + motif(row.eyebrow) + "</p>";
  if (row.heading)
    h += "<h2>" + esc(row.heading) + (row.heading_accent ? ' <span class="accent">' + esc(row.heading_accent) + "</span>" : "") + "</h2>";
  paras(row.lead).forEach((p) => { h += '<p class="lead">' + esc(p) + "</p>"; });
  return h ? '<div class="section-head" data-reveal>' + h + "</div>" : "";
}
function btnRow(items, cls) {
  const links = (items || []).filter((i) => i && i.href && i.label);
  if (!links.length) return "";
  return '<div class="btn-row" data-pgc-items>' +
    links.map((i, n) => '<a class="btn ' + (cls || (n === 0 ? "btn-primary" : "btn-ghost")) + '" href="' + esc(i.href) + '">' + esc(i.label) + arrow + "</a>").join("") +
    "</div>";
}
function cardHtml(item, withTicks) {
  let h = "";
  if (item.eyebrow) h += '<p class="eyebrow">' + motif(item.eyebrow) + "</p>";
  if (item.title) h += "<h3>" + esc(item.title) + "</h3>";
  if (withTicks && Array.isArray(item.bullets) && item.bullets.length)
    h += '<ul class="ticks">' + item.bullets.map((b) => "<li>" + esc(typeof b === "string" ? b : b.name) + "</li>").join("") + "</ul>";
  paras(item.text).forEach((p) => { h += "<p>" + esc(p) + "</p>"; });
  return '<div class="card" data-reveal>' + h + "</div>";
}

/* Build a section that exists only in the database (added from the portal). */
export function renderSection(row, doc) {
  const d = doc || document;
  const sec = d.createElement("section");
  sec.dataset.pgcSection = row.section_key || "s-" + (row.id || Math.random().toString(36).slice(2));
  sec.dataset.pgcRendered = "true";
  const items = Array.isArray(row.items) ? row.items : [];
  let inner = "";

  if (row.kind === "hero") {
    sec.className = "hero-plain section";
    if (row.eyebrow) inner += '<p class="eyebrow">' + motif(row.eyebrow) + "</p>";
    inner += "<h1>" + esc(row.heading || "") + (row.heading_accent ? ' <span class="accent">' + esc(row.heading_accent) + "</span>" : "") + "</h1>";
    if (row.kicker) inner += '<p class="kicker">' + esc(row.kicker) + "</p>";
    paras(row.lead).forEach((p) => { inner += '<p class="sub">' + esc(p) + "</p>"; });
    inner += btnRow(items);
  } else if (row.kind === "statement") {
    sec.className = "section closing" + (row.band === "alt" ? " section--alt" : "");
    inner += "<blockquote>";
    inner += '<p class="statement">' + esc(row.heading || "") + (row.heading_accent ? ' <span class="accent">' + esc(row.heading_accent) + "</span>" : "") + "</p>";
    if (row.note) inner += '<p class="attribution">' + esc(row.note) + "</p>";
    inner += "</blockquote>" + btnRow(items, "btn-primary");
  } else {
    sec.className = "section" + (row.band === "alt" ? " section--alt" : "");
    inner += headHtml(row);
    if (row.kind === "cards" || row.kind === "ticks") {
      const cols = row.kind === "ticks" ? 2 : Math.min(Math.max(items.length, 2), 4);
      inner += '<div class="grid grid-' + cols + '" data-pgc-items>' +
        items.map((i) => cardHtml(i, row.kind === "ticks")).join("") + "</div>";
    } else if (row.kind === "cta") {
      inner += btnRow(items);
    } else if (Array.isArray(row.bullets) && row.bullets.length) {
      inner += '<ul class="ticks" data-pgc-bullets>' +
        row.bullets.map((b) => "<li>" + esc(typeof b === "string" ? b : b.name) + "</li>").join("") + "</ul>";
    }
  }
  sec.innerHTML = '<div class="container">' + inner + "</div>";
  return sec;
}

/* ------------------------------------------------------------------- team */
export function patchTeamGrid(grid, people) {
  const cards = Array.from(grid.children);
  if (!cards.length || !people.length) return;
  fit(grid, cards, people.length).forEach((card, i) => {
    const p = people[i];
    const img = card.querySelector("img");
    if (img) { if (p.photo_url) img.setAttribute("src", p.photo_url); img.setAttribute("alt", p.photo_alt || p.name || ""); }
    writeMotif(card.querySelector(".name"), p.name || "");
    const role = card.querySelector(".role");
    if (role) role.textContent = p.role || "";
    const bios = Array.from(card.querySelectorAll(".bio"));
    const wanted = paras(p.bio);
    if (bios.length) fit(bios[0].parentNode, bios, Math.max(wanted.length, 1))
      .forEach((n, j) => { n.textContent = wanted[j] || ""; });
    const li = card.querySelector(".team-links .link-solid");
    if (li) {
      if (p.linkedin_url) { li.setAttribute("href", p.linkedin_url); li.setAttribute("aria-label", (p.name || "") + " on LinkedIn (opens in a new tab)"); li.hidden = false; }
      else li.hidden = true;
    }
    const mail = card.querySelector(".team-links .link-outline");
    if (mail) {
      if (p.email) { mail.setAttribute("href", "mailto:" + p.email); mail.setAttribute("aria-label", "Email " + (p.name || "")); mail.hidden = false; }
      else mail.hidden = true;
    }
  });
}

export function readTeamGrid(grid) {
  return Array.from(grid.children).map((card, i) => {
    const img = card.querySelector("img");
    const li = card.querySelector(".team-links .link-solid");
    const mail = card.querySelector(".team-links .link-outline");
    return {
      name: readMotif(card.querySelector(".name")),
      role: txt(card.querySelector(".role")),
      bio: Array.from(card.querySelectorAll(".bio")).map(txt).join("\n\n"),
      photo_url: img ? img.getAttribute("src") : null,
      photo_alt: img ? img.getAttribute("alt") : null,
      linkedin_url: li ? li.getAttribute("href") : null,
      email: mail ? (mail.getAttribute("href") || "").replace(/^mailto:/, "") : null,
      team_group: grid.dataset.pgcTeam || "principals",
      sort_order: (i + 1) * 10,
    };
  });
}

/* --------------------------------------------------------------- applying */
export function applyPage(main, rows) {
  const byKey = new Map();
  rows.forEach((r) => { if (r.section_key) byKey.set(r.section_key, r); });
  const existing = Array.from(main.querySelectorAll("[data-pgc-section]"));
  const ordered = rows.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // A managed page shows exactly the published rows: sections without a row
  // are gone from the database, so they go from the page too.
  existing.forEach((el) => { if (!byKey.has(el.dataset.pgcSection)) el.remove(); });

  let anchor = null;
  ordered.forEach((row) => {
    let el = row.section_key ? main.querySelector('[data-pgc-section="' + CSS.escape(row.section_key) + '"]') : null;
    if (el) patchSection(el, row);
    else el = renderSection(row, main.ownerDocument);
    if (anchor) anchor.after(el); else main.prepend(el);
    anchor = el;
  });
  return ordered.length;
}

export function applyTeam(main, people) {
  main.querySelectorAll("[data-pgc-team]").forEach((grid) => {
    const group = people.filter((p) => p.team_group === grid.dataset.pgcTeam);
    if (group.length) patchTeamGrid(grid, group);
    else grid.closest("[data-pgc-section]")?.remove();
  });
}

/* Sections that arrive after the reveal observer started still need watching. */
export function revealScan(root) {
  if (typeof window !== "undefined" && typeof window.pgcRevealScan === "function") window.pgcRevealScan(root);
  else root.querySelectorAll("[data-reveal]:not(.is-visible)").forEach((el) => el.classList.add("is-visible"));
}

export function applySettings(doc, settings) {
  const map = new Map(settings.map((s) => [s.key, s.value]));
  doc.querySelectorAll("[data-pgc-setting]").forEach((el) => {
    const v = map.get(el.dataset.pgcSetting);
    if (v == null || v === "") return;
    if (el.tagName === "A" && el.dataset.pgcSetting === "contact_email") {
      el.setAttribute("href", "mailto:" + v);
      el.textContent = v;
    } else el.textContent = v;
  });
}

/* --------------------------------------------------------------- hydrate */
async function hydrate() {
  const main = document.querySelector("[data-pgc-page]");
  if (!main) return;

  // Live preview: the portal opens this page in an iframe and posts draft rows
  // instead of letting it read the database.
  const params = new URLSearchParams(location.search);
  if (params.get("pgc_preview") === "1") {
    // A preview never fades in: show everything at once.
    document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-visible"));
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== "pgc:preview") return;
      try {
        if (Array.isArray(e.data.sections)) applyPage(main, e.data.sections);
        if (Array.isArray(e.data.team)) applyTeam(main, e.data.team);
        if (Array.isArray(e.data.settings)) applySettings(document, e.data.settings);
      } catch (err) { /* a bad draft must never break the preview frame */ }
      document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-visible"));
      window.parent.postMessage({ type: "pgc:preview-painted" }, location.origin);
    });
    if (window.parent !== window) window.parent.postMessage({ type: "pgc:preview-ready" }, location.origin);
    return;
  }

  let supabase;
  try { ({ supabase } = await import("./supabase.js")); } catch { return; }

  const slug = main.dataset.pgcPage;
  const timeout = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r({ data: null, error: "timeout" }), 6000))]);
  try {
    const page = await timeout(
      supabase.from("pgc_pages").select("id,slug,title,meta_description").eq("slug", slug).eq("published", true).maybeSingle()
    );
    if (page.error || !page.data) return;

    const [sections, team, settings] = await Promise.all([
      timeout(supabase.from("pgc_sections").select("*").eq("page_id", page.data.id).eq("published", true).order("sort_order", { ascending: true })),
      main.querySelector("[data-pgc-team]")
        ? timeout(supabase.from("pgc_team").select("*").eq("published", true).order("sort_order", { ascending: true }))
        : Promise.resolve({ data: [] }),
      timeout(supabase.from("pgc_settings").select("key,value").eq("published", true)),
    ]);

    if (!sections.error && Array.isArray(sections.data) && sections.data.length) {
      applyPage(main, sections.data);
      revealScan(main);
    }
    if (!team.error && Array.isArray(team.data) && team.data.length) applyTeam(main, team.data);
    if (!settings.error && Array.isArray(settings.data) && settings.data.length) applySettings(document, settings.data);
    if (page.data.meta_description) {
      const m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute("content", page.data.meta_description);
    }
    document.dispatchEvent(new CustomEvent("pgc:content-loaded", { detail: { slug } }));
  } catch {
    /* The repository's markup is already on screen; leave it alone. */
  }
}

if (typeof document !== "undefined" && !window.__PGC_NO_HYDRATE) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hydrate);
  else hydrate();
}
