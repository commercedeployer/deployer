#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  const username = String(process.env.DEFAULT_ADMIN_USERNAME || 'admin').trim() || 'admin';
  const password = String(process.env.DEFAULT_ADMIN_PASSWORD || '').trim();
  if (!databaseUrl || !password) {
    process.exit(0);
  }

  const hash = bcrypt.hashSync(password, 10);
  const sql = `UPDATE "user" SET username = ${sqlLiteral(username)}, password = ${sqlLiteral(hash)} WHERE role = 'admin';`;
  const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    process.stderr.write(`${msg}\n`);
    process.exit(result.status || 1);
  }
}

main();
