/**
 * Vision payload builder (OpenAI-compatible format)
 */

export interface VisionInput {
  provider?: "zai" | "bigmodel" | "openrouter";
  model?: string;
  prompt?: string;
  image_url?: string;
  image_base64?: string;
  images?: string[];
  detail?: "low" | "high" | "auto";
  thinking?: "enabled" | "disabled" | { type: "enabled" | "disabled" };
  stream?: boolean;
}

export function buildVisionPayload(input: VisionInput) {
  const provider = input.provider === "zai" || input.provider === "bigmodel" || input.provider === "openrouter"
    ? input.provider
    : "zai";
  const model = input.model?.trim() || getDefaultModel(provider);

  // Build content array
  const content: Array<{
    type: string;
    text?: string;
    image_url?: { url: string; detail?: string };
  }> = [];

  // Collect all image URLs
  const imageUrls: string[] = [];
  if (input.image_url) imageUrls.push(input.image_url);
  if (input.image_base64) {
    imageUrls.push(`data:image/png;base64,${input.image_base64}`);
  }
  if (input.images && Array.isArray(input.images)) {
    imageUrls.push(...input.images);
  }

  // Add images to content
  for (const url of imageUrls) {
    const imageContent: { type: string; image_url: { url: string; detail?: string } } = {
      type: "image_url",
      image_url: { url },
    };

    // Add detail if specified
    if (input.detail) {
      imageContent.image_url.detail = input.detail;
    }

    content.push(imageContent);
  }

  // Add text prompt
  if (input.prompt) {
    const textContent = {
      type: "text",
      text: input.prompt,
    };
    // ZAI docs examples put image first, then text.
    if (provider === "zai") {
      content.push(textContent);
    } else {
      content.unshift(textContent);
    }
  }

  // Build messages
  const messages = [
    {
      role: "user",
      content,
    },
  ];

  // Base payload
  const payload: any = {
    model,
    messages,
  };

  // Add thinking for BigModel
  if ((provider === "bigmodel" || provider === "zai") && input.thinking) {
    if (typeof input.thinking === "string") {
      payload.thinking = { type: input.thinking };
    } else if (typeof input.thinking === "object" && input.thinking.type) {
      payload.thinking = input.thinking;
    }
  }

  return { payload, provider };
}

function getDefaultModel(provider: "zai" | "bigmodel" | "openrouter"): string {
  const envModel = Deno.env.get("DEFAULT_MODEL");
  if (envModel) return envModel;

  if (provider === "zai") return "glm-4.6v-flash";
  if (provider === "bigmodel") return "glm-4.5v";
  return "qwen/qwen2.5-vl-72b-instruct";
}

/**
 * Parse multipart/form-data or JSON body
 */
export async function parseVisionRequest(req: Request): Promise<VisionInput> {
  const contentType = req.headers.get("Content-Type") || "";

  if (contentType.includes("application/json")) {
    return (await req.json()) as VisionInput;
  }

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const result: any = {};

    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") {
        result[key] = value;
      } else if (value instanceof File) {
        // Convert File to base64
        const buffer = await value.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        result.image_base64 = base64;
      }
    }

    // Parse JSON fields
    if (result.stream) {
      result.stream = result.stream.toLowerCase() !== "false";
    }
    if (result.images && typeof result.images === "string") {
      try {
        result.images = JSON.parse(result.images);
      } catch {
        // Ignore parse errors
      }
    }

    return result as VisionInput;
  }

  // Fallback: try JSON
  try {
    return (await req.json()) as VisionInput;
  } catch {
    return {};
  }
}
