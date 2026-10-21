const create = document.getElementById('btn-create');
const error = document.getElementById('entry-error');
const input = document.getElementById('room-id');
input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); error.textContent = ''; });
create.addEventListener('click', async () => {
  create.disabled = true; error.textContent = '';
  try {
    const res = await fetch('/api/rooms', {method: 'POST'});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await window.roomTransition.enter(`/r/${data.id}`);
  } catch (e) { error.textContent = e.message || 'Не удалось создать комнату'; create.disabled = false; }
});
document.getElementById('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const btn = document.getElementById('btn-join'); btn.disabled = true; error.textContent = '';
  try {
    const res = await fetch(`/api/rooms/${input.value}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await window.roomTransition.enter(`/r/${data.id}`);
  } catch (e) { error.textContent = e.message || 'Не удалось подключиться'; btn.disabled = false; }
});
