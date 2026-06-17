'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const testFile = path.join(__dirname, '../test/integration/docker-deploy.integration.test.js');

const result = spawnSync(process.execPath, ['--test', testFile], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
