import { createAdminClient } from "../_shared/admin.ts";
import { corsHeaders, isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "origin_not_allowed" }, 403);
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const department = typeof body.department === "string" ? body.department.trim() : "";
    if (!name || name.length > 60 || !department || department.length > 80) {
      return jsonResponse(request, { error: "invalid_participant" }, 400);
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("start_quiz", {
      _name: name,
      _department: department,
    });

    if (error) {
      const status = error.message.includes("event_closed") ? 410 : 400;
      return jsonResponse(request, { error: status === 410 ? "event_closed" : "could_not_start" }, status);
    }

    return jsonResponse(request, data);
  } catch {
    return jsonResponse(request, { error: "invalid_request" }, 400);
  }
});