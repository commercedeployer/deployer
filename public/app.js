const api = (path, opts = {}) => window.deployerApi(path, opts);

function t(key) {
  return window.deployerI18n ? window.deployerI18n.t(key) : key;
}

function tf(key, vars) {
  return window.deployerI18n ? window.deployerI18n.tf(key, vars) : key;
}

async function waitForOperation(operationId) {
  return window.deployerOperationPoll.waitForOperation(operationId, api);
}

async function runAsyncAction(path, opts = {}) {
  return window.deployerOperationPoll.runAsyncAction(path, api, opts);
}

function setModalStatus(el, text) {
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function showModal(template, fields) {
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const fieldsEl = document.getElementById('modal-fields');
  const form = document.getElementById('deploy-form');
  title.textContent = template.name;
  fieldsEl.innerHTML = '';
  const values = {};
  const cnLabel = document.createElement('label');
  cnLabel.innerHTML = '<span>' + escapeHtml(t('container_name_label')) + '</span>';
  const cnInput = document.createElement('input');
  cnInput.type = 'text';
  cnInput.name = 'containerName';
  cnInput.placeholder = 'my-container';
  cnInput.autocomplete = 'off';
  cnInput.required = true;
  cnLabel.appendChild(cnInput);
  fieldsEl.appendChild(cnLabel);
  form._containerNameInput = cnInput;
  (template.fields || []).forEach((f) => {
    const key = f.key;
    const label = document.createElement('label');
    label.innerHTML = `<span>${escapeHtml(f.label || key)}</span>`;
    const input = document.createElement('input');
    const fieldType = String(f.type || 'text').toLowerCase();
    input.type = fieldType === 'password' ? 'password' : 'text';
    input.name = key;
    input.placeholder = f.default ? String(f.default) : '';
    input.autocomplete = 'off';
    label.appendChild(input);
    fieldsEl.appendChild(label);
    values[key] = input;
  });
  form.dataset.templateId = template.id;
  form._valueInputs = values;
  if (window.DeployerPasswordToggle && typeof window.DeployerPasswordToggle.scan === 'function') {
    window.DeployerPasswordToggle.scan(fieldsEl);
  }
  overlay.hidden = false;
}

function hideModal() {
  document.getElementById('modal-overlay').hidden = true;
  document.getElementById('deploy-error').hidden = true;
  setModalStatus(document.getElementById('deploy-status'), '');
}

/** Delete-container modal context (id, display name). */
let deleteContainerContext = { id: null, name: null };

function openDeleteContainerModal(id, name) {
  deleteContainerContext = { id, name };
  const intro = document.querySelector('.modal-delete-intro');
  if (intro) intro.textContent = tf('delete_modal_intro', { name: '«' + name + '»' });
  document.getElementById('delete-modal-overlay').hidden = false;
}

function closeDeleteContainerModal() {
  document.getElementById('delete-modal-overlay').hidden = true;
  setModalStatus(document.getElementById('delete-modal-status'), '');
  deleteContainerContext = { id: null, name: null };
}

let containerInfoContext = { id: null, name: null, tab: 'logs' };

function setContainerInfoTab(tab) {
  containerInfoContext.tab = tab === 'inspect' ? 'inspect' : 'logs';
  const logsTab = document.getElementById('container-info-tab-logs');
  const inspectTab = document.getElementById('container-info-tab-inspect');
  const logsPanel = document.getElementById('container-info-panel-logs');
  const inspectPanel = document.getElementById('container-info-panel-inspect');
  const isLogs = containerInfoContext.tab === 'logs';
  if (logsTab) {
    logsTab.classList.toggle('is-active', isLogs);
    logsTab.setAttribute('aria-selected', isLogs ? 'true' : 'false');
  }
  if (inspectTab) {
    inspectTab.classList.toggle('is-active', !isLogs);
    inspectTab.setAttribute('aria-selected', !isLogs ? 'true' : 'false');
  }
  if (logsPanel) logsPanel.hidden = !isLogs;
  if (inspectPanel) inspectPanel.hidden = isLogs;
}

function clearContainerInfoModal() {
  const errEl = document.getElementById('container-info-error');
  const statusEl = document.getElementById('container-info-status');
  const logsEl = document.getElementById('container-info-logs');
  const inspectEl = document.getElementById('container-info-inspect');
  const refreshBtn = document.getElementById('container-info-refresh');
  if (errEl) {
    errEl.textContent = '';
    errEl.hidden = true;
  }
  setModalStatus(statusEl, '');
  if (logsEl) logsEl.textContent = '';
  if (inspectEl) inspectEl.textContent = '';
  if (refreshBtn) refreshBtn.disabled = false;
}

function closeContainerInfoModal() {
  document.getElementById('container-info-modal-overlay').hidden = true;
  clearContainerInfoModal();
  containerInfoContext = { id: null, name: null, tab: 'logs' };
}

async function loadContainerInfoData() {
  const { id } = containerInfoContext;
  if (!id) return;
  const errEl = document.getElementById('container-info-error');
  const statusEl = document.getElementById('container-info-status');
  const logsEl = document.getElementById('container-info-logs');
  const inspectEl = document.getElementById('container-info-inspect');
  const refreshBtn = document.getElementById('container-info-refresh');
  if (errEl) errEl.hidden = true;
  setModalStatus(statusEl, t('container_info_loading'));
  if (refreshBtn) refreshBtn.disabled = true;
  const errors = [];
  try {
    const [logsResult, inspectResult] = await Promise.allSettled([
      api('/api/containers/' + encodeURIComponent(id) + '/logs'),
      api('/api/containers/' + encodeURIComponent(id) + '?inspect=1'),
    ]);
    if (logsResult.status === 'fulfilled') {
      const logsText = logsResult.value && logsResult.value.logs != null ? String(logsResult.value.logs) : '';
      if (logsEl) logsEl.textContent = logsText.trim() ? logsText : t('container_info_logs_empty');
    } else {
      errors.push(logsResult.reason?.message || t('err_get_logs'));
      if (logsEl) logsEl.textContent = '';
    }
    if (inspectResult.status === 'fulfilled') {
      const inspectData = inspectResult.value;
      const inspect = inspectData && inspectData.inspect ? inspectData.inspect : inspectData;
      if (inspectEl) inspectEl.textContent = JSON.stringify(inspect, null, 2);
    } else {
      errors.push(inspectResult.reason?.message || t('err_get_container'));
      if (inspectEl) inspectEl.textContent = '';
    }
    setModalStatus(statusEl, '');
    if (errors.length) {
      if (errEl) {
        errEl.textContent = errors.join('\n');
        errEl.hidden = false;
      }
    }
  } catch (err) {
    setModalStatus(statusEl, '');
    if (errEl) {
      errEl.textContent = err.message || t('err_load_containers');
      errEl.hidden = false;
    }
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function openContainerInfoModal(id, name, tab) {
  containerInfoContext = { id, name, tab: tab === 'inspect' ? 'inspect' : 'logs' };
  const titleEl = document.getElementById('container-info-modal-title');
  if (titleEl) titleEl.textContent = t('container_info_title') + ': ' + name;
  clearContainerInfoModal();
  setContainerInfoTab(containerInfoContext.tab);
  document.getElementById('container-info-modal-overlay').hidden = false;
  loadContainerInfoData();
}

function confirmAndDeleteContainer(removeData) {
  const { id, name } = deleteContainerContext;
  if (!id) return;
  const msg = removeData
    ? tf('confirm_delete_container_with_data', { name })
    : tf('confirm_delete_container_only', { name });
  if (!confirm(msg)) return;
  runDeleteContainer(removeData);
}

async function runDeleteContainer(removeData) {
  const { id } = deleteContainerContext;
  if (!id) return;
  const overlay = document.getElementById('delete-modal-overlay');
  const actionBtns = overlay.querySelectorAll('.modal-delete-actions button');
  const statusEl = document.getElementById('delete-modal-status');
  actionBtns.forEach((b) => {
    b.disabled = true;
  });
  setModalStatus(statusEl, t('status_deleting'));
  try {
    const q = removeData ? '?removeData=true' : '';
    const op = await runAsyncAction('/api/containers/' + encodeURIComponent(id) + q, { method: 'DELETE' });
    const result = op.result || op;
    closeDeleteContainerModal();
    if (removeData && result.dataRemoved && result.dataRemoved.length) {
      alert(tf('alert_dirs_removed', { paths: result.dataRemoved.join('\n') }));
    }
    loadContainers();
  } catch (err) {
    setModalStatus(statusEl, '');
    alert(err.message || t('err_delete'));
  } finally {
    actionBtns.forEach((b) => {
      b.disabled = false;
    });
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function substituteDefaults(fields, params) {
  const out = { ...params };
  (fields || []).forEach((f) => {
    if (out[f.key] != null && out[f.key] !== '') return;
    let def = f.default || '';
    Object.keys(params).forEach((k) => {
      def = def.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), params[k] != null ? params[k] : '');
    });
    out[f.key] = def;
  });
  return out;
}

async function loadTemplates() {
  const el = document.getElementById('templates-list');
  try {
    const list = await api('/api/templates');
    if (!Array.isArray(list)) {
      throw new Error(t('err_unexpected_templates'));
    }
    if (!list.length) {
      hideModal();
      el.innerHTML =
        '<p class="muted">' +
        escapeHtml(t('empty_templates_lead')) +
        ' <a href="/template-editor.html">' +
        escapeHtml(t('empty_templates_link')) +
        '</a> ' +
        escapeHtml(t('empty_templates_tail')) +
        '</p>';
      return;
    }
    el.innerHTML = list
      .map(
        (tpl) => `
    <div class="template-card">
      <div>
        <h3>${escapeHtml(tpl.name)}</h3>
        <p>${escapeHtml(tpl.description || '')}</p>
      </div>
      <div class="template-card-actions">
        <button type="button" class="btn btn-primary" data-deploy="${escapeHtml(tpl.id)}">${escapeHtml(t('btn_deploy'))}</button>
        <a href="/template-editor.html?id=${encodeURIComponent(tpl.id)}" class="btn btn-outline">${escapeHtml(t('btn_edit'))}</a>
        <button type="button" class="btn btn-outline btn-danger btn-delete" data-id="${escapeHtml(tpl.id)}" data-name="${escapeHtml(tpl.name)}">${escapeHtml(t('btn_delete'))}</button>
      </div>
    </div>
  `
      )
      .join('');
    el.querySelectorAll('[data-deploy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tpl = list.find((x) => x.id === btn.dataset.deploy);
        if (tpl) showModal(tpl, tpl.fields);
      });
    });
    el.querySelectorAll('.btn-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        if (!confirm(tf('confirm_delete_template', { name }))) return;
        try {
          await api('/api/templates/' + encodeURIComponent(id), { method: 'DELETE' });
          loadTemplates();
        } catch (err) {
          alert(err.message || t('err_delete'));
        }
      });
    });
  } catch (err) {
    hideModal();
    el.innerHTML = '<p class="error">' + escapeHtml(err.message || t('err_load_templates')) + '</p>';
  }
}

