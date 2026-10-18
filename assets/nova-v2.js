/* Close product navigation after a choice, outside click, or Escape. */
(() => {
  const menu = document.querySelector('.nova-nav-products');
  if (!menu) return;
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { menu.open = false; }));
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') menu.open = false; });
})();
