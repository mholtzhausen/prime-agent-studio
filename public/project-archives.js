import { t as tr, bindText, translateKnown } from './i18n.js';

// First-version .pastudio project archives (transferable file; operate from Studio opened on that PC, not remote browser).
// Contract v1 confirmed with portable-backend:
// - GET  /api/project-archives/export?cwd=<enc abs path> -> .pastudio ZIP binary
// - POST /api/project-archives/preview?cwd=<destCwd> raw octet-stream -> { previewToken, ... }
// - POST /api/project-archives/import?cwd=<destCwd>&token=<previewToken> same bytes again
// Pending finalization (explicit, never silent success): import may answer 409
// code pastudio_import_pending (recoverable). Safe retry = re-POST SAME bytes to
// preview (token single-use, never re-POST import). Pending preview: 200 with
// pending:true, previewToken:null, duplicate:false (pending wins over duplicate).
// No new session marks for pending; the server model gate blocks those starts.
// Raw octet-stream only v1 (no multipart). Full project, no subagent/model selection.
// Import is additive, never overwrites, never selects the historical source model:
// imported sessions keep a persisted needs-model mark and the banner below asks for
// an explicit available-model choice through the existing model dialog (server gate).
export const ARCHIVE_MAX_BYTES = 128 * 1024 * 1024;
export const ARCHIVE_ENDPOINTS = {
  export: '/api/project-archives/export',
  preview: '/api/project-archives/preview',
  import: '/api/project-archives/import',
};
const COUNT_KEYS = [
  ['sessions', 'archives.count_sessions'],
  ['childSessions', 'archives.count_children'],
  ['messages', 'archives.count_messages'],
  ['roadmapPlans', 'archives.count_plans'],
  ['roadmapSteps', 'archives.count_steps'],
  ['backlogItems', 'archives.count_backlog_items'],
  ['backlogNotes', 'archives.count_backlog_notes'],
  ['journalEntries', 'archives.count_journal'],
  ['milestones', 'archives.count_milestones'],
];
// Frozen backend contract v1: imported sessions carry pastudioImported,
// pastudioNeedsModel (true until one explicit-model run consumes it to false),
// pastudioArchiveId and pastudioImportedAt in overview/history summaries.
const isFlagged = (summary) =>
  !!summary && summary.pastudioImported === true && summary.pastudioNeedsModel === true;

