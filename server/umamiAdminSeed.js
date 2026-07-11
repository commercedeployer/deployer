#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPsql(databaseUrl, args) {
  return spawnSync('psql', [databaseUrl, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sleepSec(sec) {
  spawnSync('sleep', [String(Math.max(1, sec))]);
}

/** Umami applies Prisma migrations on first start; postStart can run before "user" exists. */
function waitForUserTable(databaseUrl) {
  const timeoutSec = Math.max(
    10,
    parseInt(String(process.env.UMAMI_SEED_WAIT_SEC || '120'), 10) || 120,
  );
  const deadline = Date.now() + timeoutSec * 1000;
  const checkSql =
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user' LIMIT 1;";

  while (Date.now() < deadline) {
    const probe = runPsql(databaseUrl, ['-tAc', checkSql]);
    if (probe.status === 0 && String(probe.stdout || '').trim() === '1') {
      return;
    }
    sleepSec(2);
  }
  throw new Error(`timeout waiting for umami "user" table (${timeoutSec}s)`);
}

function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  const username = String(process.env.DEFAULT_ADMIN_USERNAME || 'admin').trim() || 'admin';
  const password = String(process.env.DEFAULT_ADMIN_PASSWORD || '').trim();
  if (!databaseUrl || !password) {
    process.exit(0);
  }

  waitForUserTable(databaseUrl);

  const hash = bcrypt.hashSync(password, 10);
  const sql = `UPDATE "user" SET username = ${sqlLiteral(username)}, password = ${sqlLiteral(hash)} WHERE role = 'admin';`;
  const result = runPsql(databaseUrl, ['-v', 'ON_ERROR_STOP=1', '-c', sql]);
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    process.stderr.write(`${msg}\n`);
    process.exit(result.status || 1);
  }
}

main();
