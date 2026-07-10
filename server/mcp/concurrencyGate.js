function createMcpConcurrencyGate({
  maxConcurrent = 4,
  maxQueued = 16,
  queueTimeoutMs = 60_000,
} = {}) {
  let running = 0;
  const waiters = [];

  function drain() {
    while (running < maxConcurrent && waiters.length) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      running += 1;
      Promise.resolve()
        .then(waiter.fn)
        .then(waiter.resolve, waiter.reject)
        .finally(() => {
          running -= 1;
          drain();
        });
    }
  }

  function run(fn) {
    return new Promise((resolve, reject) => {
      if (running < maxConcurrent) {
        running += 1;
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            running -= 1;
            drain();
          });
        return;
      }

      if (waiters.length >= maxQueued) {
        const err = new Error('mcp_server_busy');
        err.code = 'mcp_server_busy';
        reject(err);
        return;
      }

      const waiter = {
        fn,
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = waiters.indexOf(waiter);
          if (idx >= 0) {
            waiters.splice(idx, 1);
            const err = new Error('mcp_queue_timeout');
            err.code = 'mcp_queue_timeout';
            reject(err);
          }
        }, queueTimeoutMs),
      };
      waiters.push(waiter);
    });
  }

  return { run };
}

module.exports = { createMcpConcurrencyGate };
