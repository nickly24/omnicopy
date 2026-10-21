const roomId = window.ROOM_ID;
const apiRoot = `/api/rooms/${roomId}`;
const grid = document.getElementById('notes-grid');
const states = new Map();
let roomFiles = [];
let primaryId;
let selectedView = 'notes';
let loaded = false;
let unavailable = false;
let toastTimer;
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = (text) => text.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const formatSize = n => n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message; el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}
function syncStatus(message, kind = '') {
  const el = document.getElementById('sync-status');
  el.className = `sync-status ${kind}`; el.querySelector('span').textContent = message;
}
async function api(path = '', options = {}) {
  const response = await fetch(apiRoot + path, {...options, signal: AbortSignal.timeout(15000)});
  const data = await response.json();
  if (!response.ok) { const e = new Error(data.error || 'Ошибка сервера'); e.status = response.status; e.data = data; throw e; }
  return data;
}
function jsonOptions(method, data) { return {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)}; }
async function copy(text, button) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const area = document.createElement('textarea'); area.value = text;
      area.style.cssText = 'position:fixed;opacity:0'; document.body.append(area); area.select();
      const success = document.execCommand('copy'); area.remove();
      if (!success) throw new Error('copy');
    }
    if (button) {
      const original = button.innerHTML;
      button.innerHTML = `${icon('check')}Скопировано`;
      setTimeout(() => { if (button.isConnected) button.innerHTML = original; }, 1600);
    } else toast('Скопировано');
  } catch { toast('Не удалось скопировать. Выделите текст и нажмите Ctrl+C / ⌘C.'); }
}
function detect(text) {
  const value = text.trim();
  if (!value) return {type: 'text', label: 'ТЕКСТ'};
  if (/^[\[{]/.test(value)) {
    try { JSON.parse(value); return {type:'json', label:'JSON'}; }
    catch { return {type:'json', label:'JSON · ОШИБКА', invalid:true}; }
  }
  if (value.startsWith('<')) {
    const doc = new DOMParser().parseFromString(value, 'application/xml');
    return {type:'xml', label:doc.querySelector('parsererror') ? 'XML · ОШИБКА' : 'XML', invalid:!!doc.querySelector('parsererror')};
  }
  const statement = value.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '');
  if (/^(?:SELECT\b|WITH\s+(?:RECURSIVE\s+)?[\w"`\[]+|INSERT\s+INTO\b|UPDATE\s+[\w"`\[]+\s+SET\b|DELETE\s+FROM\b|(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW|INDEX|DATABASE|SCHEMA|FUNCTION|PROCEDURE|TRIGGER)\b|EXPLAIN\b|MERGE\s+INTO\b|BEGIN\s*;|COMMIT\s*;|ROLLBACK\s*;)/i.test(statement)) {
    return {type:'sql', label:'SQL'};
  }
  return {type:'text', label:'ТЕКСТ'};
}
function highlight(text, type) {
  if (text.length > 100000) return escapeHtml(text);
  if (type === 'sql') {
    const keywords = new Set('SELECT FROM WHERE JOIN LEFT RIGHT INNER OUTER FULL CROSS ON AS AND OR NOT IN IS NULL TRUE FALSE INSERT INTO VALUES UPDATE SET DELETE CREATE ALTER DROP TRUNCATE TABLE VIEW INDEX DATABASE SCHEMA IF EXISTS DISTINCT ALL UNION INTERSECT EXCEPT GROUP BY ORDER HAVING LIMIT OFFSET FETCH FIRST NEXT ROW ROWS ONLY ASC DESC WITH RECURSIVE RETURNING CASE WHEN THEN ELSE END BETWEEN LIKE ILIKE EXISTS OVER PARTITION WINDOW FILTER NULLS LAST BEGIN COMMIT ROLLBACK TRANSACTION PRIMARY FOREIGN KEY REFERENCES CONSTRAINT UNIQUE DEFAULT CHECK CASCADE ADD COLUMN RENAME TO REPLACE TEMP TEMPORARY EXPLAIN ANALYZE MERGE USING MATCHED DO NOTHING CONFLICT PROCEDURE FUNCTION TRIGGER RETURNS RETURN DECLARE LANGUAGE GRANT REVOKE EXEC EXECUTE CALL TOP USE GO'.split(' '));
    const types = new Set('INT INTEGER BIGINT SMALLINT DECIMAL NUMERIC FLOAT DOUBLE REAL BOOLEAN BOOL TEXT VARCHAR CHAR NVARCHAR DATE TIME DATETIME TIMESTAMP INTERVAL JSON JSONB UUID BYTEA SERIAL BIGSERIAL'.split(' '));
    const tokens = /(?<comment>--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(?<string>'(?:''|\\.|[^'\\])*(?:'|$)|(?<delimiter>\$(?:[A-Za-z_]\w*)?\$)[\s\S]*?\k<delimiter>)|(?<identifier>"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\])|(?<number>\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<parameter>:[A-Za-z_]\w*|\$\d+|@[A-Za-z_]\w*)|(?<word>\b[A-Za-z_]\w*\b)|(?<operator>::|[=<>!+*/%|~-]+)/g;
    let out = '', last = 0;
    for (const m of text.matchAll(tokens)) {
      out += escapeHtml(text.slice(last, m.index));
      const g = m.groups;
      let kind = g.comment ? 'comment' : g.string ? 'string' : g.identifier ? 'identifier' : g.number ? 'number' : g.parameter ? 'parameter' : g.operator ? 'punct' : '';
      if (g.word) {
        const word = g.word.toUpperCase();
        kind = keywords.has(word) ? 'keyword' : types.has(word) ? 'type' : /^\s*\(/.test(text.slice(m.index + m[0].length)) ? 'function' : '';
      }
      out += kind ? `<span class="tok-${kind}">${escapeHtml(m[0])}</span>` : escapeHtml(m[0]);
      last = m.index + m[0].length;
    }
    return out + escapeHtml(text.slice(last));
  }
  if (type === 'json') {
    let out = '', last = 0;
    const tokens = /"(?:\\.|[^"\\])*"\s*(?=:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;
    for (const m of text.matchAll(tokens)) {
      out += escapeHtml(text.slice(last, m.index));
      const rest = text.slice(m.index + m[0].length);
      const kind = m[0].startsWith('"') ? (/^:/.test(rest) ? 'key' : 'string') : 'number';
      out += `<span class="tok-${kind}">${escapeHtml(m[0])}</span>`; last = m.index + m[0].length;
    }
    return out + escapeHtml(text.slice(last));
  }
  if (type === 'xml') {
    let out = '', last = 0;
    const tokens = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>/g;
    for (const m of text.matchAll(tokens)) {
      out += escapeHtml(text.slice(last, m.index));
      if (m[0].startsWith('<!--')) out += `<span class="tok-comment">${escapeHtml(m[0])}</span>`;
      else {
        const raw = m[0]; let markup = '', end = 0;
        for (const attr of raw.matchAll(/([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g)) {
          markup += escapeHtml(raw.slice(end, attr.index));
          markup += `<span class="tok-attr">${escapeHtml(attr[1])}</span>${escapeHtml(attr[2])}<span class="tok-string">${escapeHtml(attr[3])}</span>`;
          end = attr.index + attr[0].length;
        }
        out += `<span class="tok-tag">${markup + escapeHtml(raw.slice(end))}</span>`;
      }
      last = m.index + m[0].length;
    }
    return out + escapeHtml(text.slice(last));
  }
  return escapeHtml(text);
}
function updateEditor(state) {
  const text = state.el.querySelector('textarea').value;
  const detected = detect(text);
  const badge = state.el.querySelector('.type-badge');
  badge.className = `type-badge ${detected.type} ${detected.invalid ? 'invalid' : ''}`;
  badge.textContent = detected.label;
  badge.title = detected.invalid ? 'Проверьте синтаксис. Текст сохраняется без изменений.' : 'Формат определён автоматически';
  state.el.querySelector('pre').innerHTML = highlight(text, detected.type) + '\n';
  state.el.querySelector('.char-count').textContent = `${text.length.toLocaleString('ru')} симв.`;
  state.el.querySelector('.card-type-icon').innerHTML = icon(detected.type === 'text' ? 'file' : 'code');
  state.el.querySelector('.copy-button').disabled = !text;
}
function cardStatus(state, message, saved = false) {
  state.el.querySelector('.card-state').innerHTML = (saved ? icon('check') : '') + `<span>${escapeHtml(message)}</span>`;
}
function updateLinks() {
  const links = document.getElementById('note-links'); links.replaceChildren();
  for (const state of states.values()) {
    const link = document.createElement('button'); link.className = 'note-link';
    link.innerHTML = '<span class="note-link-dot"></span><span></span>';
    link.lastChild.textContent = state.el.querySelector('.note-title').value || 'Без названия';
    link.addEventListener('click', () => { setView('notes'); state.el.scrollIntoView({behavior:'smooth', block:'center'}); state.el.classList.remove('flash'); requestAnimationFrame(() => state.el.classList.add('flash')); });
    links.append(link);
  }
  document.getElementById('notes-count').textContent = states.size;
  document.getElementById('files-count').textContent = roomFiles.length;
  document.getElementById('section-count').textContent = String(selectedView === 'notes' ? states.size : roomFiles.length).padStart(2, '0');
}
function dirty(state) {
  state.dirty = true; state.sequence++;
  cardStatus(state, 'Не сохранено');
  clearTimeout(state.timer); state.timer = setTimeout(() => save(state), 500);
}
function showConflict(state, remote) {
  state.conflict = remote || {deleted:true};
  const panel = state.el.querySelector('.conflict-panel'); panel.hidden = false;
  panel.querySelector('p').textContent = remote ? 'Есть изменения с другого устройства. Ваш текст сохранён здесь — выберите нужную версию.' : 'Карточка удалена на другом устройстве. Вы можете сохранить свой текст в новой карточке.';
  panel.querySelector('.use-remote').hidden = !remote;
  panel.querySelector('.keep-local').textContent = remote ? 'Оставить мою версию' : 'Сохранить копию';
  cardStatus(state, 'Нужно выбрать версию');
  syncStatus('Есть несохранённые изменения', 'warn');
}
async function save(state) {
  if (state.saving || !state.dirty || state.conflict || unavailable) return;
  const title = state.el.querySelector('.note-title').value.trim();
  if (!title) { cardStatus(state, 'Добавьте название'); return; }
  state.saving = true;
  const sequence = state.sequence;
  const content = state.el.querySelector('textarea').value;
  cardStatus(state, 'Сохраняем…');
  try {
    const note = await api(`/notes/${state.id}`, jsonOptions('PATCH', {title, content, version:state.version}));
    state.version = note.version;
    state.serverTitle = note.title;
    if (sequence === state.sequence) { state.dirty = false; cardStatus(state, 'Сохранено', true); }
  } catch (e) {
    if (e.status === 409) showConflict(state, e.data.note);
    else if (e.status === 404) showConflict(state, null);
    else { cardStatus(state, 'Не отправлено · повторяем'); syncStatus(e.status ? e.message : 'Нет связи · текст остаётся здесь', 'warn'); }
  } finally {
    state.saving = false;
    if (state.dirty && sequence !== state.sequence && !state.conflict) save(state);
  }
}
function applyNote(state, note) {
  state.version = note.version; state.serverTitle = note.title;
  state.el.querySelector('.note-title').value = note.title;
  state.el.querySelector('textarea').value = note.content;
  updateEditor(state); cardStatus(state, 'Сохранено', true);
}
function createCard(note) {
  const el = document.createElement('article'); el.className = 'note-card'; el.dataset.id = note.id;
  el.innerHTML = `<div class="card-heading"><span class="card-type-icon">${icon('file')}</span><input class="note-title" aria-label="Название карточки" maxlength="80" title="Нажмите, чтобы переименовать"><button class="icon-button delete-note" title="Удалить карточку" aria-label="Удалить карточку">${icon('trash')}</button></div>
    <div class="card-meta"><span class="type-badge">ТЕКСТ</span><span class="char-count">0 симв.</span></div>
    <div class="editor"><pre aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="Текст карточки" maxlength="1000000" placeholder="Вставьте текст, XML, JSON или SQL…"></textarea></div>
    <div class="card-footer"><span class="card-state"></span><button class="button primary copy-button" title="Скопировать текст">${icon('copy')}Скопировать</button></div>
    <div class="conflict-panel" hidden><p></p><div><button class="button subtle use-remote">Взять с сервера</button><button class="button primary keep-local">Оставить мою версию</button></div></div>
    <div class="attachments"><div class="card-files"></div><button class="drop-hint">${icon('upload')}Добавить файл<span class="sr-only"> для этой карточки</span></button><input class="file-input" type="file" multiple hidden></div>`;
  const state = {id:note.id, version:note.version, el, dirty:false, sequence:0, saving:false, conflict:null};
  states.set(note.id, state);
  const textarea = el.querySelector('textarea');
  el.querySelector('.note-title').addEventListener('input', () => { dirty(state); updateLinks(); });
  el.querySelector('.note-title').addEventListener('blur', () => {
    if (!el.querySelector('.note-title').value.trim()) { el.querySelector('.note-title').value = state.serverTitle; dirty(state); updateLinks(); }
  });
  textarea.addEventListener('input', () => { updateEditor(state); dirty(state); });
  textarea.addEventListener('scroll', () => { el.querySelector('pre').scrollTop = textarea.scrollTop; el.querySelector('pre').scrollLeft = textarea.scrollLeft; });
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault(); textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end'); updateEditor(state); dirty(state);
    }
  });
  el.querySelector('.copy-button').addEventListener('click', e => copy(textarea.value, e.currentTarget));
  el.querySelector('.delete-note').hidden = note.id === primaryId;
  el.querySelector('.delete-note').addEventListener('click', () => confirmDelete(state));
  const input = el.querySelector('.file-input');
  el.querySelector('.drop-hint').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { uploadFiles(state, [...input.files]); input.value = ''; });
  let dragDepth = 0;
  el.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth++; el.classList.add('dragover'); } });
  el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  el.addEventListener('dragleave', () => { if (--dragDepth <= 0) el.classList.remove('dragover'); });
  el.addEventListener('drop', e => {
    dragDepth = 0; el.classList.remove('dragover');
    if (e.dataTransfer.files.length) { e.preventDefault(); uploadFiles(state, [...e.dataTransfer.files]); }
  });
  el.addEventListener('paste', e => { if (e.clipboardData?.files.length) { e.preventDefault(); uploadFiles(state, [...e.clipboardData.files]); } });
  el.querySelector('.use-remote').addEventListener('click', () => {
    applyNote(state, state.conflict); state.dirty = false; state.conflict = null;
    el.querySelector('.conflict-panel').hidden = true; updateLinks();
  });
  el.querySelector('.keep-local').addEventListener('click', async () => {
    if (state.conflict.deleted) {
      try {
        const replacement = await api('/notes', {method:'POST'});
        const result = await api(`/notes/${replacement.id}`, jsonOptions('PATCH', {version:replacement.version, title:el.querySelector('.note-title').value.trim() || 'Восстановленная карточка', content:textarea.value}));
        states.delete(state.id); el.remove(); createCard(result); updateLinks(); toast('Текст сохранён в новой карточке');
      } catch (e) { toast(e.message); }
      return;
    }
    state.version = state.conflict.version; state.conflict = null;
    el.querySelector('.conflict-panel').hidden = true; state.dirty = true; save(state);
  });
  applyNote(state, note);
  grid.insertBefore(el, document.getElementById('add-card'));
  return state;
}
function fileRow(file) {
  const row = document.createElement('div'); row.className = 'file-row';
  row.innerHTML = `${icon('file')}<div class="file-info"><span class="file-name"></span><span class="file-size"></span></div><a download title="Скачать файл" aria-label="Скачать файл">${icon('download')}</a><button class="icon-button" title="Удалить файл" aria-label="Удалить файл">${icon('trash')}</button>`;
  row.querySelector('.file-name').textContent = file.name; row.querySelector('.file-name').title = file.name;
  row.querySelector('.file-size').textContent = formatSize(file.size);
  row.querySelector('a').href = `${apiRoot}/files/${file.id}`;
  row.querySelector('button').addEventListener('click', async () => {
    try { const data = await api(`/files/${file.id}`, {method:'DELETE'}); roomFiles = data.files; renderFiles(); updateLinks(); toast('Файл удалён'); }
    catch (e) { toast(e.message); }
  });
  return row;
}
let filesSignature = '';
function renderFiles() {
  const signature = JSON.stringify(roomFiles.map(f => f.id)) + [...states.keys()].join();
  if (signature === filesSignature) return;
  filesSignature = signature;
  for (const state of states.values()) {
    const list = state.el.querySelector('.card-files'); list.replaceChildren();
    roomFiles.filter(f => f.note_id === state.id).forEach(f => list.append(fileRow(f)));
  }
  const all = document.getElementById('all-files'); all.replaceChildren();
  if (!roomFiles.length) all.innerHTML = `<div class="files-empty">${icon('folder')}<h2>Место для ваших файлов</h2><p>Перетащите файл в любую карточку.<br>До 25 МБ на файл и 50 МБ на комнату.</p></div>`;
  else roomFiles.forEach(f => all.append(fileRow(f)));
}
async function uploadFiles(state, files) {
  let done = 0;
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) { toast(`${file.name}: максимум 25 МБ`); continue; }
    const form = new FormData(); form.append('file', file); form.append('note_id', state.id);
    cardStatus(state, `Загружаем ${file.name}…`);
    try {
      const data = await api('/files', {method:'POST', body:form});
      roomFiles = data.files; renderFiles(); updateLinks(); done++;
    } catch (e) { toast(e.message); }
  }
  cardStatus(state, state.dirty ? 'Не сохранено' : 'Сохранено', !state.dirty);
  if (done) toast(done === 1 ? 'Файл добавлен' : `Добавлено файлов: ${done}`);
}
function setView(view) {
  selectedView = view;
  document.getElementById('view-notes').classList.toggle('active', view === 'notes');
  document.getElementById('view-files').classList.toggle('active', view === 'files');
  grid.hidden = view !== 'notes'; document.getElementById('all-files').hidden = view !== 'files';
  document.getElementById('view-title').textContent = view === 'notes' ? 'Ваше пространство' : 'Файлы комнаты';
  document.getElementById('section-label').textContent = view === 'notes' ? 'КАРТОЧКИ' : 'ФАЙЛЫ'; updateLinks();
}
let adding = false;
async function addNote() {
  if (adding || unavailable || !loaded) return;
  adding = true;
  try {
    const note = await api('/notes', {method:'POST'});
    const state = createCard(note); updateLinks(); renderFiles(); setView('notes');
    state.el.scrollIntoView({behavior:'smooth', block:'nearest'});
    state.el.querySelector('.note-title').focus(); state.el.querySelector('.note-title').select();
  } catch (e) { toast(e.message); }
  finally { adding = false; }
}
let deleting;
function confirmDelete(state) { deleting = state; document.getElementById('confirm-dialog').showModal(); }
document.getElementById('cancel-delete').addEventListener('click', () => document.getElementById('confirm-dialog').close());
document.getElementById('confirm-delete').addEventListener('click', async () => {
  if (!deleting) return;
  const state = deleting;
  document.getElementById('confirm-dialog').close();
  try {
    const data = await api(`/notes/${state.id}`, {method:'DELETE'});
    clearTimeout(state.timer); states.delete(state.id); state.el.remove(); roomFiles = data.files;
    renderFiles(); updateLinks(); toast('Карточка удалена');
  } catch (e) { toast(e.message); }
});
function applyRoom(data) {
  primaryId = data.notes[0].id;
  const remoteIds = new Set(data.notes.map(n => n.id));
  for (const [id, state] of states) {
    if (!remoteIds.has(id)) {
      if (state.dirty || state.saving) showConflict(state, null);
      else { clearTimeout(state.timer); state.el.remove(); states.delete(id); }
    }
  }
  for (const note of data.notes) {
    const state = states.get(note.id);
    if (!state) createCard(note);
    else if (!state.saving && note.version > state.version) {
      if (state.dirty || state.conflict) showConflict(state, note);
      else applyNote(state, note);
    }
  }
  roomFiles = data.files; renderFiles(); updateLinks();
}
async function poll() {
  try {
    const data = await api();
    unavailable = false; document.getElementById('room-error').hidden = true;
    applyRoom(data); loaded = true;
    window.roomTransition?.ready();
    for (const state of states.values()) if (state.dirty && !state.conflict) save(state);
    const pending = [...states.values()].some(s => s.dirty || s.conflict || s.saving);
    syncStatus(pending ? 'Сохраняем изменения…' : 'Всё синхронизировано', pending ? 'warn' : '');
    if ([...states.values()].some(s => s.conflict)) syncStatus('Выберите версию карточки', 'warn');
  } catch (e) {
    if (e.status === 404) {
      unavailable = true;
      const el = document.getElementById('room-error'); el.hidden = false;
      el.textContent = 'Комната не найдена или срок её жизни истёк. Текст на экране можно скопировать. Создайте новую комнату на главной странице.';
      syncStatus('Комната недоступна', 'error');
    } else syncStatus('Нет связи · повторяем подключение', 'warn');
  } finally { setTimeout(poll, 1200); }
}
document.getElementById('add-note').addEventListener('click', addNote);
document.getElementById('sidebar-add').addEventListener('click', addNote);
document.getElementById('view-notes').addEventListener('click', () => setView('notes'));
document.getElementById('view-files').addEventListener('click', () => setView('files'));
document.getElementById('copy-code').addEventListener('click', () => copy(roomId));
document.getElementById('copy-link').addEventListener('click', () => copy(location.href));
window.addEventListener('beforeunload', e => {
  if ([...states.values()].some(s => s.dirty || s.saving)) { e.preventDefault(); e.returnValue = ''; }
});
poll();

const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');
function expandMenu(open) {
  sidebar.classList.toggle('is-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Свернуть меню' : 'Развернуть меню');
}
sidebar.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') expandMenu(true); });
sidebar.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') expandMenu(false); });
menuToggle.addEventListener('click', () => expandMenu(!sidebar.classList.contains('is-open')));
sidebar.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) expandMenu(true); });
sidebar.addEventListener('focusout', e => { if (!sidebar.contains(e.relatedTarget)) expandMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') expandMenu(false); });
document.addEventListener('pointerdown', e => { if (!sidebar.contains(e.target)) expandMenu(false); });
