import random
import threading
import time
from dataclasses import dataclass, field

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

ROOM_TTL_SEC = 3600  # комната живёт 1 час без активности
POLL_HINT_SEC = 1


@dataclass
class Room:
    content: str = ""
    updated_at: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)


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
        return jsonify(
            {
                "id": room_id,
                "content": room.content,
                "updated_at": room.updated_at,
            }
        )


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
        room = _rooms.get(room_id)
        if room is None:
            _rooms[room_id] = Room(content=content, updated_at=now, created_at=now)
            room = _rooms[room_id]
        else:
            if client_updated is not None and client_updated < room.updated_at:
                return jsonify(
                    {
                        "id": room_id,
                        "content": room.content,
                        "updated_at": room.updated_at,
                        "conflict": True,
                    }
                )
            room.content = content
            room.updated_at = now

        return jsonify(
            {
                "id": room_id,
                "content": room.content,
                "updated_at": room.updated_at,
            }
        )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
