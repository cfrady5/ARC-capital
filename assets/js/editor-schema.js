/* Proving Ground Capital (PGC) — what the website editor shows for each section.
   ---------------------------------------------------------------------------
   The database stores every section in the same generic columns (eyebrow,
   heading, heading_accent, kicker, lead, note, bullets, items, extra). This
   file maps those columns to what an editor actually sees on the page, section
   by section, so every field is named after the thing it changes and only the
   fields the design really has are offered.

   A section is looked up by "<page slug>/<section key>". Sections added in the
   editor (no key, or a key not listed here) fall back to KIND_SCHEMAS.

   Field descriptors
     { key: "heading", label, hint, type }      a section column
     { key: "extra.lens_title", ... }            a key inside pgc_sections.extra
     { key: "text", para: 0, ... }               one paragraph of a multi-paragraph value
     type: "input" (default) | "textarea" | "paras" | "list" | "pairs" | "link" | "band"
     { group: "Lens banner", hint }              a sub-heading inside the card

   items: { label, noun, min, max, hint, fields: [...] }  the repeating blocks
*/

/* ----------------------------------------------------------- building blocks */
const eyebrow = (hint) => ({ key: "eyebrow", label: "Eyebrow label", hint: hint || "The small // label // above the headline." });
const headline = (white, mint) => [
  { key: "heading", label: white || "Headline — white part" },
  { key: "heading_accent", label: mint || "Headline — mint part", hint: "Shown in mint straight after the white part. Leave empty for an all-white headline." },
];
const lead = (label, hint) => ({ key: "lead", label: label || "Intro paragraph(s)", type: "paras", hint: hint || "Leave a blank line between paragraphs." });
const band = { key: "band", label: "Background", type: "band" };
const buttons = (max, hint) => ({
  label: "Buttons", noun: "Button", min: 0, max: max || 2,
  hint: hint || "The first button is solid mint, the second is outlined.",
  fields: [
    { key: "label", label: "Button text", hint: "The (↗) arrow is added automatically." },
    { key: "href", label: "Link", type: "link" },
  ],
});
const numberedCards = (noun, eyebrowLabel, max, hint) => ({
  label: noun + "s", noun, min: 1, max: max || 6, hint,
  fields: [
    { key: "eyebrow", label: eyebrowLabel || "Number", hint: "The small label at the top of the card." },
    { key: "title", label: noun + " title" },
    { key: "text", label: noun + " text", type: "textarea" },
  ],
});

