# PGC website editor: rebuild

The database already matches the live site; nothing in the page copy changes. This
update changes how the editor presents that content, and makes the last
hard-coded pieces editable.

## Files (paths are relative to the site root)

| File | Change |
|---|---|
| `assets/js/editor-schema.js` | **New.** A field map for each of the 25 sections, named after what each field changes on the page |
| `assets/js/portal.js` | Section cards are built from the field map. Gaps are filled from the live markup. The preview jumps to the section you open. The save message now stays visible after saving |
| `assets/js/content.js` | Adds support for `data-pgc-extra`. Keeps the values-strip spacing and the mint name in the closing quote. Settings keep their `< … >` decoration |
| `assets/js/main.js` | The contact helper message still wins over the editor copy. Fixes “conversation with ARC” → “Proving Ground Capital (PGC)” |
| `assets/css/portal.css` | Styles for the new editor parts. The `[hidden]` fix was already live |
| `index.html`, `thesis/`, `contact/`, `investors/`, `founders/`, `team/` | Small `data-pgc` hooks only. No visible change |
| `supabase/migrations/20261024_pgc_sections_extra.sql` | One-time DB update: adds the `extra` column and records the current values |

## Order

1. Deploy the files. This is safe before step 2: until the column exists, the editor
   shows the lens-banner fields read-only and saves everything else normally.
2. Run the SQL in the Supabase SQL editor (project “ARI Main Page”). It can be run
   more than once safely.
3. Hard-refresh `/portal/`.

## Newly editable

- Home hero: the values strip (Conviction / Craft / Endurance)
- Thesis: the National Security lens banner (label, title, text)
- Contact: the line above the form
- Site settings: the HQ line, shared by the footer and the Contact sidebar

Still fixed by design: the logos, the ARI → PGC arrow, the dotted arc, and the
contact form's field labels.
