const api = (path, opts = {}) => window.deployerApi(path, opts);

function t(key) {
  return window.deployerI18n ? window.deployerI18n.t(key) : key;
}

function tf(key, vars) {
  return window.deployerI18n ? window.deployerI18n.tf(key, vars) : key;
}

function applyDynamicI18n(root) {
  if (!window.deployerI18n) return;
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  scope.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
}

function setEditorTitle(key) {
  const el = document.getElementById('editor-title');
  if (el) el.textContent = t(key);
}

const urlParams = new URLSearchParams(window.location.search);
const editId = urlParams.get('id');

function normalizeTemplateForEditor(raw) {
  const t = raw && typeof raw === 'object' ? { ...raw } : {};
  if (!Array.isArray(t.networks)) {
    t.networks = [];
    const legacyNet = String(t.network || '').trim();
    if (legacyNet) t.networks.push(legacyNet);
  }
  if (!Array.isArray(t.ports)) {
    t.ports = [];
    if (t.publishPort === true && t.port != null && t.port !== '') {
      t.ports.push({
        containerPort: t.containerPort != null ? t.containerPort : 80,
        hostPort: t.port,
        protocol: 'tcp',
      });
    }
  }
  return t;
}

const PORT_MIN = 1;
const PORT_MAX = 65535;
const PORT_TEMPLATE_RE = /^\{\{[A-Za-z0-9_]+\}\}$/;

function clampPortNumber(n) {
  if (!Number.isFinite(n)) return PORT_MIN;
  return Math.min(PORT_MAX, Math.max(PORT_MIN, n));
}

function sanitizeContainerPortInput(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return String(clampPortNumber(parseInt(digits, 10)));
}


function isValidContainerPortValue(value) {
  const v = String(value || '').trim();
  if (!/^\d+$/.test(v)) return false;
  const n = parseInt(v, 10);
  return n >= PORT_MIN && n <= PORT_MAX;
}

function isValidHostPortValue(value) {
  const v = String(value || '').trim();
  if (!v) return true;
  if (PORT_TEMPLATE_RE.test(v)) return true;
  if (!/^\d+$/.test(v)) return false;
  const n = parseInt(v, 10);
  return n >= PORT_MIN && n <= PORT_MAX;
}

function markPortInvalid(input, invalid) {
  if (!input) return;
  input.classList.toggle('port-invalid', invalid);
  input.setCustomValidity(invalid ? t('err_invalid_port') : '');
}

function bindPortRowValidation(row) {
  const containerInput = row.querySelector('[data-key="containerPort"]');
  const hostInput = row.querySelector('[data-key="hostPort"]');
  if (containerInput) {
    containerInput.addEventListener('input', () => {
      containerInput.value = sanitizeContainerPortInput(containerInput.value);
      markPortInvalid(containerInput, containerInput.value !== '' && !isValidContainerPortValue(containerInput.value));
    });
    containerInput.addEventListener('blur', () => {
      if (containerInput.value) {
        containerInput.value = sanitizeContainerPortInput(containerInput.value);
      }
      markPortInvalid(containerInput, containerInput.value !== '' && !isValidContainerPortValue(containerInput.value));
    });
  }
  if (hostInput) {
    hostInput.addEventListener('blur', () => {
      const v = hostInput.value.trim();
      if (!v) {
        markPortInvalid(hostInput, false);
        return;
      }
      if (/^\d+$/.test(v)) {
        hostInput.value = String(clampPortNumber(parseInt(v, 10)));
      }
      markPortInvalid(hostInput, !isValidHostPortValue(hostInput.value));
    });
  }
}

const FIELD_KEY_RE = /^[A-Z_]+$/;

function fitTextareaHeight(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function bindAutosizeTextarea(el) {
  if (!el || el.dataset.autosizeBound) return;
  el.dataset.autosizeBound = '1';
  el.addEventListener('input', () => fitTextareaHeight(el));
  fitTextareaHeight(el);
}

function sanitizeFieldKeyInput(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z_]/g, '');
}

function isValidFieldKey(value) {
  const v = String(value || '').trim();
  return v !== '' && FIELD_KEY_RE.test(v);
}

function markFieldKeyInvalid(input, invalid) {
  if (!input) return;
  input.classList.toggle('port-invalid', invalid);
  input.setCustomValidity(invalid ? t('err_field_key_chars') : '');
}

function bindFieldRowValidation(row) {
  const keyInput = row.querySelector('[data-key="key"]');
  if (!keyInput) return;
  const sync = () => {
    keyInput.value = sanitizeFieldKeyInput(keyInput.value);
    markFieldKeyInvalid(keyInput, keyInput.value !== '' && !isValidFieldKey(keyInput.value));
  };
  keyInput.addEventListener('input', sync);
  keyInput.addEventListener('blur', sync);
}

