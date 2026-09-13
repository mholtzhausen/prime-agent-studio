import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverCli, agentEnvironment } from './agent.mjs';
import { ensureLocalKernel, execute } from './kernel.mjs';
import { extractTgz, extractZip } from './component-archives.mjs';
import { acquireLock } from '../scripts/launcher-common.mjs';

export const COMPONENT_POLICY = Object.freeze({
  engine: '0.9.4',
  npm: '10.9.4',
  uv: '0.8.22',
  installer: 'https://app.primeintellect.ai/prime-agent/install.sh',
});
const PROBE = fileURLToPath(new URL('../scripts/component-probe.mjs', import.meta.url));
const json = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('manifest_invalid');
  }
};
export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}
export function checkNode(version = process.versions.node, platform = process.platform, arch = process.arch) {
  if (platform !== 'win32' || arch !== 'x64') throw new Error('architecture_unsupported');
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  // Only the maintained Node lines actually covered by Studio's compatibility policy.
  if (!((major === 22 && minor >= 16) || major === 24)) throw new Error('node_incompatible');
}
export async function selectedEnvironment(dataRoot, env = process.env) {
  const manifest = await json(join(dataRoot, 'engine/installation.json'));
  const selection = await json(join(dataRoot, 'engine/selection.json'));
  const result = { ...env };
  for (const [key, name] of [
    ['PRIME_AGENT_CLI', 'engine'],
    ['PRIME_GUI_UV', 'uv'],
    ['PRIME_AGENT_KERNEL_PYTHON', 'python'],
  ]) {
    const saved = selection[name];
    const managed = name === 'python' ? undefined : manifest.components?.[name]?.path;
    if (!result[key] && (saved || managed)) result[key] = saved || managed;
  }
  result.PRIME_AGENT_GUI_KERNEL_ROOT = dataRoot;
  result.PRIME_STUDIO_DESKTOP_DATA_ROOT = dataRoot;
  // Prevent a skipped first-run wizard from implicitly downloading Python on a prompt.
  const resolved = discoverCli(result.PRIME_AGENT_CLI || null, result);
  const externalPython =
    result.PRIME_AGENT_KERNEL_PYTHON &&
    resolve(
      /^~[\\/]/.test(result.PRIME_AGENT_KERNEL_PYTHON)
        ? join(homedir(), result.PRIME_AGENT_KERNEL_PYTHON.slice(2))
        : result.PRIME_AGENT_KERNEL_PYTHON,
    );
  result.PRIME_STUDIO_COMPONENTS_REQUIRED =
    manifest.validatedAt &&
    manifest.shellValidated === true &&
    manifest.components?.engine?.version === COMPONENT_POLICY.engine &&
    resolved?.path === manifest.components?.engine?.path &&
    (!externalPython || externalPython === manifest.components?.python?.path)
      ? '0'
      : '1';
  result.UV_PYTHON_INSTALL_DIR = join(dataRoot, 'engine/python');
  result.UV_CACHE_DIR = join(dataRoot, 'engine/cache/uv');
  result.UV_PYTHON_DOWNLOADS = 'automatic';
  result.UV_PYTHON_PREFERENCE = 'only-managed';
  return result;
}
export async function download(
  url,
  { signal, onProgress = () => {}, limit = 128 * 1024 * 1024, fetchImpl = fetch, allowLocal = false } = {},
) {
  const timeout = AbortSignal.timeout(180000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let redirects = 0; redirects < 6; redirects++) {
    const parsed = new URL(url);
    if (
      parsed.username ||
      parsed.password ||
      (parsed.protocol !== 'https:' &&
        !(allowLocal && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'))
    )
      throw new Error('source_invalid');
    const response = await fetchImpl(url, { signal: combined, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok || !response.body) throw new Error('download_failed');
    const total = Number(response.headers.get('content-length')) || undefined;
    if (total > limit) {
      await response.body.cancel();
      throw new Error('download_too_large');
    }
    const chunks = [];
    let received = 0;
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > limit) throw new Error('download_too_large');
      chunks.push(chunk);
      onProgress({ received, total });
    }
    if (total && received !== total) throw new Error('download_failed');
    return Buffer.concat(chunks);
  }
  throw new Error('source_invalid');
}
export function checksum(inventory, name) {
  const matches = inventory
    .split(/\r?\n/)
    .map((line) => line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i))
    .filter((match) => match && match[2] === name);
  if (matches.length !== 1) throw new Error('checksum_missing');
  return matches[0][1].toLowerCase();
}
export function verifyDigest(buffer, expected, algorithm = 'sha256', encoding = 'hex') {
  if (createHash(algorithm).update(buffer).digest(encoding) !== expected)
    throw new Error('checksum_mismatch');
}
export function releaseOrigin(installer) {
  const matches = [
    ...installer.matchAll(/prime_agent_base_url="\$\{PRIME_AGENT_DOWNLOAD_BASE_URL:-([^}]+)\}"/g),
  ];
  if (matches.length !== 1) throw new Error('source_contract_changed');
  const url = new URL(matches[0][1]);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('source_contract_changed');
  return url.origin;
}
async function validateEngine(path, env, signal) {
  const cli = discoverCli(path, env);
  if (!cli?.packageDir || !cli.node || cli.path !== join(cli.packageDir, 'dist/bundle/cli.js'))
    throw new Error('engine_incompatible');
  const pkg = await json(join(cli.packageDir, 'package.json'));
  if (pkg.version !== COMPONENT_POLICY.engine || pkg.engines?.node !== '>=22.8.0')
    throw new Error('engine_incompatible');
  const version = await promisify(execFile)(process.execPath, [cli.path, '--version'], {
    env,
    windowsHide: true,
    shell: false,
    timeout: 30000,
    maxBuffer: 65536,
    signal,
  });
  if (![version.stdout.trim(), version.stderr.trim()].includes(COMPONENT_POLICY.engine))
    throw new Error('engine_incompatible');
  const probe = JSON.parse(
    await execute(
      process.execPath,
      [
        PROBE,
        cli.packageDir,
        join(env.PRIME_AGENT_CODING_AGENT_DIR || join(homedir(), '.prime/agent'), 'settings.json'),
      ],
      env,
      30000,
      signal,
    ),
  );
  return { path: cli.path, packageDir: cli.packageDir, version: cli.version, bash: probe.bash };
}
async function validateUv(path, env, signal) {
  const output = await execute(path, ['--version'], env, 10000, signal);
  const version = output.match(/^uv (\d+\.\d+\.\d+)/)?.[1];
  if (!version) throw new Error('uv_incompatible');
  // Execution plus the PE machine header rules out emulated ARM/x86 binaries.
  const exe = await readFile(path);
  const pe = exe.length >= 64 ? exe.readUInt32LE(60) : -1;
  if (pe < 0 || pe + 6 > exe.length || exe.readUInt32LE(pe) !== 0x4550 || exe.readUInt16LE(pe + 4) !== 0x8664)
    throw new Error('uv_incompatible');
  return { path, version };
}
const componentError = (error) =>
  /ENOSPC|not enough space/i.test(`${error.code} ${error.message}`)
    ? 'disk_full'
    : /EACCES|EPERM|permission denied/i.test(`${error.code} ${error.message}`)
      ? 'write_denied'
      : error.name === 'AbortError'
        ? 'cancelled'
        : error.name === 'TimeoutError'
          ? 'download_failed'
          : /^[a-z_]+$/.test(error.message || '')
            ? error.message
            : 'validation_failed';
