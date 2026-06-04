const roomId = window.ROOM_ID;
const textarea = document.getElementById("content");
const statusEl = document.getElementById("status");
const btnCopy = document.getElementById("btn-copy");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileList = document.getElementById("file-list");

let localUpdatedAt = 0;
let serverUpdatedAt = 0;
let filesUpdatedAt = 0;
let typing = false;
let saveTimer = null;
let pollTimer = null;
let uploading = 0;

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function renderFiles(files) {
  fileList.innerHTML = "";
  if (!files.length) {
    fileList.innerHTML = '<li class="hint" style="list-style:none;color:var(--muted)">Пока нет файлов</li>';
    return;
  }
  for (const f of files) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.dataset.id = f.id;
    const url = `/api/rooms/${roomId}/files/${f.id}`;
    li.innerHTML = `
      <span class="name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="meta">${formatSize(f.size)}</span>
      <span class="actions">
        <a class="btn small primary" href="${url}" download>Скачать</a>
        <button type="button" class="btn small danger btn-del">Удалить</button>
      </span>
    `;
    li.querySelector(".btn-del").addEventListener("click", () => deleteFile(f.id));
    fileList.appendChild(li);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function applyRoomData(data) {
  if (data.updated_at > serverUpdatedAt && !typing) {
    textarea.value = data.content;
    serverUpdatedAt = data.updated_at;
    localUpdatedAt = data.updated_at;
  }
  if (data.files_updated_at > filesUpdatedAt) {
    renderFiles(data.files || []);
    filesUpdatedAt = data.files_updated_at;
  }
}

async function fetchRoom() {
  const res = await fetch(`/api/rooms/${roomId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Ошибка");
  return data;
}

async function pushContent() {
  const res = await fetch(`/api/rooms/${roomId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: textarea.value,
      updated_at: localUpdatedAt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Ошибка");

  if (data.conflict) {
    applyRoomData(data);
    setStatus("Текст обновлён с другого устройства", "warn");
    return;
  }

  serverUpdatedAt = data.updated_at;
  localUpdatedAt = data.updated_at;
  if (!uploading) setStatus("Синхронизировано", "ok");
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    typing = false;
    pushContent().catch(() => setStatus("Ошибка отправки", "warn"));
  }, 400);
}

async function uploadFiles(fileListLike) {
  const files = [...fileListLike];
  if (!files.length) return;

  uploading += files.length;
  setStatus(`Загрузка (${files.length})…`);

  for (const file of files) {
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      const res = await fetch(`/api/rooms/${roomId}/files`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      applyRoomData(data);
      serverUpdatedAt = data.updated_at;
      localUpdatedAt = data.updated_at;
    } catch (e) {
      setStatus(e.message || "Ошибка загрузки", "warn");
    } finally {
      uploading -= 1;
    }
  }

  if (!uploading) setStatus("Файлы отправлены", "ok");
}

async function deleteFile(fileId) {
  if (!confirm("Удалить файл из комнаты?")) return;
  try {
    const res = await fetch(`/api/rooms/${roomId}/files/${fileId}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка");
    applyRoomData(data);
    filesUpdatedAt = data.files_updated_at;
    setStatus("Файл удалён", "ok");
  } catch (e) {
    setStatus(e.message || "Ошибка", "warn");
  }
}

async function poll() {
  try {
    const data = await fetchRoom();
    const textChanged = data.updated_at > serverUpdatedAt;
    const filesChanged = data.files_updated_at > filesUpdatedAt;
    if (textChanged || filesChanged) {
      applyRoomData(data);
      if (textChanged && !typing) setStatus("Получено с другого устройства", "ok");
      else if (filesChanged) setStatus("Новые файлы в комнате", "ok");
    }
  } catch {
    setStatus("Нет связи с сервером", "warn");
  }
}

textarea.addEventListener("input", () => {
  typing = true;
  setStatus("Печатаете…");
  scheduleSave();
});

textarea.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  const files = [];
  if (items) {
    for (const item of items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  if (files.length) {
    e.preventDefault();
    uploadFiles(files);
    return;
  }
  typing = true;
  scheduleSave();
});

btnCopy.addEventListener("click", async () => {
  const text = textarea.value;
  if (!text) {
    setStatus("Нечего копировать", "warn");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Текст скопирован", "ok");
  } catch {
    textarea.select();
    document.execCommand("copy");
    setStatus("Текст скопирован", "ok");
  }
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  uploadFiles(e.dataTransfer.files);
});

fileInput.addEventListener("change", () => {
  uploadFiles(fileInput.files);
  fileInput.value = "";
});

document.addEventListener("paste", (e) => {
  if (!e.clipboardData || document.activeElement === textarea) return;
  const files = [];
  for (const item of e.clipboardData.items) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    uploadFiles(files);
  }
});

(async () => {
  try {
    const data = await fetchRoom();
    textarea.value = data.content;
    serverUpdatedAt = data.updated_at;
    localUpdatedAt = data.updated_at;
    filesUpdatedAt = data.files_updated_at;
    renderFiles(data.files || []);
    setStatus("Готово — текст и файлы", "ok");
  } catch (e) {
    setStatus(e.message || "Комната недоступна", "warn");
  }
  pollTimer = setInterval(poll, 1000);
})();
