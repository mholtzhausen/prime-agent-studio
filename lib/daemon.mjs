import { formatMessage as tr } from '../public/i18n-core.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (child) => child?.pid && child.exitCode === null && child.signalCode === null;

async function terminateOwnedChild(child) {
  if (!alive(child)) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await sleep(500);
  if (alive(child)) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/** Read the parent pid from `/proc` (Linux). Injected in tests. */
export function readProcessParentPid(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = /^PPid:\s+(\d+)\s*$/m.exec(status);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * True when supervisorPid is the launcher or a descendant of it.
 * Matches prime-agent 0.9.5+ where `--mode daemon` forks a supervisor child.
 */
export function isOwnedSupervisorProcess(launcherPid, supervisorPid, dependencies = {}) {
  if (!Number.isInteger(launcherPid) || launcherPid <= 0) return false;
  if (!Number.isInteger(supervisorPid) || supervisorPid <= 0) return false;
  if (launcherPid === supervisorPid) return true;
  const parentOf = dependencies.readProcessParentPid || readProcessParentPid;
  const seen = new Set();
  let pid = supervisorPid;
  while (Number.isInteger(pid) && pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    const parent = parentOf(pid);
    if (parent === launcherPid) return true;
    if (!Number.isInteger(parent) || parent <= 0) return false;
    pid = parent;
  }
  return false;
}

function claimedSocketPath(hello) {
  if (typeof hello?.supervisorSocketPath === 'string' && hello.supervisorSocketPath)
    return hello.supervisorSocketPath;
  if (typeof hello?.socketPath === 'string' && hello.socketPath) return hello.socketPath;
  return null;
}

/**
 * Authenticate a daemon_hello against Studio's private socket and (when
 * available) the ChildProcess Studio spawned. Never adopt the user's default
 * daemon: a foreign supervisor cannot listen on our unguessable socket path.
 *
 * @param {object} hello
 * @param {{ socketPath: string, launcherPid?: number|null, requireProcessLink?: boolean, readProcessParentPid?: Function }} context
 */
export function verifySupervisorIdentity(hello, context = {}) {
  const { socketPath, launcherPid = null, requireProcessLink = false } = context;
  if (!Number.isInteger(hello?.supervisorPid) || hello.supervisorPid <= 0) {
    return { ok: false, reason: 'invalid_pid' };
  }
  const claimed = claimedSocketPath(hello);
  // When the engine reports its socket, it must be our private namespace.
  if (claimed !== null && claimed !== socketPath) {
    return { ok: false, reason: 'socket_mismatch' };
  }
  if (requireProcessLink) {
    if (!isOwnedSupervisorProcess(launcherPid, hello.supervisorPid, context)) {
      return { ok: false, reason: 'process_mismatch' };
    }
  }
  return { ok: true };
}

function identityMismatchError(messageKey) {
  const error = new Error(tr(messageKey));
  error.code = 'GUI_DAEMON_IDENTITY_MISMATCH';
  return error;
}

/** Each GUI runtime owns a separate supervisor, never the user's default daemon. */
export function createOwnedDaemon(options, dependencies = {}) {
  const { cli, env, cwd = process.cwd(), onDiagnostic } = options;
  if (!cli?.packageDir) throw new Error(tr('server.le_dossier_de_prime_agent_est_introuvable'));
  const spawnProcess = dependencies.spawnProcess || spawn;
  const terminateProcess = options.terminateProcess || terminateOwnedChild;
  const identityDeps = {
    readProcessParentPid: dependencies.readProcessParentPid || readProcessParentPid,
  };
  const timeout = options.startupTimeout ?? 30000;
  const closeTimeout = options.closeTimeout ?? 7000;
  const namespace = `prime-studio-${process.pid}-${randomUUID()}`;
  const socketPath = join(tmpdir(), `${namespace}.sock`);
  let Client;
  const loadClient =
    dependencies.loadClient ||
    (async () => {
      Client ||= (
        await import(pathToFileURL(join(cli.packageDir, 'dist/modes/daemon/daemon-client.js')).href)
      ).DaemonClient;
      return Client;
    });
  let child;
  let startPromise;
  let closePromise;
  let closing = false;
  let started = false;
  let verifiedNamespace = false;
  let supervisorPid;

  function diagnostic(kind, message) {
    try {
      onDiagnostic?.({ kind, message: String(message).slice(-8000), socketPath });
    } catch {
      // Logging must never interfere with process ownership.
    }
  }

  function acceptHello(hello, { requireProcessLink, launcherPid }) {
    const verified = verifySupervisorIdentity(hello, {
      socketPath,
      launcherPid,
      requireProcessLink,
      ...identityDeps,
    });
    if (!verified.ok) {
      verifiedNamespace = false;
      throw identityMismatchError(
        requireProcessLink
          ? 'server.le_moteur_ne_correspond_pas_au_processus_lance_par_le_studio'
          : 'server.le_moteur_de_recuperation_ne_fournit_pas_une_identite_valide',
      );
    }
    verifiedNamespace = true;
    supervisorPid = hello.supervisorPid;
    return { pid: hello.supervisorPid, socketPath };
  }

  async function startInner() {
    const DaemonClient = await loadClient();
    if (closing) throw new Error(tr('server.le_moteur_est_en_cours_d_arret'));
    // Native clients can recover a dead supervisor before the next GUI run.
    // Trust that successor only after this private namespace was authenticated
    // against our original ChildProcess. Never adopt a peer on the first start.
    if (verifiedNamespace && !alive(child)) {
      const client = new DaemonClient(socketPath);
      try {
        await client.connect(Math.min(500, timeout));
        const hello = await client.waitForHello(Math.min(1500, timeout));
        if (closing) throw new Error(tr('server.le_moteur_est_en_cours_d_arret'));
        return acceptHello(hello, { requireProcessLink: false, launcherPid: null });
      } catch (error) {
        if (closing || error.code === 'GUI_DAEMON_IDENTITY_MISMATCH') throw error;
        // No responsive successor: launch another child that we can verify.
      } finally {
        client.close();
      }
    }
    const launchEnv = { ...env };
    // A GUI launched inside an agent must not inherit that worker's identity.
    for (const name of Object.keys(launchEnv)) {
      if (
        /^PRIME_AGENT_INTERNAL_(?:DAEMON_WORKER|DAEMON_CATALOG|SESSION_LEASE|ORPHAN_PROCESS)/.test(name) ||
        name === 'PRIME_AGENT_INTERNAL_DAEMON_SUPERVISOR_SOCKET' ||
        name === 'PRIME_GUI_CONTROL'
      )
        delete launchEnv[name];
    }
    const args = ['--mode', 'daemon', '--daemon-socket', socketPath];
    const current = spawnProcess(
      cli.node ? process.execPath : cli.path,
      cli.node ? [cli.path, ...args] : args,
      {
        cwd,
        env: launchEnv,
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child = current;
    started = true;
    let failure;
    let output = '';
    const capture = (chunk) => {
      output = (output + chunk.toString()).slice(-8000);
    };
    current.stdout?.on('data', capture);
    current.stderr?.on('data', capture);
    current.on('error', (error) => {
      failure = error;
    });
    current.on('exit', (code, signal) => {
      if (current === child) startPromise = undefined;
      if (!closing && code !== 0)
        diagnostic('daemon_exit', output || tr('server.moteur_arrete', { value1: code ?? signal }));
    });
    const deadline = Date.now() + timeout;
    try {
      while (!closing && Date.now() < deadline) {
        if (failure) throw failure;
        if (!alive(current))
          throw new Error(output || tr('server.le_moteur_prime_agent_s_est_arrete_au_demarrage'));
        const client = new DaemonClient(socketPath);
        try {
          await client.connect(Math.min(500, Math.max(1, deadline - Date.now())));
          const hello = await client.waitForHello(Math.min(1500, Math.max(1, deadline - Date.now())));
          return acceptHello(hello, { requireProcessLink: true, launcherPid: current.pid });
        } catch (error) {
          if (error.code === 'GUI_DAEMON_IDENTITY_MISMATCH') throw error;
        } finally {
          client.close();
        }
        await sleep(100);
      }
      throw new Error(
        closing
          ? tr('server.le_moteur_est_en_cours_d_arret')
          : `Prime Agent ne répond pas au démarrage.${output ? ` ${output}` : ''}`,
      );
    } catch (error) {
      await terminateProcess(current);
      throw error;
    }
  }

  function ensureReady() {
    if (closing) return Promise.reject(new Error(tr('server.le_moteur_est_en_cours_d_arret')));
    if (!startPromise) {
      startPromise = startInner().then(
        (result) => {
          // Recovered supervisors are not our ChildProcess, so there is no exit
          // event to invalidate readiness. Probe that namespace on every run.
          if (!alive(child)) startPromise = undefined;
          return result;
        },
        (error) => {
          startPromise = undefined;
          throw error;
        },
      );
    }
    return startPromise;
  }

  async function closeInner() {
    closing = true;
    await startPromise?.catch(() => {});
    if (!started) return;
    if (!verifiedNamespace) {
      await terminateProcess(child);
      return;
    }
    let client;
    try {
      const DaemonClient = await loadClient();
      client = new DaemonClient(socketPath);
      await client.connect(1000);
      await client.waitForHello(1500);
      // Public `prime-agent shutdown` stops every daemon. This request is scoped
      // to the unguessable namespace allocated by this runtime, including recovery.
      const response = await client.request({ type: 'shutdown', force: true }, 2500);
      if (!response.success) diagnostic('daemon_shutdown', response.error);
    } catch (error) {
      if (alive(child)) diagnostic('daemon_shutdown', error.message);
    } finally {
      client?.close();
    }
    const deadline = Date.now() + closeTimeout;
    while (alive(child) && Date.now() < deadline) await sleep(50);
    await terminateProcess(child);
  }

  return {
    socketPath,
    get pid() {
      return supervisorPid ?? child?.pid;
    },
    ensureReady,
    close() {
      return (closePromise ||= closeInner());
    },
  };
}
