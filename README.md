# VLM API (Deno Deploy)

Edge-прокси для Vision Language Models (VLM/VLMM) с поддержкой ZAI, BigModel и OpenRouter. Проект рассчитан на работу в Deno Deploy (edge-runtime) и использует Deno KV для хранения и управления промптами.

## Возможности

- **Vision API**: анализ изображений в формате JSON или потоково через SSE.
- **Провайдеры**: ZAI (по умолчанию), BigModel и OpenRouter (опционально).
- **Prompts API**: хранение промптов в Deno KV, CRUD, список с фильтрами/сортировкой/пагинацией, поддержка default‑промпта.
- **Edge‑runtime**: быстрый холодный старт, стриминг без таймаутов.
- **CORS**: настройка разрешённых origins через переменные окружения.

## Стек и архитектура

- **Runtime**: Deno Deploy (edge).
- **Хранилище**: Deno KV.
- **Кэш**: горячий in‑memory кэш (в планах — расширение).
- **Структура**:
  - `main.ts` — точка входа и маршрутизация.
  - `lib/providers/*` — клиенты провайдеров и сборка OpenAI‑совместимого payload.
  - `lib/storage/*` — слой Prompts на Deno KV.
  - `lib/streaming/sse.ts` — SSE‑прокси и утилиты стриминга.
  - `lib/utils/*` — CORS, ошибки, логирование.

## API

Базовый URL зависит от окружения. Локально по умолчанию `http://localhost:8000`.

### Health

- `GET /healthz` — проверка healthz.

### Vision

- `POST /v1/vision/analyze` — анализ изображения, ответ JSON.
- `POST /v1/vision/stream` — анализ со стримингом SSE.

Поддерживаемые входные форматы:

- `application/json`
  - `provider`: `zai | bigmodel | openrouter` (опционально, по умолчанию `zai`)
  - `model`: строка (если не задана - используется `DEFAULT_MODEL`, иначе провайдерный дефолт)
  - `prompt`: строка (если не задана и нет `prompt_kv`, используется default?промпт из KV)
  - `prompt_id`: строковый ID промпта (взаимоисключает `prompt_kv`)
  - `prompt_kv`: объект критериев для выбора промпта из KV (используется, если `prompt` не задан)
    - `namespace`, `name`, `version`, `lang`, `tags`, `priority`
  - `image_url`: URL изображения или data‑URL
  - `image_base64`: base64 без `data:` префикса (будет обёрнут в data‑URL)
  - `images`: массив дополнительных URL/data‑URL (опционально)
  - `detail`: `low | high | auto` (опционально)
  - `stream`: boolean (для SSE используйте `/v1/vision/stream`)
