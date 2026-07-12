(function () {
  (function loadPasswordToggle() {
    if (document.querySelector('script[data-deployer-password-toggle]')) return;
    var s = document.createElement('script');
    s.src = 'password-toggle.js';
    s.defer = true;
    s.setAttribute('data-deployer-password-toggle', '1');
    document.head.appendChild(s);
  })();

  function getEffectiveLang() {
    if (window.deployerI18n && typeof window.deployerI18n.getLang === 'function') {
      return window.deployerI18n.getLang();
    }
    try {
      var stored = localStorage.getItem('deployer-lang');
      if (stored === 'en' || stored === 'ru') return stored;
    } catch (_) {
      /* ignore */
    }
    return 'ru';
  }

  function syncLangToggleLabels() {
    var label = getEffectiveLang().toUpperCase();
    var labelNodes = document.querySelectorAll('[data-lang-toggle-label]');
    for (var i = 0; i < labelNodes.length; i++) {
      labelNodes[i].textContent = label;
    }
    if (window.deployerI18n) {
      var toggleNodes = document.querySelectorAll('[data-action="language-toggle"]');
      for (var j = 0; j < toggleNodes.length; j++) {
        toggleNodes[j].setAttribute('aria-label', window.deployerI18n.t('lang_toggle'));
        toggleNodes[j].setAttribute('title', window.deployerI18n.t('lang_toggle'));
      }
    }
  }

  function setLanguage(next) {
    if (next !== 'en' && next !== 'ru') return;
    try {
      localStorage.setItem('deployer-lang', next);
    } catch (_) {
      /* ignore */
    }
    document.documentElement.setAttribute('lang', next);
    syncLangToggleLabels();
    if (window.deployerI18n && typeof window.deployerI18n.apply === 'function') {
      window.deployerI18n.apply();
    }
    if (typeof window.deployerOnLangChanged === 'function') {
      window.deployerOnLangChanged(next);
    }
    window.dispatchEvent(new CustomEvent('deployer-lang-changed', { detail: { lang: next } }));
  }

  window.deployerSetLanguage = setLanguage;

  function bindLanguageToggle() {
    syncLangToggleLabels();
    var nodes = document.querySelectorAll('[data-action="language-toggle"]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-lang-bound') === '1') continue;
      nodes[i].setAttribute('data-lang-bound', '1');
      nodes[i].addEventListener('click', function () {
        var current = getEffectiveLang();
        setLanguage(current === 'en' ? 'ru' : 'en');
      });
    }
  }

  function init() {
    var ready = window.deployerI18n && window.deployerI18n.ready;
    if (ready && typeof ready.then === 'function') {
      ready.then(bindLanguageToggle);
    } else {
      bindLanguageToggle();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
