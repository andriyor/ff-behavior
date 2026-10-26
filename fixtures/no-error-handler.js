const ff = require("ff");

ff(() => {
  throw new Error("unhandled");
});