/* --------------------------------------------------------------------- pages */
export const SECTION_SCHEMAS = {
  /* ================================ Home */
  "home/hero": {
    name: "Hero",
    where: "Top of the page — the mint card with the logo, then the intro and buttons below it.",
    fields: [
      { key: "heading", label: "Headline (inside the mint card)" },
      { key: "kicker", label: "Values strip (bottom of the mint card)", hint: "Words separated by / — e.g. Conviction / Craft / Endurance." },
      lead("Intro paragraph (below the card)"),
    ],
    items: buttons(2),
  },
  "home/about": {
    name: "About",
    where: "First section under the hero.",
    fields: [eyebrow(), ...headline(), lead("Body paragraphs")],
  },
  "home/bridge": {
    name: "ARI → PGC bridge",
    where: "Grey band: two panels joined by a dotted arrow.",
    fields: [band, eyebrow(), ...headline()],
    items: {
      label: "Panels", noun: "Panel", min: 2, max: 2,
      hint: "Left panel, then right panel (the right one is highlighted). The arrow between them is fixed.",
      fields: [
        { key: "title", label: "Short name (large)", hint: "e.g. ARI" },
        { key: "subtitle", label: "Full name", hint: "e.g. Applied Research Institute" },
        { key: "text", label: "Description", type: "textarea" },
      ],
    },
  },
  "home/why": {
    name: "Why PGC",
    where: "Headline and intro, then a row of four numbered cards.",
    fields: [band, eyebrow(), ...headline(), lead()],
    items: numberedCards("Card", "Card number", 4, "Designed as a row of four."),
  },
  "home/values": {
    name: "Values",
    where: "Three value cards: a statement at the top, the value word large at the bottom.",
    fields: [band, eyebrow(), ...headline()],
    items: {
      label: "Value cards", noun: "Value card", min: 1, max: 3, hint: "Designed as a row of three.",
      fields: [
        { key: "text", label: "Statement (top of the card)", type: "textarea" },
        { key: "title", label: "Value word (large, bottom of the card)" },
      ],
    },
  },
  "home/operating-model": {
    name: "Operating model",
    where: "Grey band: headline and intro, then two phase cards with checklists.",
    fields: [band, eyebrow(), ...headline(), lead()],
    items: {
      label: "Phase cards", noun: "Phase card", min: 1, max: 2, hint: "Left card is phase 1, right card is phase 2.",
      fields: [
        { key: "title", label: "Phase title" },
        { key: "bullets", label: "Checklist", type: "list", hint: "One point per line. Each gets a mint tick." },
      ],
    },
  },
  "home/wayfinding": {
    name: "Two ways to engage",
    where: "Two mint cards, each with its own button.",
    fields: [band, eyebrow(), ...headline()],
    items: {
      label: "Path cards", noun: "Path card", min: 1, max: 2,
      fields: [
        { key: "eyebrow", label: "Card label", hint: "e.g. For Companies — Now" },
        { key: "title", label: "Card title" },
        { key: "text", label: "Card text", type: "textarea" },
        { key: "label", label: "Button text" },
        { key: "href", label: "Button link", type: "link" },
      ],
    },
  },
  "home/closing": {
    name: "Closing quote",
    where: "Bottom of the page: a large quote, who said it, and one button.",
    fields: [
      { key: "heading", label: "Quote — white part", hint: "Include the opening “ quotation mark." },
      { key: "heading_accent", label: "Quote — mint part", hint: "Include the closing ” quotation mark." },
      { key: "note", label: "Attribution", hint: "Name · Title — the name before the · is shown in mint." },
    ],
    items: buttons(1, "One solid mint button under the quote."),
  },

  /* ================================ Investment Thesis */
  "thesis/hero": {
    name: "Hero",
    where: "Top of the page.",
    fields: [eyebrow(), ...headline(), { key: "kicker", label: "Domains line", hint: "The mint line under the headline, e.g. Biotechnology × Microelectronics × Robotics." }, lead("Intro paragraph")],
    items: buttons(2),
  },
  "thesis/market-scale": {
    name: "Market scale",
    where: "Grey band: four big-number stats.",
    fields: [band, eyebrow(), ...headline(), lead()],
    items: {
      label: "Stats", noun: "Stat", min: 1, max: 4, hint: "Designed as a row of four.",
      fields: [
        { key: "eyebrow", label: "Index label", hint: "e.g. / 01" },
        { key: "title", label: "Big number", hint: "e.g. $2.3T" },
        { key: "text", label: "What the number means", type: "textarea" },
      ],
    },
  },
  "thesis/focus": {
    name: "Our focus — three domains",
    where: "Headline, the National Security lens banner, the dotted arc, then three domain cards.",
    fields: [
      band, eyebrow(), ...headline(),
      { group: "Lens banner", hint: "The wide banner between the headline and the domain cards." },
      { key: "extra.lens_label", label: "Banner label", hint: "e.g. The Lens" },
      { key: "extra.lens_title", label: "Banner title", hint: "e.g. National Security" },
      { key: "extra.lens_note", label: "Banner text", type: "textarea" },
    ],
    items: {
      label: "Domain cards", noun: "Domain card", min: 1, max: 3, hint: "Left to right. Designed as a row of three.",
      fields: [
        { key: "eyebrow", label: "Domain number", hint: "e.g. Domain 01" },
        { key: "subtitle", label: "Sector", hint: "Shown next to the number, e.g. Microelectronics." },
        { key: "title", label: "Domain name (large)", hint: "e.g. MICRO" },
        { key: "text", para: 0, label: "Summary", type: "textarea", hint: "The first, brighter paragraph." },
        { key: "text", para: 1, label: "Scope", type: "textarea", hint: "The second, smaller paragraph." },
        { key: "bullets", label: "Focus areas", type: "pairs", columns: ["Area", "Detail"], hint: "Each row shows the area in white and the detail beside it." },
      ],
    },
  },
  "thesis/intersection": {
    name: "The intersection",
    where: "Headline and paragraph, then a grid of intersection tiles.",
    fields: [band, eyebrow(), ...headline(), lead(), { key: "bullets", label: "Intersection tiles", type: "list", hint: "One tile per line." }],
  },
  "thesis/sourcing": {
    name: "Sourcing advantage",
    where: "Grey band: four steps from ecosystem to pipeline.",
    fields: [band, eyebrow(), ...headline()],
    items: numberedCards("Step", "Step label", 4, "Left to right. Designed as a row of four."),
  },
  "thesis/get-in-touch": {
    name: "Get in touch",
    where: "Bottom of the page: headline, paragraph and buttons.",
    fields: [band, eyebrow(), ...headline(), lead()],
    items: buttons(2),
  },

  /* ================================ For Investors */
  "investors/hero": {
    name: "Hero",
    where: "Top of the page.",
    fields: [eyebrow(), ...headline(), lead("Intro paragraph")],
    items: buttons(2),
  },
  "investors/phases": {
    name: "Phase cards",
    where: "Three numbered cards directly under the hero (no headline).",
    fields: [band],
    items: numberedCards("Card", "Card number", 3, "Designed as a row of three."),
  },
  "investors/cultivation": {
    name: "LP cultivation",
    where: "Grey band: headline, intro line, then three program cards.",
    fields: [band, eyebrow(), ...headline(), lead("Intro line")],
    items: numberedCards("Program card", "Tag", 3, "Designed as a row of three."),
  },

  /* ================================ Founders & Companies */
  "founders/hero": {
    name: "Hero",
    where: "Top of the page.",
    fields: [eyebrow(), ...headline(), lead("Intro paragraph")],
    items: buttons(2),
  },
  "founders/services": {
    name: "Advisory services",
    where: "Grey band: four service cards.",
    fields: [band, eyebrow(), ...headline()],
    items: numberedCards("Service", "Service label", 4, "Designed as a row of four."),
  },
  "founders/beyond-advisory": {
    name: "Beyond advisory",
    where: "Bottom of the page: headline, paragraph and one button.",
    fields: [band, eyebrow(), ...headline(), lead()],
    items: buttons(1, "One solid mint button."),
  },

  /* ================================ Team */
  "team/hero": {
    name: "Hero",
    where: "Top of the page.",
    fields: [eyebrow(), ...headline(), lead("Intro paragraph")],
  },
  "team/principals": {
    name: "Principals",
    where: "The three leadership cards under the hero.",
    fields: [band],
    people: "principals",
  },
  "team/bench": {
    name: "Execution bench",
    where: "Grey band: headline, then the associate cards.",
    fields: [band, eyebrow(), ...headline()],
    people: "bench",
  },

  /* ================================ Contact */
  "contact/hero": {
    name: "Hero",
    where: "Top of the page.",
    fields: [eyebrow(), ...headline(), lead("Intro paragraph")],
  },
  "contact/form": {
    name: "Form and sidebar",
    where: "The contact form on the left and the “What we look for” card on the right.",
    fields: [
      { key: "note", label: "Line above the form", hint: "Visitors who arrive from a specific button (for example Submit a Company) see a matching message instead." },
    ],
    items: {
      label: "Sidebar card", noun: "Sidebar card", min: 1, max: 1,
      hint: "The HQ line and email address under the list are site settings, shared with the footer.",
      fields: [
        { key: "eyebrow", label: "Label", hint: "Shown as >> Data Loaded." },
        { key: "title", label: "Title" },
        { key: "bullets", label: "List", type: "list", hint: "One point per line." },
      ],
    },
  },
};