function validateAllFieldKeys() {
  const rows = document.querySelectorAll('#fields-list .repeat-row');
  for (let i = 0; i < rows.length; i++) {
    const keyInput = rows[i].querySelector('[data-key="key"]');
    const v = keyInput?.value?.trim() || '';
    if (!v) continue;
    keyInput.value = sanitizeFieldKeyInput(v);
    if (!isValidFieldKey(keyInput.value)) {
      markFieldKeyInvalid(keyInput, true);
      return tf('err_field_key_row', { row: i + 1 });
    }
    markFieldKeyInvalid(keyInput, false);
  }
  return null;
}

function validateAllPorts() {
  const rows = document.querySelectorAll('#ports-list .repeat-row');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const containerInput = row.querySelector('[data-key="containerPort"]');
    const hostInput = row.querySelector('[data-key="hostPort"]');
    const containerVal = containerInput?.value?.trim() || '';
    const hostVal = hostInput?.value?.trim() || '';
    if (!containerVal && !hostVal) continue;
    if (!isValidContainerPortValue(containerVal)) {
      markPortInvalid(containerInput, true);
      return tf('err_port_container_row', { row: i + 1, min: PORT_MIN, max: PORT_MAX });
    }
    if (!isValidHostPortValue(hostVal)) {
      markPortInvalid(hostInput, true);
      return tf('err_port_host_row', { row: i + 1, min: PORT_MIN, max: PORT_MAX });
    }
    markPortInvalid(containerInput, false);
    markPortInvalid(hostInput, false);
  }
  return null;
}

function addRow(containerId, config) {
  const list = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'repeat-row';
  row.innerHTML = config.html;
  list.appendChild(row);
  if (config.after) config.after(row);
}

function collectFields() {
  const rows = document.querySelectorAll('#fields-list .repeat-row');
  return Array.from(rows).map((row) => ({
    key: row.querySelector('[data-key="key"]')?.value?.trim() || '',
    label: row.querySelector('[data-key="label"]')?.value?.trim() || '',
    default: row.querySelector('[data-key="default"]')?.value?.trim() || '',
  })).filter((f) => f.key);
}

function collectEnv() {
  const rows = document.querySelectorAll('#env-list .repeat-row');
  return Array.from(rows).map((row) => ({
    name: row.querySelector('[data-key="name"]')?.value?.trim() || '',
    value: row.querySelector('[data-key="value"]')?.value?.trim() || '',
  })).filter((e) => e.name);
}

function collectVolumes() {
  const rows = document.querySelectorAll('#volumes-list .repeat-row');
  return Array.from(rows).map((row) => {
    const type = row.querySelector('[data-key="type"]')?.value === 'volume' ? 'volume' : 'bind';
    const source = row.querySelector('[data-key="source"]')?.value?.trim() || '';
    const container = row.querySelector('[data-key="container"]')?.value?.trim() || '';
    const mode = row.querySelector('[data-key="mode"]')?.value === 'ro' ? 'ro' : 'rw';
    if (!source || !container) return null;
    return { type, source, container, mode };
  }).filter(Boolean);
}

function collectNetworks() {
  const rows = document.querySelectorAll('#networks-list .repeat-row');
  return Array.from(rows).map((row) => {
    const name = row.querySelector('[data-key="name"]')?.value?.trim() || '';
    const aliasesRaw = row.querySelector('[data-key="aliases"]')?.value?.trim() || '';
    const ipv4Address = row.querySelector('[data-key="ipv4"]')?.value?.trim() || '';
    if (!name) return null;
    const out = { name };
    if (aliasesRaw) out.aliases = aliasesRaw;
    if (ipv4Address) out.ipv4Address = ipv4Address;
    return out;
  }).filter(Boolean);
}

function collectPorts() {
  const rows = document.querySelectorAll('#ports-list .repeat-row');
  return Array.from(rows).map((row) => {
    const containerRaw = row.querySelector('[data-key="containerPort"]')?.value?.trim() || '';
    const hostPort = row.querySelector('[data-key="hostPort"]')?.value?.trim() || '';
    const protocol = row.querySelector('[data-key="protocol"]')?.value || 'tcp';
    if (!containerRaw) return null;
    const containerPort = parseInt(containerRaw, 10);
    const out = { containerPort, protocol: protocol === 'udp' ? 'udp' : 'tcp' };
    if (hostPort) out.hostPort = /^\d+$/.test(hostPort) ? parseInt(hostPort, 10) : hostPort;
    return out;
  }).filter(Boolean);
}

function collectLabels() {
  const rows = document.querySelectorAll('#labels-list .repeat-row');
  return Array.from(rows).map((row) => row.querySelector('[data-key="label"]')?.value?.trim() || '').filter(Boolean);
}

function collectStringList(containerId) {
  const rows = document.querySelectorAll(`#${containerId} .repeat-row`);
  return Array.from(rows)
    .map((row) => row.querySelector('[data-key="arg"]')?.value?.trim() || '')
    .filter(Boolean);
}

