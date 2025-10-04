# План переноса VLM API: Cloudflare → Deno Deploy (KV-only)

**Стратегия:** Deno KV как основное хранилище (БД не нужна!)  
**Целевой стек:** Deno Deploy (Edge) + Deno KV (Storage + Cache)

---

## 🎯 Упрощённая архитектура

```
Vision API     → Deno Deploy Edge (SSE без timeout!)
Prompts        → Deno KV (основное хранилище, не кэш!)
Hot Cache      → In-memory Map (опционально)
Backups        → Supabase Storage или Deno KV export
Rate-limit     → Deno KV
Nonce          → Deno KV
Regex Config   → Deno KV
Cron           → Deno Deploy Cron
```

**✅ Остаётся:**
- Deno KV (всё в одном: промпты, кэш, счётчики)
- In-memory cache (опционально, для скорости)
- Supabase Storage (только для бэкапов)

---

## 📊 Расчёт ёмкости

**Лимит Deno KV значения:** 64 KiB (65,536 байт)

**Ваши промпты:**
- Максимум ~10,000 символов (русский)
- В JSON с метаданными: ~20-25 KB
- **✅ Легко помещаются в 64 KiB**

**Хранилище:**
- Free tier: 1 GB
- 10,000 промптов × 25 KB = 250 MB
- **✅ Запаса на 4,000% роста!**

---

## ЭТАП 0: Подготовка инфраструктуры (0.5 дня)

### Задачи

**0.1 Создать Deno Deploy проект**
```bash
# 1. Установить Deno
curl -fsSL https://deno.land/install.sh | sh

# 2. Установить deployctl
deno install --allow-all --no-check -r -f \
  https://deno.land/x/deploy/deployctl.ts

# 3. Логин
deployctl login

# 4. Создать проект
deployctl projects create vlm-proxy
```

**0.2 Настроить секреты**
```bash
# Через Dashboard → Settings → Environment Variables
BIGMODEL_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
ADMIN_TOKEN=<random-token>
DEFAULT_MODEL=glm-4.5v
APP_URL=https://vlm-proxy.deno.dev
ALLOWED_ORIGINS=https://your-frontend.vercel.app,http://localhost:3000
```

**0.3 (Опционально) Supabase для бэкапов**
```bash
# Только для хранения JSON-бэкапов
# Создать проект → Storage → создать bucket "backups"
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

### Критерии приёмки
- ✅ Deno Deploy проект создан
- ✅ Секреты настроены
- ✅ (Опц.) Supabase Storage для бэкапов

---

## ЭТАП 1: MVP Vision API (1 день)

### Цель
Базовый прокси Vision без промптов

### 1.1 Структура проекта
```
/
├── main.ts              # Entrypoint
├── lib/
│   ├── router.ts        # Роутинг
│   ├── cors.ts          # CORS middleware
│   ├── providers/
│   │   ├── bigmodel.ts
│   │   └── openrouter.ts
│   ├── streaming/
│   │   └── sse.ts       # SSE helpers
│   └── utils/
│       ├── errors.ts
│       └── logging.ts
└── deno.json            # Config
```

### 1.2 Базовый роутер
```typescript
// main.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, x-admin-token",
      }
    });
  }
  
  // Routes
  if (url.pathname === "/healthz") {
    return Response.json({ ok: true, ts: Date.now() });
  }
  
  if (url.pathname === "/v1/vision/analyze") {
    return handleVisionAnalyze(req);
  }
  
  if (url.pathname === "/v1/vision/stream") {
    return handleVisionStream(req);
  }
  
  return new Response("Not Found", { status: 404 });
}

serve(handler, { port: 8000 });
```

### 1.3 SSE без timeout
```typescript
// lib/streaming/sse.ts
export async function streamFromProvider(
  provider: "bigmodel" | "openrouter",
  body: unknown
): Promise<Response> {
  const apiKey = provider === "bigmodel" 
    ? Deno.env.get("BIGMODEL_API_KEY")
    : Deno.env.get("OPENROUTER_API_KEY");
    
  const url = provider === "bigmodel"
    ? "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";
  
  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  
  // Passthrough stream (работает ДОЛГО без timeout!)
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive"
    }
  });
}
```

### 1.4 Деплой MVP
```bash
# Локально
deno run --allow-net --allow-env main.ts

