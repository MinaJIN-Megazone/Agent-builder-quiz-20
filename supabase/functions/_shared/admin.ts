import { createClient } from "npm:@supabase/supabase-js@2";

function getSecretKey() {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;

  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  const key = secretKeys.default ?? Object.values(secretKeys)[0];
  if (typeof key !== "string" || !key) throw new Error("Supabase server key is not configured.");
  return key;
}

export function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("Supabase URL is not configured.");

  return createClient(url, getSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}