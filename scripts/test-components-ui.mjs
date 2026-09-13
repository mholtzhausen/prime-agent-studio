import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!['index.html', 'desktop.js', 'desktop.css', 'icon.png'].includes(name))
    return res.writeHead(404).end();
  res.setHeader(
    'Content-Type',
    name.endsWith('.js')
      ? 'text/javascript'
      : name.endsWith('.css')
        ? 'text/css'
        : name.endsWith('.png')
          ? 'image/png'
          : 'text/html',
  );
  res.end(await readFile(join('desktop', name)));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({
  channel: process.env.PRIME_STUDIO_TEST_BROWSER || 'msedge',
  headless: true,
});
await mkdir('.local/components-ui', { recursive: true });
try {
  for (const locale of ['fr-FR', 'en-US']) {
    const context = await browser.newContext({ locale, viewport: { width: 660, height: 850 } });
    await context.addInitScript(() => {
      window.calls = [];
      window.__TAURI__ = {
        event: {
          listen: async (_, fn) => {
            window.componentProgress = fn;
          },
        },
        core: {
          invoke: async (name, args) => {
            window.calls.push({ name, args });
            if (name === 'desktop_state') return { version: '3.2.7', started: true, imported: true };
            if (name === 'desktop_components') {
              if (args.action === 'install') {
                window.componentProgress({
                  payload: { component: 'engine', stage: 'download', received: 16384, total: 32768 },
                });
                return new Promise((done) => {
                  window.finishInstall = done;
                });
              }
              return {
                ready: false,
                components: {
                  engine: { status: 'missing' },
                  uv: { status: 'missing' },
                  python: { status: 'pending' },
                },
              };
            }
            if (name === 'desktop_components_cancel')
              window.finishInstall({ failure: { component: 'engine', error: 'cancelled' } });
            if (name === 'desktop_update_status')
              return { managed: true, running: true, activeRuns: 0, version: '3.2.7' };
            return {};
          },
        },
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await expect(page.locator('#components')).toBeVisible();
    assert.equal(await page.evaluate(() => window.calls.some((c) => c.name === 'desktop_start')), false);
    assert.equal(await page.evaluate(() => window.calls.some((c) => c.args?.action === 'install')), false);
    await expect(page.locator('#start')).toContainText(locale.startsWith('fr') ? 'Plus tard' : 'Later');
    await page.locator('#components-install').click();
    await expect(page.locator('#components-status')).toContainText(
      locale.startsWith('fr') ? 'octets reçus' : 'bytes received',
    );
    await expect(page.locator('#components-status')).not.toContainText('%');
    await page.locator('#components-cancel').click();
    await expect(page.locator('#components-status')).toContainText(
      locale.startsWith('fr') ? 'annulée' : 'cancelled',
    );
    await page.locator('#components-install').click();
    await page.evaluate(() =>
      window.finishInstall({
        ready: true,
        activation: 'deferred',
        components: {
          engine: {
            status: 'ready',
            version: '0.9.4',
            path: 'C:\\Données Studio\\engine\\cli.js',
            provenance: 'https://official.example/prime-agent-0.9.4.tgz',
          },
          python: { status: 'ready' },
          bash: { status: 'ready' },
          uv: { status: 'ready', version: '0.8.22' },
        },
      }),
    );
    await expect(page.locator('#components-status')).toContainText(
      locale.startsWith('fr') ? 'différée' : 'deferred',
    );
    assert.equal(await page.evaluate(() => window.calls.some((c) => c.name === 'desktop_start')), false);
    await page.screenshot({ path: `.local/components-ui/${locale}.png`, fullPage: true });
    await page.goto(url + '/?settings');
    await expect(page.locator('#components')).toBeVisible();
    await page.goto(url + '/?background');
    await expect
      .poll(() => page.evaluate(() => window.calls.some((c) => c.name === 'desktop_start')))
      .toBe(true);
    assert.equal(await page.evaluate(() => window.calls.some((c) => c.args?.action === 'install')), false);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    'PASS: FR/EN first run, settings, explicit install, bytes, cancellation, deferred activation, background without installation.',
  );
} finally {
  await browser.close();
  server.close();
}
