const btnCreate = document.getElementById("btn-create");
const btnJoin = document.getElementById("btn-join");
const roomInput = document.getElementById("room-id");

btnCreate.addEventListener("click", async () => {
  btnCreate.disabled = true;
  try {
    const res = await fetch("/api/rooms", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Ошибка");
    window.location.href = `/r/${data.id}`;
  } catch (e) {
    alert(e.message || "Не удалось создать комнату");
    btnCreate.disabled = false;
  }
});

function goJoin() {
  const id = roomInput.value.replace(/\D/g, "").slice(0, 4);
  if (id.length !== 4) {
    alert("Введите 4 цифры");
    return;
  }
  window.location.href = `/r/${id}`;
}

btnJoin.addEventListener("click", goJoin);
roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") goJoin();
});
