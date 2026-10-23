'use strict';
// Motion layer: scroll reveals, counting figures, the reading-progress line, the hero parallax, the sliding
// tab mark and the video clips. Nothing here is needed to read the page: theme.js only switches the
// animations on (the .motion class) when the browser can watch scrolling and motion is welcome.
// Colours and positions are set through the CSSOM, because the Content-Security-Policy blocks style attributes.
const Motion = (() => {
  const root = document.documentElement;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const on = root.classList.contains('motion');
  const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];

  // ---------- scroll reveals ----------
  const REVEAL = '.page-head, .card, .tiles, .foot-lines, .foot-cap, .foot-text';
  let revealer = null;
  function reveal() {
    if (!on) return;
    revealer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        revealer.unobserve(e.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    $$(REVEAL).forEach((el) => { el.classList.add('reveal'); revealer.observe(el); });
  }

  // ---------- figures count up when they first appear ----------
  const NUMBER = /^([+−-]?)(\d+(?:\.\d+)?)$/;
  let counter = null;
  function countTiles(scope) {
    if (!on) return;
    counter ??= new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        counter.unobserve(e.target);
        run(e.target);
      }
    }, { threshold: 0.4 });
    $$('.tile .value', scope).forEach((el) => {
      const node = [...el.childNodes].find((n) => n.nodeType === 3);
      const m = node && NUMBER.exec(node.nodeValue.trim());
      if (!m) return;
      el.dataset.final = node.nodeValue;
      el.dataset.sign = m[1];
      el.dataset.amount = m[2];
      counter.observe(el);
    });
  }
  function run(el) {
    const node = [...el.childNodes].find((n) => n.nodeType === 3);
    if (!node) return;
    const amount = Number(el.dataset.amount);
    const decimals = (el.dataset.amount.split('.')[1] || '').length;
    const started = performance.now();
    const length = 900;
    const frame = (now) => {
      const t = Math.min(1, (now - started) / length);
      const eased = 1 - Math.pow(1 - t, 4);
      node.nodeValue = t < 1 ? `${el.dataset.sign}${(amount * eased).toFixed(decimals)}` : el.dataset.final;
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------- reading progress and hero parallax ----------
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const max = root.scrollHeight - window.innerHeight;
      root.style.setProperty('--progress', max > 0 ? String(Math.min(1, window.scrollY / max)) : '0');
      if (on) {
        root.style.setProperty('--py', `${Math.min(window.scrollY, 900) * 0.18}px`);
        const hero = document.querySelector('.hero');
        root.style.setProperty('--hp', hero ? String(Math.min(1, window.scrollY / Math.max(1, hero.offsetHeight * 0.8))) : '0');
      }
    });
  }

  // ---------- the band: the figures run sideways, faster the faster you scroll ----------
  function band() {
    const run = document.getElementById('bandRun');
    const box = document.querySelector('.band');
    if (!run || !box || !on) return;
    let x = 0;
    let last = window.scrollY;
    let visible = false;
    let raf = 0;
    const step = () => {
      const dy = window.scrollY - last;
      last = window.scrollY;
      const half = run.scrollWidth / 2;
      x -= 0.7 + Math.min(40, Math.abs(dy)) * 0.55;
      if (half > 0 && -x >= half) x += half;
      run.style.setProperty('transform', `translate3d(${x}px, 0, 0)`);
      raf = visible ? requestAnimationFrame(step) : 0;
    };
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible && !raf) { last = window.scrollY; raf = requestAnimationFrame(step); }
    }).observe(box);
  }

  // ---------- the sliding red mark under the selected tab ----------
  function tabInk() {
    const ink = document.querySelector('.tab-ink');
    const tab = document.querySelector('.tabs button[aria-selected="true"]');
    if (!ink || !tab) return;
    ink.style.setProperty('width', `${tab.offsetWidth - 24}px`);
    ink.style.setProperty('transform', `translateX(${tab.offsetLeft + 12}px)`);
  }

  // Choosing a tab while the hero is on screen brings the dashboard up to it.
  function toDashboard() {
    const dash = document.getElementById('dashboard');
    if (!dash) return;
    const top = dash.getBoundingClientRect().top;
    if (top > 120) dash.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }

  // ---------- video clips: play what is on screen, pause the rest ----------
  let paused = calm; // visitors who asked for less motion get still frames
  const clips = $$('video[data-clip]');
  const toggles = $$('.vid-toggle');
  function syncToggles() {
    toggles.forEach((b) => {
      b.setAttribute('aria-pressed', String(paused));
      b.textContent = paused ? 'Play video' : 'Pause video';
    });
  }
  function watchClips() {
    syncToggles();
    if (!clips.length) return;
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target);
        apply(e.target);
      }
    }, { threshold: 0.25 });
    function apply(v) {
      if (!paused && seen.has(v)) v.play().catch(() => { /* autoplay refused: the first frame stays */ });
      else v.pause();
    }
    clips.forEach((v) => { v.muted = true; io.observe(v); if (paused) v.pause(); });
    toggles.forEach((b) => b.addEventListener('click', () => {
      paused = !paused;
      syncToggles();
      clips.forEach(apply);
    }));
  }

  function init() {
    reveal();
    band();
    watchClips();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => { tabInk(); onScroll(); });
    onScroll();
    tabInk();
    // Tab widths change once the fonts are in
    if (document.fonts?.ready) document.fonts.ready.then(tabInk).catch(() => {});
  }
  init();

  return { countTiles, tabInk, toDashboard };
})();