# Production
deployctl deploy --project=vlm-proxy main.ts
```

### Тесты ЭТАПА 1
```bash
URL="https://vlm-proxy.deno.dev"

# Healthcheck
curl $URL/healthz

# Vision analyze
curl -X POST $URL/v1/vision/analyze \
  -H "content-type: application/json" \
  -d '{"provider":"bigmodel","prompt":"Что на фото?","image_url":"https://..."}'

# Vision stream (долгий SSE)
curl -N -X POST $URL/v1/vision/stream \
  -H "content-type: application/json" \
  -d '{"provider":"bigmodel","prompt":"Детально опиши","image_url":"...","stream":true}'
```

### Критерии приёмки
- ✅ Vision API отвечает JSON и SSE
- ✅ SSE работает >5 минут без обрыва
- ✅ CORS настроен
- ✅ Multipart/form-data поддерживается

---

## ЭТАП 2: Prompts в Deno KV (1.5 дня)

### Цель
Реализовать CRUD промптов напрямую в Deno KV

### 2.1 Модель данных
```typescript
// lib/storage/types.ts
export interface Prompt {
  id: number;
  namespace: string;
  name: string;
  version: number;
  lang: string;
  text: string;              // До 10,000 символов
  tags: string[];
  priority: number;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}
```

### 2.2 Структура ключей в KV
```typescript
// Основные данные (дубликаты для быстрого доступа)
["prompts", "by_id", id]                     → Prompt
["prompts", namespace, name, version]        → Prompt

// Индексы для поиска
["prompts_index", namespace]                 → number[] (IDs)
["prompts_index", namespace, lang]           → number[] (IDs)
["prompts_index", "active"]                  → number[] (IDs)

// Default промпты
["prompts_default", namespace, lang]         → number (ID)

// Метаданные
["prompts_meta", "counter"]                  → number (auto-increment)
["prompts_meta", "updated_at"]               → string (ISO timestamp)
```

### 2.3 CRUD операции
```typescript
// lib/storage/prompts.ts
const kv = await Deno.openKv();

// CREATE
export async function createPrompt(
  data: Omit<Prompt, "id" | "created_at" | "updated_at">
): Promise<Prompt> {
  // Auto-increment ID
  const counterKey = ["prompts_meta", "counter"];
  const counter = await kv.get<number>(counterKey);
  const id = (counter.value || 0) + 1;
  
  const now = new Date().toISOString();
  const prompt: Prompt = {
    id,
    ...data,
    created_at: now,
    updated_at: now,
  };
  
  // Атомарная транзакция
  const res = await kv.atomic()
    .check({ key: counterKey, versionstamp: counter.versionstamp })
    .set(counterKey, id)
    .set(["prompts", "by_id", id], prompt)
    .set(["prompts", data.namespace, data.name, data.version], prompt)
    .commit();
    
  if (!res.ok) {
    throw new Error("Concurrent write conflict");
  }
  
  // Обновляем индексы
  await addToIndex(["prompts_index", data.namespace], id);
  if (data.is_active) {
    await addToIndex(["prompts_index", "active"], id);
  }
  
  return prompt;
}

// READ by ID
export async function getPromptById(id: number): Promise<Prompt | null> {
  const result = await kv.get<Prompt>(["prompts", "by_id", id]);
  return result.value;
}

// LIST с фильтрами
export async function listPrompts(options: {
  namespace?: string;
  lang?: string;
  active?: boolean;
  limit?: number;
}): Promise<Prompt[]> {
  const { namespace = "default", lang, active, limit = 50 } = options;
  
  // Получаем IDs из индекса
  const indexKey = ["prompts_index", namespace];
  const indexResult = await kv.get<number[]>(indexKey);
  const ids = indexResult.value || [];
  
  // Загружаем промпты
  const prompts: Prompt[] = [];
  for (const id of ids) {
    const prompt = await getPromptById(id);
    if (!prompt) continue;
    
    // Фильтрация
    if (lang && prompt.lang !== lang) continue;
    if (active !== undefined && prompt.is_active !== active) continue;
    
    prompts.push(prompt);
    if (prompts.length >= limit) break;
  }
  
  // Сортировка по priority
  return prompts.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return b.version - a.version;
  });
}

