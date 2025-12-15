/**
 * OpenRouter API Provider
 */

export interface OpenRouterPayload {
  model: string;
  messages: Array<{
    role: string;
    content: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>;
  }>;
  stream?: boolean;
}

export async function callOpenRouter(
  payload: OpenRouterPayload,
  stream = false
): Promise<Response> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const url = "https://openrouter.ai/api/v1/chat/completions";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  // Optional attribution headers
  const appUrl = Deno.env.get("APP_URL");
  const appTitle = Deno.env.get("APP_TITLE");
  if (appUrl) headers["HTTP-Referer"] = appUrl;
  if (appTitle) headers["X-Title"] = appTitle;

  const body: OpenRouterPayload = {
    ...payload,
    stream,
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  return response;
}
