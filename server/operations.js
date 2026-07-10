/**
 * In-memory async operations (deploy / lifecycle). Cap concurrent Docker work.
 */
const crypto = require('crypto');

const MAX_CONCURRENT = Math.max(1, parseInt(process.env.MAX_CONCURRENT_OPERATIONS || '10', 10));
const MAX_QUEUED = Math.max(1, parseInt(process.env.MAX_QUEUED_OPERATIONS || '100', 10));
const TTL_MS = Math.max(60_000, parseInt(process.env.OPERATION_TTL_HOURS || '24', 10) * 60 * 60 * 1000);

/** @type {Map<string, object>} */
const operations = new Map();
/** @type {Map<string, string>} slotKey → operationId */
const slotActive = new Map();
const waitQueue = [];
let runningCount = 0;

function nowIso() {
  return new Date().toISOString();
}

function isActive(op) {
  return Boolean(op && (op.status === 'queued' || op.status === 'running'));
}

function isTerminal(op) {
  return Boolean(op && (op.status === 'succeeded' || op.status === 'failed'));
}

function publicOperation(op) {
  if (!op) return null;
  return {
    operationId: op.id,
    kind: op.kind,
    slotKey: op.slotKey,
    status: op.status,
    phase: op.phase,
    message: op.message || '',
    result: op.result ?? null,
    error: op.error ?? null,
    createdAt: op.createdAt,
    updatedAt: op.updatedAt,
    finishedAt: op.finishedAt ?? null,
  };
}

function countQueued() {
  let n = 0;
  for (const op of operations.values()) {
    if (op.status === 'queued') n += 1;
  }
  return n;
}

function getRunningCount() {
  return runningCount;
}

function sweepTerminal() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, op] of operations) {
    if (!isTerminal(op)) continue;
    const finished = op.finishedAt ? Date.parse(op.finishedAt) : Date.parse(op.updatedAt);
    if (Number.isFinite(finished) && finished < cutoff) {
      operations.delete(id);
      if (op.slotKey && slotActive.get(op.slotKey) === id) {
        slotActive.delete(op.slotKey);
      }
    }
  }
}

function makeError(code, statusCode, retryAfterSec) {
  const err = new Error(code);
  err.statusCode = statusCode;
  if (retryAfterSec != null) err.retryAfterSec = retryAfterSec;
  return err;
}

function attachExecute(op, execute) {
  op._execute = execute;
}

async function runOperation(op) {
  op.status = 'running';
  if (op.phase === 'queued') {
    op.phase = op.kind === 'deploy' ? 'validating' : 'running';
  }
  op.updatedAt = nowIso();
  try {
    const onPhase = (phase, message) => {
      op.phase = phase;
      if (message) op.message = message;
      op.updatedAt = nowIso();
    };
    const result = await op._execute({ onPhase });
    op.status = 'succeeded';
    op.phase = 'succeeded';
    op.result = result ?? null;
    op.error = null;
  } catch (err) {
    op.status = 'failed';
    op.phase = err?.phase || 'failed';
    op.error = err?.message || String(err);
    op.result = null;
    if (err?.statusCode) op.httpStatus = err.statusCode;
  }
  op.finishedAt = nowIso();
  op.updatedAt = op.finishedAt;
  if (op.slotKey && slotActive.get(op.slotKey) === op.id) {
    slotActive.delete(op.slotKey);
  }
  runningCount = Math.max(0, runningCount - 1);
  drainQueue();
}

function drainQueue() {
  while (runningCount < MAX_CONCURRENT && waitQueue.length > 0) {
    const id = waitQueue.shift();
    const op = operations.get(id);
    if (!op || op.status !== 'queued') continue;
    runningCount += 1;
    runOperation(op).catch((err) => {
      console.error('Operation runner error:', err);
    });
  }
}

/**
 * @param {{ kind: string, slotKey?: string|null, execute: Function }} spec
 */
function enqueueOperation(spec) {
  sweepTerminal();

  const slotKey = spec.slotKey ? String(spec.slotKey).trim() : null;
  if (slotKey) {
    const existingId = slotActive.get(slotKey);
    if (existingId) {
      const existing = operations.get(existingId);
      if (isActive(existing)) {
        const err = makeError('operation_in_progress', 409);
        err.existingOperationId = existingId;
        throw err;
      }
    }
  }

  if (countQueued() >= MAX_QUEUED) {
    throw makeError('deployer_busy', 503, 30);
  }

  const op = {
    id: crypto.randomUUID(),
    kind: String(spec.kind || 'deploy'),
    slotKey,
    status: 'queued',
    phase: 'queued',
    message: '',
    result: null,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: null,
  };
  attachExecute(op, spec.execute);
  operations.set(op.id, op);
  if (slotKey) slotActive.set(slotKey, op.id);

  if (runningCount < MAX_CONCURRENT) {
    runningCount += 1;
    runOperation(op).catch((err) => {
      console.error('Operation runner error:', err);
    });
  } else {
    waitQueue.push(op.id);
  }

  return op;
}

function getOperation(operationId) {
  sweepTerminal();
  return operations.get(String(operationId || '')) ?? null;
}

function resetForTests() {
  operations.clear();
  slotActive.clear();
  waitQueue.length = 0;
  runningCount = 0;
}

module.exports = {
  enqueueOperation,
  getOperation,
  publicOperation,
  isActive,
  isTerminal,
  countQueued,
  getRunningCount,
  resetForTests,
  MAX_CONCURRENT,
  MAX_QUEUED,
};
