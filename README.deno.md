# VLM API на Deno Deploy

Edge-прокси для Vision Language Models (BigModel + OpenRouter) на Deno Deploy + Deno KV.

## Особенности

- ✅ **SSE без timeout** — стримы работают часами
- ✅ **Deno KV** — всё в одном хранилище (промпты, кэш, rate-limit)
- ✅ **Edge Runtime** — быстрый холодный старт
- ✅ **TypeScript native** — без транспиляции

## Архитектура

```
Vision API     → Deno Deploy Edge (SSE)
Prompts        → Deno KV (основное хранилище)
Hot Cache      → In-memory Map
Rate-limit     → Deno KV
Nonce          → Deno KV
Regex Config   → Deno KV
Backups        → Deno KV / Supabase Storage
Cron           → Deno Deploy Cron
```

## Быстрый старт

### Установка

```bash
# Установить Deno (если еще не установлен)
# См. SETUP_DENO.md

# Проект уже в текущей папке vlm-api-vercel
```

### Локальная разработка

```bash
# Создать .env для локальной разработки
cp .env.example .env
# Отредактировать .env — добавить ключи API

# Запустить локально
deno task dev
# или
deno run --allow-net --allow-env --allow-read --watch main.ts
```

### Деплой

```bash
# Preview деплой
deno task deploy

# Production деплой
deno task deploy:prod
```

## Environment Variables

### Обязательные:

- `BIGMODEL_API_KEY` — API ключ BigModel
- `DEFAULT_MODEL` — модель по умолчанию (например, `glm-4.5v`)
- `ADMIN_TOKEN` — токен для админ-операций

### Опциональные:

- `OPENROUTER_API_KEY` — API ключ OpenRouter
- `APP_URL` — URL приложения
- `APP_TITLE` — название приложения
- `ALLOWED_ORIGINS` — CORS origins (через запятую)

### Security:

- `WRITE_RL_LIMIT` — лимит запросов для rate-limit
- `WRITE_RL_WINDOW_SEC` — окно rate-limit (секунды)
- `ENABLE_NONCE` — включить nonce anti-replay (`1` или `0`)
- `NONCE_TTL_SEC` — TTL для nonce (секунды)

## API Endpoints

### Vision API

- `POST /v1/vision/analyze` — анализ изображения (JSON response)
- `POST /v1/vision/stream` — анализ с потоковым ответом (SSE)

### Prompts (Deno KV)

- `GET /v1/prompts` — список промптов
- `POST /v1/prompts` — создать промпт (требует `X-Admin-Token`)
- `GET /v1/prompts/:id` — получить по ID
- `PUT /v1/prompts/:id` — обновить (требует `X-Admin-Token`)
- `GET /v1/prompts/default` — получить default
- `PUT /v1/prompts/:id/default` — установить default (требует `X-Admin-Token`)

### Служебные

- `GET /healthz` — проверка живости
- `GET /about` — метаданные приложения
- `GET /openapi.yaml` — OpenAPI спецификация
- `POST /admin/backup` — ручной бэкап (требует `X-Admin-Token`)

## Примеры запросов

### Vision Analyze (JSON)

```bash
curl -X POST https://vlm-proxy.deno.dev/v1/vision/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "bigmodel",
    "model": "glm-4.5v",
    "prompt": "Что на фото?",
    "image_url": "https://example.com/image.jpg"
  }'
```

### Vision Stream (SSE)

```bash
curl -N -X POST https://vlm-proxy.deno.dev/v1/vision/stream \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "bigmodel",
    "prompt": "Опиши подробно",
    "image_url": "https://example.com/image.jpg",
    "stream": true
  }'
```

### Create Prompt

```bash
curl -X POST https://vlm-proxy.deno.dev/v1/prompts \
  -H "X-Admin-Token: YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "default",
    "name": "order_parser",
    "version": 1,
    "lang": "ru",
    "text": "Извлеки информацию о заказе из изображения...",
    "tags": ["parser", "orders"],
    "priority": 10,
    "is_active": true
  }'
```

## Структура проекта

```
vlm-api-vercel/
├── main.ts                    # Entrypoint (Deno)
├── deno.json                  # Конфигурация Deno
├── lib/
│   ├── router.ts              # Роутинг
│   ├── cors.ts                # CORS middleware
│   ├── providers/
│   │   ├── bigmodel.ts        # BigModel API client
│   │   └── openrouter.ts      # OpenRouter API client
│   ├── storage/
│   │   ├── types.ts           # Типы данных
│   │   ├── prompts.ts         # CRUD для промптов (Deno KV)
│   │   ├── indexes.ts         # Индексы KV
│   │   └── cached-prompts.ts  # Кэшированные операции
│   ├── cache/
│   │   └── memory.ts          # In-memory cache
│   ├── security/
│   │   ├── rate-limit.ts      # Rate limiting
│   │   └── nonce.ts           # Anti-replay
│   ├── streaming/
│   │   └── sse.ts             # SSE helpers
│   ├── backup/
│   │   ├── export.ts          # Export промптов
│   │   └── supabase.ts        # Supabase Storage (опц.)
│   ├── config/
│   │   └── regex.ts           # Regex cleanup config
│   └── utils/
│       ├── errors.ts          # Error responses
│       ├── logging.ts         # Structured logs
│       └── request-id.ts      # Request ID generator
└── tests/
    ├── smoke.sh               # Smoke тесты
    └── integration.test.ts    # Интеграционные тесты
```

## Разработка

### Этапы реализации

- [x] ЭТАП 0: Подготовка инфраструктуры
- [ ] ЭТАП 1: MVP Vision API (1 день)
- [ ] ЭТАП 2: Prompts в Deno KV (1.5 дня)
- [ ] ЭТАП 3: In-Memory Cache (0.5 дня)
- [ ] ЭТАП 4: Security (rate-limit + nonce) (0.5 дня)
- [ ] ЭТАП 5: Backups + Cron (0.5 дня)
- [ ] ЭТАП 6: Служебные API (/about, /openapi) (0.5 дня)
- [ ] ЭТАП 7: Полное тестирование (1 день)
- [ ] ЭТАП 8: Production деплой (0.5 дня)

**Итого:** 6.5 дней (~1.5 недели)

### Полезные команды

```bash
# Разработка
deno task dev                # Запуск с hot reload
deno task test               # Запуск тестов

# Деплой
deno task deploy             # Preview
deno task deploy:prod        # Production

# Управление проектом
deployctl logs --project=vlm-proxy              # Логи
deployctl deployments list --project=vlm-proxy  # Список деплоев
```

## Лицензия

MIT
