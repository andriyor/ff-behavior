const test = require("node:test");
const assert = require("node:assert/strict");
const { ff, settle, later } = require("../lib/helpers");

test("slot() passes a callback value to the next step", async () => {
  const out = await settle(() => {
    const f = ff(
      () => later("a")(f.slot()),
      (a) => f.pass(a + "!")
    );
    return f;
  });
  assert.deepEqual(out, { handler: "onSuccess", values: ["a!"] });
});

test("next-step args follow slot creation order, not callback order", async () => {
  const out = await settle(() => {
    const f = ff(
      () => {
        later("slow", 20)(f.slot());
        later("fast", 1)(f.slot());
      },
      (...args) => f.pass(args)
    );
    return f;
  });
  assert.deepEqual(out.values, [["slow", "fast"]]);
});

test("pass(), slotMulti(n) and slot() mix in call order", async () => {
  const out = await settle(() => {
    const f = ff(
      () => {
        f.pass("p");
        ((cb) => setTimeout(() => cb(null, 1, 2), 5))(f.slotMulti(2));
        later("s")(f.slot());
      },
      (...args) => f.pass(args)
    );
    return f;
  });
  assert.deepEqual(out.values, [["p", 1, 2, "s"]]);
});

test("a step with no slots and no pass() gives the next step no args", async () => {
  const out = await settle(() => {
    const f = ff(
      () => {},
      (...args) => f.pass(args.length)
    );
    return f;
  });
  assert.deepEqual(out.values, [0]);
});

test("wait() drops the value but still forwards errors", async () => {
  const ok = await settle(() => {
    const f = ff(
      () => {
        later("dropped")(f.wait());
        f.pass("kept");
      },
      (...args) => f.pass(args)
    );
    return f;
  });
  assert.deepEqual(ok.values, [["kept"]]);

  const failed = await settle(() => {
    const f = ff(() => ((cb) => cb(new Error("w")))(f.wait()));
    return f;
  });
  assert.equal(failed.handler, "onError");
  assert.equal(failed.err.message, "w");
});

test("slotPlain() treats the first callback arg as a value, even an Error", async () => {
  const out = await settle(() => {
    const f = ff(
      () => ((cb) => cb(new Error("just a value"), "second"))(f.slotPlain(2)),
      (a, b) => f.pass(a instanceof Error, b)
    );
    return f;
  });
  assert.deepEqual(out, { handler: "onSuccess", values: [true, "second"] });
});

test("waitPlain() ignores its callback args completely", async () => {
  const out = await settle(() => {
    const f = ff(
      () => ((cb) => cb(new Error("ignored")))(f.waitPlain()),
      (...args) => f.pass(args.length)
    );
    return f;
  });
  assert.deepEqual(out, { handler: "onSuccess", values: [0] });
});

test("group() collects group.slot() values into one array arg", async () => {
  const out = await settle(() => {
    const f = ff(
      () => {
        const group = f.group();
        later("x", 15)(group.slot());
        later("y", 1)(group.slot());
      },
      (arr) => f.pass(arr)
    );
    return f;
  });
  assert.deepEqual(out.values, [["x", "y"]]);
});

test("an empty group() gives the next step []", async () => {
  const out = await settle(() => {
    const f = ff(
      () => f.group(),
      (arr) => f.pass(arr)
    );
    return f;
  });
  assert.deepEqual(out.values, [[]]);
});

test("a slot callback called twice: the second value wins, next step runs once", async () => {
  let runs = 0;
  const out = await settle(() => {
    const f = ff(
      () => {
        const cb = f.slot();
        cb(null, 1);
        cb(null, 2);
      },
      (v) => {
        runs++;
        f.pass(v);
      }
    );
    return f;
  });
  assert.deepEqual(out.values, [2]);
  assert.equal(runs, 1);
});

test("ff(ctx, ...steps) binds this to ctx in every step", async () => {
  const ctx = { name: "ctx" };
  const out = await settle(() => {
    const f = ff(ctx, function () {
      f.pass(this.name);
    });
    return f;
  });
  assert.deepEqual(out.values, ["ctx"]);
});

test("next() appends a step after the chain is created", async () => {
  const out = await settle(() => {
    const f = ff(() => f.pass(1));
    f.next((v) => f.pass(v + 1));
    return f;
  });
  assert.deepEqual(out.values, [2]);
});