// GET default
export async function getDefaultPrompt(
  namespace: string,
  lang: string
): Promise<Prompt | null> {
  const key = ["prompts_default", namespace, lang];
  const result = await kv.get<number>(key);
  
  if (!result.value) return null;
  return getPromptById(result.value);
}

// UPDATE
export async function updatePrompt(
  id: number,
  updates: Partial<Omit<Prompt, "id" | "created_at">>
): Promise<Prompt | null> {
  const existing = await getPromptById(id);
  if (!existing) return null;
  
  const updated: Prompt = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  
  // Обновляем оба ключа
  await kv.set(["prompts", "by_id", id], updated);
  await kv.set(
    ["prompts", updated.namespace, updated.name, updated.version],
    updated
  );
  
  return updated;
}

// SET DEFAULT
export async function setDefaultPrompt(id: number): Promise<boolean> {
  const prompt = await getPromptById(id);
  if (!prompt || !prompt.is_active) return false;
  
  // Сбрасываем старый default
  const oldDefault = await getDefaultPrompt(prompt.namespace, prompt.lang);
  if (oldDefault && oldDefault.id !== id) {
    await updatePrompt(oldDefault.id, { is_default: false });
  }
  
  // Устанавливаем новый
  const key = ["prompts_default", prompt.namespace, prompt.lang];
  await kv.set(key, id);
  await updatePrompt(id, { is_default: true });
  
  return true;
}

// DELETE
export async function deletePrompt(id: number): Promise<boolean> {
  const prompt = await getPromptById(id);
  if (!prompt) return false;
  
  await kv.delete(["prompts", "by_id", id]);
  await kv.delete(["prompts", prompt.namespace, prompt.name, prompt.version]);
  
  // Удаляем из индексов
  await removeFromIndex(["prompts_index", prompt.namespace], id);
  await removeFromIndex(["prompts_index", "active"], id);
  
  return true;
}

// Вспомогательные для индексов
async function addToIndex(key: Deno.KvKey, id: number) {
  const result = await kv.get<number[]>(key);
  const ids = result.value || [];
  if (!ids.includes(id)) {
    ids.push(id);
    await kv.set(key, ids);
  }
}

async function removeFromIndex(key: Deno.KvKey, id: number) {
  const result = await kv.get<number[]>(key);
  const ids = result.value || [];
  const filtered = ids.filter(i => i !== id);
  await kv.set(key, filtered);
}
```

### 2.4 API роуты
```typescript
// lib/routes/prompts.ts

// GET /v1/prompts
export async function handleListPrompts(req: Request) {
  const url = new URL(req.url);
  const namespace = url.searchParams.get("namespace") || "default";
  const lang = url.searchParams.get("lang") || undefined;
  const active = url.searchParams.get("active") 
    ? url.searchParams.get("active") === "1" 
    : undefined;
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "50"),
    100
  );
  
  const prompts = await listPrompts({ namespace, lang, active, limit });
  
  return Response.json({ items: prompts });
}

// POST /v1/prompts
export async function handleCreatePrompt(req: Request) {
  // Проверка токена
  const token = req.headers.get("X-Admin-Token");
  if (token !== Deno.env.get("ADMIN_TOKEN")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const body = await req.json();
  
  // Валидация
  if (!body.namespace || !body.name || !body.text) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }
  
  const prompt = await createPrompt({
    namespace: body.namespace,
    name: body.name,
    version: body.version || 1,
    lang: body.lang || "en",
    text: body.text,
    tags: body.tags || [],
    priority: body.priority || 0,
    is_active: body.is_active ?? true,
    is_default: false,
  });
  
  // Если make_default=true
  if (body.make_default) {
    await setDefaultPrompt(prompt.id);
  }
  
  return Response.json(prompt, { status: 201 });
}

// GET /v1/prompts/:id
export async function handleGetPrompt(id: string) {
  const prompt = await getPromptById(parseInt(id));
  
  if (!prompt) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  
  return Response.json(prompt);
}

