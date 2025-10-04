/**
 * Error handling utilities
 */

import { getCorsHeaders } from "./cors.ts";

export interface ErrorResponse {
  error: string;
  code: string;
  request_id?: string;
  details?: unknown;
}

export function errorResponse(
  req: Request,
  opts: {
    code: string;
    message: string;
    status?: number;
    details?: unknown;
    requestId?: string;
  }
): Response {
  const body: ErrorResponse = {
    error: opts.message,
    code: opts.code,
    request_id: opts.requestId || generateRequestId(),
  };

  if (opts.details) {
    body.details = opts.details;
  }

  return new Response(JSON.stringify(body), {
    status: opts.status ?? 400,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": body.request_id!,
      ...getCorsHeaders(req),
    },
  });
}

export function jsonResponse(
  req: Request,
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...getCorsHeaders(req),
    },
  });
}

export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}
