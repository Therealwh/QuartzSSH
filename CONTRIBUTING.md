# Contributing to QuartzSSH

Спасибо за интерес к проекту! Любой вклад приветствуется: баг-репорты, фичи, документация, переводы.

## Как помочь

1. **Баги и идеи** — создайте issue по шаблону. Для багов приложите шаги воспроизведения, ожидаемое и фактическое поведение.
2. **Изменения кода** — форкните репозиторий, создайте ветку от `main` (например, `feat/sftp-queue-limits`), внесите изменения и откройте PR.
3. **Переводы** — добавьте ресурсный файл в `src/i18n/` и предложите его через PR; структура ключей должна совпадать с `ru.json`/`en.json`.

## Правила разработки

- **Conventional Commits** для сообщений: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Один PR — одна логическая задача.
- Перед пушем убедитесь, что локально проходят:
  - `npm run typecheck` — TypeScript;
  - `npm test` — тесты фронтенда;
  - `cargo test` (в `src-tauri/`) — тесты Rust;
  - `cargo clippy -- -D warnings` и `cargo fmt --check`.
- Комментарии в коде — на английском; код и строки UI не должны содержать захардкоженных сообщений — используйте i18n-ресурсы.

## Сборка из исходников

Требования: Node.js 20+, Rust 1.89+ (MSVC на Windows), NASM (нужен крейту `ring` на Windows — `choco install nasm`), на Linux — `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

```bash
npm install
npm run tauri dev     # разработка
npm run tauri build   # сборка установщика
```

На Windows NASM должен быть в PATH (`C:\Program Files\NASM`).

## Безопасность

Нашли уязвимость? Не создавайте публичный issue — следуйте инструкции в [SECURITY.md](SECURITY.md).

## Лицензия

Отправляя изменения, вы соглашаетесь лицензировать их под [MIT](LICENSE).
