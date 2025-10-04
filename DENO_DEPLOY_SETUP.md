# Настройка Deno Deploy проекта

## Шаг 1: Регистрация и авторизация

### 1.1 Создайте аккаунт на Deno Deploy

1. Перейдите на https://deno.com/deploy
2. Нажмите "Sign Up" или "Get Started"
3. Войдите через GitHub (рекомендуется)

### 1.2 Авторизуйтесь через CLI

Откройте терминал и выполните:

```bash
deployctl login
```

Это откроет браузер для авторизации. Подтвердите доступ.

## Шаг 2: Создание проекта

### Вариант A: Через Dashboard (Web UI)

1. Откройте https://dash.deno.com/projects
2. Нажмите "New Project"
3. Введите имя проекта: `vlm-proxy` (или другое по желанию)
4. Выберите "Empty Project" (не привязываем к GitHub пока)
5. Нажмите "Create Project"

Запишите:
- **Project Name:** `vlm-proxy`
- **Project URL:** `https://vlm-proxy.deno.dev` (или ваш уникальный URL)

### Вариант B: Через CLI

```bash
deployctl projects create vlm-proxy
```

После создания получите информацию:

```bash
deployctl projects list
```

## Шаг 3: Настройка Environment Variables

### 3.1 Через Dashboard (рекомендуется)

1. Откройте ваш проект: https://dash.deno.com/projects/vlm-proxy
2. Перейдите в **Settings** → **Environment Variables**
3. Добавьте следующие переменные:

#### Обязательные (для MVP Vision API):

| Variable | Value | Описание |
|----------|-------|----------|
| `BIGMODEL_API_KEY` | `sk-...` | Ключ BigModel API |
| `DEFAULT_MODEL` | `glm-4.5v` | Модель по умолчанию |
| `ADMIN_TOKEN` | `<случайная строка>` | Токен для админ-операций |

Для генерации `ADMIN_TOKEN`:
```bash
# В PowerShell
[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((New-Guid).ToString()))
```

#### Опциональные (добавим позже):

| Variable | Value | Описание |
|----------|-------|----------|
| `OPENROUTER_API_KEY` | `sk-or-...` | Ключ OpenRouter (если используем) |
| `APP_URL` | `https://vlm-proxy.deno.dev` | URL вашего проекта |
| `APP_TITLE` | `VLM Proxy Deno` | Название приложения |
| `ALLOWED_ORIGINS` | `https://your-frontend.vercel.app,http://localhost:3000` | CORS origins |

#### Security (для ЭТАПА 4):

| Variable | Value | Описание |
|----------|-------|----------|
| `WRITE_RL_LIMIT` | `20` | Лимит запросов для rate-limit |
| `WRITE_RL_WINDOW_SEC` | `60` | Окно rate-limit (секунды) |
| `ENABLE_NONCE` | `1` | Включить nonce anti-replay |
| `NONCE_TTL_SEC` | `300` | TTL для nonce (секунды) |

### 3.2 Через CLI (альтернатива)

```bash
# Основные переменные
deployctl projects env set BIGMODEL_API_KEY sk-... --project=vlm-proxy
deployctl projects env set DEFAULT_MODEL glm-4.5v --project=vlm-proxy
deployctl projects env set ADMIN_TOKEN <ваш-токен> --project=vlm-proxy
```

## Шаг 4: Проверка настроек

### Проверьте список проектов:

```bash
deployctl projects list
```

Должно показать `vlm-proxy` в списке.

### Проверьте environment variables:

```bash
deployctl projects env list --project=vlm-proxy
```

Должно показать добавленные переменные (значения скрыты).

## Шаг 5: Создание локальной структуры проекта

Создадим папку для Deno проекта:

```bash
cd D:\WORK\CNC_Milling\WORK_CNC\SOFT\ProjectDB\API_to_VLM\Cloudflare_variant\Vercel_v1\vlm-api-vercel
mkdir deno-vlm-api
cd deno-vlm-api
```

Структура будет создана автоматически при разработке ЭТАПА 1.

## Шаг 6: Тестовый деплой

Для проверки создадим минимальный `main.ts`:

```typescript
// main.ts
Deno.serve(() => new Response("Hello from Deno Deploy!"));
```

Деплой:

```bash
deployctl deploy --project=vlm-proxy main.ts
```

Откройте в браузере: `https://vlm-proxy.deno.dev`

Должно показать: "Hello from Deno Deploy!"

## Готово! ✅

Теперь инфраструктура готова для разработки ЭТАПА 1 (MVP Vision API).

---

## Следующие шаги

1. ✅ Deno установлен
2. ✅ deployctl установлен
3. ✅ Проект на Deno Deploy создан
4. ✅ Environment variables настроены
5. ⏭️ Начать ЭТАП 1: Разработка MVP Vision API

---

## Полезные команды

```bash
# Локальный запуск (для разработки)
deno run --allow-net --allow-env main.ts

# Деплой на production
deployctl deploy --project=vlm-proxy --prod main.ts

# Просмотр логов
deployctl logs --project=vlm-proxy

# Список деплоев
deployctl deployments list --project=vlm-proxy

# Откат на предыдущую версию
deployctl deployments promote <deployment-id> --project=vlm-proxy
```