- `multipart/form-data`
  - `file` (image/*), `prompt`, опционально `provider`, `model`, `detail`, `images`
  - `prompt_id` (строка)
  - `prompt_kv` (JSON?строка) или поля: `prompt_kv_namespace`, `prompt_kv_name`, `prompt_kv_version`, `prompt_kv_lang`, `prompt_kv_tags`, `prompt_kv_priority`

Если `prompt` и `prompt_kv` не заданы, используется default?промпт из KV с критериями: `namespace=default`, `priority=1`, `isDefault=true`, `isActive=true`. При равенстве выбирается наибольшая `version`.
Если `prompt` задан и не пустой, он имеет приоритет над `prompt_kv` и `prompt_id`.
`prompt_kv` и `prompt_id` взаимоисключают друг друга.

Пример JSON‑запроса:

```bash
curl -X POST http://localhost:8000/v1/vision/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "zai",
    "model": "glm-4.6v-flash",
    "prompt": "Что на фото?",
    "image_url": "https://example.com/image.jpg",
    "stream": false
  }'
```

Пример payload с `prompt_kv`:

```json
{
  "provider": "zai",
  "model": "glm-4.6v-flash",
  "prompt_kv": {
    "namespace": "default",
    "name": "order_parser",
    "version": 2,
    "lang": "ru",
    "tags": ["parser", "orders"],
    "priority": 10
  },
  "image_url": "https://example.com/image.jpg",
  "stream": false
}
```

Пример payload с `prompt_id`:

```json
{
  "provider": "zai",
  "model": "glm-4.6v-flash",
  "prompt_id": "XXXXXXXXXXXXXXX",
  "image_url": "https://example.com/image.jpg",
  "stream": false
}
```

Пример payload без ключей `prompt`, `prompt_kv`, `prompt_id`:

```json
{
  "provider": "zai",
  "model": "glm-4.6v-flash",
  "image_url": "https://example.com/image.jpg",
  "thinking": "enabled",
  "stream": false
}
```

Пример SSE‑стрима:

```bash
curl -N -X POST http://localhost:8000/v1/vision/stream \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "zai",
    "prompt": "Опиши подробно",
    "image_url": "https://example.com/image.jpg",
    "stream": true
  }'
```

### Prompts

Модель промпта хранится в KV. Записывающие операции требуют админ‑токен.

- `GET /v1/prompts` — список промптов.
  - Query‑параметры (все опциональны):  
    `namespace`, `name`, `isActive=true|false`, `tag`, `limit` (1–200), `cursor`,  
    `sortBy=priority|createdAt|updatedAt`, `sortOrder=asc|desc`
  - Ответ: `{ items: Prompt[], cursor?: string }`
- `POST /v1/prompts` — создать промпт (**требует** `X-Admin-Token`).
- `GET /v1/prompts/:id` — получить промпт по ID.
- `PUT /v1/prompts/:id` — обновить (**требует** `X-Admin-Token`).
- `DELETE /v1/prompts/:id` — удалить (**требует** `X-Admin-Token`).
- `GET /v1/prompts/default` — получить default‑промпт (опц. `?namespace=...`).
- `PUT /v1/prompts/:id/default` — установить default (**требует** `X-Admin-Token`, опц. `?namespace=...`).
- `POST /admin/prompts/defaults/sync` — синхронизировать default‑mapping (**требует** `X-Admin-Token`, опц. `?namespace=...`).

Пример создания промпта:

```bash
curl -X POST http://localhost:8000/v1/prompts \
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
    "isActive": true
  }'
```

## Переменные окружения

См. `.env.example` для полного списка и шаблона.

Обязательные:

- `OPENROUTER_API_KEY` - ключ OpenRouter (провайдер по умолчанию).
- `DEFAULT_MODEL` - модель по умолчанию (например, `glm-4.6v-flash`).
- `ADMIN_TOKEN` - токен для админ-операций (Prompts write + админ-эндпоинты).

Опциональные:

- `ZAI_API_KEY` - ключ ZAI (если используется).
- `BIGMODEL_API_KEY` - ключ BigModel (если используется).
- `APP_URL`, `APP_TITLE` — метаданные приложения.
- `ALLOWED_ORIGINS` — CORS origins через запятую.
- Безопасность (включение/настройка по необходимости):  
  `WRITE_RL_LIMIT`, `WRITE_RL_WINDOW_SEC`, `ENABLE_NONCE`, `NONCE_TTL_SEC`
- Supabase для бэкапов (опционально):  
  `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

## Локальная разработка

1) Установите Deno (см. документацию Deno).
2) Создайте файл окружения:

```bash
cp .env.example .env
```

3) Запустите dev‑сервер:

```bash
deno task dev
```

Сервер стартует с hot‑reload и слушает порт `8000`, если не задано иначе.

## Деплой в Deno Deploy

Требуется `deployctl` (устанавливается через `deno install`).

```bash
# Preview деплой
deno task deploy

# Production деплой
deno task deploy:prod
```

## Тестирование

```bash
deno task test
```

## Статус и планы

Реализовано:
- Vision API (JSON + SSE) и провайдеры BigModel/OpenRouter.
- Prompts API на Deno KV: CRUD, list, default‑промпт, синхронизация default‑mapping.

В планах:
- Расширение кэширования (in‑memory + KV).
- Rate‑limit и nonce для write‑операций.
- Служебные эндпоинты и автоматические бэкапы.
- Интеграционные тесты и расширение документации.

## Лицензия

MIT.

## Images (R2 upload)

Use this endpoint to upload a local image (multipart/form-data) to Cloudflare R2 and get an `image_url` for ZAI.

- `POST /v1/images/upload`
  - `multipart/form-data`: `file` (image/jpeg|image/png)
  - Limits (ZAI): size <= 5MB, pixels <= 6000x6000
  - Response: `{ key, url, expiresInSec?, etag?, contentType, size, width, height }`

