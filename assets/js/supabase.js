/* Shared Supabase client for the public site and the employee portal.
   The publishable key is meant to be in the browser: every write is gated by
   Row Level Security, and anonymous visitors can only read published rows.
   Never put a service-role key in this repository. */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

export const SUPABASE_URL = "https://xpelcuegqtpvojnjetkt.supabase.co";
export const SUPABASE_KEY = "sb_publishable_ikPGzv-l0gnyKIrPSYnkjA_74v54gC3";

/* The module ARI's access model grants for this site. */
export const PGC_MODULE = "pgc";
export const PGC_BUCKET = "pgc-media";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* Resolve a stored image reference (absolute URL, bucket path or repo path). */
export function assetSrc(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^(https?:|data:)/i.test(s)) return s;
  if (s.startsWith("/")) return s;
  return "/" + s.replace(/^(\.\.\/|\.\/)+/, "");
}
