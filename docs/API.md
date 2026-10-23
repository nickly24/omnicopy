# Копирник API v1

API без авторизации: `https://nickly24-omnicopy-f94f.twc1.net/api/v1`.
Локально: `http://127.0.0.1:8000/api/v1`.

Документация: `/api/docs`. Машиночитаемая схема OpenAPI 3.1: `/api/openapi.json`.
Её operationId предназначены для инструментов будущего плагина; сам плагин пока не создаётся.

## Типовой сценарий плагина

1. Если пользователь дал код комнаты, запросить `GET /rooms/{room_id}`.
2. Если комнаты ещё нет, `POST /rooms` создаёт её и первый буфер. Передать пользователю `id` и ссылку `/r/{id}`.
3. Для нового текста вызвать `POST /rooms/{room_id}/buffers` с `title` и `content`.
4. Для изменения — `PATCH /rooms/{room_id}/buffers/{note_id}` с `content` и/или `title`.
5. Файл отправлять multipart-запросом в `/rooms/{room_id}/buffers/{note_id}/files`, поле `file`.
6. Скачать файл можно GET-запросом по `download_url` из его метаданных. URL относительный к хосту API, а не к `/api/v1`.

Коды комнат всегда строки из четырёх цифр: `"0042"`, а не число `42`.
`note_id` в путях — идентификатор буфера `buffers[].id`, это не его название.
`buffer_id` в файле — идентификатор того же буфера; `note_id` в метаданных файла оставлен как совместимый псевдоним.

## Запросы

| Метод | Путь | Результат |
| --- | --- | --- |
| POST | `/rooms` | 201, комната и первый буфер; необязательный JSON `{ "title": "Название", "content": "Текст" }` |
| GET | `/rooms/{room_id}` | 200, комната со всеми буферами и метаданными файлов |
| DELETE | `/rooms/{room_id}` | 200, `{ "deleted": true, "id": "0042" }` |
| GET | `/rooms/{room_id}/buffers` | 200, `{ "buffers": [...] }` и срок жизни |
| POST | `/rooms/{room_id}/buffers` | 201, буфер; необязательный JSON `title`, `content` |
| GET | `/rooms/{room_id}/buffers/{note_id}` | 200, буфер и его `files` |
| PATCH | `/rooms/{room_id}/buffers/{note_id}` | 200, буфер; JSON `title` и/или `content`, необязательный `version` |
| DELETE | `/rooms/{room_id}/buffers/{note_id}` | 200, оставшаяся комната; вложения буфера тоже удаляются |
| GET | `/rooms/{room_id}/files` | 200, `{ "files": [...] }` и срок жизни |
| POST | `/rooms/{room_id}/files` | 201, `{ "file": {...} }`; multipart `file`, необязательный `buffer_id` (по умолчанию первый буфер) |
| GET | `/rooms/{room_id}/buffers/{note_id}/files` | 200, файлы одного буфера |
| POST | `/rooms/{room_id}/buffers/{note_id}/files` | 201, `{ "file": {...} }`; multipart `file` |
| GET | `/rooms/{room_id}/files/{file_id}` | 200, исходные байты файла, MIME и Content-Disposition с UTF-8 именем |
| DELETE | `/rooms/{room_id}/files/{file_id}` | 200, обновлённая комната |

## Примеры curl

```sh
# Создать комнату с первым текстом.
curl -X POST https://nickly24-omnicopy-f94f.twc1.net/api/v1/rooms \
  -H 'Content-Type: application/json' \
  -d '{"title":"Из чата","content":"Привет из плагина"}'

# В ответе взять id комнаты и buffers[0].id. Подставить их вместо 0042 и BUFFER_ID.
curl https://nickly24-omnicopy-f94f.twc1.net/api/v1/rooms/0042

curl -X POST https://nickly24-omnicopy-f94f.twc1.net/api/v1/rooms/0042/buffers \
  -H 'Content-Type: application/json' -d '{"title":"SQL","content":"SELECT 1;"}'

curl -X PATCH https://nickly24-omnicopy-f94f.twc1.net/api/v1/rooms/0042/buffers/BUFFER_ID \
  -H 'Content-Type: application/json' -d '{"content":"SELECT 2;"}'

curl -X POST https://nickly24-omnicopy-f94f.twc1.net/api/v1/rooms/0042/buffers/BUFFER_ID/files \
  -F 'file=@./example.txt'

curl https://nickly24-omnicopy-f94f.twc1.net/api/v1/rooms/0042/files/FILE_ID -o downloaded.txt
curl -X DELETE https://nickly24-omnicopy-f94f.twc1.net/api/v1/rooms/0042/files/FILE_ID
curl -X DELETE https://nickly24-omnicopy-f94f.twc1.net/api/v1/rooms/0042/buffers/BUFFER_ID
```

## Правила работы

- Обновление без `version` заменяет указанные поля последними переданными значениями. Поле `content` заменяется целиком: для дописывания сначала прочитать текст.
- Если передать `version`, сервер проверит её. При конфликте — 409, JSON `{ "error": "...", "note": { ...актуальный буфер... } }`. Сначала прочитать и согласовать текст, затем повторить с актуальной версией.
- Изменения плагина появляются в веб-комнате при следующей синхронизации.
- Основной буфер тоже можно удалить. Первый оставшийся буфер становится основным для desktop-клиента. Если удалён последний, сервер создаёт новый пустой буфер.
- Комнаты не имеют срока жизни. Поля API сохранены для совместимости: `expires_at: 0`, `ttl_seconds: 0` означают отсутствие срока; `server_time` — текущее время сервера в Unix seconds.
- Комнаты, буферы и файлы хранятся только в памяти процесса и пропадают после перезапуска/деплоя. Открытие `/r/{room_id}` создаёт пустую комнату с указанным кодом, если её нет; существующая комната сохраняет содержимое. Чтение через API по-прежнему возвращает 404 для отсутствующей комнаты. Сервер запускать одним worker: `gunicorn main:app --bind 0.0.0.0:8000 --timeout 60`.
- Ограничения: 30 буферов, 20 файлов, 25 МиБ/файл, 50 МиБ/комнату, 1 000 000 символов/буфер, название от 1 до 80 символов. Пустые файлы не принимаются.
- JSON-ошибки: `{"error":"..."}`. 400 — неверные данные/лимит количества, 404 — ресурс не найден, 409 — конфликт, 413 — размер, 415 — Content-Type, 503 — коды комнат заняты.
- CORS разрешён для любого origin. API-ответы не кешируются.
- Старые пути `/api/rooms/.../notes` и desktop-обновление `PUT /api/rooms/{room_id}` продолжают работать.