function collectLimits() {
  const form = document.getElementById('template-form');
  const limits = {};
  const memory = form.limitMemory?.value?.trim() || '';
  const cpus = form.limitCpus?.value?.trim() || '';
  const pidsLimit = form.limitPids?.value?.trim() || '';
  const memorySwap = form.limitMemorySwap?.value?.trim() || '';
  if (memory) limits.memory = memory;
  if (memorySwap) limits.memorySwap = memorySwap;
  if (cpus) limits.cpus = cpus;
  if (pidsLimit) limits.pidsLimit = pidsLimit;
  return limits;
}

function collectDockerParams() {
  const rows = document.querySelectorAll('#docker-params-list .repeat-row');
  return Array.from(rows).map((row) => {
    const key = row.querySelector('[data-key="key"]')?.value?.trim() || '';
    const value = row.querySelector('[data-key="value"]')?.value?.trim() || '';
    if (!key || !value) return null;
    return { key, value };
  }).filter(Boolean);
}

function normalizeStepForEditor(step) {
  const s = step && typeof step === 'object' ? step : {};
  const envObj = s.env && typeof s.env === 'object' && !Array.isArray(s.env) ? s.env : {};
  return {
    command: String(s.command || ''),
    args: Array.isArray(s.args) ? s.args.map(String) : [],
    env: Object.entries(envObj).map(([name, value]) => ({ name, value: String(value ?? '') })),
    expect: Array.isArray(s.expect) ? s.expect.map(String) : [],
  };
}

function normalizeStepsForEditor(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(normalizeStepForEditor);
  if (typeof raw === 'object') return [normalizeStepForEditor(raw)];
  return [];
}

function packProvisionSteps(steps) {
  const packed = (steps || []).map((step) => {
    const command = String(step.command || '').trim();
    if (!command) return null;
    const out = { command };
    const args = (step.args || []).map((a) => String(a).trim()).filter(Boolean);
    if (args.length) out.args = args;
    const envRows = (step.env || []).filter((e) => e.name);
    if (envRows.length) {
      out.env = {};
      envRows.forEach((e) => {
        out.env[e.name] = e.value ?? '';
      });
    }
    const expect = (step.expect || []).map((k) => String(k).trim()).filter(Boolean);
    if (expect.length) out.expect = expect;
    return out;
  }).filter(Boolean);
  if (!packed.length) return null;
  if (packed.length === 1) return packed[0];
  return packed;
}

function collectStepsFromList(listId) {
  const cards = document.querySelectorAll(`#${listId} .provision-step-card`);
  return Array.from(cards).map((card) => {
    const command = card.querySelector('[data-key="command"]')?.value?.trim() || '';
    const args = Array.from(card.querySelectorAll('.provision-args-list .repeat-row'))
      .map((row) => row.querySelector('[data-key="arg"]')?.value?.trim() || '')
      .filter(Boolean);
    const env = Array.from(card.querySelectorAll('.provision-env-list .repeat-row'))
      .map((row) => ({
        name: row.querySelector('[data-key="name"]')?.value?.trim() || '',
        value: row.querySelector('[data-key="value"]')?.value?.trim() || '',
      }))
      .filter((e) => e.name);
    const expect = Array.from(card.querySelectorAll('.provision-expect-list .repeat-row'))
      .map((row) => row.querySelector('[data-key="expect"]')?.value?.trim() || '')
      .filter(Boolean);
    return { command, args, env, expect };
  });
}

function updateProvisionStepNumbers(listId) {
  const cards = document.querySelectorAll(`#${listId} .provision-step-card`);
  cards.forEach((card, index) => {
    const title = card.querySelector('.provision-step-title');
    if (title) title.textContent = tf('provision_step_n', { n: index + 1 });
  });
}

function addNestedArgRow(listEl, value = '') {
  const row = document.createElement('div');
  row.className = 'repeat-row';
  row.innerHTML = `
    <input type="text" data-key="arg" data-i18n-placeholder="ph_provision_arg" placeholder="${escapeAttr(t('ph_provision_arg'))}" value="${escapeAttr(value)}" style="flex:1;min-width:200px">
    <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
  `;
  listEl.appendChild(row);
  row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
  applyDynamicI18n(row);
}

function addNestedEnvRow(listEl, data = {}) {
  const row = document.createElement('div');
  row.className = 'repeat-row';
  row.innerHTML = `
    <input type="text" data-key="name" data-i18n-placeholder="ph_env_name" placeholder="${escapeAttr(t('ph_env_name'))}" value="${escapeAttr(data.name || '')}">
    <input type="text" data-key="value" data-i18n-placeholder="ph_env_value" placeholder="${escapeAttr(t('ph_env_value'))}" value="${escapeAttr(data.value || '')}" style="flex:2;min-width:180px">
    <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
  `;
  listEl.appendChild(row);
  row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
  applyDynamicI18n(row);
}

function addNestedExpectRow(listEl, value = '') {
  const row = document.createElement('div');
  row.className = 'repeat-row';
  row.innerHTML = `
    <input type="text" data-key="expect" data-i18n-placeholder="ph_provision_expect" placeholder="${escapeAttr(t('ph_provision_expect'))}" value="${escapeAttr(value)}" style="flex:1;min-width:200px">
    <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
  `;
  listEl.appendChild(row);
  row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
  applyDynamicI18n(row);
}