async function readBodyJson(response) {
  try {
    const data = await response.json();
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {}
  return {};
}

function bodyMessage(data) {
  for (const key of ['error', 'message']) {
    if (typeof data?.[key] === 'string' && data[key].trim()) return data[key];
  }
  return '';
}

const isPendingBody = (data) =>
  !!data && (data.code === 'pastudio_import_pending' || data.pending === true);

function filenameFromDisposition(header, fallback) {
  if (typeof header === 'string') {
    const match = header.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
    const name = (match?.[1] || '').trim().replace(/^"|"$/g, '');
    if (name) return name;
  }
  return fallback;
}

export function createProjectArchives({ toast, getContext, refreshOverview, openModelPicker }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('project-archive-dialog');
  const acknowledged = new Set();
  const freshIds = new Set();
  let mode = null;
  let destCwd = null;
  let destName = '';
  let file = null;
  let preview = null;
  let busy = false;
  let pendingImport = false;
  let autoRetried = false;

  const context = () => getContext?.() || {};

  function showError(message) {
    if (!message) {
      $('project-archive-error').hidden = true;
      return;
    }
    bindText($('project-archive-error'), () =>
      typeof message === 'string' ? message : translateKnown(message),
    );
    $('project-archive-error').hidden = false;
  }

  // Pending mode: a 409 pastudio_import_pending was received, or the preview
  // reports pending:true (previewToken null). Confirm becomes a safe retry that
  // re-POSTs the same bytes to preview — never re-POSTs the consumed token.
  const pendingMode = () => mode === 'import' && (pendingImport || preview?.pending === true);
  const canConfirm = () =>
    mode !== 'import' || !!preview?.previewToken || (pendingMode() && !!file);

  function setBusy(value) {
    busy = value;
    $('project-archive-confirm').disabled =
      value || context().remote === true || !canConfirm();
    $('project-archive-file').disabled = value || context().remote === true;
  }

  function renderCounts(counts) {
    const list = $('project-archive-counts');
    list.replaceChildren();
    for (const [field, label] of COUNT_KEYS) {
      const value = counts?.[field];
      if (!Number.isFinite(value)) continue;
      const row = document.createElement('div');
      const term = document.createElement('dt');
      term.dataset.i18n = label;
      term.textContent = tr(label);
      const def = document.createElement('dd');
      def.textContent = String(value);
      row.append(term, def);
      list.append(row);
    }
  }

  function renderDialog() {
    const remote = context().remote === true;
    $('project-archive-remote').hidden = !remote;
    if (mode === 'export') {
      bindText($('project-archive-title'), () => tr('archives.export_title'));
      bindText($('project-archive-description'), () => tr('archives.export_desc'));
      bindText($('project-archive-project'), () => tr('archives.destination', { name: destName }));
      $('project-archive-file-wrap').hidden = true;
      $('project-archive-preview').hidden = true;
      $('project-archive-destination-note').hidden = true;
      bindText($('project-archive-confirm-label'), () => tr('archives.export_action'));
    } else {
      bindText($('project-archive-title'), () => tr('archives.import_title'));
      bindText($('project-archive-description'), () => tr('archives.import_desc'));
      bindText($('project-archive-project'), () => tr('archives.destination', { name: destName }));
      $('project-archive-file-wrap').hidden = false;
      $('project-archive-destination-note').hidden = false;
      bindText($('project-archive-destination-note'), () => tr('archives.import_destination_note'));
      const hasPreview = !!preview;
      $('project-archive-preview').hidden = !hasPreview;
      if (hasPreview) {
        bindText($('project-archive-source'), () =>
          tr('archives.preview_source', {
            name: preview.sourceProject?.name || preview.sourceProject?.cwd || '',
          }),
        );
        renderCounts(preview.counts);
        $('project-archive-duplicate').hidden = !preview.duplicate;
      }
      $('project-archive-pending').hidden = !pendingMode();
      bindText($('project-archive-confirm-label'), () =>
        tr(pendingMode() ? 'archives.retry_preview' : 'archives.import_confirm'),
      );
    }
    showError();
    setBusy(busy);
  }

  function reset(nextMode, project) {
    mode = nextMode;
    destCwd = project?.cwd || null;
    destName = project?.name || project?.cwd || '';
    file = null;
    preview = null;
    busy = false;
    pendingImport = false;
    autoRetried = false;
    $('project-archive-form').reset();
    $('project-archive-pending').hidden = true;
    renderDialog();
  }

  function openExport(project) {
    if (!project?.cwd) return;
    reset('export', project);
    dialog.showModal();
  }

  function openImport(project) {
    if (!project?.cwd) return;
    reset('import', project);
    dialog.showModal();
    if (context().remote !== true) $('project-archive-file').focus();
  }

  async function runExport() {
    setBusy(true);
    showError();
    try {
      const response = await fetch(
        `${ARCHIVE_ENDPOINTS.export}?cwd=${encodeURIComponent(destCwd)}`,
      );
      if (!response.ok) {
        const detail = bodyMessage(await readBodyJson(response));
        throw new Error(detail || tr('archives.export_failed'));
      }
      const blob = await response.blob();
      const fallback = `${destName || 'projet'}.pastudio`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filenameFromDisposition(response.headers.get('Content-Disposition'), fallback);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      dialog.close();
      toast(() => tr('archives.export_done'));
    } catch (error) {
      showError(error?.message ? translateKnown(error.message) : tr('archives.export_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(next) {
    if (!next || next.size > ARCHIVE_MAX_BYTES) {
      file = null;
      preview = null;
      showError(tr('archives.file_too_big'));
      renderDialog();
      return;
    }
    file = next;
    preview = null;
    setBusy(true);
    showError();
    try {
      const response = await fetch(
        `${ARCHIVE_ENDPOINTS.preview}?cwd=${encodeURIComponent(destCwd)}`,
        { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } },
      );
      if (!response.ok) {
        const detail = bodyMessage(await readBodyJson(response));
        if (response.status === 413) throw new Error(tr('archives.file_too_big'));
        if (response.status === 422) throw new Error(detail || tr('archives.empty_archive'));
        if (response.status === 400) throw new Error(detail || tr('archives.invalid_file'));
        throw new Error(detail || tr('archives.import_failed'));
      }
      preview = await response.json();
      // Recovery cleared while retrying: a usable token (or a completed
      // duplicate) ends pending mode; a pending preview keeps it.
      if (preview?.previewToken || preview?.duplicate) pendingImport = false;
      renderDialog();
    } catch (error) {
      file = null;
      preview = null;
      pendingImport = false;
      renderDialog();
      showError(error?.message ? translateKnown(error.message) : tr('archives.import_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!file || !preview?.previewToken) return;
    setBusy(true);
    showError();
    let failedStatus = 0;
    try {
      const response = await fetch(
        `${ARCHIVE_ENDPOINTS.import}?cwd=${encodeURIComponent(destCwd)}&token=${encodeURIComponent(preview.previewToken)}`,
        { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } },
      );
      if (!response.ok) {
        failedStatus = response.status;
        const data = await readBodyJson(response);
        if (failedStatus === 409 && isPendingBody(data)) {
          // Explicit pending finalization: never a silent success, never a
          // vague failure. Keep the dialog open with the same bytes, toast the
          // pending state distinctly, then auto-run one safe preview retry
          // (recovery replays server-side, idempotent, never duplicates).
          // The single-use token is consumed: never re-POST import directly.
          pendingImport = true;
          preview = null;
          toast(() => tr('archives.import_pending'));
          renderDialog();
          if (!autoRetried && file) {
            autoRetried = true;
            await runPreview(file);
          }
          return;
        }
        const detail = bodyMessage(data);
        throw new Error(detail || tr('archives.import_failed'));
      }
      const result = await response.json();
      for (const id of Object.values(result?.idMap || {})) {
        if (typeof id === 'string' && id) freshIds.add(id);
      }
      dialog.close();
      toast(() => tr('archives.import_done'));
      await refreshOverview?.();
      update();
    } catch (error) {
      if (failedStatus === 409 || failedStatus === 404) {
        file = null;
        preview = null;
        renderDialog();
      }
      showError(error?.message ? translateKnown(error.message) : tr('archives.import_failed'));
    } finally {
      setBusy(false);
    }
  }

  function flaggedIds() {
    const ids = new Set(freshIds);
    for (const p of context().projects || []) {
      for (const s of p.sessions || []) {
        if (s?.id && isFlagged(s)) ids.add(s.id);
      }
    }
    return ids;
  }

  function updateBadges() {
    const ids = flaggedIds();
    for (const row of document.querySelectorAll('.session-row[data-session-id]')) {
      const id = row.dataset.sessionId;
      const select = row.querySelector('.session-select');
      if (!select) continue;
      let badge = select.querySelector('.archive-imported-badge');
      if (ids.has(id) && !acknowledged.has(id)) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'archive-imported-badge';
          select.append(badge);
        }
        bindText(badge, () => tr('archives.imported_badge'));
      } else badge?.remove();
    }
  }

  function update() {
    const { sessionId, session } = context();
    const seen = !sessionId || acknowledged.has(sessionId);
    const flagged =
      !seen && (freshIds.has(sessionId) || isFlagged(session));
    const banner = $('imported-session-banner');
    if (!banner) return;
    banner.hidden = !flagged;
    if (flagged && sessionId) {
      bindText($('imported-session-banner-text'), () => tr('archives.imported_needs_model'));
      bindText($('imported-session-choose-model'), () => tr('archives.choose_model'));
    }
    updateBadges();
  }

  $('project-archive-file').addEventListener('change', (event) => {
    const next = event.target.files?.[0] || null;
    if (next) {
      autoRetried = false;
      pendingImport = false;
      void runPreview(next);
    }
  });
  $('project-archive-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || context().remote === true) return;
    if (mode === 'export') void runExport();
    else if (preview?.previewToken) void runImport();
    // Pending safe retry (or a token-less preview): re-POST the same bytes to
    // preview. Never re-POSTs the consumed single-use import token.
    else if (file) void runPreview(file);
  });
  dialog.addEventListener('close', () => {
    file = null;
    preview = null;
    busy = false;
    pendingImport = false;
    autoRetried = false;
    $('project-archive-form').reset();
    $('project-archive-pending').hidden = true;
    showError();
  });
  $('imported-session-choose-model').addEventListener('click', () => {
    const { sessionId } = context();
    if (sessionId) acknowledged.add(sessionId);
    update();
    openModelPicker?.();
  });

  return { openExport, openImport, update };
}
