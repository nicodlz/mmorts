const { copyFileSync } = require("node:fs");
const { join } = require("node:path");
copyFileSync(
  join(__dirname, "../src/default.map"),
  join(__dirname, "../dist/default.map"),
);
