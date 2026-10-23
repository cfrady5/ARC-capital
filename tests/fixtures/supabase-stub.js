// In-memory Supabase stand-in for the headless tests. Served in place of
// /assets/js/supabase.js, so the portal and the public pages run with no
// network and no credentials. Mirrors the pgc_* RLS policies and triggers:
//   anon / everyone      read published rows only
//   can_edit('pgc')      read drafts; insert/update unpublished rows
//   can_publish('pgc')   publish, unpublish, delete, restore
// The test sets window.__SEED, __ROLE, __STATUS, __MODULES, __ANON before load.
const SEED = window.__SEED || {};
const TABLES = {};
["pgc_pages", "pgc_sections", "pgc_team", "pgc_settings", "content_revisions", "employees", "employee_access"].forEach((t) => (TABLES[t] = (SEED[t] || []).map((r) => ({ ...r }))));
const ME = { email: window.__ROLE_EMAIL || "test@theari.us", full_name: window.__ROLE_NAME || "Terry Tester", role: window.__ROLE || "employee", status: window.__STATUS || "active", avatar_url: null };
const MODS = Object.assign({}, window.__MODULES || {});
const PGC = ["pgc_pages", "pgc_sections", "pgc_team", "pgc_settings"];
const isActive = () => !window.__ANON && ME.status === "active";
const isAdmin = () => isActive() && ME.role === "admin";
const canEdit = () => isAdmin() || (isActive() && ["contributor", "publisher"].includes(MODS.pgc));
const canPublish = () => isAdmin() || (isActive() && MODS.pgc === "publisher");
const isComms = () => isAdmin() || (isActive() && Object.keys(MODS).some((m) => m !== "messages"));
const rls = (msg) => { throw new Error(msg || "new row violates row-level security policy"); };
let idc = 1;
const uuid = () => "t-" + (idc++).toString(36).padStart(5, "0");
let revId = (TABLES.content_revisions.reduce((m, r) => Math.max(m, r.id || 0), 0) || 0) + 1;
window.__TABLES = TABLES;
window.__LOG = [];
window.__ACCESS_STUB = { isAdmin, canEdit, canPublish };

const LABELS = { pgc_pages: (r) => r.title || r.slug, pgc_sections: (r) => r.heading || r.eyebrow || r.section_key || "Section", pgc_team: (r) => r.name, pgc_settings: (r) => r.label || r.key };
function logRevision(table, op, row) {
  TABLES.content_revisions.push({ id: revId++, table_name: table, record_id: row.id, operation: op, snapshot: JSON.parse(JSON.stringify(row)), label: LABELS[table] ? LABELS[table](row) : table, changed_by: window.__ANON ? null : ME.email, changed_at: new Date().toISOString() });
}
/* The pgc_content_guard trigger. */
function guard(table, oldRow, newRow) {
  if (newRow.review_state === "changes_requested" && (!oldRow || oldRow.review_state !== "changes_requested") && !canPublish()) throw new Error("Only a Proving Ground Capital publisher can request changes.");
  if (newRow.published) newRow.review_state = "draft";
  newRow.updated_at = new Date().toISOString(); newRow.updated_by = window.__ANON ? null : ME.email;
}

function builder(table) {
  const rows = TABLES[table] || (TABLES[table] = []);
  const st = { filters: [], order: [], limit: null, single: false, maybe: false, op: "select", payload: null };
  const visible = (r) => {
    if (PGC.includes(table)) return r.published === true || canEdit();
    if (table === "content_revisions") return isComms();
    if (table === "employees") return isActive();
    return false;
  };
  const writable = (r) => PGC.includes(table) && (canPublish() || (canEdit() && r.published === false));
  const apply = () => {
    let out = rows.filter((r) => visible(r) && st.filters.every((f) => f(r)));
    if (st.order.length) out = [...out].sort((a, b) => { for (const { col, asc } of st.order) { const x = a[col], y = b[col]; if (x === y) continue; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : 1) * (asc ? 1 : -1); } return 0; });
    if (st.limit != null) out = out.slice(0, st.limit);
    return out;
  };
  const b = {
    select() { return b; },
    eq(k, v) { st.filters.push((r) => r[k] === v); return b; },
    neq(k, v) { st.filters.push((r) => r[k] !== v); return b; },
    in(k, arr) { st.filters.push((r) => arr.includes(r[k])); return b; },
    is(k, v) { st.filters.push((r) => r[k] === v); return b; },
    order(col, opts) { st.order.push({ col, asc: !opts || opts.ascending !== false }); return b; },
    limit(n) { st.limit = n; return b; },
    maybeSingle() { st.single = true; st.maybe = true; return b; },
    single() { st.single = true; return b; },
    insert(p) { st.op = "insert"; st.payload = p; return b; },
    update(p) { st.op = "update"; st.payload = p; return b; },
    delete() { st.op = "delete"; return b; },
    then(res, rej) {
      let result;
      try {
        if (window.__FAIL_TABLES && window.__FAIL_TABLES.includes(table)) throw new Error("FetchError: network down");
        if (st.op === "select") {
          const out = apply();
          result = { data: st.single ? out[0] || null : out, error: null };
          if (st.single && !st.maybe && !out[0]) result = { data: null, error: { message: "Row not found", code: "PGRST116" } };
        } else if (st.op === "insert") {
          if (window.__ANON || !PGC.includes(table)) throw new Error("permission denied for table " + table);
          const list = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((p) => {
            const row = { id: uuid(), created_at: new Date().toISOString(), published: false, review_state: "draft", ...p };
            if (table === "pgc_sections") { row.items = row.items || []; row.bullets = row.bullets || []; }
            if (!writable(row)) rls();
            guard(table, null, row);
            if (table === "pgc_pages" && rows.some((r) => r.slug === row.slug)) throw Object.assign(new Error('duplicate key value violates unique constraint "pgc_pages_slug_key"'), { code: "23505" });
            rows.push(row); logRevision(table, "insert", row); window.__LOG.push(["insert", table, row]); return row;
          });
          result = { data: st.single ? list[0] : list, error: null };
        } else if (st.op === "update") {
          if (window.__ANON || !PGC.includes(table)) throw new Error("permission denied for table " + table);
          const out = apply().filter(writable);
          out.forEach((r) => {
            const next = Object.assign({}, r, st.payload);
            if (!writable(next)) rls();
            guard(table, r, next);
            const changed = JSON.stringify({ ...r, updated_at: 0, updated_by: 0 }) !== JSON.stringify({ ...next, updated_at: 0, updated_by: 0 });
            Object.assign(r, next);
            if (changed) logRevision(table, "update", r);
          });
          window.__LOG.push(["update", table, st.payload, out.length]);
          result = { data: st.single ? out[0] || null : out, error: null };
        } else if (st.op === "delete") {
          if (window.__ANON || !PGC.includes(table)) throw new Error("permission denied for table " + table);
          const out = apply().filter(() => canPublish());
          out.forEach((r) => { rows.splice(rows.indexOf(r), 1); logRevision(table, "delete", r); });
          if (table === "pgc_pages") out.forEach((p) => (TABLES.pgc_sections = TABLES.pgc_sections.filter((s) => s.page_id !== p.id)));
          window.__LOG.push(["delete", table, out.length]);
          result = { data: out, error: null };
        }
      } catch (e) { result = { data: null, error: { message: e.message, code: e.code } }; }
      return Promise.resolve(result).then(res, rej);
    },
  };
  return b;
}

