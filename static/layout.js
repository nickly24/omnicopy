(() => {
  const grid = document.getElementById('notes-grid');
  const stage = document.getElementById('notes-stage');
  const layer = document.getElementById('grid-resizers');
  const toggle = document.getElementById('layout-toggle');
  const menu = document.getElementById('layout-menu');
  const key = `kopirnik-layout:${window.ROOM_ID}`;
  const presets = [
    {id:'columns', label:'Рядом', cells:[[2,2,8,16],[14,2,8,16]], sizes:[.5,.5]},
    {id:'wide-left', label:'Шире слева', cells:[[2,2,12,16],[18,2,4,16]], sizes:[.65,.35]},
    {id:'wide-right', label:'Шире справа', cells:[[2,2,4,16],[10,2,12,16]], sizes:[.35,.65]},
    {id:'two-left', label:'Две слева', cells:[[2,2,8,6],[2,12,8,6],[14,2,8,16]], sizes:[.5,.5]},
    {id:'two-right', label:'Две справа', cells:[[2,2,8,16],[14,2,8,6],[14,12,8,6]], sizes:[.5,.5]},
    {id:'three', label:'Три колонки', cells:[[1,2,5,16],[9,2,5,16],[17,2,5,16]], sizes:[1/3,1/3,1/3]},
    {id:'stack', label:'Друг под другом', cells:[[2,2,20,6],[2,12,20,6]], sizes:[1]}
  ];
  let layout = 'columns';
  let savedSizes = {};
  let sizes = [];
  let signature = '';
  let dragging = false;
  const compact = matchMedia('(max-width: 850px)');
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (presets.some(p => p.id === saved?.layout)) layout = saved.layout;
    if (saved?.sizes && typeof saved.sizes === 'object') savedSizes = saved.sizes;
  } catch {}
  function persist() {
    try { localStorage.setItem(key, JSON.stringify({layout, sizes:savedSizes})); } catch {}
  }
  function open(value) {
    menu.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
  }
  for (const preset of presets) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'layout-option'; button.dataset.layout = preset.id;
    button.setAttribute('aria-pressed', String(layout === preset.id));
    button.innerHTML = `<svg viewBox="0 0 24 20" aria-hidden="true">${preset.cells.map(([x,y,w,h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2"/>`).join('')}</svg><span>${preset.label}</span>`;
    button.addEventListener('click', () => {
      layout = preset.id; persist(); signature = ''; refresh(); open(false); toggle.focus();
    });
    document.getElementById('layout-options').append(button);
  }
  toggle.addEventListener('click', () => open(menu.hidden));
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.layout-picker')) open(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { open(false); toggle.focus(); } });
  document.addEventListener('focusin', e => { if (!e.target.closest('.layout-picker')) open(false); });
  function setColumns() {
    grid.style.gridTemplateColumns = sizes.map(n => `minmax(0,${n}fr)`).join(' ');
    positionHandles();
  }
  function positionHandles() {
    if (!sizes.length || grid.hidden || stage.hidden) return;
    const style = getComputedStyle(grid);
    const columns = style.gridTemplateColumns.split(' ').map(parseFloat);
    const gap = parseFloat(style.columnGap) || 0;
    let left = 0;
    [...layer.children].forEach((handle, i) => {
      left += columns[i] || 0;
      handle.style.left = `${left + gap * (i + .5)}px`;
      const percent = Math.round(sizes[i] / (sizes[i] + sizes[i + 1]) * 100);
      handle.setAttribute('aria-valuenow', String(percent));
      handle.setAttribute('aria-valuetext', `Левая колонка ${percent}%, правая ${100 - percent}%`);
    });
  }
  function saveSizes() { savedSizes[layout] = sizes.slice(); persist(); }
  function adjust(index, delta, initial = sizes) {
    const pair = initial[index] + initial[index + 1];
    const min = Math.min(220 / Math.max(grid.clientWidth, 1), pair * .4);
    sizes[index] = Math.max(min, Math.min(pair - min, initial[index] + delta));
    sizes[index + 1] = pair - sizes[index];
    setColumns();
  }
  function makeHandle(index) {
    const handle = document.createElement('div'); handle.className = 'grid-resizer'; handle.tabIndex = 0;
    handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', `Ширина колонок ${index + 1} и ${index + 2}`);
    handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '100');
    handle.title = 'Потяните для изменения ширины · двойной щелчок — поровну';
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); dragging = true;
      const origin = e.clientX, initial = sizes.slice();
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      const width = grid.clientWidth - gap * (sizes.length - 1);
      handle.setPointerCapture(e.pointerId); handle.focus();
      document.body.classList.add('resizing-columns'); handle.classList.add('dragging');
      const move = event => adjust(index, (event.clientX - origin) / width, initial);
      const end = () => {
        dragging = false; document.body.classList.remove('resizing-columns'); handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); handle.removeEventListener('lostpointercapture', end);
        saveSizes();
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
    });
    handle.addEventListener('keydown', e => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
      e.preventDefault();
      adjust(index, e.key === 'Home' ? -1 : e.key === 'End' ? 1 : (e.key === 'ArrowLeft' ? -.02 : .02)); saveSizes();
    });
    handle.addEventListener('dblclick', () => {
      const pair = sizes[index] + sizes[index + 1]; sizes[index] = sizes[index + 1] = pair / 2; setColumns(); saveSizes();
    });
    return handle;
  }
  function refresh() {
    if (dragging) return;
    const count = grid.querySelectorAll('.note-card').length;
    const current = `${layout}:${count}:${compact.matches}`;
    if (signature === current) { positionHandles(); return; }
    signature = current;
    const preset = presets.find(p => p.id === layout);
    const columns = compact.matches ? 1 : Math.max(1, Math.min(count, preset.sizes.length));
    grid.dataset.layout = count >= 3 && columns > 1 ? layout : 'columns';
    grid.dataset.columns = String(columns);
    const cached = savedSizes[layout];
    sizes = Array.isArray(cached) && cached.length === columns && cached.every(n => typeof n === 'number' && Number.isFinite(n) && n > .05 && n <= 1)
      ? cached.slice() : preset.sizes.length === columns ? preset.sizes.slice() : Array(columns).fill(1 / columns);
    const sum = sizes.reduce((a,b) => a + b, 0); sizes = sizes.map(n => n / sum);
    layer.replaceChildren(...Array.from({length:columns - 1}, (_,i) => makeHandle(i)));
    setColumns();
    document.querySelectorAll('.layout-option').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === layout)));
  }
  compact.addEventListener('change', refresh);
  new ResizeObserver(positionHandles).observe(grid);
  window.roomLayout = {refresh}; refresh();
})();
