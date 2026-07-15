'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function filesUnder(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

for (const file of [...filesUnder(path.join(__dirname, '..', 'src')), ...filesUnder(path.join(__dirname, '..', 'test'))]) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log('API JavaScript syntax check passed.');
