import { t as tr, bindText, translateKnown } from './i18n.js';

const TOOLS = [
  { id: 'engine', labelKey: 'components.engine', pathKey: 'engine' },
  { id: 'uv', labelKey: 'components.uv', pathKey: 'uv' },
  { id: 'python', labelKey: 'components.python', pathKey: 'python' },
];

function statusOf(components, id) {
  if (id === 'engine') return components?.engine;
  if (id === 'uv') return components?.uv;
  if (id === 'python') return components?.python;
  return null;
}

function pathOf(result, id) {
  const info = statusOf(result?.components, id);
  if (info?.path) return info.path;
  if (id === 'engine' && info?.packageDir) return info.packageDir;
  return result?.selection?.[id] || '';
}

function iconState(info) {
  if (!info || info.status === 'missing' || info.status === 'pending') return 'error';
  if (info.status === 'error') return 'error';
  if (info.status === 'ready' && info.warning) return 'warn';
  if (info.status === 'ready' || info.status === 'not_required') return 'ready';
  return 'error';
}

/**
 * Shared binary path editor for Settings → System and the desktop setup page.
 * @param {{ root: HTMLElement, api: Function, remote?: boolean, toast?: Function, onChange?: Function }} options
 */
export function createComponentsSettings({ root, api, remote = false, toast = () => {}, onChange = () => {} }) {
  if (!root) return { refresh: async () => {}, destroy() {} };
  root.innerHTML = '';
  root.classList.add('components-settings');

  const note = document.createElement('p');
  note.className = 'settings-footnote';
  bindText(note, () => tr('components.note'));
  root.appendChild(note);

  if (remote) {
    const locked = document.createElement('p');
    locked.className = 'settings-footnote';
    bindText(locked, () => tr('components.remote_only'));
    root.appendChild(locked);
    return { refresh: async () => {}, destroy() {} };
  }

  const fields = {};
  for (const tool of TOOLS) {
    const row = document.createElement('div');
    row.className = 'components-row';
    row.dataset.component = tool.id;

    const label = document.createElement('label');
    label.htmlFor = `components-path-${tool.id}`;
    bindText(label, () => tr(tool.labelKey));

    const status = document.createElement('span');
    status.className = 'components-status-icon';
    status.dataset.state = 'error';
    status.setAttribute('aria-hidden', 'true');

    const head = document.createElement('div');
    head.className = 'components-row-head';
    head.append(label, status);

    const input = document.createElement('input');
    input.id = `components-path-${tool.id}`;
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = tr('components.path_placeholder');

    const browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'secondary-button';
    bindText(browse, () => tr('components.browse'));

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'secondary-button';
    bindText(save, () => tr('components.apply'));

    const actions = document.createElement('div');
    actions.className = 'components-row-actions';
    actions.append(browse, save);

    const error = document.createElement('p');
    error.className = 'form-error components-row-error';
    error.hidden = true;
    error.setAttribute('role', 'status');

    const warn = document.createElement('p');
    warn.className = 'settings-footnote components-row-warn';
    warn.hidden = true;

    row.append(head, input, actions, error, warn);
    root.appendChild(row);
    fields[tool.id] = { input, status, error, warn, browse, save };
  }

  const chips = document.createElement('ul');
  chips.className = 'components-chips';
  root.appendChild(chips);

  const toolbar = document.createElement('div');
  toolbar.className = 'components-toolbar';
  const discover = document.createElement('button');
  discover.type = 'button';
  discover.className = 'secondary-button';
  bindText(discover, () => tr('components.discover'));
  const recheck = document.createElement('button');
  recheck.type = 'button';
  recheck.className = 'secondary-button';
  bindText(recheck, () => tr('components.recheck'));
  const install = document.createElement('button');
  install.type = 'button';
  install.className = 'primary-button';
  bindText(install, () => tr('components.install'));
  toolbar.append(discover, recheck, install);
  root.appendChild(toolbar);

  const live = document.createElement('p');
  live.className = 'settings-footnote';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);

  let busy = false;
  let latest = null;

  function render(result) {
    latest = result;
    if (result?.failure) {
      bindText(live, () => translateKnown(result.failure.error || 'preparation_failed'));
      return;
    }
    for (const tool of TOOLS) {
      const info = statusOf(result?.components, tool.id);
      const field = fields[tool.id];
      if (document.activeElement !== field.input) field.input.value = pathOf(result, tool.id);
      field.status.dataset.state = iconState(info);
      field.status.title =
        info?.status === 'ready'
          ? tr('components.state_ready')
          : info?.status === 'not_required'
            ? tr('components.state_not_required')
            : tr('components.state_error');
      if (info?.error) {
        field.error.hidden = false;
        bindText(field.error, () => translateKnown(info.error));
      } else {
        field.error.hidden = true;
        field.error.textContent = '';
      }
      if (info?.warning === 'engine_version_mismatch') {
        field.warn.hidden = false;
        bindText(field.warn, () => tr('components.engine_version_mismatch'));
      } else if (info?.warning === 'uv_version_mismatch') {
        field.warn.hidden = false;
        bindText(field.warn, () => tr('components.uv_version_mismatch'));
      } else {
        field.warn.hidden = true;
        field.warn.textContent = '';
      }
    }
    chips.innerHTML = '';
    for (const key of ['node', 'bash']) {
      const info = result?.components?.[key];
      if (!info) continue;
      const li = document.createElement('li');
      li.dataset.state = iconState(info);
      li.textContent = `${key === 'node' ? tr('components.node') : tr('components.bash')}${info.version ? ` ${info.version}` : ''}`;
      chips.appendChild(li);
    }
    install.hidden = Boolean(result?.ready);
    bindText(live, () =>
      result?.ready ? tr('components.ready') : tr('components.incomplete'),
    );
    onChange(result);
  }

  async function run(action, body) {
    if (busy) return;
    busy = true;
    root.dataset.busy = '1';
    try {
      let result;
      if (action === 'get') result = await api('/api/system/components');
      else if (action === 'discover')
        result = await api('/api/system/components/discover', { method: 'POST', body: {} });
      else if (action === 'recheck')
        result = await api('/api/system/components/recheck', { method: 'POST', body: {} });
      else if (action === 'install')
        result = await api('/api/system/components/install', { method: 'POST', body: {} });
      else if (action === 'put')
        result = await api('/api/system/components', { method: 'PUT', body });
      else if (action === 'pick')
        result = await api('/api/system/components/pick', { method: 'POST', body });
      else throw new Error('action_invalid');
      if (result?.cancelled) return latest;
      render(result);
      return result;
    } catch (error) {
      const message = error?.message || String(error);
      const stale =
        /404|route introuvable|not found/i.test(message) &&
        (action === 'get' || action === 'discover' || action === 'recheck');
      bindText(live, () =>
        stale ? tr('components.server_stale') : translateKnown(message),
      );
      toast(stale ? tr('components.server_stale') : message, 'error');
      throw error;
    } finally {
      busy = false;
      delete root.dataset.busy;
    }
  }

  for (const tool of TOOLS) {
    const field = fields[tool.id];
    field.browse.onclick = () => void run('pick', { component: tool.id });
    field.save.onclick = () =>
      void run('put', { [tool.pathKey]: field.input.value.trim() || null });
    field.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        field.save.click();
      }
    });
  }
  discover.onclick = () => void run('discover');
  recheck.onclick = () => void run('recheck');
  install.onclick = () => void run('install');

  return {
    refresh: () => run('get'),
    destroy() {
      root.innerHTML = '';
    },
  };
}
