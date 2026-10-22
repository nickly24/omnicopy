"""Dependency-free OpenAPI contract for the public plugin API."""


def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def build_spec(base_url):
    string = {"type": "string"}
    lifetime = {"expires_at": {"type": "number", "description": "Unix seconds until automatic room deletion"},
                "server_time": {"type": "number"}, "ttl_seconds": {"type": "integer", "example": 7200}}
    edit = {"title": {"type": "string", "minLength": 1, "maxLength": 80},
            "content": {"type": "string", "maxLength": 1000000}}
    note = {"id": string, **edit, "version": {"type": "integer", "minimum": 1}, "updated_at": {"type": "number"}}
    schemas = {
        "Error": {"type": "object", "required": ["error"], "properties": {"error": string, "note": ref("Buffer")}},
        "BufferInput": {"type": "object", "properties": edit},
        "BufferPatch": {"type": "object", "minProperties": 1, "anyOf": [{"required": ["title"]}, {"required": ["content"]}],
                        "properties": {**edit, "version": {"type": "integer", "minimum": 1, "description": "Optional optimistic lock; omit for a simple update. A stale version returns 409."}}},
        "Buffer": {"type": "object", "required": ["id", "title", "content", "version"], "properties": {**note, **lifetime, "files": {"type": "array", "items": ref("File")}}},
        "File": {"type": "object", "required": ["id", "name", "buffer_id", "download_url"], "properties": {
            "id": string, "name": string, "mime": string, "size": {"type": "integer"}, "buffer_id": string,
            "note_id": {"type": "string", "description": "Legacy alias of buffer_id"}, "uploaded_at": {"type": "number"},
            "download_url": {"type": "string", "description": "Relative URL on this API host; GET returns raw file bytes."}}},
        "Room": {"type": "object", "required": ["id", "buffers", "files", "expires_at"], "properties": {
            "id": {"type": "string", "pattern": "^[0-9]{4}$", "example": "0042"}, **lifetime,
            "buffers": {"type": "array", "items": ref("Buffer")}, "files": {"type": "array", "items": ref("File")},
            "content": {"type": "string", "description": "Text of the first buffer, for desktop compatibility"},
            "updated_at": {"type": "number"}, "files_updated_at": {"type": "number"}}},
        "BufferList": {"type": "object", "required": ["buffers"], "properties": {**lifetime, "buffers": {"type": "array", "items": ref("Buffer")}}},
        "FileList": {"type": "object", "required": ["files"], "properties": {**lifetime, "files": {"type": "array", "items": ref("File")}}},
        "UploadResult": {"type": "object", "required": ["file"], "properties": {**lifetime, "file": ref("File")}},
        "DeletedRoom": {"type": "object", "required": ["deleted", "id"], "properties": {"deleted": {"type": "boolean"}, "id": string}},
    }
    paths = {}

    def operation(path, method, operation_id, summary, output, *, body=None, status="200", description=None):
        params = []
        for name in ("room_id", "note_id", "file_id"):
            if "{" + name + "}" in path:
                schema = {"type": "string"}
                if name == "room_id":
                    schema["pattern"] = "^[0-9]{4}$"
                params.append({"name": name, "in": "path", "required": True, "schema": schema,
                               "description": "Buffer ID from buffers[].id" if name == "note_id" else name})
        responses = {status: {"description": "Success", "content": {"application/json": {"schema": ref(output)}}}}
        for code in ("400", "404", "409", "413", "415", "503"):
            responses[code] = {"description": {"400": "Invalid input or room limit reached", "404": "Room expired or resource not found", "409": "Version conflict", "413": "File or room size limit exceeded", "415": "Unsupported request content type", "503": "No room codes available"}[code], "content": {"application/json": {"schema": ref("Error")}}}
        op = {"operationId": operation_id, "summary": summary, "parameters": params, "responses": responses}
        if description:
            op["description"] = description
        if body:
            op["requestBody"] = body
        paths.setdefault(path, {})[method] = op
        return op

    def json_body(schema, required=False):
        return {"required": required, "content": {"application/json": {"schema": ref(schema)}}}

    upload = {"required": True, "content": {"multipart/form-data": {"schema": {"type": "object", "required": ["file"], "properties": {
        "file": {"type": "string", "format": "binary"}, "buffer_id": {"type": "string", "description": "Optional when uploading to the room. Defaults to the first buffer."}}}}}}
    room = "/rooms/{room_id}"
    buffers = room + "/buffers"
    buffer = buffers + "/{note_id}"
    files = room + "/files"
    file = files + "/{file_id}"
    operation("/rooms", "post", "createRoom", "Create a room, optionally with initial text", "Room", body=json_body("BufferInput"), status="201")
    operation(room, "get", "getRoom", "Read a room, all buffers and file metadata", "Room")
    operation(room, "delete", "deleteRoom", "Delete a room and all its buffers and files", "DeletedRoom")
    operation(buffers, "get", "listBuffers", "List room buffers with their text", "BufferList")
    operation(buffers, "post", "createBuffer", "Create a named buffer with optional text", "Buffer", body=json_body("BufferInput"), status="201")
    operation(buffer, "get", "getBuffer", "Read one buffer and its file metadata", "Buffer")
    operation(buffer, "patch", "updateBuffer", "Update a buffer's title or text", "Buffer", body=json_body("BufferPatch", True))
    operation(buffer, "delete", "deleteBuffer", "Delete a buffer and its attached files", "Room", description="Deleting the final buffer creates a new empty default buffer so the room remains usable.")
    operation(files, "get", "listRoomFiles", "List metadata for all room files", "FileList")
    operation(files, "post", "uploadRoomFile", "Upload a file to a room", "UploadResult", body=upload, status="201")
    operation(buffer + "/files", "get", "listBufferFiles", "List metadata for one buffer's files", "FileList")
    operation(buffer + "/files", "post", "uploadBufferFile", "Upload a file to a specific buffer", "UploadResult", body=upload, status="201")
    download = operation(file, "get", "downloadFile", "Download raw file bytes", "File")
    download["responses"]["200"] = {"description": "Original file bytes with Content-Disposition filename", "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}
    operation(file, "delete", "deleteFile", "Delete a file from a room", "Room")
    return {
        "openapi": "3.1.0", "info": {"title": "Копирник API", "version": "1.0.0", "description":
            "Public API without authentication. Room codes are strings of four digits, preserving leading zeros. Rooms and files live in server memory and disappear on restart or after 2 hours without activity. Reads do not extend room lifetime; writes and downloads do. Limits: 30 buffers, 20 files, 25 MiB/file, 50 MiB/room, 1,000,000 characters/buffer."},
        "servers": [{"url": base_url + "/api/v1"}], "security": [], "paths": paths,
        "components": {"schemas": schemas},
    }
