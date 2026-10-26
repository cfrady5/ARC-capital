// Mailchimp integration for pgc.capital (Proving Ground Capital). Adapted from
// ARI's supabase/functions/mailchimp (cfrady5/ARI); same actions, a separate
// audience and separate tables (pgc_campaigns, pgc_campaign_templates).
//
// The public site never talks to Mailchimp directly and never loads Mailchimp
// scripts: the API key lives here as an Edge Function secret and the browser
// only ever posts an email address (public) or a signed-in request (portal).
//
// Actions (POST JSON { action, ... }; "subscribe" is the default):
//   subscribe   – public. Adds the address to the audience with double opt-in
//                 (Mailchimp emails a confirmation link; nothing is subscribed
//                 until it is clicked). Never re-subscribes an unsubscribed
//                 address.
//   stats       – pgc_newsletter module (contributor+). Audience totals + last sends.
//   preview     – newsletter module. Renders a campaign (saved row or unsaved
//                 draft) to HTML/text with warnings.
//   test_send   – newsletter module. Pushes the campaign to Mailchimp and
//                 sends a test to the caller's own address.
//   send        – newsletter PUBLISHER. Re-syncs, runs Mailchimp's send
//                 checklist, then sends now or schedules (schedule_time).
//   unschedule  – newsletter publisher. Cancels a scheduled send.
//   refresh     – newsletter module. Pulls status/emails_sent for scheduled
//                 and sent rows back from Mailchimp.
//   reports     – newsletter module. Sent campaigns + audience growth, or one
//                 campaign's report with click details and timeline.
//   members     – newsletter module. A page of audience members (50, by
//                 last change) or a search by email/name; optional status;
//                 segment_id narrows to one group (tag/segment).
//   segments    – newsletter module. Tags and segments with counts + stats.
//                 "Groups" in the portal are Mailchimp tags (static segments).
//   create_group – newsletter PUBLISHER. { name } → a new empty tag.
//   delete_group – newsletter PUBLISHER. { segment_id } → removes a tag
//                 (contacts stay in the audience).
//   add_member  – newsletter PUBLISHER. Adds a contact as "pending" (double
//                 opt-in) tagged "Portal" (+ optional tags = groups); never
//                 re-subscribes anyone.
//   diagnose    – newsletter module. Read-only: account, whether the From
//                 domain is verified/authenticated, Mailchimp's send checklist.
//
// Deployed with verify_jwt: false (subscribe is public; every other action
// resolves the caller through rpc/my_access with the caller's own token).
// Access is the pgc_newsletter module (contributor | publisher); ARI
// administrators have it implicitly, like the other non-explicit modules.
//
// Edge Function secrets (Supabase dashboard → Edge Functions → Secrets):
//   MAILCHIMP_API_KEY          – shared with ARI's mailchimp function (same account)
//   MAILCHIMP_SERVER_PREFIX    – optional; derived from the key when omitted
//   PGC_MAILCHIMP_AUDIENCE_ID  – the PGC audience: Audience → Settings → "Audience name and defaults"
//   PGC_MAILCHIMP_TAGS         – optional comma-separated tags for website sign-ups
//                                (defaults to "PGC Website")
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Web Crypto has no MD5, which Mailchimp uses for member ids; @std/crypto adds it.
import { crypto as stdCrypto } from "jsr:@std/crypto@^1/crypto";
import { renderCampaign, normalizeCampaign, RENDER_VERSION, type Campaign, type Post, type Event, type Block, type Theme } from "./render.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function secrets() {
  const key = (Deno.env.get("MAILCHIMP_API_KEY") || "").trim();
  const list = (Deno.env.get("PGC_MAILCHIMP_AUDIENCE_ID") || "").trim();
  let dc = (Deno.env.get("MAILCHIMP_SERVER_PREFIX") || "").trim();
  if (!dc && key.includes("-")) dc = key.slice(key.lastIndexOf("-") + 1);
  const missing = [!key && "MAILCHIMP_API_KEY", !list && "PGC_MAILCHIMP_AUDIENCE_ID", key && !dc && "MAILCHIMP_SERVER_PREFIX"].filter(Boolean) as string[];
  return { key, list, dc, missing };
}
function config() {
  const { key, list, dc, missing } = secrets();
  if (missing.length) return null;
  const tags = (Deno.env.get("PGC_MAILCHIMP_TAGS") || "PGC Website").split(",").map((t) => t.trim()).filter(Boolean);
  return { key, list, dc, tags };
}
type Cfg = NonNullable<ReturnType<typeof config>>;
// Names the secret(s) to set instead of a generic "not connected".
function notConfigured() {
  const { missing } = secrets();
  return json({ error: "Mailchimp isn’t connected yet — set the " + missing.join(", ") + " secret" + (missing.length > 1 ? "s" : "") + " on the pgc-mailchimp function.", missing }, 503);
}