const containerPendingOps = {};
const DOCKER_STATE_I18N = {
  running: 'container_status_running',
  exited: 'container_status_exited',
  dead: 'container_status_dead',
  created: 'container_status_created',
  paused: 'container_status_paused',
  restarting: 'container_status_restarting_docker',
  removing: 'container_status_removing',
};
const PENDING_STATE_I18N = {
  stopping: 'container_status_stopping',
  starting: 'container_status_starting',
  restarting: 'container_status_restarting',
};
const LIFECYCLE_PENDING = { stop: 'stopping', start: 'starting', restart: 'restarting' };
const LIFECYCLE_PATH = { stop: 'stop', start: 'start', restart: 'restart' };
const LIFECYCLE_EXPECT = {
  stop: (s) => s === 'exited' || s === 'dead' || s === 'paused' || s === 'created',
  start: (s) => s === 'running',
  restart: (s) => s === 'running',
};

function stateBadgeClass(state) {
  if (state === 'stopping' || state === 'starting' || state === 'restarting') return 'pending';
  if (state === 'running') return 'running';
  if (state === 'exited' || state === 'dead') return 'exited';
  return 'other';
}

function getEffectiveContainerState(c) {
  if (containerPendingOps[c.id]) return containerPendingOps[c.id];
  const live = lastContainerData[c.id]?.liveState;
  if (live) return live;
  return c.state;
}