function addProvisionStepRow(listId, data = {}) {
  const step = normalizeStepForEditor(data);
  const list = document.getElementById(listId);
  const card = document.createElement('div');
  card.className = 'provision-step-card';
  card.innerHTML = `
    <div class="provision-step-header">
      <span class="provision-step-title"></span>
      <div class="provision-step-actions">
        <button type="button" class="btn btn-outline btn-sm btn-step-up" data-i18n-title="provision_move_up" title="${escapeAttr(t('provision_move_up'))}">↑</button>
        <button type="button" class="btn btn-outline btn-sm btn-step-down" data-i18n-title="provision_move_down" title="${escapeAttr(t('provision_move_down'))}">↓</button>
        <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
      </div>
    </div>
    <label class="provision-step-command">
      <span data-i18n="provision_command">${escapeAttr(t('provision_command'))}</span>
      <input type="text" data-key="command" data-i18n-placeholder="ph_provision_command" placeholder="${escapeAttr(t('ph_provision_command'))}" value="${escapeAttr(step.command)}">
    </label>
    <div class="provision-step-sub">
      <span class="provision-sub-label" data-i18n="provision_args">${escapeAttr(t('provision_args'))}</span>
      <div class="repeat-list provision-args-list"></div>
      <button type="button" class="btn btn-outline btn-sm btn-add-arg" data-i18n="provision_add_arg">${escapeAttr(t('provision_add_arg'))}</button>
    </div>
    <div class="provision-step-sub">
      <span class="provision-sub-label" data-i18n="provision_env">${escapeAttr(t('provision_env'))}</span>
      <div class="repeat-list provision-env-list"></div>
      <button type="button" class="btn btn-outline btn-sm btn-add-env" data-i18n="provision_add_env">${escapeAttr(t('provision_add_env'))}</button>
    </div>
    <div class="provision-step-sub">
      <span class="provision-sub-label" data-i18n="provision_expect">${escapeAttr(t('provision_expect'))}</span>
      <div class="repeat-list provision-expect-list"></div>
      <button type="button" class="btn btn-outline btn-sm btn-add-expect" data-i18n="provision_add_expect">${escapeAttr(t('provision_add_expect'))}</button>
    </div>
  `;
  list.appendChild(card);

  const argsList = card.querySelector('.provision-args-list');
  const envList = card.querySelector('.provision-env-list');
  const expectList = card.querySelector('.provision-expect-list');
  step.args.forEach((arg) => addNestedArgRow(argsList, arg));
  step.env.forEach((e) => addNestedEnvRow(envList, e));
  step.expect.forEach((key) => addNestedExpectRow(expectList, key));

  card.querySelector('.btn-add-arg').addEventListener('click', () => addNestedArgRow(argsList));
  card.querySelector('.btn-add-env').addEventListener('click', () => addNestedEnvRow(envList));
  card.querySelector('.btn-add-expect').addEventListener('click', () => addNestedExpectRow(expectList));
  card.querySelector('.btn-remove').addEventListener('click', () => {
    card.remove();
    updateProvisionStepNumbers(listId);
  });
  card.querySelector('.btn-step-up').addEventListener('click', () => {
    const prev = card.previousElementSibling;
    if (!prev) return;
    card.parentNode.insertBefore(card, prev);
    updateProvisionStepNumbers(listId);
  });
  card.querySelector('.btn-step-down').addEventListener('click', () => {
    const next = card.nextElementSibling;
    if (!next) return;
    card.parentNode.insertBefore(next, card);
    updateProvisionStepNumbers(listId);
  });

  applyDynamicI18n(card);
  updateProvisionStepNumbers(listId);
}

function fillProvisionSteps(listId, raw) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  normalizeStepsForEditor(raw).forEach((step) => addProvisionStepRow(listId, step));
}

function buildTemplate() {
  const form = document.getElementById('template-form');
  const limits = collectLimits();
  const template = {
    id: form.id?.value?.trim() || '',
    name: form.name?.value?.trim() || '',
    description: form.description?.value?.trim() || '',
    image: form.image?.value?.trim() || '',
    pullPolicy: form.pullPolicy?.value?.trim() || '',
    restartPolicy: form.restartPolicy?.value?.trim() || '',
    restartMaxRetries: form.restartMaxRetries?.value?.trim() || '',
    platform: form.platform?.value?.trim() || '',
    waitHealthy: form.waitHealthy?.checked || false,
    waitHealthyTimeoutSec: form.waitHealthyTimeoutSec?.value?.trim() || '',
    user: form.user?.value?.trim() || '',
    entrypoint: collectStringList('entrypoint-list'),
    command: collectStringList('command-list'),
    limits,
    dockerParams: collectDockerParams(),
    networks: collectNetworks(),
    ports: collectPorts(),
    fields: collectFields(),
    env: collectEnv(),
    volumes: collectVolumes(),
    labels: collectLabels(),
  };
  const provision = packProvisionSteps(collectStepsFromList('provision-steps-list'));
  const deprovision = packProvisionSteps(collectStepsFromList('deprovision-steps-list'));
  if (provision) template.provision = provision;
  if (deprovision) template.deprovision = deprovision;
  return template;
}

function normalizeImportedTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(t('err_import_not_object'));
  }
  const t = normalizeTemplateForEditor(raw);
  const id = String(t.id || '').trim();
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(t('err_import_id'));
  }
  if (!String(t.name || '').trim()) throw new Error(t('err_import_name'));
  if (!String(t.image || '').trim()) throw new Error(t('err_import_image'));
  return {
    id,
    name: String(t.name).trim(),
    description: String(t.description || '').trim(),
    image: String(t.image).trim(),
    pullPolicy: String(t.pullPolicy || '').trim(),
    restartPolicy: String(t.restartPolicy || '').trim(),
    restartMaxRetries: t.restartMaxRetries != null ? String(t.restartMaxRetries) : '',
    platform: String(t.platform || '').trim(),
    waitHealthy: Boolean(t.waitHealthy),
    waitHealthyTimeoutSec: t.waitHealthyTimeoutSec != null ? String(t.waitHealthyTimeoutSec) : '',
    user: String(t.user || '').trim(),
    entrypoint: Array.isArray(t.entrypoint) ? t.entrypoint : [],
    command: Array.isArray(t.command) ? t.command : [],
    limits: t.limits && typeof t.limits === 'object' ? t.limits : {},
    dockerParams: Array.isArray(t.dockerParams) ? t.dockerParams : [],
    networks: Array.isArray(t.networks) ? t.networks : [],
    ports: Array.isArray(t.ports) ? t.ports : [],
    fields: Array.isArray(t.fields) ? t.fields : [],
    env: Array.isArray(t.env) ? t.env : [],
    volumes: Array.isArray(t.volumes) ? t.volumes : [],
    labels: Array.isArray(t.labels) ? t.labels : [],
    provision: raw.provision != null ? raw.provision : null,
    deprovision: raw.deprovision != null ? raw.deprovision : null,
  };
}

function addFieldRow(data = {}) {
  const list = document.getElementById('fields-list');
  const row = document.createElement('div');
  row.className = 'repeat-row repeat-row-field';
  const keyVal = sanitizeFieldKeyInput(data.key || '');
  row.innerHTML = `
    <input type="text" data-key="key" data-i18n-placeholder="ph_field_key" placeholder="${escapeAttr(t('ph_field_key'))}" value="${escapeAttr(keyVal)}" autocomplete="off" spellcheck="false" data-i18n-aria-label="ph_field_key_aria" aria-label="${escapeAttr(t('ph_field_key_aria'))}">
    <input type="text" data-key="default" data-i18n-placeholder="ph_field_default" placeholder="${escapeAttr(t('ph_field_default'))}" value="${escapeAttr(data.default || '')}" data-i18n-aria-label="ph_field_default_aria" aria-label="${escapeAttr(t('ph_field_default_aria'))}">
    <input type="text" data-key="label" data-i18n-placeholder="ph_field_label" placeholder="${escapeAttr(t('ph_field_label'))}" value="${escapeAttr(data.label || '')}" data-i18n-aria-label="ph_field_label_aria" aria-label="${escapeAttr(t('ph_field_label_aria'))}">
    <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
  `;
  list.appendChild(row);
  row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
  bindFieldRowValidation(row);
}

function normalizeNetworkRowData(raw) {
  if (typeof raw === 'string') return { name: raw, aliases: '', ipv4Address: '' };
  return {
    name: raw?.name || '',
    aliases: Array.isArray(raw?.aliases) ? raw.aliases.join(', ') : String(raw?.aliases || ''),
    ipv4Address: raw?.ipv4Address || raw?.ipv4 || '',
  };
}

function normalizeVolumeRowData(raw) {
  if (typeof raw === 'string') {
    const parts = raw.split(':');
    return { type: 'bind', source: parts[0] || '', container: parts[1] || '', mode: parts[2] === 'ro' ? 'ro' : 'rw' };
  }
  const type = raw?.type === 'volume' ? 'volume' : 'bind';
  return {
    type,
    source: raw?.source || raw?.host || '',
    container: raw?.container || raw?.target || '',
    mode: raw?.mode === 'ro' ? 'ro' : 'rw',
  };
}

function syncRestartRetriesVisibility() {
  const form = document.getElementById('template-form');
  const wrap = document.getElementById('restart-retries-wrap');
  if (!wrap || !form.restartPolicy) return;
  wrap.hidden = form.restartPolicy.value !== 'on-failure';
}

function syncWaitTimeoutVisibility() {
  const form = document.getElementById('template-form');
  const wrap = document.getElementById('wait-timeout-wrap');
  if (!wrap || !form.waitHealthy) return;
  wrap.hidden = !form.waitHealthy.checked;
}

