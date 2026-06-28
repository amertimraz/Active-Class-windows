(function() {
  const currentHash = window.location.hash;
  if (!currentHash.includes('?')) return;

  const params    = new URLSearchParams(currentHash.split('?')[1]);
  const gameSrc   = params.get('src')   ? decodeURIComponent(params.get('src'))   : '';
  const gameTitle = params.get('title') ? decodeURIComponent(params.get('title')) : 'لعبة تعليمية';

  const titleEl = document.getElementById('egTitle');
  if (titleEl) titleEl.textContent = gameTitle;

  if (!gameSrc) return;

  const wrapper = document.getElementById('egWrapper');
  const loading = document.getElementById('egLoading');

  // Try webview first (Electron), fallback to iframe
  const isElectron = !!(window.api);
  const el = isElectron ? document.createElement('webview') : document.createElement('iframe');

  el.style.cssText = 'width:100%;height:100%;border:none;display:block;position:absolute;inset:0';

  if (isElectron) {
    el.setAttribute('src', gameSrc);
    el.setAttribute('allowpopups', '');
    el.addEventListener('dom-ready', () => { if (loading) loading.style.display = 'none'; });
  } else {
    el.src = gameSrc;
    el.setAttribute('allowfullscreen', '');
    el.onload = () => { if (loading) loading.style.display = 'none'; };
  }

  wrapper.appendChild(el);

  document.getElementById('egFsBtn')?.addEventListener('click', () => {
    if (el.requestFullscreen) el.requestFullscreen();
  });

  // Init page-level quick tools widget
  const _qtT = document.getElementById('qtToggle_eg');
  const _qtM = document.getElementById('qtMenu_eg');
  if (_qtT && _qtM && window.initQtWidget) window.initQtWidget(_qtT, _qtM);
})();
