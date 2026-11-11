import { createAdminClient } from "../_shared/admin.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "origin_not_allowed" }, 403);
  if (request.method !== "GET") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_public_leaderboard");
    if (error) return jsonResponse(request, { error: "leaderboard_unavailable" }, 500);

    return jsonResponse(request, data ?? []);
  } catch {
    return jsonResponse(request, { error: "leaderboard_unavailable" }, 500);
  }
});