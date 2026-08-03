const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'darwin') process.exit(0);

const root = path.join(__dirname, '..');
const source = path.join(__dirname, 'codex-desktop-ui-macos.swift');
const outputDirectory = path.join(root, 'build', 'macos');
const output = path.join(outputDirectory, 'codex-desktop-ui');

fs.mkdirSync(outputDirectory, { recursive: true });
const result = spawnSync(
  'xcrun',
  [
    'swiftc',
    '-O',
    '-framework', 'AppKit',
    '-framework', 'ApplicationServices',
    source,
    '-o', output,
  ],
  { stdio: 'inherit' }
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
fs.chmodSync(output, 0o755);
console.log(`codexwhip: built ${output}`);
