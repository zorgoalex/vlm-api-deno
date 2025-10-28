/**
 * VLM API on Deno Deploy
 * Edge proxy for Vision Language Models (BigModel + OpenRouter)
 * Includes Prompts management via Deno KV.
 */

// --- Utils ---
import { corsResponse } from "./lib/utils/cors.ts";
import { errorResponse, jsonResponse, generateRequestId } from "./lib/utils/errors.ts";
import { logRequest, logError } from "./lib/utils/logging.ts";
import { passthroughSSE } from "./lib/streaming/sse.ts";

// --- Vision API ---
import { parseVisionRequest, buildVisionPayload } from "./lib/providers/payload.ts";
import { callBigModel } from "./lib/providers/bigmodel.ts";
import { callOpenRouter } from "./lib/providers/openrouter.ts";

// --- Prompts API ---
import { createPrompt, getPrompt, updatePrompt, deletePrompt, listPrompts } from "./lib/storage/prompts.ts";
import type { PromptCreate, PromptUpdate, PromptListFilters } from "./lib/storage/types.ts";

// --- Router Patterns ---
const VISION_ANALYZE_PATTERN = new URLPattern({ pathname: "/v1/vision/analyze" });
const VISION_STREAM_PATTERN = new URLPattern({ pathname: "/v1/vision/stream" });
const PROMPT_CREATE_PATTERN = new URLPattern({ pathname: "/v1/prompts" });
const PROMPT_LIST_PATTERN = new URLPattern({ pathname: "/v1/prompts" });
const PROMPT_GET_PATTERN = new URLPattern({ pathname: "/v1/prompts/:id" });
const PROMPT_UPDATE_PATTERN = new URLPattern({ pathname: "/v1/prompts/:id" });
const PROMPT_DELETE_PATTERN = new URLPattern({ pathname: "/v1/prompts/:id" });
const HEALTHZ_PATTERN = new URLPattern({ pathname: "/healthz" });

/**
 * Main request handler.
 */
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const startTime = Date.now();
  const requestId = req.headers.get("X-Request-Id") || generateRequestId();

  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return corsResponse(req);
    }

    const visionAnalyzeMatch = VISION_ANALYZE_PATTERN.exec(url);
    if (visionAnalyzeMatch && req.method === "POST") {
      return await handleVisionAnalyze(req, requestId, startTime, false);
    }

    const visionStreamMatch = VISION_STREAM_PATTERN.exec(url);
    if (visionStreamMatch && req.method === "POST") {
      return await handleVisionAnalyze(req, requestId, startTime, true);
    }

    const healthzMatch = HEALTHZ_PATTERN.exec(url);
    if (healthzMatch && req.method === "GET") {
      const response = jsonResponse(req, { ok: true, ts: Date.now() });
      logRequest(req, 200, Date.now() - startTime, { request_id: requestId });
      return response;
    }

    const promptCreateMatch = PROMPT_CREATE_PATTERN.exec(url);
    if (promptCreateMatch && req.method === "POST") {
      return await handleCreatePrompt(req, requestId);
    }

    const promptListMatch = PROMPT_LIST_PATTERN.exec(url);
    if (promptListMatch && req.method === "GET") {
      return await handleListPrompts(req, requestId);
    }

    const promptGetMatch = PROMPT_GET_PATTERN.exec(url);
    if (promptGetMatch && req.method === "GET") {
      const id = promptGetMatch.pathname.groups.id!;
      return await handleGetPrompt(req, id, requestId);
    }

    const promptUpdateMatch = PROMPT_UPDATE_PATTERN.exec(url);
    if (promptUpdateMatch && req.method === "PUT") {
      const id = promptUpdateMatch.pathname.groups.id!;
      return await handleUpdatePrompt(req, id, requestId);
    }

    const promptDeleteMatch = PROMPT_DELETE_PATTERN.exec(url);
    if (promptDeleteMatch && req.method === "DELETE") {
      const id = promptDeleteMatch.pathname.groups.id!;
      return await handleDeletePrompt(req, id, requestId);
    }

    // 404 Not Found
    logRequest(req, 404, Date.now() - startTime, { request_id: requestId });
    return errorResponse(req, { code: "NOT_FOUND", message: "Not Found", status: 404, requestId });

  } catch (error) {
    logError({ request_id: requestId, route: url.pathname, method: req.method, error: String(error) });
    return errorResponse(req, {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Internal Server Error",
      status: 500,
      requestId,
    });
  }
}

/**
 * Checks for the admin token on a request.
 */
function checkAdminToken(req: Request): Response | null {
    const adminToken = Deno.env.get("ADMIN_TOKEN");
    if (!adminToken) {
        // If token is not configured, deny all admin actions.
        return errorResponse(req, { code: "CONFIG_ERROR", message: "Admin token not configured", status: 500 });
    }
    if (req.headers.get("X-Admin-Token") !== adminToken) {
        return errorResponse(req, { code: "UNAUTHORIZED", message: "Invalid or missing admin token", status: 401 });
    }
    return null; // Token is valid
}


