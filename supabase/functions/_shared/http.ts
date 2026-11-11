export function isAllowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

export function corsHeaders(request) {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  });

  if (!origin) headers.set("Access-Control-Allow-Origin", "*");
  else if (isAllowedOrigin(request)) headers.set("Access-Control-Allow-Origin", origin);

  return headers;
}

export function jsonResponse(request, body, status = 200) {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

export function preflightResponse(request) {
  return new Response("ok", { status: 204, headers: corsHeaders(request) });
}