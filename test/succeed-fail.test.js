const test = require("node:test");
const assert = require("node:assert/strict");
const { ff, settle, later, wait } = require("../lib/helpers");

test("succeed() ends the chain and skips the remaining steps", async () => {
  let step2 = false;
  const out = await settle(() => {
    const f = ff(
      () => f.succeed("early"),
      () => {
        step2 = true;
      }
    );
    return f;
  });
  assert.deepEqual(out, { handler: "onSuccess", values: ["early"] });
  assert.equal(step2, false);
});

test("succeed() does not stop the step that calls it", async () => {
  let afterSucceed = false;
  await settle(() => {
    const f = ff(() => {
      f.succeed();
      afterSucceed = true;
    });
    return f;
  });
  assert.equal(afterSucceed, true);
});

test("async work started after a bare succeed() still runs; its result is ignored", async () => {
  let workRan = false;
  const out = await settle(() => {
    const f = ff(
      () => {
        f.succeed("first");
        setTimeout(() => {
          workRan = true;
        }, 5);
        later("ignored")(f.slot());
      },
      () => f.pass("step2 should not run")
    );
    return f;
  });
  await wait(20);
  assert.deepEqual(out, { handler: "onSuccess", values: ["first"] });
  assert.equal(workRan, true);
});

test("return f.succeed() is the safe form", async () => {
  let afterSucceed = false;
  await settle(() => {
    const f = ff(() => {
      return f.succeed();
      // eslint-disable-next-line no-unreachable
      afterSucceed = true;
    });
    return f;
  });
  assert.equal(afterSucceed, false);
});

test("fail() ends the chain with onError and also does not stop the step", async () => {
  let afterFail = false;
  const out = await settle(() => {
    const f = ff(
      () => {
        f.fail(new Error("nope"));
        afterFail = true;
      },
      () => f.pass("step2 should not run")
    );
    return f;
  });
  assert.equal(out.handler, "onError");
  assert.equal(out.err.message, "nope");
  assert.equal(afterFail, true);
});

test("succeed() from an async callback, with that step's slot still pending: the chain hangs", async () => {
  const out = await settle(() => {
    const f = ff(
      () => {
        const cb = f.slot();
        setTimeout(() => {
          f.succeed("too late");
          cb(null, "x");
        }, 5);
      },
      () => f.pass("step2")
    );
    return f;
  });
  assert.deepEqual(out, { handler: "none" });
});

test("fail() from an async callback, with a slot still pending: the chain hangs too", async () => {
  const out = await settle(() => {
    const f = ff(() => {
      const cb = f.slot();
      setTimeout(() => {
        f.fail(new Error("lost"));
        cb(null);
      }, 5);
    });
    return f;
  });
  assert.deepEqual(out, { handler: "none" });
});

test("succeed() from an async callback after its slot resolved is ignored", async () => {
  const out = await settle(() => {
    const f = ff(
      () => {
        const cb = f.slot();
        setTimeout(() => {
          cb(null, "x");
          f.succeed("ignored");
        }, 5);
      },
      (x) => f.pass("step2 got " + x)
    );
    return f;
  });
  assert.deepEqual(out, { handler: "onSuccess", values: ["step2 got x"] });
});

test("from a callback, report errors through the slot instead of fail()", async () => {
  const out = await settle(() => {
    const f = ff(
      () => {
        const cb = f.slot();
        setTimeout(() => cb(new Error("via slot")), 5);
      },
      () => f.pass("step2 should not run")
    );
    return f;
  });
  assert.equal(out.handler, "onError");
  assert.equal(out.err.message, "via slot");
});