// --- Route Handlers ---

async function handleCreatePrompt(req: Request, requestId: string): Promise<Response> {
    const authError = checkAdminToken(req);
    if (authError) return authError;

    try {
        const data = await req.json() as PromptCreate;
        // Basic validation can be added here later
        const newPrompt = await createPrompt(data);
        return jsonResponse(req, newPrompt, 201);
    } catch (error) {
        logError({ request_id: requestId, route: "/v1/prompts", error: String(error) });
        return errorResponse(req, {
            code: "PROMPT_CREATE_FAILED",
            message: error instanceof Error ? error.message : "Failed to create prompt",
            status: 400, // 400 for bad data, 500 for server error
            requestId,
        });
    }
}

async function handleListPrompts(req: Request, requestId: string): Promise<Response> {
    try {
        const url = new URL(req.url);
        const params = url.searchParams;

        const filters: PromptListFilters = {
            namespace: params.get("namespace") || undefined,
            name: params.get("name") || undefined,
            isActive: params.get("isActive") !== null ? params.get("isActive") === "true" : undefined,
            tag: params.get("tag") || undefined,
            limit: params.get("limit") ? Math.max(1, Math.min(200, Number(params.get("limit")))) : undefined,
            cursor: params.get("cursor") || undefined,
            sortBy: (params.get("sortBy") as any) || undefined,
            sortOrder: (params.get("sortOrder") as any) || undefined,
        };

        const result = await listPrompts(filters);
        return jsonResponse(req, result);
    } catch (error) {
        logError({ request_id: requestId, route: "/v1/prompts", error: String(error) });
        return errorResponse(req, {
            code: "PROMPT_LIST_FAILED",
            message: error instanceof Error ? error.message : "Failed to list prompts",
            status: 500,
            requestId,
        });
    }
}

async function handleGetPrompt(req: Request, id: string, requestId: string): Promise<Response> {
    try {
        const prompt = await getPrompt(id);
        if (!prompt) {
            return errorResponse(req, { code: "NOT_FOUND", message: `Prompt with id '${id}' not found`, status: 404, requestId });
        }
        return jsonResponse(req, prompt);
    } catch (error) {
        logError({ request_id: requestId, route: `/v1/prompts/${id}`, error: String(error) });
        return errorResponse(req, {
            code: "PROMPT_GET_FAILED",
            message: error instanceof Error ? error.message : "Failed to retrieve prompt",
            status: 500,
            requestId,
        });
    }
}

async function handleUpdatePrompt(req: Request, id: string, requestId: string): Promise<Response> {
    const authError = checkAdminToken(req);
    if (authError) return authError;

    try {
        const data = await req.json() as PromptUpdate;
        const updatedPrompt = await updatePrompt(id, data);

        if (!updatedPrompt) {
            return errorResponse(req, { code: "NOT_FOUND", message: `Prompt with id '${id}' not found`, status: 404, requestId });
        }

        return jsonResponse(req, updatedPrompt);
    } catch (error) {
        logError({ request_id: requestId, route: `/v1/prompts/${id}`, error: String(error) });
        return errorResponse(req, {
            code: "PROMPT_UPDATE_FAILED",
            message: error instanceof Error ? error.message : "Failed to update prompt",
            status: 400, // Or 500 depending on error
            requestId,
        });
    }
}

async function handleDeletePrompt(req: Request, id: string, requestId: string): Promise<Response> {
    const authError = checkAdminToken(req);
    if (authError) return authError;

    try {
        const success = await deletePrompt(id);

        if (!success) {
            return errorResponse(req, { code: "NOT_FOUND", message: `Prompt with id '${id}' not found`, status: 404, requestId });
        }

        // Return 204 No Content on successful deletion
        return new Response(null, { status: 204 });
    } catch (error) {
        logError({ request_id: requestId, route: `/v1/prompts/${id}`, error: String(error) });
        return errorResponse(req, {
            code: "PROMPT_DELETE_FAILED",
            message: error instanceof Error ? error.message : "Failed to delete prompt",
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
    const input = await parseVisionRequest(req);
    const shouldStream = forceStream || input.stream === true;
    const { payload, provider } = buildVisionPayload(input);

    let upstreamResponse: Response;
    if (provider === "bigmodel") {
      upstreamResponse = await callBigModel(payload, shouldStream);
    } else {
      upstreamResponse = await callOpenRouter(payload, shouldStream);
    }

    if (shouldStream) {
      const response = passthroughSSE(req, upstreamResponse);
      logRequest(req, 200, Date.now() - startTime, { request_id: requestId, provider, stream: true });
      return response;
    }

    const jsonData = await upstreamResponse.json();
    const response = jsonResponse(req, jsonData);
    logRequest(req, 200, Date.now() - startTime, { request_id: requestId, provider, stream: false });
    return response;
  } catch (error) {
    logError({ request_id: requestId, route: "/v1/vision/*", error: String(error) });
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
