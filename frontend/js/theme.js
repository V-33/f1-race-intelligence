'use strict';
// Runs in <head> before the page paints, so the chosen theme never flashes.
// A saved choice wins; otherwise the system setting; otherwise dark.
(function () {
  var theme = null;
  try { theme = localStorage.getItem('f1.theme'); } catch (e) { /* storage may be blocked */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);

  // The entrance and scroll animations only apply when the browser can watch scrolling and the
  // visitor has not asked for less motion. Without this class every element is simply visible.
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!calm && 'IntersectionObserver' in window) document.documentElement.classList.add('motion');
})();