// PUT /v1/prompts/:id
export async function handleUpdatePrompt(id: string, req: Request) {
  const token = req.headers.get("X-Admin-Token");
  if (token !== Deno.env.get("ADMIN_TOKEN")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const body = await req.json();
  const prompt = await updatePrompt(parseInt(id), body);
  
  if (!prompt) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  
  return Response.json(prompt);
}

// GET /v1/prompts/default
export async function handleGetDefaultPrompt(req: Request) {
  const url = new URL(req.url);
  const namespace = url.searchParams.get("namespace") || "default";
  const lang = url.searchParams.get("lang") || "en";
  
  const prompt = await getDefaultPrompt(namespace, lang);
  
  if (!prompt) {
    return Response.json({ error: "No default prompt" }, { status: 404 });
  }
  
  return Response.json(prompt);
}

// PUT /v1/prompts/:id/default
export async function handleSetDefault(id: string, req: Request) {
  const token = req.headers.get("X-Admin-Token");
  if (token !== Deno.env.get("ADMIN_TOKEN")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const success = await setDefaultPrompt(parseInt(id));
  
  if (!success) {
    return Response.json({ error: "Failed to set default" }, { status: 400 });
  }
  
  return Response.json({ success: true });
}
```

### Тесты ЭТАПА 2
```bash
# Create
curl -X POST $URL/v1/prompts \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "namespace":"default",
    "name":"test_prompt",
    "version":1,
    "lang":"ru",
    "text":"Тестовый промпт",
    "tags":["test"],
    "priority":10,
    "is_active":true
  }'

# List
curl "$URL/v1/prompts?namespace=default&lang=ru"

# Get by ID
curl "$URL/v1/prompts/1"

# Update
curl -X PUT "$URL/v1/prompts/1" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"text":"Обновлённый текст"}'

# Set default
curl -X PUT "$URL/v1/prompts/1/default" \
  -H "X-Admin-Token: $ADMIN_TOKEN"

# Get default
curl "$URL/v1/prompts/default?namespace=default&lang=ru"
```

### Критерии приёмки
- ✅ CRUD работает
- ✅ Default логика корректна
- ✅ Индексы обновляются
- ✅ Промпты до 10K символов сохраняются без ошибок

---

## ЭТАП 3: In-Memory Cache (0.5 дня)

### Цель
Ускорить частые запросы через кэш в памяти

### 3.1 Memory Cache
```typescript
// lib/cache/memory.ts
interface CacheEntry<T> {
  value: T;
  expires: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  
  set<T>(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, {
      value,
      expires: Date.now() + ttlMs,
    });
  }
  
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.value;
  }
  
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  deletePattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
      }
    }
  }
}

export const memCache = new MemoryCache();

// Автоочистка каждые 60 секунд
setInterval(() => memCache.cleanup(), 60_000);
```

### 3.2 Кэшированные операции
```typescript
// lib/storage/cached-prompts.ts
import { memCache } from "../cache/memory.ts";
import * as prompts from "./prompts.ts";

// GET с кэшем
export async function getCachedPrompt(id: number): Promise<Prompt | null> {
  const key = `prompt:${id}`;
  
  // Проверяем memory
  const cached = memCache.get<Prompt>(key);
  if (cached) {
    console.log(`[CACHE] HIT: ${key}`);
    return cached;
  }
  
  // Запрос к KV
  const prompt = await prompts.getPromptById(id);
  
  if (prompt) {
    // Кэшируем на 5 минут
    memCache.set(key, prompt, 5 * 60 * 1000);
    console.log(`[CACHE] MISS: ${key}`);
  }
  
  return prompt;
}

// LIST с кэшем
export async function getCachedList(options: {
  namespace?: string;
  lang?: string;
  active?: boolean;
}): Promise<Prompt[]> {
  const { namespace = "default", lang = "*", active } = options;
  const key = `list:${namespace}:${lang}:${active}`;
  
  const cached = memCache.get<Prompt[]>(key);
  if (cached) {
    console.log(`[CACHE] HIT: ${key}`);
    return cached;
  }
  
  const list = await prompts.listPrompts(options);
  
  // Кэшируем на 1 минуту
  memCache.set(key, list, 60 * 1000);
  console.log(`[CACHE] MISS: ${key}`);
  
  return list;
}