function bindVolumeRowTypeToggle(row) {
  const typeSelect = row.querySelector('[data-key="type"]');
  const sourceInput = row.querySelector('[data-key="source"]');
  if (!typeSelect || !sourceInput) return;
  const sync = () => {
    const isVolume = typeSelect.value === 'volume';
    sourceInput.placeholder = isVolume ? 'my-data-volume' : t('ph_volume_source_bind');
  };
  typeSelect.addEventListener('change', sync);
  sync();
}

function addNetworkRow(data = {}) {
  const n = normalizeNetworkRowData(data);
  addRow('networks-list', {
    html: `
      <input type="text" data-key="name" data-i18n-placeholder="ph_network_name" placeholder="${escapeAttr(t('ph_network_name'))}" value="${escapeAttr(n.name)}" data-i18n-title="ph_network_name_title" title="${escapeAttr(t('ph_network_name_title'))}">
      <input type="text" data-key="aliases" placeholder="alias1, alias2" value="${escapeAttr(n.aliases)}" data-i18n-title="ph_network_aliases_title" title="${escapeAttr(t('ph_network_aliases_title'))}">
      <input type="text" data-key="ipv4" placeholder="172.18.0.10" value="${escapeAttr(n.ipv4Address)}" data-i18n-title="ph_network_ipv4_title" title="${escapeAttr(t('ph_network_ipv4_title'))}">
      <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
    `,
    after: (row) => row.querySelector('.btn-remove').addEventListener('click', () => row.remove()),
  });
}

function addPortRow(data = {}) {
  const cp = data.containerPort != null ? String(data.containerPort) : '';
  const hp = data.hostPort != null ? String(data.hostPort) : '';
  const proto = data.protocol === 'udp' ? 'udp' : 'tcp';
  addRow('ports-list', {
    html: `
      <input type="text" class="port-in" data-key="containerPort" inputmode="numeric" data-i18n-placeholder="ph_port_container" placeholder="${escapeAttr(t('ph_port_container'))}" value="${escapeAttr(cp)}" data-i18n-title="ph_port_container_title" title="${escapeAttr(t('ph_port_container_title'))}">
      <span class="repeat-sep">→</span>
      <input type="text" class="port-out" data-key="hostPort" placeholder="{{HOST_PORT}}" value="${escapeAttr(hp)}" data-i18n-title="ph_port_host_title" title="${escapeAttr(t('ph_port_host_title'))}">
      <select class="port-proto" data-key="protocol" data-i18n-title="ph_port_proto_title" title="${escapeAttr(t('ph_port_proto_title'))}">
        <option value="tcp" ${proto === 'tcp' ? 'selected' : ''}>TCP</option>
        <option value="udp" ${proto === 'udp' ? 'selected' : ''}>UDP</option>
      </select>
      <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
    `,
    after: (row) => {
      row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
      bindPortRowValidation(row);
    },
  });
}

function addEnvRow(data = {}) {
  addRow('env-list', {
    html: `
      <input type="text" data-key="name" data-i18n-placeholder="ph_env_name" placeholder="${escapeAttr(t('ph_env_name'))}" value="${escapeAttr(data.name || '')}">
      <input type="text" data-key="value" data-i18n-placeholder="ph_env_value" placeholder="${escapeAttr(t('ph_env_value'))}" value="${escapeAttr(data.value || '')}" style="flex:2;min-width:180px">
      <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
    `,
    after: (row) => row.querySelector('.btn-remove').addEventListener('click', () => row.remove()),
  });
}

function addVolumeRow(data = {}) {
  const v = normalizeVolumeRowData(data);
  addRow('volumes-list', {
    html: `
      <select data-key="type" data-i18n-title="ph_volume_type_title" title="${escapeAttr(t('ph_volume_type_title'))}">
        <option value="bind" ${v.type === 'bind' ? 'selected' : ''}>bind</option>
        <option value="volume" ${v.type === 'volume' ? 'selected' : ''}>volume</option>
      </select>
      <input type="text" data-key="source" data-i18n-placeholder="ph_volume_source" placeholder="${escapeAttr(t('ph_volume_source'))}" value="${escapeAttr(v.source)}">
      <input type="text" data-key="container" data-i18n-placeholder="ph_volume_container" placeholder="${escapeAttr(t('ph_volume_container'))}" value="${escapeAttr(v.container)}">
      <select data-key="mode" data-i18n-title="ph_volume_mode_title" title="${escapeAttr(t('ph_volume_mode_title'))}">
        <option value="rw" ${v.mode === 'rw' ? 'selected' : ''}>rw</option>
        <option value="ro" ${v.mode === 'ro' ? 'selected' : ''}>ro</option>
      </select>
      <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
    `,
    after: (row) => {
      row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
      bindVolumeRowTypeToggle(row);
    },
  });
}

