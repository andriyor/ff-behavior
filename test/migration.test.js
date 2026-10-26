// Each test runs an ff chain and its async/await rewrite from skills/migrate-ff
// and checks they end the same way.
const test = require("node:test");
const assert = require("node:assert/strict");
const { promisify, callbackify } = require("node:util");
const { ff, settle, later, wait } = require("../lib/helpers");

const getA = (id, cb) => later("A" + id, 5)(cb);
const getB = (id, cb) => later("B" + id, 1)(cb);
const bad = (id, cb) => setTimeout(() => cb(new Error("bad " + id)), 3);
const twoValues = (cb) => setTimeout(() => cb(null, 1, 2), 3);
const plain = (cb) => setTimeout(() => cb(false), 3);

// Same shape as settle(), for an async function.
const outcome = (promise) =>
  promise.then(
    (value) => ({ handler: "onSuccess", values: [value] }),
    (err) => ({ handler: "onError", message: err.message })
  );
const ffOutcome = async (build) => {
  const out = await settle(build);
  return out.handler === "onError" ? { handler: "onError", message: out.err.message } : out;
};

test("parallel slots become Promise.all, args in slot order", async () => {
  const before = await ffOutcome(() => {
    const f = ff(
      () => {
        getA(1, f.slot());
        getB(1, f.slot());
      },
      (a, b) => f.pass(a + b)
    );
    return f;
  });
  const after = await outcome(
    (async () => {
      const [a, b] = await Promise.all([promisify(getA)(1), promisify(getB)(1)]);
      return a + b;
    })()
  );
  assert.deepEqual(after, before);
  assert.deepEqual(after.values, ["A1B1"]);
});

test("a slot error becomes a rejection of Promise.all", async () => {
  const before = await ffOutcome(() => {
    const f = ff(
      () => {
        bad(1, f.slot());
        getA(1, f.slot());
      },
      () => f.pass("unreachable")
    );
    return f;
  });
  const after = await outcome(
    (async () => {
      await Promise.all([promisify(bad)(1), promisify(getA)(1)]);
      return "unreachable";
    })()
  );
  assert.deepEqual(after, before);
});

test("return f.succeed(v) becomes return v", async () => {
  const before = await ffOutcome(() => {
    const f = ff(
      () => getA(1, f.slot()),
      (a) => {
        if (a) return f.succeed("early");
        f.pass("late");
      },
      () => f.pass("step3")
    );
    return f;
  });
  const after = await outcome(
    (async () => {
      const a = await promisify(getA)(1);
      if (a) return "early";
      return "late";
    })()
  );
  assert.deepEqual(after, before);
});

test("return f.fail(err) becomes throw err", async () => {
  const before = await ffOutcome(() => {
    const f = ff(() => f.fail(new Error("nope")));
    return f;
  });
  const after = await outcome(
    (async () => {
      throw new Error("nope");
    })()
  );
  assert.deepEqual(after, before);
});

test("slotMulti(2) needs a manual promise; promisify keeps only the first value", async () => {
  const before = await ffOutcome(() => {
    const f = ff(
      () => twoValues(f.slotMulti(2)),
      (x, y) => f.pass([x, y])
    );
    return f;
  });
  const after = await outcome(
    new Promise((resolve, reject) => twoValues((err, a, b) => (err ? reject(err) : resolve([a, b]))))
  );
  assert.deepEqual(after, before);
  assert.equal(await promisify(twoValues)(), 1);
});

test("slotPlain() becomes new Promise(resolve), first arg is the value", async () => {
  const before = await ffOutcome(() => {
    const f = ff(
      () => plain(f.slotPlain()),
      (v) => f.pass(v)
    );
    return f;
  });
  const after = await outcome(new Promise((resolve) => plain(resolve)));
  assert.deepEqual(after, before);
  assert.deepEqual(after.values, [false]);
});

test("group() over a list becomes Promise.all(map), including the empty list", async () => {
  for (const items of [[1, 2, 3], []]) {
    const before = await ffOutcome(() => {
      const f = ff(
        () => {
          const g = f.group();
          items.forEach((i) => getA(i, g.slot()));
        },
        (arr) => f.pass(arr)
      );
      return f;
    });
    const after = await outcome(Promise.all(items.map((i) => promisify(getA)(i))));
    assert.deepEqual(after, before);
  }
});

test("callbackify keeps a (err, result) caller API", async () => {
  const fnAsync = async (id) => {
    if (!id) throw new Error("no id");
    return "v" + id;
  };
  const fn = callbackify(fnAsync);
  const call = (id) => new Promise((resolve) => fn(id, (err, value) => resolve({ err: err && err.message, value })));
  assert.deepEqual(await call(1), { err: null, value: "v1" });
  assert.deepEqual(await call(0), { err: "no id", value: undefined });
});

test("behaviour change: a bare succeed() let later work run; return does not", async () => {
  let ffRan = false;
  await settle(() => {
    const f = ff(() => {
      f.succeed("x");
      setTimeout(() => {
        ffRan = true;
      }, 2);
    });
    return f;
  });
  let asyncRan = false;
  await (async () => {
    return "x";
    // eslint-disable-next-line no-unreachable
    setTimeout(() => {
      asyncRan = true;
    }, 2);
  })();
  await wait(10);
  assert.equal(ffRan, true);
  assert.equal(asyncRan, false);
});
