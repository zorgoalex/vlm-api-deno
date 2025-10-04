/**
 * BigModel API Provider (GLM-4.5V)
 */

export interface BigModelPayload {
  model: string;
  messages: Array<{
    role: string;
    content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
  stream?: boolean;
  thinking?: { type: "enabled" | "disabled" };
}

export async function callBigModel(
  payload: BigModelPayload,
  stream = false
): Promise<Response> {
  const apiKey = Deno.env.get("BIGMODEL_API_KEY");
  if (!apiKey) {
    throw new Error("BIGMODEL_API_KEY not configured");
  }

  const url = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

  const body: BigModelPayload = {
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
    throw new Error(`BigModel API error (${response.status}): ${errorText}`);
  }

  return response;
}
