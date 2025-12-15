/**
 * Server-Sent Events (SSE) streaming helpers
 */

import { getCorsHeaders } from "../utils/cors.ts";

/**
 * Passthrough SSE stream from upstream provider
 * No timeout limitations on Deno Deploy!
 */
export function passthroughSSE(req: Request, upstreamResponse: Response): Response {
  if (!upstreamResponse.body) {
    throw new Error("Upstream response has no body");
  }

  return new Response(upstreamResponse.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      ...getCorsHeaders(req),
    },
  });
}

/**
 * Helper to write SSE event
 */
export function sseEvent(event: string | null, data: unknown): string {
  let output = "";
  if (event) output += `event: ${event}\n`;
  output += `data: ${JSON.stringify(data)}\n\n`;
  return output;
}
