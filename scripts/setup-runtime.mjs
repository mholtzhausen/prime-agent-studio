#!/usr/bin/env node
/**
 * Formerly prepared Studio's private uv Python kernel.
 * Prime Agent now bootstraps its own kernel on first use — nothing to do here.
 */
console.log(
  'setup:runtime is no longer required. Prime Agent bootstraps its Python kernel automatically.\n' +
    'Install and configure Prime Agent only (Preferences → System, or PRIME_AGENT_CLI).',
);
