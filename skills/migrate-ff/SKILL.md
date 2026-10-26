---
name: migrate-ff
description: Migrate code that uses the `ff` async flow-control library (`ff(...)`, `f.slot()`, `f.pass()`, `f.succeed()`, `onSuccess`/`onError`) to async/await, keeping behaviour the same. Use when asked to migrate, convert, rewrite or remove ff, or to turn an ff chain into async/await or promises.
---

Rewrite `ff` chains as `async` functions without changing what the code does. ff has behaviour that is easy to "fix" by accident during a rewrite. Find it first, decide with the user, then convert.

## 1. Find and read every chain

- Find the call sites: `grep -rn "ff(" --include=*.js --include=*.ts . | grep -v node_modules`. Also find who imports the file, since the callers' API may need to stay callback-based.
- For one chain, write down: each step, what it slots or passes, how it ends (`succeed`, `fail`, last step), and which handlers are attached (`onSuccess`, `onError`, `onComplete`, `cb`).
- Read the tests that cover the function, if any. If there are none, write one against the **current** ff code before changing it (step 4).

## 2. Look for behaviour the rewrite would change

Stop and tell the user before converting any of these. They are bugs in the ff code, and an async rewrite silently changes them:

| In the ff code | What ff does | What async/await would do |
|----------------|--------------|---------------------------|
| `f.succeed()` / `f.fail()` **without `return`**, with code after it | The rest of the step still runs. Async work it starts still happens, but the results are ignored | `return` stops it, so that work no longer runs |
| `f.succeed()` / `f.fail()` called **inside an async callback**, while a slot of that step is still pending | The chain hangs: no handler ever runs | The function resolves or rejects |
| The same, with no slot pending | The call is ignored and the chain continues | The function returns early |
| A slot callback **called twice** | The second value wins, the next step runs once | The first value wins: a promise settles once, with `promisify` or `new Promise` |
| A `throw` inside an async callback a step started | Uncaught exception, `onError` does not run | Still uncaught unless the callback is wrapped in a promise |

For each one, ask whether to keep the old behaviour or fix it. Fixing is usually right, but it is a behaviour change, so it belongs in the commit message. Never reproduce a hang.

## 3. Convert

Rewrite step by step, top to bottom, in one `async` function.

| ff | async/await |
|----|-------------|
| `ff(step1, step2, ...)` | `async function name(...) { ... }` with each step's body in order |
| `getX(a, f.slot())` | `const x = await promisify(getX)(a)` (Node `util.promisify`), or the library's promise API if it has one |
| several `f.slot()` in one step | `const [x, y] = await Promise.all([getX(), getY()])`. They ran in parallel in ff, so keep them parallel |
| `f.pass(v)` | a local variable |
| `f.slotMulti(n)` | `new Promise((resolve, reject) => fn((err, a, b) => (err ? reject(err) : resolve([a, b]))))`. **Not** `promisify`: it keeps only the first value |
| `f.slotPlain()` | `new Promise((resolve) => fn(resolve))`. The first arg is a value, not an error |
| `f.wait()` | `await promisify(fn)(...)` and ignore the result |
| `f.waitPlain()` | drop it, or `await new Promise((resolve) => fn(() => resolve()))` if ordering matters |
| `const g = f.group(); items.forEach((i) => fn(i, g.slot()))` | `await Promise.all(items.map((i) => promisify(fn)(i)))` |
| `return f.succeed(v)` | `return v` |
| `return f.fail(err)` | `throw err` |
| a `throw` in a step | stays a `throw` |
| `.onSuccess(fn)` / `.onError(fn)` | the caller's `await` / `try`/`catch`, or `.then(fn, fn)` |
| `.onComplete(fn)` | `try { ... } finally { ... }` or `.then(ok, err)` |
| `f.timeout(ms)` | an `AbortSignal.timeout(ms)` passed to the call, or a `Promise.race` with a timer; keep the same error |
| `ff(ctx, ...)` (`this` = ctx) | use `ctx` by name, or an arrow function inside a method |

Keep these the same:
- **Parallel vs sequential.** Two slots in one step run at the same time; don't turn them into two `await`s in a row.
- **Argument order.** The next step got slots in creation order; destructure `Promise.all` in the same order.
- **What the caller sees.** If callers pass a `(err, result)` callback, export the async version and keep a wrapper: `module.exports.fn = util.callbackify(fnAsync)`. `callbackify` turns a falsy rejection into an `Error` with `.reason`, which ff didn't do.
- **Error values.** Rethrow the same error object, not a new one, unless the user asks.

## 4. Prove it

- Before converting, write a test that calls the function with the ff code and checks its result and its error. Run it.
- Convert, run the same test unchanged. It must pass.
- Add a case for each behaviour change agreed in step 2, asserting the **new** behaviour.
- Run the project's normal test and type-check commands.

## 5. Report

Say which chains were converted, which tests prove them, and every behaviour change from step 2 with the user's decision. Remove the `ff` dependency only when no `ff(` call sites are left.
