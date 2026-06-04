const roomId = window.ROOM_ID;
const textarea = document.getElementById("content");
const statusEl = document.getElementById("status");
const btnCopy = document.getElementById("btn-copy");

let localUpdatedAt = 0;
let serverUpdatedAt = 0;
let typing = false;
let saveTimer = null;
let pollTimer = null;

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
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
    textarea.value = data.content;
    serverUpdatedAt = data.updated_at;
    localUpdatedAt = data.updated_at;
    setStatus("Обновлено с другого устройства", "warn");
    return;
  }

  serverUpdatedAt = data.updated_at;
  localUpdatedAt = data.updated_at;
  setStatus("Синхронизировано", "ok");
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    typing = false;
    pushContent().catch(() => setStatus("Ошибка отправки", "warn"));
  }, 400);
}

async function poll() {
  if (typing) return;
  try {
    const data = await fetchRoom();
    if (data.updated_at > serverUpdatedAt) {
      textarea.value = data.content;
      serverUpdatedAt = data.updated_at;
      localUpdatedAt = data.updated_at;
      setStatus("Получено с другого устройства", "ok");
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

textarea.addEventListener("paste", () => {
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
    setStatus("Скопировано в буфер", "ok");
  } catch {
    textarea.select();
    document.execCommand("copy");
    setStatus("Скопировано (fallback)", "ok");
  }
});

(async () => {
  try {
    const data = await fetchRoom();
    textarea.value = data.content;
    serverUpdatedAt = data.updated_at;
    localUpdatedAt = data.updated_at;
    setStatus("Готово — вставляйте и копируйте", "ok");
  } catch (e) {
    setStatus(e.message || "Комната недоступна", "warn");
  }
  pollTimer = setInterval(poll, 1000);
})();
