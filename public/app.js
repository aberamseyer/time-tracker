// Live-sync client: WS -> htmx refresh; Alpine running clock.
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

  document.addEventListener('alpine:init', () => {
    window.Alpine.data('clock', (elapsedMs, running) => ({
      text: '',
      init() {
        const origin = Date.now() - elapsedMs;
        const render = (ms) => {
          const s = Math.max(0, Math.floor(ms / 1000));
          const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
          this.text = (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0');
        };
        render(elapsedMs);
        if (running) setInterval(() => render(Date.now() - origin), 1000);
      },
    }));
  });
})();
