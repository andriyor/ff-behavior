const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ff = require("ff");

// Runs an ff chain and resolves with how it ended. Resolves with
// { handler: "none" } if no result handler ran within `ms`, so tests can
// assert that a chain hangs.
function settle(build, ms = 100) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ handler: "none" }), ms);
    const finish = (outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    build()
      .onSuccess((...values) => finish({ handler: "onSuccess", values }))
      .onError((err) => finish({ handler: "onError", err }));
  });
}

// Node-style async function: calls back with (null, value) after `ms`.
const later = (value, ms = 5) => (cb) => setTimeout(() => cb(null, value), ms);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs fixtures/<name> in a separate node process. For behaviour that ends in
// an uncaught exception, which the test runner would otherwise report as a failure.
function runFixture(name) {
  return spawnSync(process.execPath, [path.join(__dirname, "..", "fixtures", name)], {
    encoding: "utf8",
    timeout: 5000,
  });
}

module.exports = { ff, settle, later, wait, runFixture };