function formatContainerStateLabel(state) {
  if (PENDING_STATE_I18N[state]) return t(PENDING_STATE_I18N[state]);
  const key = DOCKER_STATE_I18N[state];
  if (key) return t(key);
  return state || '—';
}

function isContainerPending(state) {
  return state === 'stopping' || state === 'starting' || state === 'restarting';
}

function setContainerPending(id, op) {
  containerPendingOps[id] = op;
}

function clearContainerPending(id) {
  delete containerPendingOps[id];
}

function isContainerNotFoundError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('Container not found') ||
    msg.includes('Container not found') ||
    msg === t('err_container_not_found')
  );
}

async function fetchContainerLiveState(id) {
  try {
    const data = await api('/api/containers/' + encodeURIComponent(id));
    return { exists: true, state: data.state || null };
  } catch (err) {
    if (isContainerNotFoundError(err)) return { exists: false, state: null };
    return { exists: true, state: null };
  }
}

async function waitForContainerState(id, predicate, options = {}) {
  const maxAttempts = options.maxAttempts ?? 25;
  const delayMs = options.delayMs ?? 1000;
  for (let i = 0; i < maxAttempts; i += 1) {
    const res = await fetchContainerLiveState(id);
    if (!res.exists) return null;
    if (res.state && predicate(res.state)) {
      lastContainerData[id] = lastContainerData[id] || {};
      lastContainerData[id].liveState = res.state;
      const cacheItem = containersCache.find((x) => x.id === id);
      if (cacheItem) cacheItem.state = res.state;
      return res.state;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

async function refreshContainerLiveStates(list) {
  if (!list.length) return;
  const results = await Promise.all(list.map((c) => fetchContainerLiveState(c.id)));
  let changed = false;
  const removedIds = [];
  results.forEach((res, idx) => {
    const c = list[idx];
    if (!res.exists) {
      removedIds.push(c.id);
      changed = true;
      return;
    }
    if (!res.state) return;
    lastContainerData[c.id] = lastContainerData[c.id] || {};
    const prev = lastContainerData[c.id].liveState;
    lastContainerData[c.id].liveState = res.state;
    const cacheItem = containersCache.find((x) => x.id === c.id);
    if (cacheItem && cacheItem.state !== res.state) {
      cacheItem.state = res.state;
      changed = true;
    } else if (prev !== res.state) {
      changed = true;
    }
  });
  if (removedIds.length) {
    removedIds.forEach((id) => {
      delete lastContainerData[id];
      delete containerPendingOps[id];
    });
    loadContainers({ skipStats: true });
    return;
  }
  if (changed) renderContainersList();
}

async function runContainerLifecycle(id, name, action) {
  const confirmKey = { stop: 'confirm_stop', start: 'confirm_start', restart: 'confirm_restart' }[action];
  const errKey = { stop: 'err_stop', start: 'err_start', restart: 'err_restart' }[action];
  if (!confirm(tf(confirmKey, { name }))) return;
  setContainerPending(id, LIFECYCLE_PENDING[action]);
  renderContainersList();
  try {
    await runAsyncAction('/api/containers/' + encodeURIComponent(id) + '/' + LIFECYCLE_PATH[action], {
      method: 'POST',
    });
    await waitForContainerState(id, LIFECYCLE_EXPECT[action]);
    const row = containersCache.filter((c) => c.id === id);
    if (row.length) refreshContainerStats(row);
  } catch (err) {
    alert(err.message || t(errKey));
  } finally {
    clearContainerPending(id);
    const row = containersCache.filter((c) => c.id === id);
    if (row.length) await refreshContainerLiveStates(row);
    else renderContainersList();
  }
}

const lastContainerData = {};
const CONTAINERS_PAGE_SIZE = 20;
let containersCache = [];
let containersListTotal = 0;
let containersListOffset = 0;
let containerDeployLimit = 0;
let containersSearchTimer = null;

function getContainerSearchQuery() {
  const input = document.getElementById('containers-search');
  return input ? input.value.trim() : '';
}

function buildContainersQueryString() {
  const parts = ['all=true', 'limit=' + CONTAINERS_PAGE_SIZE, 'offset=' + containersListOffset];
  const q = getContainerSearchQuery();
  if (q) parts.push('q=' + encodeURIComponent(q));
  return '?' + parts.join('&');
}

function renderContainersPagerFromBody(body) {
  const pagerEl = document.getElementById('containers-pager');
  if (!pagerEl || !window.ListPager) return;
  window.ListPager.render(pagerEl, window.ListPager.normalizeMeta(body, CONTAINERS_PAGE_SIZE), {
    dataAttr: 'data-containers-offset',
    tr: (key, fb) => t(key) || fb,
    trf: (key, fb, vars) => tf(key, vars) || fb,
  });
}

function bindContainersPager() {
  const pagerEl = document.getElementById('containers-pager');
  if (!pagerEl || !window.ListPager || pagerEl.dataset.bound) return;
  pagerEl.dataset.bound = '1';
  window.ListPager.bindClick(
    pagerEl,
    (offset) => {
      containersListOffset = Math.max(0, Number(offset) || 0);
      loadContainers();
    },
    'data-containers-offset',
  );
}

function syncContainersSearchVisibility() {
  const wrap = document.getElementById('containers-search-wrap');
  if (wrap) wrap.hidden = containersListTotal === 0 && !getContainerSearchQuery();
}

function updateContainersUsage(total, limit) {
  const usageEl = document.getElementById('containers-usage');
  if (!usageEl) return;
  usageEl.textContent = limit > 0 ? tf('containers_usage', { total, limit }) : tf('containers_count', { total });
}

function bindContainerRowActions(el) {
  el.querySelectorAll('.btn-restart').forEach((btn) => {
    btn.addEventListener('click', () => runContainerLifecycle(btn.dataset.id, btn.dataset.name, 'restart'));
  });
  el.querySelectorAll('.btn-stop').forEach((btn) => {
    btn.addEventListener('click', () => runContainerLifecycle(btn.dataset.id, btn.dataset.name, 'stop'));
  });
  el.querySelectorAll('.btn-start').forEach((btn) => {
    btn.addEventListener('click', () => runContainerLifecycle(btn.dataset.id, btn.dataset.name, 'start'));
  });
  el.querySelectorAll('.btn-delete-container').forEach((btn) => {
    btn.addEventListener('click', () => {
      openDeleteContainerModal(btn.dataset.id, btn.dataset.name);
    });
  });
  el.querySelectorAll('.btn-container-details').forEach((btn) => {
    btn.addEventListener('click', () => {
      openContainerInfoModal(btn.dataset.id, btn.dataset.name, 'logs');
    });
  });
}

function renderContainersList() {
  const el = document.getElementById('containers-list');
  if (!el) return;
  const query = getContainerSearchQuery();
  if (!containersListTotal && !query) {
    el.innerHTML = '<p class="muted">' + escapeHtml(t('empty_containers')) + '</p>';
    renderContainersPagerFromBody({ total: 0, total_pages: 1, page: 1, offset: 0, limit: CONTAINERS_PAGE_SIZE });
    return;
  }
  if (!containersCache.length) {
    el.innerHTML =
      '<p class="muted">' + escapeHtml(tf('containers_search_empty', { query: query || '—' })) + '</p>';
    renderContainersPagerFromBody({ total: containersListTotal, total_pages: 1, page: 1, offset: 0, limit: CONTAINERS_PAGE_SIZE });
    return;
  }
  el.innerHTML = containersCache
    .map((c) => renderContainerRow(c, buildStatsLine(lastContainerData[c.id]) || ''))
    .join('');
  bindContainerRowActions(el);
}

function refreshContainerStats(list) {
  const el = document.getElementById('containers-list');
  if (!el) return;
  if (window._diskPollTimeouts) {
    window._diskPollTimeouts.forEach(clearTimeout);
    window._diskPollTimeouts.clear();
  } else {
    window._diskPollTimeouts = new Set();
  }
  const DISK_POLL_MS = 45000;
  function scheduleDiskPoll(id) {
    api('/api/containers/' + encodeURIComponent(id) + '/disk')
      .then((disk) => {
        if (disk) {
          lastContainerData[id] = lastContainerData[id] || {};
          lastContainerData[id].disk = disk;
          const row = Array.from(el.querySelectorAll('.container-row')).find((r) => r.dataset.id === id);
          if (row) {
            const statsEl = row.querySelector('.stats');
            if (statsEl) statsEl.textContent = buildStatsLine(lastContainerData[id]);
          }
        }
        const timer = setTimeout(() => scheduleDiskPoll(id), DISK_POLL_MS);
        window._diskPollTimeouts.add(timer);
      })
      .catch(() => {
        const timer = setTimeout(() => scheduleDiskPoll(id), DISK_POLL_MS);
        window._diskPollTimeouts.add(timer);
      });
  }
  Promise.allSettled(list.map((c) => api('/api/containers/' + encodeURIComponent(c.id) + '/stats'))).then(
    (results) => {
      results.forEach((res, idx) => {
        const c = list[idx];
        if (!c || res.status !== 'fulfilled' || !res.value) return;
        lastContainerData[c.id] = lastContainerData[c.id] || {};
        lastContainerData[c.id].stats = res.value;
        if (res.value.state) {
          const prev = lastContainerData[c.id].liveState;
          lastContainerData[c.id].liveState = res.value.state;
          if (cacheItemStateNeedsSync(c.id, res.value.state, prev)) renderContainersList();
        }
        const row = Array.from(el.querySelectorAll('.container-row')).find((r) => r.dataset.id === c.id);
        if (row) {
          const statsEl = row.querySelector('.stats');
          if (statsEl) statsEl.textContent = buildStatsLine(lastContainerData[c.id]);
        }
      });
      list.forEach((c) => scheduleDiskPoll(c.id));
    }
  );
}

const CONTAINER_ACTION_ICONS = {
  details:
    '<svg class="btn-icon-square__svg btn-icon-square__svg--details" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10.5 5.5h3v3h-3v-3zm0 5.5h3v8h-3v-8z"/></svg>',
  start:
    '<svg class="btn-icon-square__svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  stop:
    '<svg class="btn-icon-square__svg btn-icon-square__svg--stop" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>',
  restart:
    '<svg class="btn-icon-square__svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>',
  delete:
    '<svg class="btn-icon-square__svg btn-icon-square__svg--delete" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
};

const CONTAINER_ACTION_LABEL_KEYS = {
  details: 'btn_container_details',
  start: 'btn_start',
  stop: 'btn_stop',
  restart: 'btn_restart',
  delete: 'btn_delete',
};

const CONTAINER_ACTION_CLASSES = {
  details: 'btn-container-details',
  stop: 'btn-stop',
  start: 'btn-start',
  restart: 'btn-restart',
  delete: 'btn-danger btn-delete-container',
};

function containerActionBtn(action, id, name) {
  const label = escapeHtml(t(CONTAINER_ACTION_LABEL_KEYS[action]));
  const extra = CONTAINER_ACTION_CLASSES[action] || '';
  return (
    '<button type="button" class="btn btn-outline btn-icon-square ' +
    extra +
    '" data-id="' +
    escapeHtml(id) +
    '" data-name="' +
    escapeHtml(name) +
    '" aria-label="' +
    label +
    '" title="' +
    label +
    '">' +
    (CONTAINER_ACTION_ICONS[action] || '') +
    '</button>'
  );
}

function isContainerRunning(state) {
  return state === 'running';
}

function cacheItemStateNeedsSync(id, nextState, prevLive) {
  const cacheItem = containersCache.find((x) => x.id === id);
  if (cacheItem && cacheItem.state !== nextState) {
    cacheItem.state = nextState;
    return true;
  }
  return prevLive !== nextState;
}

function buildStatsLine(data) {
  if (!data) return '';
  let s = '';
  if (data.stats) {
    if (data.stats.memory_usage_mb != null) {
      s = `${data.stats.memory_usage_mb} / ${data.stats.memory_limit_mb || '?'} MB`;
    }
    if (data.stats.state === 'running' && data.stats.cpu_percent != null) {
      s += (s ? ' · ' : '') + `${data.stats.cpu_percent}% ${t('stats_cpu')}`;
    }
  }
  if (data.disk && data.disk.total_mb != null) {
    const mb = data.disk.total_mb;
    s += (s ? ' · ' : '') + t('stats_disk') + ': ' + (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB');
  }
  return s;
}

function renderContainerRow(c, cachedLine = '') {
  const effectiveState = getEffectiveContainerState(c);
  const stateClass = stateBadgeClass(effectiveState);
  const pending = isContainerPending(effectiveState);
  const running = isContainerRunning(effectiveState);
  const actions = [
    containerActionBtn('details', c.id, c.name),
    pending ? '' : running ? containerActionBtn('stop', c.id, c.name) : '',
    pending ? '' : running ? containerActionBtn('restart', c.id, c.name) : '',
    pending ? '' : running ? '' : containerActionBtn('start', c.id, c.name),
    containerActionBtn('delete', c.id, c.name),
  ].join('');
  const rowClass = pending ? ' container-row--pending' : '';
  return `
    <div class="container-row${rowClass}" data-id="${escapeHtml(c.id)}">
      <span class="name">${escapeHtml(c.name)}</span>
      <span class="image">${escapeHtml(c.image)}</span>
      <span class="state-badge ${stateClass}">${escapeHtml(formatContainerStateLabel(effectiveState))}</span>
      <span class="stats">${escapeHtml(cachedLine)}</span>
      <div class="actions">${actions}</div>
    </div>
  `;
}

async function loadContainers(options = {}) {
  try {
    const data = await api('/api/containers' + buildContainersQueryString());
    containersCache = data.containers || [];
    containersListTotal = data.total != null ? data.total : containersCache.length;
    containersListOffset = data.offset != null ? data.offset : containersListOffset;
    containerDeployLimit =
      data.container_limit != null
        ? data.container_limit
        : data.limit != null && data.total_pages == null
          ? data.limit
          : 0;
    updateContainersUsage(containersListTotal, containerDeployLimit);
    syncContainersSearchVisibility();
    renderContainersList();
    renderContainersPagerFromBody(data);
    if (containersCache.length) {
      refreshContainerLiveStates(containersCache);
      if (!options.skipStats) refreshContainerStats(containersCache);
    }
  } catch (e) {
    containersCache = [];
    containersListTotal = 0;
    syncContainersSearchVisibility();
    document.getElementById('containers-list').innerHTML =
      '<p class="error">' + escapeHtml(t('err_load_containers')) + '</p>';
    renderContainersPagerFromBody({ total: 0, total_pages: 1, page: 1, offset: 0, limit: CONTAINERS_PAGE_SIZE });
  }
}

function hideAllModals() {
  hideModal();
  closeDeleteContainerModal();
  closeContainerInfoModal();
}
document.getElementById('modal-close').addEventListener('click', hideModal);
document.getElementById('modal-cancel').addEventListener('click', hideModal);

document.getElementById('delete-modal-close').addEventListener('click', closeDeleteContainerModal);
document.getElementById('delete-modal-cancel').addEventListener('click', closeDeleteContainerModal);
document.getElementById('delete-modal-container-only').addEventListener('click', () => confirmAndDeleteContainer(false));
document.getElementById('delete-modal-with-data').addEventListener('click', () => confirmAndDeleteContainer(true));
document.getElementById('container-info-modal-close').addEventListener('click', closeContainerInfoModal);
document.getElementById('container-info-cancel').addEventListener('click', closeContainerInfoModal);
document.getElementById('container-info-refresh').addEventListener('click', () => loadContainerInfoData());
document.getElementById('container-info-tab-logs').addEventListener('click', () => setContainerInfoTab('logs'));
document.getElementById('container-info-tab-inspect').addEventListener('click', () => setContainerInfoTab('inspect'));
(function () {
  let mousedownOnBackdrop = false;
  const infoOverlay = document.getElementById('container-info-modal-overlay');
  infoOverlay.addEventListener('mousedown', (e) => {
    mousedownOnBackdrop = e.target.id === 'container-info-modal-overlay';
  });
  infoOverlay.addEventListener('click', (e) => {
    if (e.target.id === 'container-info-modal-overlay' && mousedownOnBackdrop) closeContainerInfoModal();
    mousedownOnBackdrop = false;
  });
})();
(function () {
  let mousedownOnBackdrop = false;
  const delOverlay = document.getElementById('delete-modal-overlay');
  delOverlay.addEventListener('mousedown', (e) => {
    mousedownOnBackdrop = e.target.id === 'delete-modal-overlay';
  });
  delOverlay.addEventListener('click', (e) => {
    if (e.target.id === 'delete-modal-overlay' && mousedownOnBackdrop) closeDeleteContainerModal();
    mousedownOnBackdrop = false;
  });
})();
(function () {
  let deployMousedownOnOverlay = false;
  const overlay = document.getElementById('modal-overlay');
  overlay.addEventListener('mousedown', (e) => {
    deployMousedownOnOverlay = e.target.id === 'modal-overlay';
  });
  overlay.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay' && deployMousedownOnOverlay) hideModal();
    deployMousedownOnOverlay = false;
  });
})();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideAllModals();
});

