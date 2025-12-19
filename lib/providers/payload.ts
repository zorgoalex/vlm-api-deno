/**
 * Vision payload builder (OpenAI-compatible format)
 */

import type { PromptCriteria } from "../storage/types.ts";

export interface VisionInput {
  provider?: "zai" | "bigmodel" | "openrouter";
  model?: string;
  prompt?: string;
  prompt_kv?: PromptCriteria;
  prompt_id?: string;
  image_url?: string;
  image_base64?: string;
  images?: string[];
  detail?: "low" | "high" | "auto";
  thinking?: "enabled" | "disabled" | { type: "enabled" | "disabled" };
  stream?: boolean;
}

function parseTagsInput(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tags = value.map((tag) => String(tag).trim()).filter(Boolean);
    return tags.length > 0 ? tags : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const tags = parsed.map((tag) => String(tag).trim()).filter(Boolean);
        return tags.length > 0 ? tags : undefined;
      }
    } catch {
      // ignore JSON parse errors
    }
    const tags = trimmed.split(",").map((tag) => tag.trim()).filter(Boolean);
    return tags.length > 0 ? tags : undefined;
  }
  return undefined;
}

function parseNumberInput(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizePromptCriteria(raw: unknown): PromptCriteria | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const criteria: PromptCriteria = {};

  if (typeof obj.namespace === "string" && obj.namespace.trim()) {
    criteria.namespace = obj.namespace.trim();
  }
  if (typeof obj.name === "string" && obj.name.trim()) {
    criteria.name = obj.name.trim();
  }
  const version = parseNumberInput(obj.version);
  if (version !== undefined) criteria.version = version;

  if (typeof obj.lang === "string" && obj.lang.trim()) {
    criteria.lang = obj.lang.trim();
  }
  const tags = parseTagsInput(obj.tags);
  if (tags) criteria.tags = tags;

  const priority = parseNumberInput(obj.priority);
  if (priority !== undefined) criteria.priority = priority;

  return Object.keys(criteria).length > 0 ? criteria : undefined;
}

function extractPromptCriteria(raw: Record<string, unknown>): PromptCriteria | undefined {
  let fromObject: PromptCriteria | undefined;
  if (raw.prompt_kv !== undefined) {
    if (typeof raw.prompt_kv === "string") {
      try {
        fromObject = normalizePromptCriteria(JSON.parse(raw.prompt_kv));
      } catch {
        fromObject = undefined;
      }
    } else {
      fromObject = normalizePromptCriteria(raw.prompt_kv);
    }
  }

  const fromFlat = normalizePromptCriteria({
    namespace: raw.prompt_kv_namespace,
    name: raw.prompt_kv_name,
    version: raw.prompt_kv_version,
    lang: raw.prompt_kv_lang,
    tags: raw.prompt_kv_tags,
    priority: raw.prompt_kv_priority,
  });

  const merged: PromptCriteria = {
    ...(fromObject ?? {}),
    ...(fromFlat ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizeVisionInput(raw: Record<string, unknown>): VisionInput {
  const promptCriteria = extractPromptCriteria(raw);
  if (promptCriteria) {
    raw.prompt_kv = promptCriteria;
  }
  if (typeof raw.prompt_id === "string") {
    const trimmed = raw.prompt_id.trim();
    if (trimmed) {
      raw.prompt_id = trimmed;
    } else {
      delete raw.prompt_id;
    }
  }
  return raw as VisionInput;
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
    const data = await req.json() as Record<string, unknown>;
    return normalizeVisionInput(data);
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

    return normalizeVisionInput(result as Record<string, unknown>);
  }

  // Fallback: try JSON
  try {
    const data = await req.json() as Record<string, unknown>;
    return normalizeVisionInput(data);
  } catch {
    return {};
  }
}
