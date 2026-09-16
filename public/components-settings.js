import { t as tr, bindText, translateKnown } from './i18n.js';

/** User-editable path: Prime Agent only. Python kernel is owned by Prime Agent. */
const TOOLS = [{ id: 'engine', labelKey: 'components.engine', pathKey: 'engine' }];

function statusOf(components, id) {
  if (id === 'engine') return components?.engine;
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
  if (info.status === 'ready' || info.status === 'not_required') return 'ready';
  return 'error';
}

/**
 * Binary path editor for Preferences → System (desktop and browser).
 * Soft-fills empty slots on refresh; auto-applies on field change; Reset rediscovers one tool.
 */
export function createComponentsSettings({
  root,
  api,
  remote = false,
  toast = () => {},
  onChange = () => {},
}) {
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
  const timers = {};
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

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'secondary-button components-reset';
    reset.title = tr('components.reset');
    reset.setAttribute('aria-label', tr('components.reset'));
    reset.textContent = '↻';

    const actions = document.createElement('div');
    actions.className = 'components-row-actions';
    actions.append(browse, reset);

    const error = document.createElement('p');
    error.className = 'form-error components-row-error';
    error.hidden = true;
    error.setAttribute('role', 'status');

    row.append(head, input, actions, error);
    root.appendChild(row);
    fields[tool.id] = { input, status, error, browse, reset };
  }

  const chips = document.createElement('ul');
  chips.className = 'components-chips';
  root.appendChild(chips);

  const live = document.createElement('p');
  live.className = 'settings-footnote';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);

  let busy = false;
  let latest = null;
  let generation = 0;

  function render(result) {
    latest = result;
    if (result?.failure) {
      bindText(live, () => {
        const base = translateKnown(result.failure.error || 'validation_failed');
        return result.failure.detail ? `${base} (${result.failure.detail})` : base;
      });
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
        bindText(field.error, () => {
          const base = translateKnown(info.error);
          return info.detail ? `${base} (${info.detail})` : base;
        });
      } else {
        field.error.hidden = true;
        field.error.textContent = '';
      }
    }
    chips.innerHTML = '';
    for (const key of ['node', 'bash']) {
      const info = result?.components?.[key];
      if (!info) continue;
      const li = document.createElement('li');
      li.dataset.state = iconState(info);
      li.textContent = `${key === 'node' ? tr('components.node') : tr('components.bash')}${
        info.version ? ` ${info.version}` : ''
      }`;
      chips.appendChild(li);
    }
    bindText(live, () => (result?.ready ? tr('components.ready') : tr('components.incomplete')));
    onChange(result);
  }

  async function run(action, body) {
    const gen = ++generation;
    busy = true;
    root.dataset.busy = '1';
    try {
      let result;
      if (action === 'get') result = await api('/api/system/components');
      else if (action === 'put')
        result = await api('/api/system/components', { method: 'PUT', body });
      else if (action === 'pick')
        result = await api('/api/system/components/pick', { method: 'POST', body });
      else if (action === 'reset')
        result = await api('/api/system/components/reset', { method: 'POST', body });
      else throw new Error('action_invalid');
      if (gen !== generation) return latest;
      if (result?.cancelled) return latest;
      render(result);
      return result;
    } catch (error) {
      if (gen !== generation) return latest;
      const message = error?.message || String(error);
      const stale = /404|route introuvable|not found/i.test(message);
      bindText(live, () => (stale ? tr('components.server_stale') : translateKnown(message)));
      toast(stale ? tr('components.server_stale') : message, 'error');
      throw error;
    } finally {
      if (gen === generation) {
        busy = false;
        delete root.dataset.busy;
      }
    }
  }

  function schedulePut(tool) {
    clearTimeout(timers[tool.id]);
    timers[tool.id] = setTimeout(() => {
      const value = fields[tool.id].input.value.trim();
      void run('put', { [tool.pathKey]: value || null });
    }, 300);
  }

  for (const tool of TOOLS) {
    const field = fields[tool.id];
    field.browse.onclick = () => {
      clearTimeout(timers[tool.id]);
      void run('pick', { component: tool.id });
    };
    field.reset.onclick = () => {
      clearTimeout(timers[tool.id]);
      void run('reset', { component: tool.id });
    };
    field.input.addEventListener('input', () => schedulePut(tool));
    field.input.addEventListener('change', () => {
      clearTimeout(timers[tool.id]);
      const value = field.input.value.trim();
      void run('put', { [tool.pathKey]: value || null });
    });
  }

  return {
    refresh: () => run('get'),
    destroy() {
      generation++;
      for (const id of Object.keys(timers)) clearTimeout(timers[id]);
      root.innerHTML = '';
    },
  };
}
