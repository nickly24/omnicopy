import math
import os
import random
import threading
import time
import uuid
from dataclasses import dataclass, field

from flask import Flask, Response, jsonify, render_template, request
from werkzeug.http import dump_options_header
from werkzeug.exceptions import BadRequest, HTTPException, UnsupportedMediaType

from api_spec import build_spec

app = Flask(__name__)
ROOM_TTL_SEC = 0  # Kept for compatibility; zero means no expiration.
MAX_FILE_SIZE = 25 * 1024 * 1024
MAX_FILES_PER_ROOM = 20
MAX_ROOM_FILES_BYTES = 50 * 1024 * 1024
MAX_NOTES = 30
MAX_TEXT_LENGTH = 1_000_000
# Allow multipart headers in addition to the file itself.
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE + 1024 * 1024


@dataclass
class Note:
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    title: str = "Основной буфер"
    content: str = ""
    version: int = 1
    updated_at: float = field(default_factory=time.time)


@dataclass
class RoomFile:
    id: str
    name: str
    mime: str
    data: bytes
    size: int
    note_id: str
    uploaded_at: float = field(default_factory=time.time)


@dataclass
class Room:
    notes: list[Note] = field(default_factory=lambda: [Note()])
    activity_at: float = field(default_factory=time.time)
    files: dict[str, RoomFile] = field(default_factory=dict)
    files_updated_at: float = field(default_factory=time.time)


_rooms: dict[str, Room] = {}
_lock = threading.Lock()


def _note_payload(note):
    return {"id": note.id, "title": note.title, "content": note.content,
            "version": note.version, "updated_at": note.updated_at}


def _file_meta(f):
    extra = {"buffer_id": f.note_id, "download_url": f"/api/v1/rooms/{request.view_args['room_id']}/files/{f.id}"} if request.path.startswith("/api/v1/") else {}
    return {**extra, "id": f.id, "name": f.name, "size": f.size, "mime": f.mime,
            "note_id": f.note_id, "uploaded_at": f.uploaded_at}


def _lifetime(room):
    return {"expires_at": 0,  # Numeric compatibility fields: zero means unlimited.
            "server_time": time.time(), "ttl_seconds": ROOM_TTL_SEC}


def _room_payload(room_id, room):
    primary = room.notes[0]
    return {**_lifetime(room), "id": room_id, "content": primary.content, "updated_at": primary.updated_at,
            ("buffers" if request.path.startswith("/api/v1/") else "notes"): [_note_payload(n) for n in room.notes],
            "files": [_file_meta(f) for f in room.files.values()],
            "files_updated_at": room.files_updated_at}


def _touch_note(room, note):
    note.version += 1
    note.updated_at = max(time.time(), note.updated_at + 0.000001)
    room.activity_at = time.time()


def _json_object():
    if not request.content_length:
        return {}
    if not request.is_json:
        raise UnsupportedMediaType("Ожидается Content-Type: application/json")
    data = request.get_json()
    if not isinstance(data, dict):
        raise BadRequest("Тело запроса должно быть JSON-объектом")
    return data


def _note_data_error(data):
    if "title" in data and (not isinstance(data["title"], str) or not 1 <= len(data["title"].strip()) <= 80):
        return "Название должно содержать от 1 до 80 символов"
    if "content" in data and (not isinstance(data["content"], str) or len(data["content"]) > MAX_TEXT_LENGTH):
        return "Максимум 1 000 000 символов в буфере"
    if "version" in data and (type(data["version"]) is not int or data["version"] < 1):
        return "Версия должна быть положительным целым числом"


@app.get("/api/openapi.json")
@app.get("/api/v1/openapi.json")
def openapi():
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    if scheme not in ("https", "http"):
        scheme = request.scheme
    base = os.environ.get("PUBLIC_BASE_URL", f"{scheme}://{request.host}").rstrip("/")
    return jsonify(build_spec(base))


@app.get("/api/docs")
def api_docs():
    return render_template("api-docs.html")


@app.before_request
def validate_room_id():
    room_id = (request.view_args or {}).get("room_id")
    if room_id is not None and (len(room_id) != 4 or not room_id.isascii() or not room_id.isdigit()):
        return jsonify(error="Код должен состоять из 4 цифр"), 400


