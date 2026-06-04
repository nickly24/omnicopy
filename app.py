import random
import threading
import time
import uuid
from dataclasses import dataclass, field

from flask import Flask, Response, jsonify, render_template, request
from werkzeug.utils import secure_filename

app = Flask(__name__)

ROOM_TTL_SEC = 3600
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 МБ на файл
MAX_FILES_PER_ROOM = 20
MAX_ROOM_FILES_BYTES = 50 * 1024 * 1024  # 50 МБ на комнату

app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE


@dataclass
class RoomFile:
    id: str
    name: str
    mime: str
    data: bytes
    size: int
    uploaded_at: float = field(default_factory=time.time)


@dataclass
class Room:
    content: str = ""
    updated_at: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)
    files: dict[str, RoomFile] = field(default_factory=dict)
    files_updated_at: float = field(default_factory=time.time)


_rooms: dict[str, Room] = {}
_lock = threading.Lock()


def _cleanup_expired() -> None:
    now = time.time()
    expired = [
        rid
        for rid, room in _rooms.items()
        if now - room.updated_at > ROOM_TTL_SEC
    ]
    for rid in expired:
        del _rooms[rid]


def _generate_room_id() -> str:
    for _ in range(100):
        code = f"{random.randint(0, 9999):04d}"
        if code not in _rooms:
            return code
    raise RuntimeError("Не удалось создать комнату")


def _get_or_create_room(room_id: str) -> Room:
    room = _rooms.get(room_id)
    if room is None:
        now = time.time()
        room = Room(created_at=now, updated_at=now, files_updated_at=now)
        _rooms[room_id] = room
    return room


def _room_files_size(room: Room) -> int:
    return sum(f.size for f in room.files.values())


def _file_meta(f: RoomFile) -> dict:
    return {
        "id": f.id,
        "name": f.name,
        "size": f.size,
        "mime": f.mime,
        "uploaded_at": f.uploaded_at,
    }


def _room_payload(room_id: str, room: Room) -> dict:
    return {
        "id": room_id,
        "content": room.content,
        "updated_at": room.updated_at,
        "files": [_file_meta(f) for f in room.files.values()],
        "files_updated_at": room.files_updated_at,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/r/<room_id>")
def room_page(room_id: str):
    room_id = room_id.strip()
    if len(room_id) != 4 or not room_id.isdigit():
        return render_template("index.html", error="Код должен быть из 4 цифр"), 400
    return render_template("room.html", room_id=room_id)


@app.post("/api/rooms")
def create_room():
    with _lock:
        _cleanup_expired()
        room_id = _generate_room_id()
        _rooms[room_id] = Room()
    return jsonify({"id": room_id})


@app.get("/api/rooms/<room_id>")
def get_room(room_id: str):
    with _lock:
        _cleanup_expired()
        room = _rooms.get(room_id)
        if room is None:
            return jsonify({"error": "Комната не найдена"}), 404
        return jsonify(_room_payload(room_id, room))


@app.put("/api/rooms/<room_id>")
def update_room(room_id: str):
    data = request.get_json(silent=True) or {}
    if "content" not in data:
        return jsonify({"error": "Нужно поле content"}), 400

    content = data["content"]
    if not isinstance(content, str):
        return jsonify({"error": "content должен быть строкой"}), 400

    client_updated = data.get("updated_at")
    now = time.time()

    with _lock:
        _cleanup_expired()
        room = _get_or_create_room(room_id)
        if client_updated is not None and client_updated < room.updated_at:
            payload = _room_payload(room_id, room)
            payload["conflict"] = True
            return jsonify(payload)
        room.content = content
        room.updated_at = now
        return jsonify(_room_payload(room_id, room))


@app.post("/api/rooms/<room_id>/files")
def upload_file(room_id: str):
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"error": "Нужен файл (поле file)"}), 400

    raw = upload.read()
    size = len(raw)
    if size == 0:
        return jsonify({"error": "Пустой файл"}), 400
    if size > MAX_FILE_SIZE:
        return jsonify({"error": f"Максимум {MAX_FILE_SIZE // (1024 * 1024)} МБ на файл"}), 413

    name = secure_filename(upload.filename) or "file"
    mime = upload.mimetype or "application/octet-stream"
    now = time.time()

    with _lock:
        _cleanup_expired()
        room = _get_or_create_room(room_id)

        if len(room.files) >= MAX_FILES_PER_ROOM:
            return jsonify({"error": f"Не больше {MAX_FILES_PER_ROOM} файлов в комнате"}), 400

        if _room_files_size(room) + size > MAX_ROOM_FILES_BYTES:
            return jsonify({"error": "Превышен лимит памяти комнаты (50 МБ)"}), 413

        file_id = uuid.uuid4().hex[:12]
        room.files[file_id] = RoomFile(
            id=file_id,
            name=name,
            mime=mime,
            data=raw,
            size=size,
            uploaded_at=now,
        )
        room.files_updated_at = now
        room.updated_at = now
        return jsonify(
            {
                **_room_payload(room_id, room),
                "uploaded_id": file_id,
            }
        ), 201


@app.get("/api/rooms/<room_id>/files/<file_id>")
def download_file(room_id: str, file_id: str):
    with _lock:
        _cleanup_expired()
        room = _rooms.get(room_id)
        if room is None:
            return jsonify({"error": "Комната не найдена"}), 404
        f = room.files.get(file_id)
        if f is None:
            return jsonify({"error": "Файл не найден"}), 404
        room.updated_at = time.time()

    return Response(
        f.data,
        mimetype=f.mime,
        headers={
            "Content-Disposition": f'attachment; filename="{f.name}"',
            "Content-Length": str(f.size),
        },
    )


@app.delete("/api/rooms/<room_id>/files/<file_id>")
def delete_file(room_id: str, file_id: str):
    with _lock:
        _cleanup_expired()
        room = _rooms.get(room_id)
        if room is None:
            return jsonify({"error": "Комната не найдена"}), 404
        if file_id not in room.files:
            return jsonify({"error": "Файл не найден"}), 404
        del room.files[file_id]
        now = time.time()
        room.files_updated_at = now
        room.updated_at = now
        return jsonify(_room_payload(room_id, room))


@app.errorhandler(413)
def too_large(_e):
    return jsonify({"error": f"Файл больше {MAX_FILE_SIZE // (1024 * 1024)} МБ"}), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