// CREATE с инвалидацией
export async function createPromptCached(
  data: Omit<Prompt, "id" | "created_at" | "updated_at">
): Promise<Prompt> {
  const prompt = await prompts.createPrompt(data);
  
  // Инвалидируем списки
  memCache.deletePattern(`list:${data.namespace}`);
  
  return prompt;
}

// UPDATE с инвалидацией
export async function updatePromptCached(
  id: number,
  updates: Partial<Prompt>
): Promise<Prompt | null> {
  const prompt = await prompts.updatePrompt(id, updates);
  
  if (prompt) {
    memCache.delete(`prompt:${id}`);
    memCache.deletePattern(`list:${prompt.namespace}`);
  }
  
  return prompt;
}
```

### Критерии приёмки
- ✅ Логи показывают HIT/MISS
- ✅ Инвалидация работает при записи
- ✅ TTL корректный

---

## ЭТАП 4: Security (0.5 дня)

### Цель
Rate-limit и nonce через Deno KV

### 4.1 Rate-limit
```typescript
// lib/security/rate-limit.ts
export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowSec: number
): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  const kv = await Deno.openKv();
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = ["rate_limit", identifier, window];
  
  const current = await kv.get<number>(key);
  const count = (current.value || 0);
  
  if (count >= limit) {
    return { 
      allowed: false, 
      remaining: 0,
      reset: (window + 1) * windowSec
    };
  }
  
  await kv.set(key, count + 1, { expireIn: windowSec * 1000 });
  
  return { 
    allowed: true, 
    remaining: limit - count - 1,
    reset: (window + 1) * windowSec
  };
}
```

### 4.2 Nonce
```typescript
// lib/security/nonce.ts
export async function checkNonce(
  nonce: string,
  ttlSec: number
): Promise<boolean> {
  const kv = await Deno.openKv();
  const key = ["nonce", nonce];
  
  const existing = await kv.get(key);
  if (existing.value) {
    return false; // Replay!
  }
  
  await kv.set(key, true, { expireIn: ttlSec * 1000 });
  return true;
}
```

### Критерии приёмки
- ✅ Rate-limit возвращает 429 с headers
- ✅ Nonce предотвращает replay

---

## ЭТАП 5: Backups + Cron (0.5 дня)

### Цель
Автобэкапы промптов

### 5.1 Export в JSON
```typescript
// lib/backup/export.ts
export async function exportPrompts(): Promise<string> {
  const kv = await Deno.openKv();
  const prompts: Prompt[] = [];
  
  // Экспортируем все
  const entries = kv.list<Prompt>({ prefix: ["prompts", "by_id"] });
  
  for await (const entry of entries) {
    prompts.push(entry.value);
  }
  
  return JSON.stringify({
    exported_at: new Date().toISOString(),
    count: prompts.length,
    prompts,
  }, null, 2);
}

