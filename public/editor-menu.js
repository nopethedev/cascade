/* App-style menu bar shared by the Game Studio and Flow editors.
   Menu buttons dispatch `cascade:menu` on document with { action }. */
(function () {
  let openMenu = null;
  function close() {
    document.querySelectorAll('.app-menu.open').forEach((menu) => menu.classList.remove('open'));
    openMenu = null;
  }
  function wire() {
    document.querySelectorAll('.app-menu > [data-menu-trigger]').forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        const menu = trigger.parentElement;
        const wasOpen = menu.classList.contains('open');
        close();
        if (!wasOpen) { menu.classList.add('open'); openMenu = menu; }
      });
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.app-menu')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    document.addEventListener('click', (event) => {
      const item = event.target.closest('[data-menu-action]');
      if (!item) return;
      const action = item.getAttribute('data-menu-action');
      close();
      document.dispatchEvent(new CustomEvent('cascade:menu', { detail: { action } }));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  window.CascadeMenu = { close };
})();
