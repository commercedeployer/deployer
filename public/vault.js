(function () {
  'use strict';

  function t(key) {
    return window.deployerI18n ? window.deployerI18n.t(key) : key;
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

  async function apiGet(path) {
    return window.deployerApi(path, { cache: 'no-store' });
  }

  async function apiPut(path, payload) {
    return window.deployerApi(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  }

  async function apiDelete(path) {
    return window.deployerApi(path, { method: 'DELETE' });
  }

  function renderKeysTable(keys) {
    if (!keys.length) {
      return '<p class="muted">' + esc(t('vault_no_keys')) + '</p>';
    }
    var rows = keys
      .map(function (row) {
        var emptyHint =
          !row.set ? ' <span class="vault-key-empty">' + esc(t('vault_status_empty')) + '</span>' : '';
        return (
          '<tr><td><code class="mcp-key-prefix">' +
          esc(row.key) +
          '</code>' +
          emptyHint +
          '</td><td class="mcp-keys-actions">' +
          '<button type="button" class="btn btn-outline btn-sm vault-edit-btn" data-key="' +
          attrEsc(row.key) +
          '">' +
          esc(t('vault_edit')) +
          '</button> ' +
          '<button type="button" class="btn btn-outline btn-sm btn-danger vault-delete-btn" data-key="' +
          attrEsc(row.key) +
          '">' +
          esc(t('vault_delete')) +
          '</button></td></tr>'
        );
      })
      .join('');
    return (
      '<div class="mcp-keys-table-wrap"><table class="mcp-keys-table">' +
      '<thead><tr><th>' +
      esc(t('vault_col_key')) +
      '</th><th></th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div>'
    );
  }

  function fillFormForEdit(key) {
    var keyInput = document.getElementById('vault-key');
    var valueInput = document.getElementById('vault-value');
    if (keyInput) {
      keyInput.value = key || '';
      keyInput.readOnly = true;
    }
    if (valueInput) {
      valueInput.value = '';
      valueInput.focus();
    }
  }

  function resetForm() {
    var keyInput = document.getElementById('vault-key');
    var valueInput = document.getElementById('vault-value');
    if (keyInput) {
      keyInput.value = '';
      keyInput.readOnly = false;
    }
    if (valueInput) valueInput.value = '';
  }

  async function reloadKeysTable() {
    var wrap = document.getElementById('vault-keys-wrap');
    if (!wrap) return;
    var data = await apiGet('/api/vault');
    wrap.innerHTML = renderKeysTable((data && data.keys) || []);
  }

  var panelClickBound = false;

  function bindPanelActions() {
    if (panelClickBound) return;
    var panel = document.getElementById('vault-panel');
    if (!panel) return;
    panel.addEventListener('click', function (ev) {
      var editBtn = ev.target.closest('.vault-edit-btn');
      if (editBtn) {
        fillFormForEdit(editBtn.getAttribute('data-key'));
        return;
      }
      var delBtn = ev.target.closest('.vault-delete-btn');
      if (delBtn) {
        var delKey = delBtn.getAttribute('data-key');
        if (!delKey || !window.confirm(t('vault_delete_confirm'))) return;
        delBtn.disabled = true;
        apiDelete('/api/vault/' + encodeURIComponent(delKey))
          .then(function () {
            resetForm();
            return reloadKeysTable();
          })
          .catch(function (err) {
            delBtn.disabled = false;
            alert(err.message || String(err));
          });
      }
    });
    panelClickBound = true;
  }

  async function loadVaultPanel() {
    var panel = document.getElementById('vault-panel');
    if (!panel) return;
    bindPanelActions();
    panel.innerHTML = '<p class="muted">' + esc(t('loading')) + '</p>';

    try {
      var data = await apiGet('/api/vault');
      var keys = (data && data.keys) || [];

      panel.innerHTML =
        '<p class="muted">' +
        esc(t('vault_lead')) +
        '</p>' +
        '<form id="vault-save-form" class="vault-create-form" autocomplete="off">' +
        '<label class="vault-create-field-label" for="vault-key">' +
        esc(t('vault_add_label')) +
        '</label>' +
        '<div class="vault-create-row">' +
        '<input type="text" id="vault-key" class="vault-key-input" required maxlength="64" pattern="[A-Z][A-Z0-9_]*" data-i18n-placeholder="ph_vault_key" placeholder="' +
        attrEsc(t('ph_vault_key')) +
        '" />' +
        '<input type="password" id="vault-value" class="vault-value-input" required autocomplete="new-password" data-i18n-placeholder="ph_vault_value" placeholder="' +
        attrEsc(t('ph_vault_value')) +
        '" />' +
        '<button type="submit" class="btn btn-primary vault-create-submit" id="vault-save-btn">' +
        esc(t('vault_save')) +
        '</button></div></form>' +
        '<div id="vault-keys-wrap">' +
        renderKeysTable(keys) +
        '</div>';

      if (window.deployerI18n) window.deployerI18n.apply(panel);
      if (window.DeployerPasswordToggle && typeof window.DeployerPasswordToggle.scan === 'function') {
        window.DeployerPasswordToggle.scan(panel);
      }

      var form = document.getElementById('vault-save-form');
      if (form) {
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var submitBtn = document.getElementById('vault-save-btn');
          var keyInput = document.getElementById('vault-key');
          var valueInput = document.getElementById('vault-value');
          var key = keyInput ? String(keyInput.value || '').trim() : '';
          var value = valueInput ? String(valueInput.value) : '';
          if (!key) {
            if (keyInput) keyInput.focus();
            return;
          }
          if (!value) {
            if (valueInput) valueInput.focus();
            return;
          }
          if (submitBtn) submitBtn.disabled = true;

          apiPut('/api/vault/' + encodeURIComponent(key), { value: value })
            .then(function () {
              resetForm();
              return reloadKeysTable();
            })
            .catch(function (err) {
              alert(err.message || String(err));
            })
            .finally(function () {
              if (submitBtn) submitBtn.disabled = false;
            });
        });
      }
    } catch (err) {
      panel.innerHTML = '<p class="muted">' + esc(err.message || String(err)) + '</p>';
    }
  }

  window.deployerVault = { load: loadVaultPanel };
})();
