/**
 * Deployer capacity snapshot for Commerce placement.
 */
const { getContainerCount, CONTAINER_LIMIT } = require('./docker');
const { countQueued, getRunningCount, MAX_QUEUED, MAX_CONCURRENT } = require('./operations');

async function probeDocker() {
  try {
    await getContainerCount();
    return 'ok';
  } catch {
    return 'error';
  }
}

async function getCapacitySnapshot() {
  const docker = await probeDocker();
  let total = 0;
  if (docker === 'ok') {
    try {
      total = await getContainerCount();
    } catch {
      /* keep 0 */
    }
  }
  const limit = CONTAINER_LIMIT > 0 ? CONTAINER_LIMIT : 0;
  const free_slots = limit > 0 ? Math.max(0, limit - total) : Number.MAX_SAFE_INTEGER;
  return {
    ok: docker === 'ok',
    docker,
    total_containers: total,
    container_limit: limit,
    free_slots: limit > 0 ? free_slots : null,
    queued_operations: countQueued(),
    max_queued_operations: MAX_QUEUED,
    running_operations: getRunningCount(),
    max_concurrent_operations: MAX_CONCURRENT,
  };
}

module.exports = {
  probeDocker,
  getCapacitySnapshot,
};