export async function diagnoseComponents({ dataRoot, env = process.env, signal }, deps = {}) {
  const selected = await selectedEnvironment(dataRoot, env);
  const home = selected.PRIME_AGENT_CODING_AGENT_DIR || join(homedir(), '.prime/agent');
  const runtimeEnv = agentEnvironment({ env: selected });
  const cached = await json(join(dataRoot, 'engine/prepared.json'));
  const installed = await json(join(dataRoot, 'engine/installation.json'));
  const result = { components: {}, ready: false };
  try {
    (deps.checkNode || checkNode)();
    result.components.node = { status: 'ready', version: process.versions.node };
  } catch (e) {
    result.components.node = { status: 'error', error: componentError(e) };
    return result;
  }
  const explicit = env.PRIME_AGENT_CLI || (await json(join(dataRoot, 'engine/selection.json'))).engine;
  const candidates = selected.PRIME_AGENT_CLI
    ? [selected.PRIME_AGENT_CLI]
    : [...discoverCli(null, selected, { all: true }).map((cli) => cli.path), cached.engine?.path].filter(
        Boolean,
      );
  result.components.engine = { status: 'error', error: 'missing', explicit: Boolean(explicit) };
  for (const candidate of candidates) {
    try {
      result.components.engine = {
        ...(await (deps.validateEngine || validateEngine)(candidate, runtimeEnv, signal)),
        status: 'ready',
        source: explicit ? 'explicit' : candidate.includes(join(dataRoot, 'engine')) ? 'managed' : 'external',
      };
      break;
    } catch (e) {
      result.components.engine = { status: 'error', error: componentError(e), explicit: Boolean(explicit) };
    }
  }
  const engine = result.components.engine;
  if (engine.status === 'ready') {
    try {
      const python = await (deps.ensureKernel || ensureLocalKernel)({
        packageDir: engine.packageDir,
        root: dataRoot,
        cwd: existsSync(home) ? home : homedir(),
        agentHome: home,
        env: runtimeEnv,
        signal,
        readOnly: true,
      });
      result.components.python = {
        status: python ? 'ready' : 'missing',
        path: python,
        source: selected.PRIME_AGENT_KERNEL_PYTHON ? 'explicit' : 'managed',
      };
    } catch (e) {
      result.components.python = {
        status: 'error',
        error: componentError(e),
        explicit: Boolean(selected.PRIME_AGENT_KERNEL_PYTHON),
      };
    }
    try {
      if (!engine.bash) throw new Error('bash_missing');
      const output = await (deps.execute || execute)(
        engine.bash,
        ['--noprofile', '--norc', '-c', 'printf studio-shell-ok'],
        runtimeEnv,
        10000,
        signal,
      );
      if (output !== 'studio-shell-ok') throw new Error('bash_missing');
      result.components.bash = { status: 'ready', path: engine.bash };
    } catch {
      result.components.bash = { status: 'error', error: 'bash_missing' };
    }
  } else result.components.python = { status: 'pending' };
  const uvRequired = !selected.PRIME_AGENT_KERNEL_PYTHON && result.components.python.status !== 'ready';
  const uvExplicit = env.PRIME_GUI_UV || (await json(join(dataRoot, 'engine/selection.json'))).uv;
  const uvCandidates = selected.PRIME_GUI_UV
    ? [selected.PRIME_GUI_UV]
    : [
        join(homedir(), '.local/bin/uv.exe'),
        join(homedir(), '.cargo/bin/uv.exe'),
        ...(selected.PATH || '')
          .split(delimiter)
          .filter(Boolean)
          .map((p) => join(p, 'uv.exe')),
        cached.uv?.path,
      ];
  result.components.uv = { status: uvRequired || uvExplicit ? 'missing' : 'not_required' };
  if (uvRequired || selected.PRIME_GUI_UV)
    for (const path of uvCandidates.filter(Boolean)) {
      try {
        result.components.uv = {
          ...(await (deps.validateUv || validateUv)(path, runtimeEnv, signal)),
          status: 'ready',
          source: uvExplicit ? 'explicit' : path.includes(join(dataRoot, 'engine')) ? 'managed' : 'external',
        };
        break;
      } catch (e) {
        if (uvExplicit) {
          result.components.uv = { status: 'error', explicit: true, error: componentError(e) };
          break;
        }
      }
    }
  result.ready =
    ['engine', 'python', 'bash'].every((key) => result.components[key]?.status === 'ready') &&
    !Object.values(result.components).some((c) => c.explicit && c.status === 'error');
  for (const name of ['engine', 'uv']) {
    const info = installed.components?.[name] || cached[name];
    if (info?.path && info.path === result.components[name]?.path) {
      result.components[name].provenance = info.provenance;
      result.components[name].sha256 = info.sha256;
    }
  }
  return result;
}

