/* Instalación como app: service worker y aviso de "Añadir a pantalla de inicio" en iOS. */
(function () {
  'use strict';

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo offline */ });
    });
  }

  const standalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  document.documentElement.classList.toggle('is-standalone', standalone);

  // En iPhone y iPad no hay botón de instalar: se explica cómo hacerlo, una sola vez.
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const KEY = 'backgammon-para-dos/aviso-instalar';
  let dismissed = false;
  try { dismissed = localStorage.getItem(KEY) === '1'; } catch (e) { /* sin almacenamiento */ }

  const tip = document.getElementById('installTip');
  if (!tip || standalone || !ios || dismissed) return;
  tip.hidden = false;
  document.getElementById('btnInstallTip').addEventListener('click', () => {
    tip.hidden = true;
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* sin almacenamiento */ }
  });
})();
