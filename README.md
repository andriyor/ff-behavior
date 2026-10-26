# ff-behavior

How the [`ff`](https://github.com/play-co/ff) async flow-control library actually behaves, as runnable tests. The upstream README documents the API but not what happens around `succeed()`/`fail()`, errors thrown from callbacks, or hung chains. Each statement below is backed by a test in [`test/`](test).

Checked against `ff@0.2.2` on Node 20. `0.2.1` has the same `lib/ff.js`; only `main` in `package.json` differs.

```bash
npm install
npm test
```

## Basics

```js
const ff = require("ff");

const f = ff(
  function () {                 // step 1
    db.get(id, f.slot());       // async value -> step 2 arg 1
    f.pass(options);            // sync value  -> step 2 arg 2
  },
  function (doc, options) {     // step 2 runs once every slot of step 1 has called back
    if (!doc) return f.succeed(null);   // end the chain early
    f.pass(doc.id);
  }
)
  .onSuccess(function (id) {})  // values passed by the last step that ran
  .onError(function (err) {});
```

## Methods on `f`

| Method | Next step receives |
|--------|--------------------|
| `f.slot()` | a Node callback `(err, value)`; `value` becomes the next arg, `err` ends the chain |
| `f.slotMulti(n)` | a Node callback with `n` values, `(err, v1, ..., vn)` |
| `f.slotPlain(n = 1)` | a callback with no error arg; the first `n` args are values, even an `Error` |
| `f.wait()` | a Node callback whose value is dropped; `err` still ends the chain |
| `f.waitPlain()` | a callback that is ignored completely |
| `f.pass(...values)` | the values, synchronously |
| `f.group()` | one arg: an array of the values from `group.slot()` calls, in call order (`[]` if none); an error in any of them ends the chain |
| `f.succeed(...values)` | ends the chain; `onSuccess` gets `values` |
| `f.fail(err)` | ends the chain; `onError` gets `err` |
| `f.next(step)` | appends a step |
| `f.timeout(ms)` | `onError(new Error("ff timeout"))` if the chain is not done in `ms` |

- Next-step args are in the order the slots and `pass()` calls were made, not the order the callbacks fire.
- A step that registers no slot and calls no `pass()` leads to the next step with no args.
- `ff(ctx, step1, ...)` binds `this` to `ctx` in every step.

## Result handlers

- `onSuccess(...values)` runs only on success, `onError(err)` only on error, `onComplete(err, ...values)` always (`err` is `null` on success).
- Handlers run asynchronously after the chain ends, in the order they were registered.
- With no `onError` or `onComplete`, an error is rethrown as an uncaught exception.
- A `throw` inside a step is caught and sent to `onError`. A `throw` inside an async callback that a step started is not caught; it becomes an uncaught exception.
- The first error wins; later slot callbacks are ignored.

## Gotchas

### `succeed()` and `fail()` don't stop the step

They mark the chain finished, but the rest of the step function keeps running. Async work it starts afterwards still runs, and its results are ignored. Always write `return f.succeed(...)` / `return f.fail(...)`.

```js
const f = ff(function () {
  if (cached) {
    f.succeed(cached);   // missing return
  }
  expensiveFetch(f.slot());   // still runs; its result is thrown away
});
```

### `succeed()` and `fail()` only work directly in a step

Called from an async callback after the step has returned:

- If a slot of that step is still pending, **the chain hangs**: no further step and no handler ever runs. ff marks the step done and then ignores the slot when it calls back.
- If no slot is pending, the call is ignored and the chain continues as if it was never made.

From a callback, report errors through the slot's `err` argument instead:

```js
const f = ff(function () {
  const cb = f.slot();
  client.get(url, (err, res) => {
    if (err) return cb(err);          // not f.fail(err)
    cb(null, res.body);
  });
});
```

### Other

- A slot callback called twice: the second value wins and the next step runs once.
- `f.timeout()` is the only guard against a slot that never calls back. Without it the chain, and anything waiting on it, hangs silently.

## Migrating to async/await

[`skills/migrate-ff/SKILL.md`](skills/migrate-ff/SKILL.md) is a step-by-step guide (and a [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills)): find each chain, flag the behaviour above that a rewrite would change, convert with the mapping table, and prove it with a test written before the change. [`test/migration.test.js`](test/migration.test.js) checks the main rows of that table: parallel slots, early exit, errors, `slotMulti`, `slotPlain`, `group` and `callbackify`.

To use it as a skill:

```bash
ln -s "$PWD/skills/migrate-ff" ~/.claude/skills/migrate-ff
```

## Layout

- `test/slots.test.js`: slots, `pass`, `group`, `wait`/`slotPlain`/`waitPlain`, context, `next`
- `test/succeed-fail.test.js`: early exit, and `succeed`/`fail` from async callbacks
- `test/errors-handlers.test.js`: thrown errors, handler order, uncaught errors, `timeout`
- `test/migration.test.js`: each ff pattern and its async/await rewrite end the same way
- `skills/migrate-ff/SKILL.md`: a Claude Code skill for migrating ff code to async/await
- `fixtures/`: scripts run in a child process for behaviour that ends in an uncaught exception
- `lib/helpers.js`: `settle()` runs a chain and reports which handler ran, or `"none"` if it hung