export async function prepareComponents(
  { dataRoot, env = process.env, signal, onProgress = () => {}, selection },
  deps = {},
) {
  (deps.checkNode || checkNode)();
  const base = join(resolve(dataRoot), 'engine');
  await mkdir(base, { recursive: true });
  const release = await acquireLock({ lock: join(base, 'install.lock') }, { timeout: 1200 });
  const emit = (component, stage, extra = {}) => onProgress({ component, stage, ...extra });
  let component = 'engine';
  try {
    if (selection) {
      if (!['engine', 'uv', 'python'].includes(selection.component) || typeof selection.path !== 'string')
        throw new Error('selection_invalid');
      const settings = await json(join(base, 'selection.json'));
      await atomicJson(join(base, 'selection.json'), { ...settings, [selection.component]: selection.path });
    }
    let state = await diagnoseComponents({ dataRoot, env, signal }, deps);
    if (Object.values(state.components).some((c) => c.explicit && c.status === 'error'))
      throw new Error('explicit_invalid');
    const prepared = await json(join(base, 'prepared.json'));
    const runtimeEnv = agentEnvironment({ env: await selectedEnvironment(dataRoot, env) });
    runtimeEnv.PRIME_STUDIO_COMPONENTS_REQUIRED = '0';
    // Resume a fully validated component after a later Python/network failure.
    if (state.components.engine.status !== 'ready' && prepared.engine?.path) {
      try {
        state.components.engine = {
          ...(await validateEngine(prepared.engine.path, runtimeEnv, signal)),
          status: 'ready',
          source: 'managed',
        };
      } catch {
        /* An old or damaged prepared engine must be replaced. */
      }
    }
    const fetchBytes = async (url, limit) =>
      (deps.download || download)(url, {
        signal,
        limit,
        onProgress: (bytes) => emit(component, 'download', bytes),
      });
    const text = async (url) => (await fetchBytes(url, 2 * 1024 * 1024)).toString('utf8');
    async function save(name, info) {
      prepared[name] = info;
      await atomicJson(join(base, 'prepared.json'), prepared);
    }
    async function stage(name, install) {
      const id = randomUUID();
      const work = join(base, 'staging', id);
      await mkdir(work, { recursive: true });
      emit(name, 'install');
      const installed = await install(work);
      signal?.throwIfAborted();
      const destination = join(
        base,
        name === 'engine' ? 'prime-agent' : name,
        `${COMPONENT_POLICY[name]}-${id}`,
      );
      await mkdir(dirname(destination), { recursive: true });
      await rename(installed, destination);
      return destination;
    }
    if (state.components.engine.status !== 'ready') {
      component = 'npm';
      let npm = prepared.npm;
      if (npm)
        try {
          if (
            (await execute(process.execPath, [npm.path, '--version'], runtimeEnv, 15000, signal)).trim() !==
            COMPONENT_POLICY.npm
          )
            npm = null;
        } catch {
          npm = null;
        }
      if (!npm) {
        const source = `https://registry.npmjs.org/npm/${COMPONENT_POLICY.npm}`;
        const metadata = JSON.parse(await text(source));
        const url = `https://registry.npmjs.org/npm/-/npm-${COMPONENT_POLICY.npm}.tgz`;
        if (
          metadata.version !== COMPONENT_POLICY.npm ||
          metadata.dist?.tarball !== url ||
          !/^sha512-[A-Za-z0-9+/]{86}==$/.test(metadata.dist?.integrity)
        )
          throw new Error('source_invalid');
        const archive = await fetchBytes(url);
        emit(component, 'verify');
        verifyDigest(archive, metadata.dist.integrity.slice(7), 'sha512', 'base64');
        const directory = await stage('npm', async (work) => {
          await extractTgz(archive, join(work, 'unpacked'));
          return join(work, 'unpacked/package');
        });
        npm = {
          path: join(directory, 'bin/npm-cli.js'),
          version: COMPONENT_POLICY.npm,
          source,
          integrity: metadata.dist.integrity,
          sha256: createHash('sha256').update(archive).digest('hex'),
        };
        if (
          (await execute(process.execPath, [npm.path, '--version'], runtimeEnv, 15000, signal)).trim() !==
          npm.version
        )
          throw new Error('npm_incompatible');
        await save('npm', npm);
      }
      component = 'engine';
      const origin = releaseOrigin(await text(COMPONENT_POLICY.installer));
      const releaseUrl = `${origin}/releases/v${COMPONENT_POLICY.engine}`;
      const inventory = await text(`${releaseUrl}/SHA256SUMS`);
      const name = `prime-agent-${COMPONENT_POLICY.engine}.tgz`,
        source = `${releaseUrl}/${name}`;
      const sha256 = checksum(inventory, name);
      const archive = await fetchBytes(source);
      emit(component, 'verify');
      verifyDigest(archive, sha256);
      const directory = await stage('engine', async (work) => {
        await extractTgz(archive, join(work, 'unpacked'));
        const packageDir = join(work, 'unpacked/package');
        const pkg = await json(join(packageDir, 'package.json'));
        if (pkg.name !== 'prime-agent' || pkg.version !== COMPONENT_POLICY.engine)
          throw new Error('engine_incompatible');
        // Verify all three first-party dependencies against the SAME official inventory.
        // Local tarballs keep the versioned graph intact without trusting unchecked remote URLs.
        for (const [key, value] of Object.entries(pkg.dependencies || {})) {
          if (!key.startsWith('@earendil-works/')) continue;
          const depName = new URL(value).pathname.split('/').at(-1);
          if (
            value !== `${releaseUrl}/${depName}` ||
            !/^prime-agent-(ai|core|tui)-0\.9\.4\.tgz$/.test(depName)
          )
            throw new Error('source_invalid');
          const dep = await fetchBytes(value);
          verifyDigest(dep, checksum(inventory, depName));
          await extractTgz(dep, join(work, depName + '-checked'));
          await writeFile(join(work, depName), dep, { flag: 'wx' });
          pkg.dependencies[key] = `file:${join(work, depName).replaceAll('\\', '/')}`;
        }
        await writeFile(join(packageDir, 'package.json'), JSON.stringify(pkg));
        // Install directly at the package root: native workers require packageDir/node_modules.
        const emptyConfig = join(work, 'empty.npmrc');
        await writeFile(emptyConfig, '');
        const globalConfig = join(work, 'global.npmrc');
        await writeFile(globalConfig, '');
        const npmEnv = {
          ...runtimeEnv,
          PATH: `${dirname(process.execPath)}${delimiter}${runtimeEnv.PATH || ''}`,
          npm_config_userconfig: emptyConfig,
          npm_config_globalconfig: globalConfig,
          npm_config_cache: join(base, 'cache/npm'),
          npm_config_registry: 'https://registry.npmjs.org/',
          PRIME_AGENT_BOOTSTRAP_TOOLS_ON_INSTALL: '0',
          PRIME_AGENT_BOOTSTRAP_KERNEL_ON_INSTALL: '0',
        };
        await execute(
          process.execPath,
          [
            npm.path,
            'install',
            '--prefix',
            packageDir,
            '--install-strategy=nested',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--package-lock=true',
            '--fetch-retries=2',
            '--fetch-timeout=60000',
            '--registry=https://registry.npmjs.org/',
          ],
          npmEnv,
          600000,
          signal,
          { cwd: packageDir },
        );
        // No lifecycle scripts are necessary for 0.9.4's essential integrations.
        // Preserve upstream metadata after resolving dependencies; retain npm's lock as evidence.
        const original = JSON.parse((await readFile(join(work, 'unpacked/package/package.json'))).toString());
        for (const [key, value] of Object.entries(original.dependencies))
          if (key.startsWith('@earendil-works/'))
            original.dependencies[key] = `${releaseUrl}/${new URL(value).pathname.split('/').at(-1)}`;
        await writeFile(join(packageDir, 'package.json'), JSON.stringify(original, null, 2));
        await validateEngine(packageDir, runtimeEnv, signal);
        return packageDir;
      });
      const engine = await validateEngine(directory, runtimeEnv, signal);
      await save('engine', {
        ...engine,
        provenance: source,
        sha256,
        installer: COMPONENT_POLICY.installer,
        validatedAt: new Date().toISOString(),
      });
      state.components.engine = { ...engine, status: 'ready', source: 'managed' };
    }
    component = 'uv';
    if (
      !runtimeEnv.PRIME_AGENT_KERNEL_PYTHON &&
      state.components.python.status !== 'ready' &&
      state.components.uv.status !== 'ready'
    ) {
      const name = 'uv-x86_64-pc-windows-msvc.zip';
      const source = `https://github.com/astral-sh/uv/releases/download/${COMPONENT_POLICY.uv}/${name}`;
      const sha256 = checksum(await text(source + '.sha256'), name);
      const archive = await fetchBytes(source);
      emit(component, 'verify');
      verifyDigest(archive, sha256);
      const directory = await stage('uv', async (work) => {
        const target = join(work, 'unpacked');
        await extractZip(archive, target);
        return target;
      });
      const uv = await validateUv(join(directory, 'uv.exe'), runtimeEnv, signal);
      if (uv.version !== COMPONENT_POLICY.uv) throw new Error('uv_incompatible');
      await save('uv', { ...uv, provenance: source, sha256, validatedAt: new Date().toISOString() });
      state.components.uv = { ...uv, status: 'ready', source: 'managed' };
    }
    if (state.components.uv.path) runtimeEnv.PRIME_GUI_UV = state.components.uv.path;
    const engine = state.components.engine;
    component = 'python';
    emit(component, 'python');
    const home = runtimeEnv.PRIME_AGENT_CODING_AGENT_DIR || join(homedir(), '.prime/agent');
    await mkdir(home, { recursive: true });
    const python = await (deps.ensureKernel || ensureLocalKernel)({
      packageDir: engine.packageDir,
      root: dataRoot,
      cwd: home,
      agentHome: home,
      env: runtimeEnv,
      signal,
      onProgress: () => emit(component, 'python'),
    });
    signal?.throwIfAborted();
    emit('engine', 'validation');
    const components = {
      engine: { ...(engine.source === 'managed' ? prepared.engine : {}), ...engine },
      uv: { ...(state.components.uv.source === 'managed' ? prepared.uv : {}), ...state.components.uv },
      python: { path: python, source: runtimeEnv.PRIME_AGENT_KERNEL_PYTHON ? 'explicit' : 'managed' },
      npm: prepared.npm,
    };
    let shellValidated = false;
    if (engine.bash)
      try {
        shellValidated =
          (await (deps.execute || execute)(
            engine.bash,
            ['--noprofile', '--norc', '-c', 'printf studio-shell-ok'],
            runtimeEnv,
            10000,
            signal,
          )) === 'studio-shell-ok';
      } catch {
        /* Retain prepared components, but keep shell setup visibly incomplete. */
      }
    signal?.throwIfAborted();
    await atomicJson(join(base, 'installation.json'), {
      schema: 1,
      validatedAt: new Date().toISOString(),
      shellValidated,
      components,
    });
    return await diagnoseComponents({ dataRoot, env, signal }, deps);
  } catch (error) {
    const code = signal?.aborted ? 'cancelled' : componentError(error);
    emit(component, 'error', { error: code });
    throw Object.assign(new Error(code, { cause: error }), { component });
  } finally {
    await release();
  }
}
