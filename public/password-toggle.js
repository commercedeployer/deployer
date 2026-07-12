/**
 * Password visibility toggle for type=password fields (Feather icons, MIT).
 */
(function (global) {
  var EYE_SHOW =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
    '<circle cx="12" cy="12" r="3"/>' +
    '</svg>';
  var EYE_HIDE =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>' +
    '<line x1="1" y1="1" x2="23" y2="23"/>' +
    '</svg>';

  function tr(key, fb) {
    if (global.deployerI18n && typeof global.deployerI18n.t === 'function') {
      var msg = global.deployerI18n.t(key);
      if (msg && msg !== key) return msg;
    }
    return fb;
  }

  function labelShow() {
    return tr('password_show', 'Показать пароль');
  }

  function labelHide() {
    return tr('password_hide', 'Скрыть пароль');
  }

  function syncToggle(btn, input) {
    var visible = input.type === 'text';
    btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
    btn.setAttribute('aria-label', visible ? labelHide() : labelShow());
    btn.innerHTML = visible ? EYE_HIDE : EYE_SHOW;
  }

  function refreshAllToggleLabels() {
    var buttons = document.querySelectorAll('.password-field__toggle');
    for (var i = 0; i < buttons.length; i++) {
      var wrap = buttons[i].closest('.password-field');
      var input = wrap && wrap.querySelector('input');
      if (input) syncToggle(buttons[i], input);
    }
  }

  function enhanceInput(input) {
    if (!input || input.type !== 'password') return;
    if (input.closest('.password-field')) return;
    if (input.dataset.passwordToggle === 'off') return;

    var wrap = document.createElement('span');
    wrap.className = 'password-field';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-field__toggle';
    wrap.appendChild(btn);

    syncToggle(btn, input);

    btn.addEventListener('click', function () {
      input.type = input.type === 'password' ? 'text' : 'password';
      syncToggle(btn, input);
      input.focus();
    });
  }

  function scan(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll('input[type="password"]:not([data-password-toggle="off"])');
    for (var i = 0; i < nodes.length; i++) enhanceInput(nodes[i]);
  }

  var observeTimer = null;
  function scheduleScan() {
    if (observeTimer) return;
    observeTimer = setTimeout(function () {
      observeTimer = null;
      scan(document);
    }, 0);
  }

  function startObserver() {
    if (!global.MutationObserver || !document.body) return;
    var obs = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
          scheduleScan();
          return;
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    scan(document);
    startObserver();
    global.addEventListener('deployer-lang-changed', refreshAllToggleLabels);
  }

  global.DeployerPasswordToggle = { scan: scan, init: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
