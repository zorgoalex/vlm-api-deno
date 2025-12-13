import { buildVisionPayload } from "./payload.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function withEnv(name: string, value: string | undefined, fn: () => void) {
  const prev = Deno.env.get(name);
  try {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
    fn();
  } finally {
    if (prev === undefined) Deno.env.delete(name);
    else Deno.env.set(name, prev);
  }
}

Deno.test("buildVisionPayload: default provider is zai and default model is glm-4.6v-flash", () => {
  withEnv("DEFAULT_MODEL", undefined, () => {
    const { payload, provider } = buildVisionPayload({});
    assert(provider === "zai", `expected provider=zai, got ${String(provider)}`);
    assert(payload.model === "glm-4.6v-flash", `expected glm-4.6v-flash, got ${payload.model}`);
  });
});

Deno.test("buildVisionPayload: bigmodel default model is glm-4.5v when DEFAULT_MODEL is not set", () => {
  withEnv("DEFAULT_MODEL", undefined, () => {
    const { payload, provider } = buildVisionPayload({ provider: "bigmodel" });
    assert(provider === "bigmodel", `expected provider=bigmodel, got ${String(provider)}`);
    assert(payload.model === "glm-4.5v", `expected glm-4.5v, got ${payload.model}`);
  });
});

Deno.test("buildVisionPayload: DEFAULT_MODEL overrides provider defaults", () => {
  withEnv("DEFAULT_MODEL", "custom-model", () => {
    const { payload, provider } = buildVisionPayload({ provider: "zai" });
    assert(provider === "zai", `expected provider=zai, got ${String(provider)}`);
    assert(payload.model === "custom-model", `expected custom-model, got ${payload.model}`);
  });
});

Deno.test("buildVisionPayload: thinking supported for zai", () => {
  const { payload } = buildVisionPayload({ provider: "zai", thinking: "enabled" });
  assert(payload.thinking?.type === "enabled", "expected thinking.type=enabled");
});

Deno.test("buildVisionPayload: for zai, image content goes before text (docs example order)", () => {
  const { payload } = buildVisionPayload({
    provider: "zai",
    prompt: "Опиши изображение",
    image_url: "https://example.com/image.jpg",
  });

  const items = payload.messages?.[0]?.content;
  assert(Array.isArray(items), "expected messages[0].content to be an array");
  assert(items.length >= 2, "expected at least 2 content items");
  assert(items[0].type === "image_url", "expected first item to be image_url");
  assert(items[1].type === "text", "expected second item to be text");
});
