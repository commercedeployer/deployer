(function () {
  'use strict';

  var KEY_LIMIT = 5;
  var pendingPlaintext = null;
  var modalBound = false;
  var panelClickBound = false;

  function t(key) {
    return window.deployerI18n ? window.deployerI18n.t(key) : key;
  }

  function tf(key, vars) {
    return window.deployerI18n ? window.deployerI18n.tf(key, vars) : key;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attrEsc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      var locale = window.deployerI18n && window.deployerI18n.getLang && window.deployerI18n.getLang() === 'en' ? 'en-GB' : 'ru-RU';
      return new Date(iso).toLocaleString(locale);
    } catch (_) {
      return String(iso);
    }
  }

  function shortId(keyId) {
    var s = String(keyId || '');
    return s.length > 10 ? s.slice(0, 8) + '…' : s;
  }

  function apiErrorText(body, fallback) {
    var code = body && (body.code || body.error);
    if (code === 'mcp_key_limit') {
      var limit = (body.details && body.details.limit) || KEY_LIMIT;
      return tf('mcp_limit_reached', { limit: limit });
    }
    if (body && (body.error || body.message)) return String(body.error || body.message);
    return fallback || t('err_request_failed');
  }

  async function apiGet(path) {
    try {
      return await window.deployerApi(path, { cache: 'no-store' });
    } catch (err) {
      var msg = String(err.message || err);
      if (/not found/i.test(msg)) {
        throw new Error(t('mcp_err_server_stale'));
      }
      throw err;
    }
  }

  async function apiPost(path, payload) {
    return window.deployerApi(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  }

  function renderKeysTable(keys) {
    if (!keys.length) {
      return '<p class="muted">' + esc(t('mcp_no_keys')) + '</p>';
    }
    var rows = keys
      .map(function (k) {
        return (
          '<tr><td>' +
          esc(k.label) +
          '</td><td><code class="mcp-key-prefix" title="' +
          attrEsc(k.key_id) +
          '">' +
          esc(k.key_prefix) +
          '</code></td><td>' +
          esc(fmtTime(k.last_used_at)) +
          '</td><td class="mcp-keys-actions"><button type="button" class="btn btn-outline btn-sm" data-mcp-revoke="' +
          attrEsc(k.key_id) +
          '">' +
          esc(t('mcp_revoke')) +
          '</button></td></tr>'
        );
      })
      .join('');
    return (
      '<div class="mcp-keys-table-wrap"><table class="mcp-keys-table">' +
      '<thead><tr><th>' +
      esc(t('mcp_col_label')) +
      '</th><th>' +
      esc(t('mcp_col_prefix')) +
      '</th><th>' +
      esc(t('mcp_col_last_used')) +
      '</th><th></th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div>'
    );
  }

  function setCreateEnabled(keysRemaining) {
    var btn = document.getElementById('mcp-create-btn');
    var hint = document.getElementById('mcp-limit-hint');
    var atLimit = keysRemaining <= 0;
    if (btn) btn.disabled = atLimit;
    if (hint) {
      hint.hidden = !atLimit;
      hint.textContent = tf('mcp_limit_reached', { limit: KEY_LIMIT });
    }
  }

  async function reloadKeys() {
    var wrap = document.getElementById('mcp-keys-wrap');
    if (!wrap) return null;
    var data = await apiGet('/api/v1/mcp/keys');
    if (data.keyLimit) KEY_LIMIT = data.keyLimit;
    var keys = data.keys || [];
    wrap.innerHTML = renderKeysTable(keys);
    var remaining = typeof data.keysRemaining === 'number' ? data.keysRemaining : KEY_LIMIT - keys.length;
    setCreateEnabled(remaining);
    var urlEl = document.getElementById('mcp-url');
    if (urlEl && data.mcpUrl) urlEl.textContent = data.mcpUrl;
    return data;
  }

  function bindPanelActions() {
    if (panelClickBound) return;
    var panel = document.getElementById('mcp-panel');
    if (!panel) return;
    panel.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-mcp-revoke]');
      if (!btn || !panel.contains(btn)) return;
      ev.preventDefault();
      var keyId = btn.getAttribute('data-mcp-revoke');
      if (!keyId) return;
      if (!window.confirm(t('mcp_revoke_confirm'))) return;
      btn.disabled = true;
      apiPost('/api/v1/mcp/keys/' + encodeURIComponent(keyId) + '/revoke', {})
        .then(function () {
          return reloadKeys();
        })
        .catch(function (err) {
          btn.disabled = false;
          alert(err.message || String(err));
        });
    });
    panelClickBound = true;
  }

  function ensureModal() {
    if (modalBound) return;
    var overlay = document.getElementById('mcp-key-modal');
    if (!overlay) return;
    var closeBtn = document.getElementById('mcp-key-modal-close');
    var xBtn = document.getElementById('mcp-key-modal-x');
    var copyBtn = document.getElementById('mcp-key-modal-copy');
    var input = document.getElementById('mcp-key-modal-value');

    function closeModal() {
      pendingPlaintext = null;
      if (input) input.value = '';
      overlay.hidden = true;
      document.body.classList.remove('modal-open');
    }

    function copyKey() {
      var text = pendingPlaintext || (input ? input.value : '');
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = t('mcp_copied');
          setTimeout(function () {
            copyBtn.textContent = t('mcp_copy');
          }, 2000);
        });
        return;
      }
      if (input) {
        input.focus();
        input.select();
      }
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (xBtn) xBtn.addEventListener('click', closeModal);
    if (copyBtn) copyBtn.addEventListener('click', copyKey);
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) closeModal();
    });
    overlay.querySelector('.modal')?.addEventListener('click', function (ev) {
      ev.stopPropagation();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !overlay.hidden) closeModal();
    });
    modalBound = true;
  }

  function openKeyModal(label, plaintext) {
    ensureModal();
    var overlay = document.getElementById('mcp-key-modal');
    var title = document.getElementById('mcp-key-modal-title');
    var input = document.getElementById('mcp-key-modal-value');
    if (!overlay || !input || !plaintext) return;
    pendingPlaintext = String(plaintext);
    if (title) title.textContent = tf('mcp_modal_title', { label: label || t('mcp_heading') });
    input.value = pendingPlaintext;
    overlay.hidden = false;
    document.body.classList.add('modal-open');
    input.focus();
    input.select();
  }

  async function loadMcpPanel() {
    var panel = document.getElementById('mcp-panel');
    if (!panel) return;
    bindPanelActions();
    panel.innerHTML = '<p class="muted">' + esc(t('loading')) + '</p>';

    try {
      var data = await apiGet('/api/v1/mcp/keys');
      if (data.keyLimit) KEY_LIMIT = data.keyLimit;
      var keys = data.keys || [];
      var keysRemaining = typeof data.keysRemaining === 'number' ? data.keysRemaining : KEY_LIMIT - keys.length;
      var mcpUrl = data.mcpUrl || window.location.origin.replace(/\/$/, '') + '/mcp';

      panel.innerHTML =
        '<p class="muted">' +
        esc(t('mcp_lead')) +
        '</p>' +
        '<p class="muted">' +
        esc(t('mcp_config_hint')) +
        '</p>' +
        '<p class="muted mcp-docs-links">' +
        '<a href="/docs/DEPLOYER-MCP-AGENT-RU.md" target="_blank" rel="noopener">' +
        esc(t('mcp_docs_agent')) +
        '</a> · ' +
        '<a href="/docs/DEPLOYER-MCP-TOOLS-RU.md" target="_blank" rel="noopener">' +
        esc(t('mcp_docs_tools')) +
        '</a> · ' +
        '<a href="/docs/DEPLOYER-MCP-v1-RU.md" target="_blank" rel="noopener">' +
        esc(t('mcp_docs_setup')) +
        '</a></p>' +
        '<p class="muted mcp-url-line"><code id="mcp-url">' +
        esc(mcpUrl) +
        '</code></p>' +
        '<p class="muted">' +
        esc(tf('mcp_limit_note', { limit: KEY_LIMIT })) +
        '</p>' +
        '<form id="mcp-create-form" class="mcp-create-form" autocomplete="off">' +
        '<label class="mcp-create-field-label" for="mcp-label">' +
        esc(t('mcp_label_field')) +
        '</label>' +
        '<div class="mcp-create-row">' +
        '<input type="text" id="mcp-label" class="mcp-create-input" required maxlength="64" placeholder="Cursor">' +
        '<button type="submit" class="btn btn-primary mcp-create-submit" id="mcp-create-btn">' +
        esc(t('mcp_create')) +
        '</button></div></form>' +
        '<p id="mcp-limit-hint" class="muted mcp-limit-hint" hidden></p>' +
        '<p id="mcp-create-status" class="muted" role="status"></p>' +
        '<div id="mcp-keys-wrap">' +
        renderKeysTable(keys) +
        '</div>';

      setCreateEnabled(keysRemaining);

      var form = document.getElementById('mcp-create-form');
      if (form) {
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var statusEl = document.getElementById('mcp-create-status');
          var submitBtn = document.getElementById('mcp-create-btn');
          var labelInput = document.getElementById('mcp-label');
          var label = labelInput ? String(labelInput.value || '').trim() : '';
          if (!label) {
            statusEl.textContent = t('mcp_label_required');
            return;
          }
          if (submitBtn && submitBtn.disabled) return;
          statusEl.textContent = t('loading');
          if (submitBtn) submitBtn.disabled = true;

          apiPost('/api/v1/mcp/keys', { label: label })
            .then(function (created) {
              statusEl.textContent = '';
              if (labelInput) labelInput.value = '';
              return reloadKeys().then(function () {
                if (!created.plaintext) {
                  statusEl.textContent = t('mcp_create_no_plaintext');
                  return;
                }
                openKeyModal(created.key && created.key.label ? created.key.label : label, created.plaintext);
              });
            })
            .catch(function (err) {
              statusEl.textContent = err.message || String(err);
            })
            .finally(function () {
              reloadKeys().catch(function () {
                if (submitBtn) submitBtn.disabled = false;
              });
            });
        });
      }
    } catch (err) {
      panel.innerHTML = '<p class="muted">' + esc(err.message || String(err)) + '</p>';
    }
  }

  window.deployerMcpKeys = { load: loadMcpPanel };
})();