export const supabase = {
  supabaseUrl: "https://stub.local", supabaseKey: "stub",
  auth: {
    getSession: async () => ({ data: { session: window.__ANON ? null : { user: { email: ME.email }, access_token: "tok" } } }),
    signOut: async () => { window.__ANON = true; window.__LOG.push(["signOut"]); return { error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithPassword: async (args) => { window.__LOG.push(["signInWithPassword", args.email]); if (window.__PW_OK && args.password === window.__PW_OK) { window.__ANON = false; return { data: { session: {} }, error: null }; } return { data: null, error: { message: "Invalid login credentials" } }; },
    signInWithOtp: async (args) => { window.__OTP = (window.__OTP || []).concat([args]); return window.__OTP_ERROR ? { data: null, error: { message: window.__OTP_ERROR } } : { data: {}, error: null }; },
  },
  rpc: async (name, args) => {
    window.__LOG.push(["rpc", name, args]);
    if (window.__RPC_FAIL === name) return { data: null, error: { message: "function public." + name + " failed" } };
    if (name === "my_access") {
      if (window.__ANON || window.__NOT_EMPLOYEE) return { data: null, error: null };
      return { data: { email: ME.email, full_name: ME.full_name, avatar_url: null, role: ME.role, status: ME.status, modules: Object.assign({}, MODS) }, error: null };
    }
    if (name === "pgc_restore_revision") {
      const rev = TABLES.content_revisions.find((r) => r.id === (args && args.rev_id));
      if (!rev) return { data: null, error: { message: "That version no longer exists." } };
      if (!PGC.includes(rev.table_name)) return { data: null, error: { message: "Not a Proving Ground Capital record: " + rev.table_name } };
      if (!canPublish()) return { data: null, error: { message: "Not authorized." } };
      const rows = TABLES[rev.table_name];
      const i = rows.findIndex((r) => r.id === rev.record_id);
      const snap = JSON.parse(JSON.stringify(rev.snapshot));
      if (i >= 0) rows[i] = snap; else rows.push(snap);
      logRevision(rev.table_name, "restore", snap);
      return { data: snap, error: null };
    }
    return { data: null, error: { message: "function public." + name + " does not exist" } };
  },
  from: (t) => builder(t),
  storage: {
    from: (bucket) => ({
      upload: async (path, file) => {
        window.__LOG.push(["upload", bucket, path, file && file.type]);
        if (bucket !== "pgc-media") return { data: null, error: { message: "Bucket not found" } };
        if (!canEdit()) return { data: null, error: { message: "new row violates row-level security policy" } };
        return { data: { path }, error: null };
      },
      getPublicUrl: (path) => ({ data: { publicUrl: "https://stub.local/storage/v1/object/public/" + bucket + "/" + path } }),
      remove: async () => ({ error: canPublish() ? null : { message: "not allowed" } }),
    }),
  },
};
export const SUPABASE_URL = "https://stub.local";
export const SUPABASE_KEY = "stub";
export const PGC_MODULE = "pgc";
export const PGC_BUCKET = "pgc-media";
export function assetSrc(v) { return v ? (/^(https?:|data:)/.test(v) ? v : "/" + String(v).replace(/^(\.\.\/|\.\/|\/)+/, "")) : null; }
