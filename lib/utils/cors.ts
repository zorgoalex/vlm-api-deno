/**
 * CORS utilities for Deno Deploy
 */

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8000",
  "http://127.0.0.1:3000",
];

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";

  // Get allowed origins from env
  const envOrigins = Deno.env.get("ALLOWED_ORIGINS");
  const allowedOrigins = new Set<string>([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(envOrigins ? envOrigins.split(",").map((s) => s.trim()).filter(Boolean) : []),
    ...(Deno.env.get("APP_URL") ? [Deno.env.get("APP_URL")!] : []),
  ]);

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token, X-Nonce",
    "Access-Control-Max-Age": "86400",
  };

  // Set origin if allowed
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  } else if (!origin) {
    // No origin header (non-browser request)
    headers["Access-Control-Allow-Origin"] = "*";
  }

  return headers;
}

export function corsResponse(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(req),
  });
}
