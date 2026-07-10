'use strict';

const path = require('path');

// Source of bundled defaults for integration tests.
const DEFAULT_SEED_DIR = path.join(__dirname, '../../../templates-bundled');

function seedTemplatesDir(targetDir, sourceDir = DEFAULT_SEED_DIR) {
  const { syncTemplatesFromDefault } = require('../../../server/templates');
  return syncTemplatesFromDefault(targetDir, sourceDir);
}

module.exports = {
  DEFAULT_SEED_DIR,
  seedTemplatesDir,
};
