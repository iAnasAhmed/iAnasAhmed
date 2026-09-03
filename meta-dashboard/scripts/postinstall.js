import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Copies Chart.js's browser UMD build into public/vendor/ so index.html can
// load it with a plain <script> tag - no bundler, no CDN. Keeping public/
// self-contained (rather than pointing express.static at node_modules
// directly) means the only thing the browser can ever fetch from node_modules
// is this one named file, copied on purpose.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
const destDir = path.join(root, 'public', 'vendor');
const dest = path.join(destDir, 'chart.umd.js');

if (!fs.existsSync(src)) {
  console.warn(`[postinstall] expected Chart.js build at ${src} but it was not found — the dashboard's charts will not load. Try reinstalling: npm install chart.js`);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[postinstall] copied Chart.js to public/vendor/chart.umd.js');
