(() => {
  const container = document.getElementById('room-lifetime');
  const label = document.getElementById('lifetime-label');
  const time = document.getElementById('lifetime-time');
  const progress = document.getElementById('lifetime-progress');
  const fill = document.getElementById('lifetime-fill');
  let deadline = null;
  let total = 7200;
  function render() {
    if (deadline === null) return;
    const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    const fraction = Math.max(0, Math.min(1, remaining / total));
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor(remaining % 3600 / 60);
    const seconds = remaining % 60;
    time.textContent = `${hours}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
    time.setAttribute('datetime', `PT${remaining}S`);
    label.textContent = remaining ? 'Осталось' : 'Время истекло';
    fill.style.width = `${fraction * 100}%`;
    // Stay green for the first half, then gradually pass through amber to red.
    const hue = fraction >= .5 ? 92 : 6 + fraction * 172;
    container.style.setProperty('--life-start', `hsl(${hue} 96% 67%)`);
    container.style.setProperty('--life-end', `hsl(${hue + 12} 92% 53%)`);
    container.classList.toggle('running-low', fraction <= .125);
    progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    progress.setAttribute('aria-valuetext', `Осталось ${hours} ч ${minutes} мин ${seconds} с`);
  }
  window.roomLifetime = {
    update(data) {
      if (![data.expires_at, data.server_time, data.ttl_seconds].every(Number.isFinite) || data.ttl_seconds <= 0) return;
      total = data.ttl_seconds;
      // Use server-relative time, so incorrect device clocks do not affect the countdown.
      deadline = performance.now() + Math.max(0, data.expires_at - data.server_time) * 1000;
      render();
    }
  };
  setInterval(render, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
})();
