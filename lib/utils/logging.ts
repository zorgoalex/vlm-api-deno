/**
 * Structured logging utilities
 */

export function log(data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      deployment_id: Deno.env.get("DENO_DEPLOYMENT_ID") || "local",
      ...data,
    })
  );
}

export function logInfo(data: Record<string, unknown>): void {
  log({ level: "info", ...data });
}

export function logWarn(data: Record<string, unknown>): void {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      deployment_id: Deno.env.get("DENO_DEPLOYMENT_ID") || "local",
      ...data,
    })
  );
}

export function logError(data: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      deployment_id: Deno.env.get("DENO_DEPLOYMENT_ID") || "local",
      ...data,
    })
  );
}

export function logRequest(
  req: Request,
  status: number,
  latencyMs: number,
  extra?: Record<string, unknown>
): void {
  const url = new URL(req.url);
  logInfo({
    type: "request",
    method: req.method,
    path: url.pathname,
    status,
    latency_ms: latencyMs,
    ...extra,
  });
}