/* --------------------------------------------- sections added in the editor */
export const KIND_SCHEMAS = {
  hero: {
    name: "Hero", where: "Plain hero: eyebrow, headline, mint line, intro and buttons.",
    fields: [eyebrow(), ...headline(), { key: "kicker", label: "Mint line under the headline" }, lead("Intro paragraph")],
    items: buttons(2),
  },
  rich: {
    name: "Text block", where: "Eyebrow, headline, paragraphs and an optional checklist.",
    fields: [band, eyebrow(), ...headline(), lead("Paragraphs"), { key: "bullets", label: "Checklist", type: "list", hint: "Optional. One point per line." }],
  },
  cards: {
    name: "Cards", where: "Headline, then a row of up to four cards.",
    fields: [band, eyebrow(), ...headline(), lead()],
    items: numberedCards("Card", "Card label", 4),
  },
  ticks: {
    name: "Checklist cards", where: "Headline, then two cards with mint-tick checklists.",
    fields: [band, eyebrow(), ...headline(), lead()],
    items: {
      label: "Cards", noun: "Card", min: 1, max: 4,
      fields: [
        { key: "eyebrow", label: "Card label" },
        { key: "title", label: "Card title" },
        { key: "bullets", label: "Checklist", type: "list", hint: "One point per line." },
        { key: "text", label: "Text under the checklist", type: "textarea" },
      ],
    },
  },
  statement: {
    name: "Statement / quote", where: "A large centred quote with an attribution and a button.",
    fields: [band, ...headline("Quote — white part", "Quote — mint part"), { key: "note", label: "Attribution" }],
    items: buttons(1, "One solid mint button."),
  },
  cta: {
    name: "Call to action", where: "Headline, paragraph and buttons.",
    fields: [band, eyebrow(), ...headline(), lead()],
    items: buttons(2),
  },
};

export function schemaFor(slug, section) {
  return (section.section_key && SECTION_SCHEMAS[slug + "/" + section.section_key]) || KIND_SCHEMAS[section.kind] || KIND_SCHEMAS.rich;
}
