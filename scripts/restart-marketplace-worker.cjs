#!/usr/bin/env node

const { execSync } = require('child_process');
const { existsSync } = require('fs');

// Reuse sync-marketplace's derivation instead of re-spelling the marketplace
// name: this file arrived from upstream carrying `thedotmack`, which would have
// restarted a worker this fork does not install.
const { INSTALLED_PATH } = require('./sync-marketplace.cjs');

if (!existsSync(INSTALLED_PATH)) {
  console.error('\x1b[31m%s\x1b[0m', `Marketplace not found at ${INSTALLED_PATH} - run npm run sync-marketplace first`);
  process.exit(1);
}

try {
  execSync('npm run worker:restart', { cwd: INSTALLED_PATH, stdio: 'inherit' });
} catch (error) {
  console.error('\x1b[31m%s\x1b[0m', 'Worker restart failed:', error.message);
  process.exit(1);
}
