# Инструкция по установке Deno для Windows

## Вариант 1: Установка через PowerShell (Рекомендуется)

1. **Откройте PowerShell от имени администратора**

2. **Выполните команду установки:**
   ```powershell
   irm https://deno.land/install.ps1 | iex
   ```

3. **Добавьте Deno в PATH (если не добавлено автоматически):**
   ```powershell
   $env:Path += ";$env:USERPROFILE\.deno\bin"
   [Environment]::SetEnvironmentVariable("Path", $env:Path, [EnvironmentVariableTarget]::User)
   ```

4. **Проверьте установку:**
   ```powershell
   deno --version
   ```

## Вариант 2: Установка через winget

1. **Откройте терминал (PowerShell или CMD)**

2. **Выполните:**
   ```bash
   winget install DenoLand.Deno
   ```

3. **Перезапустите терминал**

4. **Проверьте:**
   ```bash
   deno --version
   ```

## Вариант 3: Ручная установка (если автоматика не работает)

1. **Скачайте Deno вручную:**
   - Перейдите: https://github.com/denoland/deno/releases
   - Скачайте `deno-x86_64-pc-windows-msvc.zip`

2. **Распакуйте архив:**
   - Создайте папку: `C:\deno`
   - Распакуйте `deno.exe` в `C:\deno\`

3. **Добавьте в PATH:**
   - Откройте "Переменные среды" (Win+R → `sysdm.cpl` → вкладка "Дополнительно")
   - Нажмите "Переменные среды"
   - В разделе "Переменные пользователя" выберите `Path` → "Изменить"
   - Добавьте новую строку: `C:\deno`
   - Нажмите ОК везде

4. **Перезапустите все терминалы**

5. **Проверьте:**
   ```bash
   deno --version
   ```

## После успешной установки Deno

### Установите deployctl (инструмент для деплоя на Deno Deploy)

```bash
deno install -g --allow-all --no-check -r -f https://deno.land/x/deploy/deployctl.ts
```

### Проверьте deployctl:

```bash
deployctl --version
```

## Следующие шаги

После успешной установки вернитесь к плану реализации:
1. Создание проекта на Deno Deploy
2. Настройка environment variables
3. Разработка MVP Vision API

---

## Troubleshooting

### Ошибка "deno не является внутренней командой"
- Убедитесь что PATH содержит путь к deno
- Перезапустите терминал
- Попробуйте вариант 3 (ручная установка)

### PowerShell блокирует скрипты
Выполните в PowerShell от админа:
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Нет прав администратора
Используйте вариант 3 с установкой в `%USERPROFILE%\.deno` вместо `C:\deno`
