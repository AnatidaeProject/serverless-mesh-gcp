const nxPreset = require("@nrwl/jest/preset");
require("dotenv-flow").config({ path: __dirname, silent: true });
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS?.startsWith(__dirname)) {
    process.env["GOOGLE_APPLICATION_CREDENTIALS"] =
        __dirname + "/" + process.env.GOOGLE_APPLICATION_CREDENTIALS;
}
module.exports = { ...nxPreset };
