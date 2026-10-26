const test = require("node:test");
const assert = require("node:assert/strict");
const { ff, settle, runFixture } = require("../lib/helpers");

test("a throw inside a step goes to onError and skips later steps", async () => {
  let step2 = false;
  const out = await settle(() =>
    ff(
      () => {
        throw new Error("boom");
      },
      () => {
        step2 = true;
      }
    )
  );
  assert.equal(out.handler, "onError");
  assert.equal(out.err.message, "boom");
  assert.equal(step2, false);
});

test("the first slot error wins; later slot callbacks are ignored", async () => {
  const out = await settle(() => {
    const f = ff(
      () => {
        const a = f.slot();
        const b = f.slot();
        setTimeout(() => a(new Error("first")), 5);
        setTimeout(() => b(new Error("second")), 10);
      },
      () => f.pass("step2 should not run")
    );
    return f;
  });
  assert.equal(out.err.message, "first");
});

test("an error in any group.slot() ends the chain", async () => {
  const out = await settle(() => {
    const f = ff(
      () => {
        const group = f.group();
        ((cb) => cb(new Error("g")))(group.slot());
        ((cb) => cb(null, 1))(group.slot());
      },
      () => f.pass("step2 should not run")
    );
    return f;
  });
  assert.equal(out.handler, "onError");
  assert.equal(out.err.message, "g");
});

test("onSuccess gets the values passed by the last step that ran", async () => {
  const out = await settle(() => {
    const f = ff(
      () => f.pass("a"),
      (a) => f.pass(a + "b")
    );
    return f;
  });
  assert.deepEqual(out.values, ["ab"]);
});

test("onComplete always runs, with err null on success", async () => {
  const seen = [];
  await new Promise((resolve) => {
    const f = ff(() => f.pass(1));
    f.onComplete((err, v) => {
      seen.push([err, v]);
      resolve();
    });
  });
  assert.deepEqual(seen, [[null, 1]]);
});

test("handlers run asynchronously, in registration order", async () => {
  const order = [];
  let sync = true;
  await new Promise((resolve) => {
    ff(() => {
      throw new Error("o");
    })
      .onComplete(() => order.push(["onComplete", sync]))
      .onError(() => {
        order.push(["onError", sync]);
        resolve();
      });
    sync = false;
  });
  assert.deepEqual(order, [
    ["onComplete", false],
    ["onError", false],
  ]);
});

test("with no onError/onComplete, the error is rethrown as uncaught", () => {
  const run = runFixture("no-error-handler.js");
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Error: unhandled/);
});

test("a throw inside an async callback a step started is not caught by ff", () => {
  const run = runFixture("async-throw.js");
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Error: async throw/);
  assert.doesNotMatch(run.stdout, /onError ran/);
});

test("timeout() fails a chain whose slot never calls back", async () => {
  const out = await settle(() => {
    const f = ff(() => {
      f.slot();
    });
    return f.timeout(20);
  });
  assert.equal(out.handler, "onError");
  assert.equal(out.err.message, "ff timeout");
});