@app.after_request
def api_response_headers(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Expose-Headers"] = "Content-Disposition, Content-Length"
    return response


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/r/<room_id>")
def room_page(room_id):
    with _lock:
        if room_id not in _rooms:
            _rooms[room_id] = Room()
    return render_template("room.html", room_id=room_id)


@app.post("/api/v1/rooms")
@app.post("/api/rooms")
def create_room():
    data = _json_object()
    error = _note_data_error(data)
    if error:
        return jsonify(error=error), 400
    with _lock:
        available = list(set(range(10000)) - {int(rid) for rid in _rooms})
        if not available:
            return jsonify(error="Все комнаты заняты. Попробуйте позже"), 503
        rid = f"{random.choice(available):04d}"
        _rooms[rid] = Room(notes=[Note(title=data.get("title", "Основной буфер").strip(), content=data.get("content", ""))])
        return jsonify(_room_payload(rid, _rooms[rid])), 201


@app.get("/api/v1/rooms/<room_id>")
@app.get("/api/rooms/<room_id>")
def get_room(room_id):
    with _lock:
        room = _rooms.get(room_id)
        if room is None:
            return jsonify(error="Комната не найдена"), 404
        return jsonify(_room_payload(room_id, room))


@app.put("/api/rooms/<room_id>")
def update_room(room_id):
    # Legacy desktop clients synchronize the first card.
    data = _json_object()
    content, revision = data.get("content"), data.get("updated_at")
    if not isinstance(content, str) or len(content) > MAX_TEXT_LENGTH:
        return jsonify(error="Нужен текст длиной до 1 000 000 символов"), 400
    if revision is not None and (type(revision) not in (int, float) or not math.isfinite(revision)):
        return jsonify(error="Некорректная версия текста"), 400
    with _lock:
        room = _rooms.get(room_id)
        if room is None:
            return jsonify(error="Комната не найдена"), 404
        note = room.notes[0]
        if revision is not None and revision < note.updated_at:
            return jsonify({**_room_payload(room_id, room), "conflict": True})
        note.content = content
        _touch_note(room, note)
        return jsonify(_room_payload(room_id, room))


@app.post("/api/v1/rooms/<room_id>/buffers")
@app.post("/api/rooms/<room_id>/notes")
def create_note(room_id):
    data = _json_object()
    error = _note_data_error(data)
    if error:
        return jsonify(error=error), 400
    with _lock:
        room = _rooms.get(room_id)
        if room is None:
            return jsonify(error="Комната не найдена"), 404
        if len(room.notes) >= MAX_NOTES:
            return jsonify(error="В комнате может быть до 30 карточек"), 400
        note = Note(title=data.get("title", f"Buffer {len(room.notes) + 1}").strip(), content=data.get("content", ""))
        room.notes.append(note)
        room.activity_at = time.time()
        return jsonify({**_note_payload(note), **_lifetime(room)}), 201


@app.patch("/api/v1/rooms/<room_id>/buffers/<note_id>")
@app.patch("/api/rooms/<room_id>/notes/<note_id>")
def update_note(room_id, note_id):
    data = _json_object()
    error = _note_data_error(data)
    if error:
        return jsonify(error=error), 400
    if not any(key in data for key in ("title", "content")):
        return jsonify(error="Укажите название или текст"), 400
    with _lock:
        room = _rooms.get(room_id)
        note = next((n for n in room.notes if n.id == note_id), None) if room else None
        if note is None:
            return jsonify(error="Карточка не найдена"), 404
        if "version" in data and data["version"] != note.version:
            return jsonify(error="Карточка изменена на другом устройстве", note=_note_payload(note)), 409
        if "title" in data:
            note.title = data["title"].strip()
        if "content" in data:
            note.content = data["content"]
        _touch_note(room, note)
        return jsonify({**_note_payload(note), **_lifetime(room)})


@app.delete("/api/v1/rooms/<room_id>/buffers/<note_id>")
@app.delete("/api/rooms/<room_id>/notes/<note_id>")
def delete_note(room_id, note_id):
    with _lock:
        room = _rooms.get(room_id)
        if room is None or not any(n.id == note_id for n in room.notes):
            return jsonify(error="Карточка не найдена"), 404
        room.notes = [n for n in room.notes if n.id != note_id]
        if not room.notes:
            room.notes.append(Note())
        room.files = {fid: f for fid, f in room.files.items() if f.note_id != note_id}
        room.activity_at = room.files_updated_at = time.time()
        return jsonify(_room_payload(room_id, room))


@app.post("/api/v1/rooms/<room_id>/buffers/<note_id>/files")
@app.post("/api/v1/rooms/<room_id>/files")
@app.post("/api/rooms/<room_id>/files")
def upload_file(room_id, note_id=None):
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify(error="Выберите файл"), 400
    raw = upload.read(MAX_FILE_SIZE + 1)
    if not raw:
        return jsonify(error="Файл пуст"), 400
    if len(raw) > MAX_FILE_SIZE:
        return jsonify(error="Максимум 25 МБ на файл"), 413
    # Preserve Cyrillic filenames, removing paths and control characters.
    name = upload.filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(c for c in name if ord(c) >= 32 and ord(c) != 127)[:240] or "file"
    with _lock:
        room = _rooms.get(room_id)
        if room is None:
            return jsonify(error="Комната не найдена"), 404
        note_id = note_id or request.form.get("buffer_id") or request.form.get("note_id") or room.notes[0].id
        if not any(n.id == note_id for n in room.notes):
            return jsonify(error="Карточка не найдена"), 404
        if len(room.files) >= MAX_FILES_PER_ROOM:
            return jsonify(error="Не больше 20 файлов в комнате"), 400
        if sum(f.size for f in room.files.values()) + len(raw) > MAX_ROOM_FILES_BYTES:
            return jsonify(error="Превышен лимит комнаты — 50 МБ"), 413
        fid = uuid.uuid4().hex[:12]
        room.files[fid] = RoomFile(fid, name, upload.mimetype or "application/octet-stream", raw, len(raw), note_id)
        room.activity_at = room.files_updated_at = time.time()
        if request.path.startswith("/api/v1/"):
            return jsonify({"file": _file_meta(room.files[fid]), **_lifetime(room)}), 201
        return jsonify({**_room_payload(room_id, room), "uploaded_id": fid}), 201


@app.get("/api/v1/rooms/<room_id>/files/<file_id>")
@app.get("/api/rooms/<room_id>/files/<file_id>")
def download_file(room_id, file_id):
    from urllib.parse import quote
    with _lock:
        room = _rooms.get(room_id)
        f = room.files.get(file_id) if room else None
        if f is None:
            return jsonify(error="Файл не найден"), 404
        room.activity_at = time.time()
    disposition = dump_options_header("attachment", {"filename": "download"})
    disposition += "; filename*=UTF-8''" + quote(f.name)
    return Response(f.data, mimetype=f.mime, headers={"Content-Disposition": disposition,
                    "Content-Length": str(f.size), "X-Content-Type-Options": "nosniff"})


@app.delete("/api/v1/rooms/<room_id>/files/<file_id>")
@app.delete("/api/rooms/<room_id>/files/<file_id>")
def delete_file(room_id, file_id):
    with _lock:
        room = _rooms.get(room_id)
        if room is None or file_id not in room.files:
            return jsonify(error="Файл не найден"), 404
        del room.files[file_id]
        room.activity_at = room.files_updated_at = time.time()
        return jsonify(_room_payload(room_id, room))


@app.delete("/api/v1/rooms/<room_id>")
def delete_room(room_id):
    with _lock:
        if room_id not in _rooms:
            return jsonify(error="Комната не найдена"), 404
        del _rooms[room_id]
        return jsonify(deleted=True, id=room_id)


@app.get("/api/v1/rooms/<room_id>/buffers")
def list_buffers(room_id):
    with _lock:
        room = _rooms.get(room_id)
        if room is None:
            return jsonify(error="Комната не найдена"), 404
        return jsonify(buffers=[_note_payload(n) for n in room.notes], **_lifetime(room))


@app.get("/api/v1/rooms/<room_id>/buffers/<note_id>")
def get_buffer(room_id, note_id):
    with _lock:
        room = _rooms.get(room_id)
        note = next((n for n in room.notes if n.id == note_id), None) if room else None
        if note is None:
            return jsonify(error="Буфер не найден"), 404
        return jsonify({**_note_payload(note), "files": [_file_meta(f) for f in room.files.values() if f.note_id == note_id], **_lifetime(room)})


@app.get("/api/v1/rooms/<room_id>/files")
@app.get("/api/v1/rooms/<room_id>/buffers/<note_id>/files")
def list_files(room_id, note_id=None):
    with _lock:
        room = _rooms.get(room_id)
        if room is None:
            return jsonify(error="Комната не найдена"), 404
        if note_id and not any(n.id == note_id for n in room.notes):
            return jsonify(error="Буфер не найден"), 404
        return jsonify(files=[_file_meta(f) for f in room.files.values() if note_id is None or f.note_id == note_id], **_lifetime(room))


@app.errorhandler(HTTPException)
def api_http_error(error):
    if request.path.startswith("/api/"):
        return jsonify(error=error.description), error.code
    return error


@app.errorhandler(413)
def too_large(_e):
    return jsonify(error="Максимум 25 МБ на файл"), 413


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host=os.environ.get("HOST", "0.0.0.0"), port=port, debug=debug)
