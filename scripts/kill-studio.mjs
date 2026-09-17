#!/usr/bin/env node
/**
 * Force-stop leftover Studio servers and desktop clients.
 * Does not stop Prime Agent’s own daemon/supervisor.
 */
import { readdir, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  APP_ROOT,
  parsePort,
  pathsFor,
  probeHealth,
  sleep,
  isDirectInvocation,
} from './launcher-common.mjs';
import { stopServer } from './stop-server.mjs';

const DESKTOP_DATA_ROOT = join(homedir(), '.local/share/com.primeagent.studio.nix');
const CLIENT_NAME_RE = /prime-agent-studio-nix(?:\.exe)?$/i;
const SERVER_CMD_RE = /(?:^|[\\/])server\.mjs(?:\s|$)/;
const STUDIO_PATH_RE = /prime-agent-studio|\/studio\/server\.mjs|\\studio\\server\.mjs/i;

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function readProcFile(pid, name) {
  try {
    return await readFile(`/proc/${pid}/${name}`);
  } catch {
    return null;
  }
}

async function listLinuxPids() {
  const entries = await readdir('/proc', { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid);
}

function decodeCmdline(buffer) {
  if (!buffer?.length) return '';
  return buffer.toString('utf8').replace(/\0+$/g, '').replace(/\0/g, ' ');
}

function decodeEnviron(buffer) {
  if (!buffer?.length) return '';
  return buffer.toString('utf8');
}

async function classifyPid(pid) {
  const cmdline = decodeCmdline(await readProcFile(pid, 'cmdline'));
  if (!cmdline) return null;
  const exe = cmdline.split(' ')[0] || '';
  if (CLIENT_NAME_RE.test(exe) || CLIENT_NAME_RE.test(cmdline)) return 'client';
  const environ = decodeEnviron(await readProcFile(pid, 'environ'));
  const studioEnv =
    environ.includes('PRIME_AGENT_GUI_INSTANCE=') ||
    environ.includes('PRIME_AGENT_GUI_DATA_DIR=') ||
    environ.includes('PRIME_STUDIO_DESKTOP_DATA_ROOT=');
  if (SERVER_CMD_RE.test(cmdline) && (STUDIO_PATH_RE.test(cmdline) || studioEnv)) return 'server';
  return null;
}

async function collectStudioPids() {
  const found = { server: new Set(), client: new Set() };
  for (const pid of await listLinuxPids()) {
    const kind = await classifyPid(pid);
    if (kind) found[kind].add(pid);
  }
  return found;
}

async function signalPids(pids, signal) {
  const sent = [];
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      sent.push(pid);
    } catch {
      /* already gone or not permitted */
    }
  }
  return sent;
}

async function waitGone(pids, timeoutMs = 4000) {
  const pending = new Set(pids);
  const deadline = Date.now() + timeoutMs;
  while (pending.size && Date.now() < deadline) {
    for (const pid of [...pending]) {
      try {
        process.kill(pid, 0);
      } catch {
        pending.delete(pid);
      }
    }
    if (pending.size) await sleep(100);
  }
  return [...pending];
}

async function stopOwned(label, options) {
  try {
    const result = await stopServer(options);
    if (result.stopped) log(`Stopped managed ${label} (ownership file).`);
    else if (result.reason === 'already-stopped') log(`Managed ${label} already stopped.`);
    else if (result.reason === 'not-managed') log(`No managed ${label} ownership file.`);
    return result;
  } catch (error) {
    log(`Managed ${label} stop skipped: ${error.message}`);
    return { stopped: false, reason: 'error' };
  }
}

async function killHealthListeners(ports) {
  const killed = new Set();
  for (const port of ports) {
    const result = await probeHealth(port, { timeout: 800 });
    if (result.state !== 'ready' || result.health?.service !== 'prime-agent-gui') continue;
    const pid = result.health.pid;
    if (!Number.isSafeInteger(pid) || pid < 1 || pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGTERM');
      killed.add(pid);
      log(`Signaled Studio health listener on port ${port} (PID ${pid}).`);
    } catch {
      /* ignore */
    }
  }
  return killed;
}

async function clearStaleOwnership(dataDir) {
  const paths = pathsFor(APP_ROOT, dataDir);
  const record = await readFile(paths.ownership, 'utf8').catch(() => null);
  if (!record) return;
  try {
    const ownership = JSON.parse(record);
    if (!Number.isSafeInteger(ownership.pid) || ownership.pid < 1) {
      await unlink(paths.ownership).catch(() => {});
      return;
    }
    try {
      process.kill(ownership.pid, 0);
    } catch {
      await unlink(paths.ownership).catch(() => {});
      log(`Cleared stale ownership in ${paths.ownership}.`);
    }
  } catch {
    /* leave unreadable ownership alone */
  }
}

export async function killStudio() {
  const checkoutLocal = pathsFor(APP_ROOT).local;
  const desktopData = join(DESKTOP_DATA_ROOT, 'data');
  const ports = new Set([parsePort(process.env.PORT || '3088')]);

  for (const dataDir of [undefined, desktopData]) {
    const paths = pathsFor(APP_ROOT, dataDir);
    try {
      const ownership = JSON.parse(await readFile(paths.ownership, 'utf8'));
      if (Number.isSafeInteger(ownership.port) && ownership.port >= 1 && ownership.port <= 65535) {
        ports.add(ownership.port);
      }
    } catch {
      /* no ownership */
    }
  }

  await stopOwned('checkout server', { root: APP_ROOT, dataDir: checkoutLocal });
  await stopOwned('desktop server', { root: APP_ROOT, dataDir: desktopData });
  await killHealthListeners(ports);

  const classified = await collectStudioPids();
  const targets = new Set([...classified.server, ...classified.client]);
  if (!targets.size) {
    await clearStaleOwnership(checkoutLocal);
    await clearStaleOwnership(desktopData);
    log('No leftover Studio server or desktop client processes.');
    return { servers: [], clients: [], forced: [] };
  }

  const servers = [...classified.server];
  const clients = [...classified.client];
  if (servers.length) log(`Stopping Studio server PID(s): ${servers.join(', ')}`);
  if (clients.length) log(`Stopping Studio client PID(s): ${clients.join(', ')}`);

  await signalPids(targets, 'SIGTERM');
  let remaining = await waitGone(targets);
  let forced = [];
  if (remaining.length) {
    log(`Force-killing stubborn PID(s): ${remaining.join(', ')}`);
    forced = await signalPids(remaining, 'SIGKILL');
    remaining = await waitGone(remaining, 2000);
  }
  if (remaining.length) {
    throw new Error(`Could not stop Studio PID(s): ${remaining.join(', ')}`);
  }

  await clearStaleOwnership(checkoutLocal);
  await clearStaleOwnership(desktopData);
  log('Studio servers and desktop clients are stopped.');
  return { servers, clients, forced };
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await killStudio();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
