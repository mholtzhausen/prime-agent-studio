import { t as tr } from './i18n.js';

// Shared safe action for opening the desktop application component settings.
// Contract (coordinated with native sibling): invoke('desktop_components_open')
// with no arguments. The native side only opens the settings window; it never
// auto-installs. Installation still needs an explicit user click in app settings.
export function isDesktopComponentsAvailable() {
  return (
    window.__PRIME_STUDIO_DESKTOP__ === true &&
    typeof window.__TAURI__?.core?.invoke === 'function'
  );
}

let componentsOpening = false;

export async function openDesktopComponents({ toast } = {}) {
  // Desktop-only native functionality. Browser/mobile fallback stays
  // explanatory: toast the existing components note, never a broken invoke.
  if (!isDesktopComponentsAvailable()) {
    if (typeof toast === 'function') toast(tr('settings.components_note'));
    return false;
  }
  // Single-flight: rapid clicks share one native open, never concurrent.
  if (componentsOpening) return false;
  componentsOpening = true;
  try {
    await window.__TAURI__.core.invoke('desktop_components_open');
    return true;
  } catch {
    if (typeof toast === 'function') toast(tr('settings.components_note'));
    return false;
  } finally {
    componentsOpening = false;
  }
}