function addArgRow(containerId, value = '') {
  addRow(containerId, {
    html: `
      <input type="text" data-key="arg" data-i18n-placeholder="ph_arg" placeholder="${escapeAttr(t('ph_arg'))}" value="${escapeAttr(value)}" style="flex:1;min-width:200px">
      <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
    `,
    after: (row) => row.querySelector('.btn-remove').addEventListener('click', () => row.remove()),
  });
}

function addDockerParamRow(data = {}) {
  addRow('docker-params-list', {
    html: `
      <input type="text" data-key="key" data-i18n-placeholder="ph_docker_param_key" placeholder="${escapeAttr(t('ph_docker_param_key'))}" value="${escapeAttr(data.key || '')}" data-i18n-title="ph_docker_param_key_title" title="${escapeAttr(t('ph_docker_param_key_title'))}">
      <input type="text" data-key="value" data-i18n-placeholder="ph_docker_param_value" placeholder="${escapeAttr(t('ph_docker_param_value'))}" value="${escapeAttr(data.value || '')}" data-i18n-title="ph_docker_param_value_title" title="${escapeAttr(t('ph_docker_param_value_title'))}">
      <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
    `,
    after: (row) => row.querySelector('.btn-remove').addEventListener('click', () => row.remove()),
  });
}

function addLabelRow(data = '') {
  addRow('labels-list', {
    html: `
      <input type="text" data-key="label" data-i18n-placeholder="ph_label" placeholder="${escapeAttr(t('ph_label'))}" value="${escapeAttr(data)}" style="flex:1;min-width:280px">
      <button type="button" class="btn btn-outline btn-remove" data-i18n="action_remove">${escapeAttr(t('action_remove'))}</button>
    `,
    after: (row) => row.querySelector('.btn-remove').addEventListener('click', () => row.remove()),
  });
}

function escapeAttr(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML.replace(/"/g, '&quot;');
}

function fillForm(raw) {
  const template = normalizeTemplateForEditor(raw);
  const form = document.getElementById('template-form');
  form.id.value = template.id || '';
  form.name.value = template.name || '';
  form.description.value = template.description || '';
  fitTextareaHeight(form.description);
  form.image.value = template.image || '';
  form.pullPolicy.value = template.pullPolicy === 'ifNotPresent' ? 'ifNotPresent' : 'always';
  const restart = String(template.restartPolicy || '').trim();
  form.restartPolicy.value = ['no', 'always', 'on-failure'].includes(restart) ? restart : 'unless-stopped';
  if (form.restartMaxRetries) form.restartMaxRetries.value = template.restartMaxRetries != null ? String(template.restartMaxRetries) : '';
  if (form.platform) form.platform.value = template.platform || '';
  if (form.waitHealthy) form.waitHealthy.checked = Boolean(template.waitHealthy);
  if (form.waitHealthyTimeoutSec) form.waitHealthyTimeoutSec.value = template.waitHealthyTimeoutSec != null ? String(template.waitHealthyTimeoutSec) : '';
  if (form.user) form.user.value = template.user || '';
  if (form.limitMemory) form.limitMemory.value = template.limits?.memory || '';
  if (form.limitMemorySwap) form.limitMemorySwap.value = template.limits?.memorySwap || '';
  if (form.limitCpus) form.limitCpus.value = template.limits?.cpus || '';
  if (form.limitPids) form.limitPids.value = template.limits?.pidsLimit || '';
  syncRestartRetriesVisibility();
  syncWaitTimeoutVisibility();
  if (template.id) form.id.readOnly = true;

  document.getElementById('entrypoint-list').innerHTML = '';
  (template.entrypoint || []).forEach((arg) => addArgRow('entrypoint-list', arg));

  document.getElementById('command-list').innerHTML = '';
  (template.command || []).forEach((arg) => addArgRow('command-list', arg));

  document.getElementById('docker-params-list').innerHTML = '';
  (template.dockerParams || []).forEach((p) => addDockerParamRow(p));

  document.getElementById('networks-list').innerHTML = '';
  (template.networks || []).forEach((n) => addNetworkRow(n));

  document.getElementById('ports-list').innerHTML = '';
  (template.ports || []).forEach((p) => addPortRow(p));

  document.getElementById('fields-list').innerHTML = '';
  (template.fields || []).forEach((f) => addFieldRow(f));
  if ((template.fields || []).length === 0) addFieldRow();

  fillProvisionSteps('provision-steps-list', template.provision);
  fillProvisionSteps('deprovision-steps-list', template.deprovision);

  document.getElementById('env-list').innerHTML = '';
  (template.env || []).forEach((e) => addEnvRow(e));
  if ((template.env || []).length === 0) addEnvRow();

  document.getElementById('volumes-list').innerHTML = '';
  (template.volumes || []).forEach((v) => addVolumeRow(v));
  if ((template.volumes || []).length === 0) addVolumeRow();

  document.getElementById('labels-list').innerHTML = '';
  (template.labels || []).forEach((l) => addLabelRow(typeof l === 'string' ? l : (l.name && l.value ? l.name + '=' + l.value : '')));
  if ((template.labels || []).length === 0) addLabelRow();
}

document.getElementById('add-field').addEventListener('click', () => addFieldRow());
document.getElementById('add-provision-step').addEventListener('click', () => addProvisionStepRow('provision-steps-list'));
document.getElementById('add-deprovision-step').addEventListener('click', () => addProvisionStepRow('deprovision-steps-list'));
document.getElementById('add-entrypoint').addEventListener('click', () => addArgRow('entrypoint-list'));
document.getElementById('add-command').addEventListener('click', () => addArgRow('command-list'));
document.getElementById('add-docker-param').addEventListener('click', () => addDockerParamRow());
document.getElementById('add-network').addEventListener('click', () => addNetworkRow());
document.getElementById('add-port').addEventListener('click', () => addPortRow());
document.getElementById('add-env').addEventListener('click', () => addEnvRow());
document.getElementById('add-volume').addEventListener('click', () => addVolumeRow());
document.getElementById('add-label').addEventListener('click', () => addLabelRow());

const templateForm = document.getElementById('template-form');
if (templateForm?.description) {
  bindAutosizeTextarea(templateForm.description);
  window.addEventListener('resize', () => fitTextareaHeight(templateForm.description));
}
if (templateForm.restartPolicy) {
  templateForm.restartPolicy.addEventListener('change', syncRestartRetriesVisibility);
}
if (templateForm.waitHealthy) {
  templateForm.waitHealthy.addEventListener('change', syncWaitTimeoutVisibility);
}

document.getElementById('import-json').addEventListener('change', async (e) => {
  const input = e.target;
  const statusEl = document.getElementById('import-status');
  const errEl = document.getElementById('form-error');
  statusEl.hidden = true;
  errEl.hidden = true;
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const template = normalizeImportedTemplate(parsed);
    fillForm(template);
    setEditorTitle(editId ? 'editor_edit' : 'editor_edit_from_json');
    statusEl.textContent = tf('import_loaded', { id: template.id });
    statusEl.hidden = false;
  } catch (err) {
    errEl.textContent = err.message || t('err_import_json');
    errEl.hidden = false;
    input.value = '';
  }
});

