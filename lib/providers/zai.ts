/**
 * ZAI API Provider (default: GLM-4.6V-Flash)
 * Docs: https://docs.z.ai/guides/vlm/glm-4.6v#glm-4-6v-flash
 */

export interface ZaiPayload {
  model: string;
  messages: Array<{
    role: string;
    content: Array<{
      type: string;
      text?: string;
      image_url?: { url: string; detail?: string };
    }>;
  }>;
  stream?: boolean;
  thinking?: { type: "enabled" | "disabled" };
}

export async function callZai(
  payload: ZaiPayload,
  stream = false,
): Promise<Response> {
  const apiKey = Deno.env.get("ZAI_API_KEY");
  if (!apiKey) {
    throw new Error("ZAI_API_KEY not configured");
  }

  const url = "https://api.z.ai/api/paas/v4/chat/completions";

  const body: ZaiPayload = {
    ...payload,
    stream,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`ZAI API error (${response.status}): ${errorText}`);
  }

  return response;
}
