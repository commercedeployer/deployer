'use strict';

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'templates');
const dest = path.join(__dirname, '..', 'templates-bundled');

if (!fs.existsSync(src)) {
  console.warn(`sync-templates-default: source dir missing: ${src}. Nothing to sync.`);
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
const files = fs.readdirSync(src).filter((f) => f.endsWith('.json'));
for (const file of files) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
}
console.log(`Synced ${files.length} template(s): ${src} → ${dest}`);