document.getElementById('template-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('form-error');
  errEl.hidden = true;
  const portErr = validateAllPorts();
  if (portErr) {
    errEl.textContent = portErr;
    errEl.hidden = false;
    return;
  }
  const fieldKeyErr = validateAllFieldKeys();
  if (fieldKeyErr) {
    errEl.textContent = fieldKeyErr;
    errEl.hidden = false;
    return;
  }
  const template = buildTemplate();
  if (!template.id) {
    errEl.textContent = t('err_template_id_required');
    errEl.hidden = false;
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(template.id)) {
    errEl.textContent = t('err_template_id_format');
    errEl.hidden = false;
    return;
  }
  if (!template.name || !template.image) {
    errEl.textContent = t('err_template_name_image');
    errEl.hidden = false;
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await api('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(template) });
    window.location.href = '/index.html';
  } catch (err) {
    errEl.textContent = err.message || t('err_save');
    errEl.hidden = false;
    btn.disabled = false;
  }
});

function refreshVolumePlaceholders() {
  document.querySelectorAll('#volumes-list .repeat-row').forEach((row) => {
    const typeSelect = row.querySelector('[data-key="type"]');
    const sourceInput = row.querySelector('[data-key="source"]');
    if (!typeSelect || !sourceInput) return;
    sourceInput.placeholder = typeSelect.value === 'volume' ? 'my-data-volume' : t('ph_volume_source_bind');
  });
}

window.addEventListener('deployer-lang-changed', () => {
  if (window.deployerI18n) window.deployerI18n.apply();
  applyDynamicI18n(document.getElementById('template-form'));
  refreshVolumePlaceholders();
  updateProvisionStepNumbers('provision-steps-list');
  updateProvisionStepNumbers('deprovision-steps-list');
  if (editId) setEditorTitle('editor_edit');
  else setEditorTitle('editor_new');
});

(async () => {
  if (window.deployerI18n && window.deployerI18n.ready) {
    await window.deployerI18n.ready;
  }
  try {
    await api('/api/me');
  } catch {
    window.location.href = '/login.html';
    return;
  }
  if (editId) {
    setEditorTitle('editor_edit');
    try {
      const template = await api('/api/templates/' + encodeURIComponent(editId));
      fillForm(template);
    } catch {
      document.getElementById('form-error').textContent = t('err_template_not_found');
      document.getElementById('form-error').hidden = false;
    }
  } else {
    addPortRow({ containerPort: 80, hostPort: '{{HOST_PORT}}', protocol: 'tcp' });
    addFieldRow({
      key: 'HOST_PORT',
      label: t('default_host_port_label'),
      default: '8080',
    });
    addEnvRow();
    addVolumeRow({ type: 'bind', source: '{{DEPLOY_BASE_PATH}}/{{CONTAINER_NAME}}/data', container: '/data' });
    addLabelRow();
    syncRestartRetriesVisibility();
    syncWaitTimeoutVisibility();
  }
})();