document.getElementById('deploy-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('deploy-error');
  errEl.hidden = true;
  const templateId = form.dataset && form.dataset.templateId ? form.dataset.templateId : '';
  const containerName = ((form._containerNameInput && form._containerNameInput.value) || '').trim();
  const params = {};
  if (form._valueInputs && Object.keys(form._valueInputs)) {
    Object.keys(form._valueInputs).forEach((key) => {
      params[key] = (form._valueInputs[key].value || '').trim();
    });
  }
  if (!templateId) {
    errEl.textContent = t('err_no_template');
    errEl.hidden = false;
    return;
  }
  if (!containerName) {
    errEl.textContent = t('err_no_container_name');
    errEl.hidden = false;
    return;
  }
  const btn = form.querySelector('button[type="submit"]');
  const cancelBtn = document.getElementById('modal-cancel');
  const statusEl = document.getElementById('deploy-status');
  btn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  setModalStatus(statusEl, t('status_deploying'));
  try {
    const payload = { templateId, containerName, params };
    const result = await api('/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let container;
    const opId = result.operation?.operationId;
    if (opId) {
      const op = await waitForOperation(opId);
      container = op.result && op.result.container;
    } else {
      container = result.container;
    }
    hideModal();
    loadContainers();
    const name = container && (container.name || container.id);
    alert(tf('alert_container_started', { name: name || '—' }));
  } catch (err) {
    setModalStatus(statusEl, '');
    errEl.textContent = err.message || t('err_deploy');
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }
});

const containersSearchInput = document.getElementById('containers-search');
if (containersSearchInput) {
  containersSearchInput.addEventListener('input', () => {
    containersListOffset = 0;
    clearTimeout(containersSearchTimer);
    containersSearchTimer = setTimeout(() => loadContainers(), 300);
  });
}
bindContainersPager();

window.addEventListener('deployer-lang-changed', () => {
  if (window.deployerVault) window.deployerVault.load();
  if (window.deployerMcpKeys) window.deployerMcpKeys.load();
  loadTemplates();
  loadContainers();
  if (window.deployerI18n) window.deployerI18n.apply();
  renderContainersList();
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
  hideModal();
  if (window.deployerVault) await window.deployerVault.load();
  if (window.deployerMcpKeys) await window.deployerMcpKeys.load();
  await loadTemplates();
  await loadContainers();
  setInterval(() => {
    loadContainers({ skipStats: true });
  }, 15000);
  setInterval(() => {
    if (containersCache.length) refreshContainerLiveStates(containersCache);
  }, 4000);
})();