async function md5Hex(s: string) {
  const buf = await stdCrypto.subtle.digest("MD5", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
type Any = any;
async function mc(cfg: Cfg, method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Any }> {
  const r = await fetch(`https://${cfg.dc}.api.mailchimp.com/3.0${path}`, {
    method,
    headers: {
      Authorization: "Basic " + btoa("anystring:" + cfg.key),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data: Any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}
function mcDetail(r: { status: number; data: Any }) {
  const d = r.data || {};
  return (d.detail || d.title || ("Mailchimp error " + r.status)) as string;
}

// Database access as the service role (bypasses RLS; the guard trigger lets
// the server write the Mailchimp columns). Only ever called after the
// caller's own access has been checked.
async function db(method: string, path: string, body?: unknown, prefer = "return=representation"): Promise<{ ok: boolean; status: number; data: Any }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data: Any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) console.error("DB", method, path, r.status, text);
  return { ok: r.ok, status: r.status, data };
}

// Best-effort throttle per address/IP. Isolates are short-lived, so this only
// blunts bursts; Mailchimp's own limits are the real backstop.
const recent = new Map<string, number[]>();
function throttled(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const hits = (recent.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  recent.set(key, hits);
  return hits.length > limit;
}

// ---------- subscribe (public) ----------
async function subscribe(req: Request, body: Record<string, unknown>) {
  // Honeypot: bots fill this hidden field. Pretend success, do nothing.
  if ((body.company_website || "").toString().trim()) return json({ ok: true, state: "pending" });

  const str = (k: string, max = 120) => (body[k] == null ? "" : String(body[k])).trim().slice(0, max);
  const email = str("email", 254).toLowerCase();
  const first = str("first_name");
  const last = str("last_name");
  const source = str("source", 60) || "website";
  if (!email || !EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (throttled("ip:" + (ip || "unknown"), 8, 10 * 60_000) || throttled("email:" + email, 3, 10 * 60_000)) {
    return json({ error: "Too many sign-up attempts. Please try again in a few minutes." }, 429);
  }

  const cfg = config();
  if (!cfg) {
    console.error("Mailchimp secrets are not configured");
    return json({ error: "Newsletter sign-up isn’t available right now. Please try again later." }, 503);
  }

  const hash = await md5Hex(email);
  const payload: Record<string, unknown> = {
    email_address: email,
    // New addresses are "pending" until they click Mailchimp's confirmation
    // email (double opt-in). Existing members keep whatever status they have,
    // so an unsubscribed person is never silently re-added.
    status_if_new: "pending",
    merge_fields: { ...(first ? { FNAME: first } : {}), ...(last ? { LNAME: last } : {}) },
    tags: cfg.tags,
  };
  if (ip) payload.ip_signup = ip;

  const r = await mc(cfg, "PUT", `/lists/${cfg.list}/members/${hash}?skip_merge_validation=true`, payload);
  if (!r.ok) {
    const d = r.data as { title?: string; detail?: string };
    console.error("Mailchimp subscribe failed", r.status, JSON.stringify(d));
    if (r.status === 400 && /looks fake|invalid/i.test(d.detail || "")) {
      return json({ error: "That email address was rejected. Please check it and try again." }, 400);
    }
    if (r.status === 400 && /compliance state|permanently deleted|forgotten/i.test(d.detail || "")) {
      return json({ error: "This address can’t be re-added automatically. Please email innovations@theari.us to subscribe." }, 400);
    }
    return json({ error: "We couldn’t complete your sign-up right now. Please try again later." }, 502);
  }

  const status = String((r.data as { status?: string }).status || "pending");
  if (status === "subscribed") return json({ ok: true, state: "subscribed" });
  if (status === "unsubscribed" || status === "cleaned" || status === "archived") {
    // Do not resubscribe on their behalf; Mailchimp requires the person to
    // opt back in through a hosted form or the confirmation flow.
    return json({ ok: true, state: "unsubscribed" });
  }
  return json({ ok: true, state: "pending", source });
}

// ---------- caller identity (portal actions) ----------
interface Caller { email: string; isAdmin: boolean; canEdit: boolean; canPublish: boolean; }
async function callerAccess(req: Request): Promise<Caller | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === ANON) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_access`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return null;
  const a = await r.json().catch(() => null) as { email?: string; role?: string; status?: string; modules?: Record<string, string> } | null;
  if (!a || a.status !== "active" || !a.email) return null;
  // pgc_newsletter is a regular module: administrators have it, others need the grant.
  const isAdmin = a.role === "admin";
  const level = isAdmin ? "publisher" : ((a.modules || {}).pgc_newsletter || null);
  return { email: String(a.email).toLowerCase(), isAdmin, canEdit: level === "contributor" || level === "publisher", canPublish: level === "publisher" };
}
function denied(who: Caller | null, publish = false) {
  if (!who) return json({ error: "Sign in again." }, 401);
  if (!who.canEdit) return json({ error: "You don’t have access to Proving Ground Capital email campaigns." }, 403);
  if (publish && !who.canPublish) return json({ error: "Only an email campaigns publisher can do that." }, 403);
  return null;
}

// ---------- audience stats ----------
async function audienceStats(cfg: Cfg) {
  const list = await mc(cfg, "GET", `/lists/${cfg.list}?fields=id,name,stats.member_count,stats.unsubscribe_count,stats.cleaned_count,stats.campaign_count,stats.campaign_last_sent,stats.open_rate,stats.click_rate,stats.member_count_since_send,date_created`);
  if (!list.ok) return null;
  const s = list.data.stats || {};
  return {
    audience: { id: cfg.list, name: list.data.name || "", server: cfg.dc },
    stats: {
      members: Number(s.member_count || 0), unsubscribed: Number(s.unsubscribe_count || 0), cleaned: Number(s.cleaned_count || 0),
      campaigns: Number(s.campaign_count || 0), lastSent: s.campaign_last_sent || null,
      openRate: Number(s.open_rate || 0), clickRate: Number(s.click_rate || 0), newSinceSend: Number(s.member_count_since_send || 0),
    },
  };
}
function campaignSummary(c: Any) {
  return {
    id: c.id, webId: c.web_id || null,
    title: (c.settings && (c.settings.title || c.settings.subject_line)) || "(untitled)",
    subject: (c.settings && c.settings.subject_line) || "",
    status: c.status || null, sentAt: c.send_time || null, emailsSent: Number(c.emails_sent || 0),
    openRate: Number((c.report_summary && c.report_summary.open_rate) || 0),
    clickRate: Number((c.report_summary && c.report_summary.click_rate) || 0),
    archiveUrl: c.archive_url || null,
  };
}
const CAMPAIGN_FIELDS = "campaigns.id,campaigns.web_id,campaigns.status,campaigns.settings.title,campaigns.settings.subject_line,campaigns.send_time,campaigns.emails_sent,campaigns.report_summary.open_rate,campaigns.report_summary.click_rate,campaigns.archive_url";

async function stats(req: Request) {
  const who = await callerAccess(req);
  const d = denied(who); if (d) return d;
  const cfg = config();
  if (!cfg) return json({ configured: false });
  const [a, campaigns] = await Promise.all([
    audienceStats(cfg),
    mc(cfg, "GET", `/campaigns?list_id=${cfg.list}&status=sent&sort_field=send_time&sort_dir=DESC&count=5&fields=${CAMPAIGN_FIELDS}`),
  ]);
  if (!a) return json({ error: "Mailchimp didn’t answer. Check the API key and audience ID in the Edge Function secrets." }, 502);
  return json({ configured: true, ...a, campaigns: ((campaigns.ok && campaigns.data.campaigns) || []).map(campaignSummary) });
}

// ---------- campaigns ----------
interface Row {
  id: string; title: string; subject: string; preview_text: string; from_name: string; reply_to: string; template: string;
  content: Any; status: string; mailchimp_id: string | null; mailchimp_web_id: number | null; scheduled_for: string | null;
  sent_at: string | null; emails_sent: number | null; test_sent_at: string | null; test_sent_to: string | null;
  segment_id: number | null; segment_name: string | null;
  created_by: string | null; updated_at: string;
}
async function loadRow(id: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await db("GET", `pgc_campaigns?id=eq.${id}&select=*&limit=1`);
  return r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0] as Row : null;
}
async function saveRow(id: string, patch: Record<string, unknown>) {
  const r = await db("PATCH", `pgc_campaigns?id=eq.${id}`, patch);
  return r.ok && Array.isArray(r.data) ? r.data[0] as Row : null;
}
function campaignFrom(src: Any): Campaign {
  // Shared with the portal canvas (render.ts): strict mode drops blocks that cannot be sent.
  return normalizeCampaign(src, true);
}
// PGC has no brand-kit themes and no newsroom/events tables: every campaign uses
// the PGC palette, and post/event blocks (an ARI feature kept in the shared
// renderer) are never produced by the PGC composer, so they resolve to nothing.
async function loadTheme(_themeId?: string): Promise<Theme | null> { return null; }
async function loadRefs(_blocks: Block[]) {
  return { posts: new Map<string, Post>(), events: new Map<string, Event>() };
}
async function render(src: Any) {
  const c = campaignFrom(src);
  const [refs, theme] = await Promise.all([loadRefs(c.content!.blocks || []), loadTheme((c.content as Any).theme_id)]);
  return { campaign: c, ...renderCampaign(c, refs.posts, refs.events, theme) };
}

async function preview(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who); if (d) return d;
  let src: Any = body.campaign;
  if (body.campaign_id) { src = await loadRow(String(body.campaign_id)); if (!src) return json({ error: "Campaign not found." }, 404); }
  if (!src || typeof src !== "object") return json({ error: "Nothing to preview." }, 400);
  const out = await render(src);
  return json({ ok: true, html: out.html, text: out.text, warnings: out.warnings, subject: out.campaign.subject, renderer: RENDER_VERSION });
}

// Create or update the Mailchimp campaign for a row and push its content.
async function syncCampaign(cfg: Cfg, row: Row) {
  const out = await render(row);
  const settings = {
    subject_line: out.campaign.subject || row.title, preview_text: out.campaign.preview_text, title: row.title,
    from_name: out.campaign.from_name, reply_to: (row.reply_to || "innovations@theari.us").trim(),
    auto_footer: false, inline_css: false,
  };
  // Recipients: the whole audience, or one group (a saved/static segment id kept on the row).
  const segmentId = Number(row.segment_id) > 0 ? Number(row.segment_id) : null;
  const recipients: Any = { list_id: cfg.list, ...(segmentId ? { segment_opts: { saved_segment_id: segmentId } } : {}) };
  let id = row.mailchimp_id, webId = row.mailchimp_web_id;
  let existing: Any = null;
  if (id) {
    const g = await mc(cfg, "GET", `/campaigns/${id}?fields=id,web_id,status`);
    if (g.ok) existing = g.data; else if (g.status === 404) { id = null; webId = null; } else throw new Error(mcDetail(g));
  }
  if (existing && ["sent", "sending", "canceling"].includes(existing.status)) {
    throw new Error("This campaign has already been sent in Mailchimp.");
  }
  if (existing && existing.status === "schedule") {
    throw new Error("This campaign is scheduled in Mailchimp. Unschedule it before making changes.");
  }
  if (id) {
    const u = await mc(cfg, "PATCH", `/campaigns/${id}`, { settings, recipients });
    if (!u.ok) throw new Error(mcDetail(u));
  } else {
    const c = await mc(cfg, "POST", `/campaigns`, {
      type: "regular", recipients, settings,
      tracking: { opens: true, html_clicks: true, text_clicks: false },
    });
    if (!c.ok) throw new Error(mcDetail(c));
    id = c.data.id; webId = c.data.web_id || null;
  }
  const content = await mc(cfg, "PUT", `/campaigns/${id}/content`, { html: out.html, plain_text: out.text });
  if (!content.ok) throw new Error(mcDetail(content));
  if (id !== row.mailchimp_id || webId !== row.mailchimp_web_id) await saveRow(row.id, { mailchimp_id: id, mailchimp_web_id: webId });
  return { id: id as string, webId, warnings: out.warnings };
}

async function testSend(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who); if (d) return d;
  const cfg = config(); if (!cfg) return notConfigured();
  const row = await loadRow(String(body.campaign_id || "")); if (!row) return json({ error: "Campaign not found." }, 404);
  if (row.status === "sent" || row.status === "scheduled") return json({ error: "This campaign is already " + row.status + "." }, 409);
  if (!(row.subject || "").trim()) return json({ error: "Add a subject line before sending a test." }, 400);
  if (throttled("test:" + who!.email, 12, 60 * 60_000)) return json({ error: "Too many test sends. Please wait a while." }, 429);
  // Recipients: the addresses the sender typed (up to 10), or their own.
  const raw = Array.isArray(body.emails) ? body.emails : [];
  const emails = [...new Set(raw.map((x) => String(x || "").trim().toLowerCase()).filter((x) => x && EMAIL_RE.test(x) && x.length <= 254))].slice(0, 10);
  if (raw.length && !emails.length) return json({ error: "None of those test addresses look valid." }, 400);
  const to = emails.length ? emails : [who!.email];
  let synced;
  try { synced = await syncCampaign(cfg, row); } catch (e) { return json({ error: String((e as Error).message || e) }, 502); }
  const t = await mc(cfg, "POST", `/campaigns/${synced.id}/actions/test`, { test_emails: to, send_type: "html" });
  if (!t.ok) return json({ error: "Mailchimp refused the test send: " + mcDetail(t) }, 502);
  const at = new Date().toISOString();
  const updated = await saveRow(row.id, { test_sent_at: at, test_sent_to: to.join(", ") });
  return json({ ok: true, sentTo: to.join(", "), emails: to, warnings: synced.warnings, row: updated });
}

function nextQuarterHour(iso: string) {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  const ms = 15 * 60_000;
  return new Date(Math.ceil(t.getTime() / ms) * ms);
}
async function logActivity(actor: string, action: string, detail: Record<string, unknown>) {
  await db("POST", "admin_activity", { actor_email: actor, action, target_email: null, detail }, "return=minimal");
}

async function send(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who, true); if (d) return d;
  const cfg = config(); if (!cfg) return notConfigured();
  const row = await loadRow(String(body.campaign_id || "")); if (!row) return json({ error: "Campaign not found." }, 404);
  if (row.status === "sent") return json({ error: "This campaign has already been sent." }, 409);
  if (row.status === "scheduled") return json({ error: "This campaign is already scheduled. Unschedule it first to change it." }, 409);
  if (!(row.subject || "").trim()) return json({ error: "Add a subject line first." }, 400);
  // A test must have gone out after the last edit.
  const tested = row.test_sent_at ? new Date(row.test_sent_at).getTime() : 0;
  const edited = new Date(row.updated_at).getTime();
  if (!tested || tested < edited - 5000) return json({ error: "Send yourself a test email after your last change before sending to the audience." }, 400);

  let when: Date | null = null;
  if (body.schedule_time) {
    when = nextQuarterHour(String(body.schedule_time));
    if (!when) return json({ error: "That schedule time isn’t valid." }, 400);
    if (when.getTime() < Date.now() + 5 * 60_000) return json({ error: "Schedule at least a few minutes in the future." }, 400);
  }
  // The audience can be chosen in Review & send (a group, or everyone) without counting as an edit that
  // needs a new test: it travels with this request, is applied to the Mailchimp campaign and kept on the row.
  if ("segment_id" in body) {
    const sid = Number(body.segment_id) > 0 ? Math.floor(Number(body.segment_id)) : null;
    row.segment_id = sid;
    row.segment_name = sid ? String(body.segment_name || "").slice(0, 100) || null : null;
  }
  let synced;
  try { synced = await syncCampaign(cfg, row); } catch (e) { return json({ error: String((e as Error).message || e) }, 502); }
  const check = await mc(cfg, "GET", `/campaigns/${synced.id}/send-checklist`);
  if (!check.ok) return json({ error: "Couldn’t run Mailchimp’s send checklist: " + mcDetail(check) }, 502);
  const items = ((check.data.items || []) as Any[]).map((i) => ({ type: i.type, heading: i.heading, details: i.details }));
  if (!check.data.is_ready) {
    return json({ error: "Mailchimp’s checklist isn’t clear yet. Fix the items below in Mailchimp and try again.", checklist: items.filter((i) => i.type === "error") }, 409);
  }
  if (when) {
    const s = await mc(cfg, "POST", `/campaigns/${synced.id}/actions/schedule`, { schedule_time: when.toISOString() });
    if (!s.ok) return json({ error: "Mailchimp couldn’t schedule it: " + mcDetail(s) }, 502);
    const updated = await saveRow(row.id, { status: "scheduled", scheduled_for: when.toISOString(), segment_id: row.segment_id, segment_name: row.segment_name });
    await logActivity(who!.email, "pgc_newsletter_scheduled", { campaign_id: row.id, mailchimp_id: synced.id, subject: row.subject, scheduled_for: when.toISOString() });
    return json({ ok: true, scheduled: true, scheduledFor: when.toISOString(), warnings: synced.warnings, row: updated });
  }
  const s = await mc(cfg, "POST", `/campaigns/${synced.id}/actions/send`);
  if (!s.ok) return json({ error: "Mailchimp couldn’t send it: " + mcDetail(s) }, 502);
  const g = await mc(cfg, "GET", `/campaigns/${synced.id}?fields=status,send_time,emails_sent`);
  const updated = await saveRow(row.id, { status: "sent", sent_at: (g.ok && g.data.send_time) || new Date().toISOString(), emails_sent: g.ok ? Number(g.data.emails_sent || 0) : null, scheduled_for: null, segment_id: row.segment_id, segment_name: row.segment_name });
  await logActivity(who!.email, "pgc_newsletter_sent", { campaign_id: row.id, mailchimp_id: synced.id, subject: row.subject });
  return json({ ok: true, sent: true, warnings: synced.warnings, row: updated });
}

async function unschedule(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who, true); if (d) return d;
  const cfg = config(); if (!cfg) return notConfigured();
  const row = await loadRow(String(body.campaign_id || "")); if (!row) return json({ error: "Campaign not found." }, 404);
  if (row.status !== "scheduled" || !row.mailchimp_id) return json({ error: "This campaign isn’t scheduled." }, 409);
  const u = await mc(cfg, "POST", `/campaigns/${row.mailchimp_id}/actions/unschedule`);
  if (!u.ok && u.status !== 404) {
    // Already sent meanwhile? Reflect that instead of failing.
    const g = await mc(cfg, "GET", `/campaigns/${row.mailchimp_id}?fields=status,send_time,emails_sent`);
    if (g.ok && g.data.status === "sent") {
      const updated = await saveRow(row.id, { status: "sent", sent_at: g.data.send_time, emails_sent: Number(g.data.emails_sent || 0), scheduled_for: null });
      return json({ ok: false, error: "Too late: Mailchimp already sent this campaign.", row: updated }, 409);
    }
    return json({ error: "Mailchimp couldn’t unschedule it: " + mcDetail(u) }, 502);
  }
  const updated = await saveRow(row.id, { status: "draft", scheduled_for: null });
  await logActivity(who!.email, "pgc_newsletter_unscheduled", { campaign_id: row.id, mailchimp_id: row.mailchimp_id, subject: row.subject });
  return json({ ok: true, row: updated });
}

// Pull Mailchimp's view of scheduled/sent rows back into the table.
async function refresh(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who); if (d) return d;
  const cfg = config(); if (!cfg) return json({ ok: true, rows: [] });
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
  if (!ids.length) return json({ ok: true, rows: [] });
  const r = await db("GET", `pgc_campaigns?id=in.(${ids.join(",")})&status=in.(scheduled,sent)&mailchimp_id=not.is.null&select=*`);
  const rows: Row[] = r.ok && Array.isArray(r.data) ? r.data : [];
  const out: Row[] = [];
  for (const row of rows) {
    const g = await mc(cfg, "GET", `/campaigns/${row.mailchimp_id}?fields=status,send_time,emails_sent`);
    if (!g.ok) continue;
    const st = g.data.status;
    let patch: Record<string, unknown> | null = null;
    if (st === "sent" && (row.status !== "sent" || row.emails_sent !== Number(g.data.emails_sent || 0))) patch = { status: "sent", sent_at: g.data.send_time || row.sent_at || new Date().toISOString(), emails_sent: Number(g.data.emails_sent || 0), scheduled_for: null };
    else if ((st === "save" || st === "paused") && row.status === "scheduled") patch = { status: "draft", scheduled_for: null };
    if (patch) { const u = await saveRow(row.id, patch); if (u) out.push(u); }
  }
  return json({ ok: true, rows: out });
}

async function reports(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who); if (d) return d;
  const cfg = config(); if (!cfg) return json({ configured: false });
  const id = body.campaign_id ? String(body.campaign_id) : "";
  if (id) {
    if (!/^[0-9a-z]+$/i.test(id)) return json({ error: "Bad campaign id." }, 400);
    const [rep, clicks, camp] = await Promise.all([
      mc(cfg, "GET", `/reports/${id}`),
      mc(cfg, "GET", `/reports/${id}/click-details?count=25&sort_field=total_clicks&sort_dir=DESC`),
      mc(cfg, "GET", `/campaigns/${id}?fields=id,web_id,status,settings.title,settings.subject_line,send_time,emails_sent,archive_url`),
    ]);
    if (!rep.ok) return json({ error: "Mailchimp has no report for that campaign yet: " + mcDetail(rep) }, 502);
    const R = rep.data;
    return json({
      configured: true,
      campaign: camp.ok ? campaignSummary(camp.data) : { id },
      report: {
        emailsSent: Number(R.emails_sent || 0), sentAt: R.send_time || null,
        opens: { total: Number(R.opens?.opens_total || 0), unique: Number(R.opens?.unique_opens || 0), rate: Number(R.opens?.open_rate || 0), last: R.opens?.last_open || null },
        clicks: { total: Number(R.clicks?.clicks_total || 0), unique: Number(R.clicks?.unique_clicks || 0), subscribers: Number(R.clicks?.unique_subscriber_clicks || 0), rate: Number(R.clicks?.click_rate || 0), last: R.clicks?.last_click || null },
        unsubscribed: Number(R.unsubscribed || 0), abuse: Number(R.abuse_reports || 0),
        bounces: { hard: Number(R.bounces?.hard_bounces || 0), soft: Number(R.bounces?.soft_bounces || 0), syntax: Number(R.bounces?.syntax_errors || 0) },
        forwards: Number(R.forwards?.forwards_count || 0),
        listStats: R.list_stats ? { openRate: Number(R.list_stats.open_rate || 0), clickRate: Number(R.list_stats.click_rate || 0) } : null,
        timeseries: ((R.timeseries || []) as Any[]).map((t) => ({ at: t.timestamp, sent: Number(t.emails_sent || 0), opens: Number(t.unique_opens || 0), clicks: Number(t.recipients_clicks || 0) })),
      },
      links: (((clicks.ok && clicks.data.urls_clicked) || []) as Any[]).map((u) => ({ url: u.url, total: Number(u.total_clicks || 0), unique: Number(u.unique_clicks || 0), pct: Number(u.click_percentage || 0) })),
    });
  }
  const [a, campaigns, growth] = await Promise.all([
    audienceStats(cfg),
    mc(cfg, "GET", `/campaigns?list_id=${cfg.list}&status=sent&sort_field=send_time&sort_dir=DESC&count=50&fields=${CAMPAIGN_FIELDS}`),
    mc(cfg, "GET", `/lists/${cfg.list}/growth-history?count=12&sort_field=month&sort_dir=DESC`),
  ]);
  if (!a) return json({ error: "Mailchimp didn’t answer. Check the API key and audience ID in the Edge Function secrets." }, 502);
  return json({
    configured: true, ...a,
    campaigns: ((campaigns.ok && campaigns.data.campaigns) || []).map(campaignSummary),
    growth: (((growth.ok && growth.data.history) || []) as Any[]).map((h) => ({ month: h.month, subscribed: Number(h.subscribed || 0), unsubscribed: Number(h.unsubscribed || 0), cleaned: Number(h.cleaned || 0), optins: Number(h.optins || 0), pending: Number(h.pending || 0) })).reverse(),
  });
}

// ---------- diagnose: why a test or send might not arrive ----------
// Read-only. Reports the account, whether the From domain is verified and
// authenticated in Mailchimp, and Mailchimp's own send checklist for the
// campaign. No secrets are returned.
async function diagnose(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who); if (d) return d;
  const cfg = config();
  if (!cfg) {
    // With the shared API key in place, list the account's audiences so an
    // admin can pick the ID for PGC_MAILCHIMP_AUDIENCE_ID.
    const s = secrets();
    let audiences: { id: string; name: string; members: number }[] = [];
    if (s.key && s.dc) {
      const r = await mc({ key: s.key, dc: s.dc, list: "", tags: [] }, "GET", `/lists?count=50&fields=lists.id,lists.name,lists.stats.member_count`);
      if (r.ok) audiences = ((r.data.lists || []) as Any[]).map((l) => ({ id: String(l.id), name: String(l.name || ""), members: Number(l.stats && l.stats.member_count || 0) }));
    }
    return json({ configured: false, missing: s.missing, audiences });
  }
  const row = body.campaign_id ? await loadRow(String(body.campaign_id)) : null;
  const fromEmail = ((row && row.reply_to) || "innovations@theari.us").trim().toLowerCase();
  const fromDomain = fromEmail.split("@")[1] || "";
  const [acct, doms, list, check] = await Promise.all([
    mc(cfg, "GET", `/?fields=account_name,email,pricing_plan_type,first_payment,account_timezone,contact.company`),
    mc(cfg, "GET", `/verified-domains`),
    mc(cfg, "GET", `/lists/${cfg.list}?fields=name,campaign_defaults.from_email,campaign_defaults.from_name,stats.member_count`),
    row && row.mailchimp_id ? mc(cfg, "GET", `/campaigns/${row.mailchimp_id}/send-checklist`) : Promise.resolve(null),
  ]);
  const domains = (((doms.ok && doms.data.domains) || []) as Any[]).map((x) => ({ domain: String(x.domain || "").toLowerCase(), verified: !!x.verified, authenticated: !!x.authenticated }));
  const mine = domains.find((x) => x.domain === fromDomain) || null;
  const items = check && check.ok ? ((check.data.items || []) as Any[]).map((i) => ({ type: i.type, heading: i.heading, details: i.details })) : [];
  return json({
    configured: true,
    account: acct.ok ? { name: acct.data.account_name || "", email: String(acct.data.email || "").toLowerCase(), plan: acct.data.pricing_plan_type || "", company: acct.data.contact && acct.data.contact.company || "" } : null,
    audience: list.ok ? { name: list.data.name, members: Number(list.data.stats && list.data.stats.member_count || 0), defaultFrom: String(list.data.campaign_defaults && list.data.campaign_defaults.from_email || "").toLowerCase() } : null,
    from: { email: fromEmail, domain: fromDomain, verified: !!(mine && mine.verified), authenticated: !!(mine && mine.authenticated), known: !!mine },
    domains,
    campaign: row ? { id: row.id, mailchimpId: row.mailchimp_id, status: row.status, testSentAt: row.test_sent_at, testSentTo: row.test_sent_to } : null,
    checklist: { ready: check && check.ok ? !!check.data.is_ready : null, items },
    server: cfg.dc,
  });
}

// ---------- email lists (audience members, segments, add contact) ----------
function memberSummary(m: Any) {
  const mf = m.merge_fields || {};
  return {
    id: m.id, email: m.email_address, name: (m.full_name || [mf.FNAME, mf.LNAME].filter(Boolean).join(" ") || "").trim(),
    status: m.status, optedIn: m.timestamp_opt || m.timestamp_signup || null, changed: m.last_changed || null,
    tags: ((m.tags || []) as Any[]).map((t) => t.name).filter(Boolean),
  };
}
const MEMBER_FIELDS = "members.id,members.email_address,members.full_name,members.status,members.timestamp_opt,members.timestamp_signup,members.last_changed,members.tags,members.merge_fields,total_items";
async function members(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who); if (d) return d;
  const cfg = config(); if (!cfg) return json({ configured: false, members: [], total: 0 });
  const q = String(body.q || "").trim().slice(0, 120);
  const status = ["subscribed", "unsubscribed", "cleaned", "pending"].includes(String(body.status || "")) ? String(body.status) : "";
  const offset = Math.max(0, Math.min(10000, Number(body.offset) || 0));
  const segmentId = Number(body.segment_id) > 0 ? Math.floor(Number(body.segment_id)) : 0;
  if (segmentId) {
    // One group: Mailchimp pages a segment's members itself (no search or status filter there).
    const r = await mc(cfg, "GET", `/lists/${cfg.list}/segments/${segmentId}/members?count=50&offset=${offset}&fields=${MEMBER_FIELDS}`);
    if (!r.ok) return json({ error: "Mailchimp didn’t answer: " + mcDetail(r) }, 502);
    const list = ((r.data.members || []) as Any[]).map(memberSummary).filter((m) => !status || m.status === status);
    return json({ configured: true, members: list, total: Number(r.data.total_items || 0), offset, segment_id: segmentId });
  }
  if (q) {
    const r = await mc(cfg, "GET", `/search-members?query=${encodeURIComponent(q)}&list_id=${cfg.list}&fields=exact_matches.members.id,exact_matches.members.email_address,exact_matches.members.full_name,exact_matches.members.status,exact_matches.members.timestamp_opt,exact_matches.members.timestamp_signup,exact_matches.members.last_changed,exact_matches.members.tags,exact_matches.members.merge_fields,full_search.members.id,full_search.members.email_address,full_search.members.full_name,full_search.members.status,full_search.members.timestamp_opt,full_search.members.timestamp_signup,full_search.members.last_changed,full_search.members.tags,full_search.members.merge_fields`);
    if (!r.ok) return json({ error: "Mailchimp search failed: " + mcDetail(r) }, 502);
    const seen = new Set<string>();
    const list = [...(r.data.exact_matches?.members || []), ...(r.data.full_search?.members || [])].filter((m: Any) => !seen.has(m.id) && seen.add(m.id)).filter((m: Any) => !status || m.status === status).map(memberSummary);
    return json({ configured: true, members: list, total: list.length, offset: 0, search: true });
  }
  const r = await mc(cfg, "GET", `/lists/${cfg.list}/members?count=50&offset=${offset}${status ? "&status=" + status : ""}&sort_field=last_changed&sort_dir=DESC&fields=${MEMBER_FIELDS}`);
  if (!r.ok) return json({ error: "Mailchimp didn’t answer: " + mcDetail(r) }, 502);
  return json({ configured: true, members: ((r.data.members || []) as Any[]).map(memberSummary), total: Number(r.data.total_items || 0), offset });
}
async function segments(req: Request) {
  const who = await callerAccess(req);
  const d = denied(who); if (d) return d;
  const cfg = config(); if (!cfg) return json({ configured: false, segments: [] });
  const [seg, a] = await Promise.all([
    mc(cfg, "GET", `/lists/${cfg.list}/segments?count=100&fields=segments.id,segments.name,segments.member_count,segments.type,segments.updated_at`),
    audienceStats(cfg),
  ]);
  return json({ configured: true, ...(a || {}), segments: ((seg.ok && seg.data.segments) || []).map((s: Any) => ({ id: s.id, name: s.name, count: Number(s.member_count || 0), type: s.type, updatedAt: s.updated_at })) });
}
// Groups are Mailchimp tags (static segments) on the one audience.
const cleanTags = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map((t) => String(t).trim().slice(0, 60)).filter(Boolean).slice(0, 5) : []);
async function createGroup(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who, true); if (d) return d;
  const cfg = config(); if (!cfg) return notConfigured();
  const name = String(body.name || "").trim().slice(0, 60);
  if (name.length < 2) return json({ error: "Give the group a name (2 to 60 characters)." }, 400);
  const r = await mc(cfg, "POST", `/lists/${cfg.list}/segments`, { name, static_segment: [] });
  if (!r.ok) return json({ error: "Mailchimp refused it: " + mcDetail(r) }, 502);
  await logActivity(who!.email, "pgc_newsletter_group_created", { segment_id: r.data.id, name });
  return json({ ok: true, group: { id: r.data.id, name: r.data.name || name, count: Number(r.data.member_count || 0), type: r.data.type || "static" } });
}
async function deleteGroup(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who, true); if (d) return d;
  const cfg = config(); if (!cfg) return notConfigured();
  const id = Number(body.segment_id) > 0 ? Math.floor(Number(body.segment_id)) : 0;
  if (!id) return json({ error: "Which group?" }, 400);
  const r = await mc(cfg, "DELETE", `/lists/${cfg.list}/segments/${id}`);
  if (!r.ok && r.status !== 404) return json({ error: "Mailchimp refused it: " + mcDetail(r) }, 502);
  await logActivity(who!.email, "pgc_newsletter_group_deleted", { segment_id: id });
  return json({ ok: true });
}
// A publisher adds a contact by hand. It goes in as "pending": Mailchimp emails
// the confirmation and nobody is subscribed without clicking it.
async function addMember(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who, true); if (d) return d;
  const cfg = config(); if (!cfg) return notConfigured();
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address." }, 400);
  const first = String(body.first_name || "").trim().slice(0, 120), last = String(body.last_name || "").trim().slice(0, 120);
  const hash = await md5Hex(email);
  const r = await mc(cfg, "PUT", `/lists/${cfg.list}/members/${hash}?skip_merge_validation=true`, {
    email_address: email, status_if_new: "pending", merge_fields: { ...(first ? { FNAME: first } : {}), ...(last ? { LNAME: last } : {}) }, tags: ["PGC Portal", ...cleanTags(body.tags)],
  });
  if (!r.ok) return json({ error: "Mailchimp refused it: " + mcDetail(r) }, 502);
  await logActivity(who!.email, "pgc_newsletter_contact_added", { email, status: r.data.status });
  return json({ ok: true, member: memberSummary(r.data), state: r.data.status });
}

// Bulk upload from the Email Lists page (publisher only): up to 500 contacts per
// call, batch-subscribed with the consent the publisher chose. "pending" sends
// Mailchimp's confirmation email; "subscribed" is for lists whose people
// already asked to hear from PGC. Existing members keep their status.
async function importMembers(req: Request, body: Record<string, unknown>) {
  const who = await callerAccess(req);
  const d = denied(who, true); if (d) return d;
  const cfg = config(); if (!cfg) return notConfigured();
  const rows = Array.isArray(body.members) ? (body.members as Any[]).slice(0, 500) : [];
  const status = body.status === "subscribed" ? "subscribed" : "pending";
  const extraTags = cleanTags(body.tags);
  const members: Any[] = [], errors: { email: string; error: string }[] = [], seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const email = String(r.email || "").trim().toLowerCase().slice(0, 254);
    if (!EMAIL_RE.test(email)) { errors.push({ email: email || "(blank)", error: "Not a valid email address." }); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    const first = String(r.first_name || "").trim().slice(0, 120), last = String(r.last_name || "").trim().slice(0, 120);
    members.push({ email_address: email, status_if_new: status, merge_fields: { ...(first ? { FNAME: first } : {}), ...(last ? { LNAME: last } : {}) }, tags: ["PGC Portal", ...extraTags] });
  }
  if (!members.length) return json({ error: "No valid email addresses in that batch.", errors }, 400);
  const r = await mc(cfg, "POST", `/lists/${cfg.list}?skip_merge_validation=true`, { members, update_existing: true });
  if (!r.ok) return json({ error: "Mailchimp refused it: " + mcDetail(r) }, 502);
  ((r.data && r.data.errors) || []).forEach((e: Any) => errors.push({ email: String(e.email_address || ""), error: String(e.error || "Rejected by Mailchimp.") }));
  const added = Number((r.data && r.data.total_created) || 0), updated = Number((r.data && r.data.total_updated) || 0);
  await logActivity(who!.email, "pgc_newsletter_contacts_imported", { sent: members.length, status, added, updated, errors: errors.length });
  return json({ ok: true, added, updated, sent: members.length, errors });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  const action = String(body.action || "subscribe");
  try {
    switch (action) {
      case "subscribe": return await subscribe(req, body);
      case "stats": return await stats(req);
      case "preview": return await preview(req, body);
      case "test_send": return await testSend(req, body);
      case "send": return await send(req, body);
      case "unschedule": return await unschedule(req, body);
      case "refresh": return await refresh(req, body);
      case "reports": return await reports(req, body);
      case "members": return await members(req, body);
      case "segments": return await segments(req);
      case "add_member": return await addMember(req, body);
      case "create_group": return await createGroup(req, body);
      case "delete_group": return await deleteGroup(req, body);
      case "import_members": return await importMembers(req, body);
      case "diagnose": return await diagnose(req, body);
      default: return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    console.error("pgc-mailchimp function error", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