// POST /admin/backup
export async function handleBackup(req: Request) {
  const token = req.headers.get("X-Admin-Token");
  if (token !== Deno.env.get("ADMIN_TOKEN")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const json = await exportPrompts();
  const filename = `backup-${Date.now()}.json`;
  
  // Опция 1: Вернуть JSON для скачивания
  return new Response(json, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
    }
  });
  
  // Опция 2: Загрузить в Supabase Storage
  // ... код загрузки
}
```

### 5.2 Cron
```typescript
// main.ts
Deno.cron("daily backup", "0 3 * * *", async () => {
  console.log("[CRON] Running backup...");
  
  const json = await exportPrompts();
  
  // Сохраняем локально в KV (опционально)
  const kv = await Deno.openKv();
  await kv.set(
    ["backups", new Date().toISOString()],
    json,
    { expireIn: 30 * 24 * 60 * 60 * 1000 } // 30 дней
  );
  
  console.log("[CRON] Backup complete");
});
```

### Критерии приёмки
- ✅ Ручной бэкап работает
- ✅ Cron выполняется по расписанию

---

## ЭТАП 6: Служебные API (0.5 дня)

### 6.1 /about с regex config
```typescript
export async function handleAbout() {
  const kv = await Deno.openKv();
  const pattern = await kv.get<string>(["config", "regex_pattern"]);
  
  return Response.json({
    name: "vlm-api-deno",
    version: "1.0.0",
    environment: Deno.env.get("DENO_DEPLOYMENT_ID") ? "production" : "dev",
    routes: [
      "GET /healthz",
      "GET /about",
      "POST /v1/vision/analyze",
      "POST /v1/vision/stream",
      "GET /v1/prompts",
      "POST /v1/prompts",
      "GET /v1/prompts/:id",
      "PUT /v1/prompts/:id",
      "GET /v1/prompts/default",
      "PUT /v1/prompts/:id/default",
    ],
    config: {
      regex_cleanup: {
        pattern: pattern.value || "^(?:System|Meta|Debug).*$",
        flags: "gmi",
        source: pattern.value ? "kv" : "default",
      }
    }
  });
}
```

### Критерии приёмки
- ✅ /about возвращает метаданные
- ✅ Regex config доступен

---

## ЭТАП 7: Тестирование (1 день)

### 7.1 Полный набор тестов
```bash
# Vision
curl -N $URL/v1/vision/stream -X POST -d '...'

# Prompts
curl $URL/v1/prompts
curl $URL/v1/prompts/1
curl -X POST $URL/v1/prompts -H "X-Admin-Token: ..."

# Security
for i in {1..25}; do curl -X POST $URL/v1/prompts ...; done # Ждём 429

# Backup
curl -X POST $URL/admin/backup -H "X-Admin-Token: ..."
```

### 7.2 Долгий SSE (>5 мин)
```bash
time curl -N $URL/v1/vision/stream -X POST -d '{...сложное изображение...}'
```

### Критерии приёмки
- ✅ Все тесты зелёные
- ✅ SSE работает без timeout
- ✅ Кэш показывает HIT/MISS

---

## ЭТАП 8: Production (0.5 дня)

### 8.1 Финальный деплой
```bash
deployctl deploy --project=vlm-proxy --prod main.ts
```

### 8.2 Мониторинг
```typescript
function log(data: Record<string, unknown>) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    ...data
  }));
}
```

### Критерии приёмки
- ✅ Production деплой успешен
- ✅ Логи структурированы
- ✅ Метрики в норме

---

## 📋 Итоговый чеклист

### Функциональность
- [ ] Vision API (JSON + SSE)
- [ ] Prompts CRUD (Deno KV)
- [ ] In-Memory Cache
- [ ] Security (rate-limit, nonce)
- [ ] Backups (manual + cron)
- [ ] Служебные (/about, /healthz)

### Надёжность
- [ ] SSE >5 минут работает
- [ ] Промпты до 10K символов сохраняются
- [ ] Кэш инвалидируется

---

## ⏱️ Временная оценка

| Этап | Время | Итого |
|------|-------|-------|
| ЭТАП 0: Инфраструктура | 0.5 дня | 0.5 |
| ЭТАП 1: MVP Vision | 1 день | 1.5 |
| ЭТАП 2: Prompts KV | 1.5 дня | 3 |
| ЭТАП 3: Memory Cache | 0.5 дня | 3.5 |
| ЭТАП 4: Security | 0.5 дня | 4 |
| ЭТАП 5: Backups | 0.5 дня | 4.5 |
| ЭТАП 6: Служебные | 0.5 дня | 5 |
| ЭТАП 7: Тестирование | 1 день | 6 |
| ЭТАП 8: Деплой | 0.5 дня | 6.5 |

**Итого: 6.5 дней** (~1.5 недели)

---

## 🎯 Преимущества упрощённой архитектуры

✅ **Простота:** Всё в Deno KV, нет БД  
✅ **Скорость:** Memory <1ms, KV 3-5ms  
✅ **Бесплатность:** 1GB KV = 40,000 промптов  
✅ **SSE без лимита:** Стримы часами  
✅ **Минимум кода:** -40% по сравнению с БД  

---