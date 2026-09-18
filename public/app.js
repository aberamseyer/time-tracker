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

  const p2 = (n) => String(n).padStart(2, '0');
  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + p2(sec);
  }
  function fmtLocal(d) {                                   // Date -> local datetime-local value
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }
  function localDay(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

  // Clock reads real instants (Date.now() is tz-free).
  let clock = null, clockTimer = null, splitting = false;
  function renderClock() {
    if (!clock) return;
    const ms = clock.running ? Date.now() - clock.start - clock.paused
      : (clock.pauseStart ?? Date.now()) - clock.start - clock.paused;
    clock.el.textContent = fmtElapsed(ms);
  }
  function maybeSplit() {
    if (!clock || !clock.running || splitting) return;
    if (localDay(Date.now()) <= localDay(clock.start)) return;
    splitting = true;
    fetch('/timer/split', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'tz=' + new Date().getTimezoneOffset(),
    }).finally(() => { splitting = false; });
  }
  function initClock() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    const el = document.querySelector('.elapsed[data-start]');
    if (!el) { clock = null; return; }
    clock = {
      el, running: el.dataset.running === 'true',
      start: Number(el.dataset.start), paused: Number(el.dataset.paused) || 0,
      pauseStart: el.dataset.pausestart ? Number(el.dataset.pausestart) : null,
    };
    const startEl = document.getElementById('timer-start-input');
    if (startEl) startEl.value = fmtLocal(new Date(clock.start));   // real -> local
    renderClock();
    maybeSplit();
    if (clock.running) clockTimer = setInterval(() => { renderClock(); maybeSplit(); }, 1000);
  }
  // Edit running start: clamp to [local midnight, now - pauses], persist clamped.
  document.body.addEventListener('change', (e) => {
    const el = e.target;
    if (el?.id !== 'timer-start-input' || !clock) return;
    const entered = new Date(el.value).getTime();                  // local -> real
    if (isNaN(entered)) return;
    const n = new Date();
    const lo = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    const hi = (clock.pauseStart ?? Date.now()) - clock.paused;
    const clamped = Math.min(hi, Math.max(lo, entered));
    el.value = fmtLocal(new Date(clamped));
    clock.start = clamped;
    renderClock();
    el.form.dispatchEvent(new Event('tt:commitstart'));
  });
  document.body.addEventListener('htmx:afterSwap', (e) => {
    const t = e.target;
    if (t && (t.matches?.('#active-timer') || t.querySelector?.('.elapsed[data-start]'))) initClock();
  });
  initClock();
})();
