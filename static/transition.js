(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'kopirnik-entry';
  let arriving = false;
  let started = false;
  let leaving = false;
  let fallback;
  try {
    const entry = JSON.parse(sessionStorage.getItem(key) || 'null');
    sessionStorage.removeItem(key);
    arriving = !reduced.matches && entry?.path === location.pathname && Date.now() - entry.time < 15000;
  } catch { /* Storage can be unavailable in private contexts. */ }
  if (arriving) root.classList.add('room-entry-pending');

  function portal() {
    const el = document.createElement('div');
    el.className = 'entry-portal';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="portal-glow"></div><div class="portal-rings"><i></i><i></i><i></i><i></i></div>';
    document.body.append(el);
    return el;
  }
  function ready() {
    if (!arriving || started) return;
    started = true;
    clearTimeout(fallback);
    const workspace = document.querySelector('.workspace');
    if (!workspace) { root.classList.remove('room-entry-pending'); return; }
    workspace.inert = true;
    root.classList.add('room-arriving');
    root.classList.remove('room-entry-pending');
    const finish = () => {
      root.classList.remove('room-arriving');
      workspace.inert = false;
    };
    // A deadline also cleans up if the tab is backgrounded or animations are disabled mid-flight.
    setTimeout(finish, 650);
  }
  window.roomTransition = {
    ready,
    async enter(path) {
      if (leaving) return;
      leaving = true;
      document.querySelectorAll('.landing button').forEach(button => button.disabled = true);
      if (!reduced.matches) {
        try { sessionStorage.setItem(key, JSON.stringify({path, time:Date.now()})); } catch {}
        portal();
        root.classList.add('room-leaving');
        await new Promise(resolve => setTimeout(resolve, 650));
      }
      location.assign(path);
    }
  };
  document.addEventListener('DOMContentLoaded', () => {
    if (arriving) fallback = setTimeout(ready, 1800);
  });
  // Back/forward cache must not restore the collapsed login screen.
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    leaving = false;
    root.classList.remove('room-leaving', 'room-entry-pending', 'room-arriving');
    document.querySelectorAll('.entry-portal').forEach(el => el.remove());
    document.querySelectorAll('.landing button').forEach(button => button.disabled = false);
    const workspace = document.querySelector('.workspace');
    if (workspace) workspace.inert = false;
  });
})();
