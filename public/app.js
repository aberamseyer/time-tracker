// Live-sync client: WS -> htmx refresh; running clock.
(function () {
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    let backoff = 500;
    ws.onmessage = (e) => {
      try {
        if (JSON.parse(e.data).type === 'changed') {
          document.body.dispatchEvent(new Event('tt:changed'));
        }
      } catch {}
    };
    ws.onopen = () => { backoff = 500; };
    ws.onclose = () => { setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 10000); };
    ws.onerror = () => ws.close();
  }
  connect();

  // Keep group headers pinned just below the sticky search bar.
  function trackStuckTop() {
    const bar = document.querySelector('.time-toolbar');
    if (!bar) return;
    const set = () => document.documentElement.style.setProperty('--stuck-top', bar.offsetHeight + 'px');
    set();
    new ResizeObserver(set).observe(bar);
  }
  trackStuckTop();

  // Running clock: tick the active timer's elapsed span.
  let clockTimer = null;
  function initClock() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    const el = document.querySelector('.elapsed[data-elapsed]');
    if (!el) return;
    const elapsedMs = Number(el.dataset.elapsed);
    const running = el.dataset.running === 'true';
    const origin = Date.now() - elapsedMs;
    const render = (ms) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      el.textContent = (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0');
    };
    render(elapsedMs);
    if (running) clockTimer = setInterval(() => render(Date.now() - origin), 1000);
  }
  // Re-init only when the swap replaced the active timer.
  document.body.addEventListener('htmx:afterSwap', (e) => {
    const t = e.target;
    if (t && (t.matches?.('#active-timer') || t.querySelector?.('.elapsed[data-elapsed]'))) initClock();
  });
  initClock();
})();
