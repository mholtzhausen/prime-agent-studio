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
  channel: process.env.PRIME_STUDIO_TEST_BROWSER || 'chrome',
  headless: true,
});
await mkdir('.local/components-ui', { recursive: true });
try {
  for (const locale of ['fr-FR', 'en-US']) {
    const context = await browser.newContext({
      locale,
      colorScheme: locale.startsWith('fr') ? 'dark' : 'light',
      viewport: { width: 660, height: 850 },
    });
    await context.addInitScript(() => {
      window.calls = [];
      window.__TAURI__ = {
        core: {
          invoke: async (name, args) => {
            window.calls.push({ name, args });
            if (name === 'desktop_state')
              return { version: '4.0.0', started: false, imported: true, autostart: false };
            if (name === 'desktop_update_status')
              return { managed: true, running: true, activeRuns: 0, version: '4.0.0' };
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
    await expect(page.locator('#components')).toHaveCount(0);
    await expect(page.locator('#choices')).toBeVisible();
    await expect(page.locator('#start')).toBeEnabled();
    assert.equal(
      await page.evaluate(() => window.calls.some((c) => c.name === 'desktop_components')),
      false,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `.local/components-ui/launcher-${locale}.png`,
      fullPage: true,
    });
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('components launcher UI: no setup panel');
