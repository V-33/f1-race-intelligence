'use strict';
/* global gsap, ScrollTrigger, Lenis */
// Motion layer. With GSAP and ScrollTrigger it choreographs the hero, reveals content as it scrolls into view,
// scrubs the hero, the band and the footer lines against the scroll position, and runs optional smooth (inertia)
// scrolling with Lenis. Without them (or with reduced motion) the page stays fully readable: theme.js only
// switches animation on (the .motion class) when the browser can watch scrolling and motion is welcome.
// Positions and colours are set through the CSSOM, because the Content-Security-Policy blocks style attributes.
const Motion = (() => {
  const root = document.documentElement;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const on = root.classList.contains('motion');
  const useGsap = Boolean(on && window.gsap && window.ScrollTrigger);
  const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
  let lenis = null;
  let tick = null;

  if (useGsap) {
    gsap.registerPlugin(ScrollTrigger);
    root.classList.add('gsap');
  }

  // ---------- hero entrance ----------
  function heroIntro() {
    if (!useGsap) return;
    const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
    tl.fromTo('.hero-slab', { xPercent: 14 }, { xPercent: 0, duration: 1.05 }, 0.05)
      .fromTo('.hero-video', { xPercent: 10, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 1.15 }, 0.15)
      .fromTo('.hero h1 .line > span', { yPercent: 105 }, { yPercent: 0, duration: 1.05, stagger: 0.14 }, 0.1)
      .fromTo('.hero-lead, .hero-actions, .hero-now', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.85, stagger: 0.12, ease: 'power3.out' }, 0.55)
      .fromTo('.hero-slope', { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' }, 1.1);
  }

  // ---------- scroll-linked effects ----------
  function scrollFx() {
    if (!useGsap) return;
    const hero = { trigger: '.hero', start: 'top 56px', end: 'bottom 56px', scrub: true };
    gsap.to('.hero-copy', { y: -90, opacity: 0, ease: 'none', scrollTrigger: hero });
    gsap.to('.hero-slab', { x: 70, ease: 'none', scrollTrigger: hero });
    gsap.fromTo('.hero-video video', { scale: 1.04, yPercent: 0 }, { scale: 1.2, yPercent: 7, ease: 'none', scrollTrigger: hero });

    const band = { trigger: '.band', start: 'top bottom', end: 'bottom top', scrub: true };
    gsap.fromTo('.band-video video', { scale: 1.16 }, { scale: 1.02, ease: 'none', scrollTrigger: band });

    // The running line leans with the scroll speed and settles when the scrolling stops
    const lean = gsap.quickTo('.band-track', 'skewX', { duration: 0.7, ease: 'power3.out' });
    ScrollTrigger.create({ onUpdate: (self) => lean(gsap.utils.clamp(-7, 7, self.getVelocity() / -380)) });
    ScrollTrigger.addEventListener('scrollEnd', () => lean(0));
  }

  // ---------- reveals ----------
  const REVEAL = '.page-head, .card, .tiles, .foot-lines, .foot-cap, .foot-text';
  function reveal() {
    if (!on) return;
    const io = new IntersectionObserver((entries) => {
      const els = entries.filter((e) => e.isIntersecting).map((e) => e.target);
      if (!els.length) return;
      els.forEach((el) => io.unobserve(el));
      if (useGsap) {
        gsap.fromTo(els, { opacity: 0, y: 32 }, {
          opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.09,
          onComplete: () => els.forEach((el) => { el.classList.remove('reveal'); gsap.set(el, { clearProps: 'opacity,transform' }); }),
        });
      } else {
        els.forEach((el) => el.classList.add('in'));
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    $$(REVEAL).forEach((el) => { el.classList.add('reveal'); io.observe(el); });
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
    const show = (v) => { node.nodeValue = `${el.dataset.sign}${v.toFixed(decimals)}`; };
    if (useGsap) {
      const o = { v: 0 };
      gsap.to(o, { v: amount, duration: 1.2, ease: 'power3.out', onUpdate: () => show(o.v), onComplete: () => { node.nodeValue = el.dataset.final; } });
      return;
    }
    const started = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - started) / 900);
      if (t < 1) { show(amount * (1 - Math.pow(1 - t, 4))); requestAnimationFrame(frame); } else node.nodeValue = el.dataset.final;
    };
    requestAnimationFrame(frame);
  }

  // ---------- reading progress ----------
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const max = root.scrollHeight - window.innerHeight;
      root.style.setProperty('--progress', max > 0 ? String(Math.min(1, window.scrollY / max)) : '0');
      if (on && !useGsap) {
        root.style.setProperty('--py', `${Math.min(window.scrollY, 900) * 0.18}px`);
        const hero = document.querySelector('.hero');
        root.style.setProperty('--hp', hero ? String(Math.min(1, window.scrollY / Math.max(1, hero.offsetHeight * 0.8))) : '0');
      }
    });
  }

  // ---------- the band: the figures run sideways, faster the faster you scroll ----------
  function band() {
    const runEl = document.getElementById('bandRun');
    const box = document.querySelector('.band');
    if (!runEl || !box || !on) return;
    let x = 0;
    let last = window.scrollY;
    let visible = false;
    let raf = 0;
    const step = () => {
      const dy = window.scrollY - last;
      last = window.scrollY;
      const half = runEl.scrollWidth / 2;
      x -= 0.7 + Math.min(40, Math.abs(dy)) * 0.55;
      if (half > 0 && -x >= half) x += half;
      runEl.style.setProperty('transform', `translate3d(${x}px, 0, 0)`);
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

  // ---------- smooth scrolling (Lenis), with a switch ----------
  const SMOOTH_KEY = 'f1.smooth';
  const smoothSaved = () => { try { return localStorage.getItem(SMOOTH_KEY); } catch { return null; } };
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let smoothOn = false;

  function setSmooth(want, persist) {
    const allowed = useGsap && window.Lenis && !calm;
    const enable = Boolean(want && allowed);
    if (enable && !lenis) {
      lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      tick = (t) => lenis.raf(t * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    } else if (!enable && lenis) {
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenis = null;
      gsap.ticker.lagSmoothing(500, 33);
    }
    smoothOn = enable;
    if (persist) { try { localStorage.setItem(SMOOTH_KEY, enable ? 'on' : 'off'); } catch { /* storage may be blocked */ } }
    const btn = document.getElementById('smoothToggle');
    if (btn) {
      btn.hidden = !allowed;
      btn.setAttribute('aria-pressed', String(enable));
      btn.textContent = `Smooth scrolling: ${enable ? 'on' : 'off'}`;
    }
  }

  function goTo(target, offset = 0) {
    if (lenis) lenis.scrollTo(target, { offset, duration: 1.3 });
    else if (target === 0) window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
    else target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }

  // In-page links glide (through Lenis when it is running)
  function anchors() {
    document.addEventListener('click', (e) => {
      const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
      if (!a || a.classList.contains('skip') || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      const hash = a.getAttribute('href');
      const target = hash === '#top' ? 0 : document.querySelector(hash);
      if (target === null) return;
      e.preventDefault();
      goTo(target, -56);
    });
  }

  // Choosing a tab while the hero is on screen brings the dashboard up to it.
  function toDashboard() {
    const dash = document.getElementById('dashboard');
    if (dash && dash.getBoundingClientRect().top > 120) goTo(dash, -56);
  }

  // Layout below the fold shifts as charts and tabs fill in; scroll triggers must measure again
  let refreshTimer = 0;
  function refresh() {
    if (!useGsap) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 160);
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
      if (!paused && seen.has(v)) v.play().catch(() => { /* autoplay refused: the poster stays */ });
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
    heroIntro();
    scrollFx();
    band();
    watchClips();
    anchors();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => { tabInk(); onScroll(); });
    window.addEventListener('load', refresh);
    document.addEventListener('f1:season', refresh);
    onScroll();
    tabInk();
    const saved = smoothSaved();
    setSmooth(saved ? saved === 'on' : fine, false);
    const btn = document.getElementById('smoothToggle');
    btn?.addEventListener('click', () => setSmooth(!smoothOn, true));
    // Tab widths change once the fonts are in
    if (document.fonts?.ready) document.fonts.ready.then(() => { tabInk(); refresh(); }).catch(() => {});
  }
  init();

  return { countTiles, tabInk, toDashboard, refresh };
})();
