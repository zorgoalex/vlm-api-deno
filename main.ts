/**
 * VLM API on Deno Deploy
 * Edge proxy for Vision Language Models (BigModel + OpenRouter)
 */

import { corsResponse } from "./lib/utils/cors.ts";
import { errorResponse, jsonResponse, generateRequestId } from "./lib/utils/errors.ts";
import { logRequest, logError } from "./lib/utils/logging.ts";
import { parseVisionRequest, buildVisionPayload } from "./lib/providers/payload.ts";
import { callBigModel } from "./lib/providers/bigmodel.ts";
import { callOpenRouter } from "./lib/providers/openrouter.ts";
import { passthroughSSE } from "./lib/streaming/sse.ts";

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const startTime = Date.now();
  const requestId = req.headers.get("X-Request-Id") || generateRequestId();

  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return corsResponse(req);
    }

    // GET /healthz
    if (url.pathname === "/healthz" && req.method === "GET") {
      const response = jsonResponse(req, { ok: true, ts: Date.now() });
      logRequest(req, 200, Date.now() - startTime, { request_id: requestId });
      return response;
    }

    // POST /v1/vision/analyze (JSON response)
    if (url.pathname === "/v1/vision/analyze" && req.method === "POST") {
      return await handleVisionAnalyze(req, requestId, startTime, false);
    }

    // POST /v1/vision/stream (SSE response)
    if (url.pathname === "/v1/vision/stream" && req.method === "POST") {
      return await handleVisionAnalyze(req, requestId, startTime, true);
    }

    // 404 Not Found
    logRequest(req, 404, Date.now() - startTime, { request_id: requestId });
    return errorResponse(req, {
      code: "NOT_FOUND",
      message: "Not Found",
      status: 404,
      requestId,
    });
  } catch (error) {
    logError({
      request_id: requestId,
      route: url.pathname,
      method: req.method,
      error: String(error),
    });

    return errorResponse(req, {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Internal Server Error",
      status: 500,
      requestId,
    });
  }
}

async function handleVisionAnalyze(
  req: Request,
  requestId: string,
  startTime: number,
  forceStream = false
): Promise<Response> {
  try {
    // Parse input
    const input = await parseVisionRequest(req);
    const shouldStream = forceStream || input.stream === true;

    // Build payload
    const { payload, provider } = buildVisionPayload(input);

    // Call provider
    let upstreamResponse: Response;
    if (provider === "bigmodel") {
      upstreamResponse = await callBigModel(payload, shouldStream);
    } else {
      upstreamResponse = await callOpenRouter(payload, shouldStream);
    }

    // Handle streaming
    if (shouldStream) {
      const response = passthroughSSE(req, upstreamResponse);
      logRequest(req, 200, Date.now() - startTime, {
        request_id: requestId,
        provider,
        stream: true,
      });
      return response;
    }

    // Handle JSON
    const jsonData = await upstreamResponse.json();
    const response = jsonResponse(req, jsonData);
    logRequest(req, 200, Date.now() - startTime, {
      request_id: requestId,
      provider,
      stream: false,
    });
    return response;
  } catch (error) {
    logError({
      request_id: requestId,
      route: "/v1/vision/*",
      error: String(error),
    });

    return errorResponse(req, {
      code: "VISION_ERROR",
      message: error instanceof Error ? error.message : "Vision API error",
      status: 500,
      requestId,
    });
  }
}

// Start server
Deno.serve(handler);
