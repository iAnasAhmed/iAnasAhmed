/**
 * Screenshot the running app at an exact CSS viewport width, via the Chrome
 * DevTools Protocol. Chromium's --window-size has a minimum that makes true
 * phone-width verification impossible without device-metrics emulation.
 *
 * Usage: node scripts/shot.mjs <url> <out.png> <width> <height> [theme]
 */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [url, out, width = '375', height = '900', theme = 'light'] = process.argv.slice(2);
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=9222', '--window-size=1200,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not expose a debugging target');
}

const ws = new WebSocket(await targetUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  const resolve = pending.get(msg.id);
  if (resolve) { pending.delete(msg.id); resolve(msg.result); }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width), height: Number(height),
  deviceScaleFactor: 2, mobile: Number(width) < 700,
});
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: theme }],
});
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(4000);

const { data } = await send('Page.captureScreenshot', {
  format: 'png', captureBeyondViewport: true,
});
writeFileSync(out, Buffer.from(data, 'base64'));
console.log(`${out} ${width}x${height} ${theme}`);

ws.close();
chrome.kill();
process.exit(0);
