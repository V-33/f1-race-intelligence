'use strict';
// Pointer layer for devices with a mouse: a red slanted marker that follows the pointer exactly, a ring that
// trails it and swells over things you can press, and buttons that lean toward the pointer. Touch screens,
// keyboard-only use and reduced motion get none of it (the native cursor stays).
(function () {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || calm) return;

  const cursor = document.createElement('div');
  cursor.className = 'cursor';
  cursor.setAttribute('aria-hidden', 'true');
  const ring = document.createElement('div');
  ring.className = 'cursor-ring';
  const dot = document.createElement('div');
  dot.className = 'cursor-dot';
  cursor.append(ring, dot);
  document.body.append(cursor);
  document.documentElement.classList.add('has-cursor');

  let x = -100;
  let y = -100;
  let rx = x;
  let ry = y;
  let raf = 0;
  const place = (el, px, py) => el.style.setProperty('transform', `translate3d(${px}px, ${py}px, 0)`);
  function frame() {
    rx += (x - rx) * 0.18;
    ry += (y - ry) * 0.18;
    place(ring, rx, ry);
    raf = Math.abs(x - rx) + Math.abs(y - ry) > 0.1 ? requestAnimationFrame(frame) : 0;
  }

  const HOT = 'a, button, [role="tab"], label, summary, .cta, .btn';
  const VIEW = '.hero-video, .band, .head-clip';
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    x = e.clientX;
    y = e.clientY;
    place(dot, x, y);
    cursor.classList.add('on');
    if (!raf) raf = requestAnimationFrame(frame);
    const over = e.target instanceof Element ? e.target : null;
    const interactive = over?.closest(HOT) && !over.closest('select');
    cursor.classList.toggle('hot', Boolean(interactive));
    cursor.classList.toggle('view', !interactive && Boolean(over?.closest(VIEW)));
    // Buttons lean toward the pointer, a few pixels at most
    const magnet = over?.closest('.cta, .icon-btn, .btn');
    document.querySelectorAll('.cta, .icon-btn, .btn').forEach((b) => {
      if (b !== magnet) { b.style.removeProperty('--mx'); b.style.removeProperty('--my'); }
    });
    if (magnet) {
      const r = magnet.getBoundingClientRect();
      magnet.style.setProperty('--mx', `${((e.clientX - (r.left + r.width / 2)) / r.width) * 10}px`);
      magnet.style.setProperty('--my', `${((e.clientY - (r.top + r.height / 2)) / r.height) * 8}px`);
    }
  }, { passive: true });
  document.addEventListener('pointerdown', () => cursor.classList.add('down'));
  document.addEventListener('pointerup', () => cursor.classList.remove('down'));
  document.documentElement.addEventListener('pointerleave', () => cursor.classList.remove('on'));
})();
