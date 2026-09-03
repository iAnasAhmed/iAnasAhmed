/**
 * Build: compile TypeScript, then copy the static shell into dist/.
 *
 * Plain Node, no bundler. `dist/` is the document root the server serves:
 *   dist/index.html      <- src/web/index.html
 *   dist/styles.css      <- src/web/styles.css
 *   dist/web/app.js      <- compiled from src/web/app.ts
 *   dist/core/*.js       <- imported by app.js as ../core/*.js
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

execFileSync('tsc', [], { stdio: 'inherit', shell: process.platform === 'win32' });

copyFileSync('src/web/index.html', 'dist/index.html');
copyFileSync('src/web/styles.css', 'dist/styles.css');

console.log('Built to dist/');
