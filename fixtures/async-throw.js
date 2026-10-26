const ff = require("ff");

const f = ff(() => {
  f.slot();
  setTimeout(() => {
    throw new Error("async throw");
  }, 5);
});
f.onError(() => console.log("onError ran"));
