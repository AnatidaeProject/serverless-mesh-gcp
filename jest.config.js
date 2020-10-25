require("dotenv-flow").config({ path: __dirname, silent: true });
module.exports = {
    verbose: true,
    projects: [
        "<rootDir>/libs/moleculer-discoverer-firebase",
        "<rootDir>/libs/moleculer-transport-pubsub",
        "<rootDir>/libs/moleculer-transport-gcp-subscription",
        "<rootDir>/apps/functions",
        "<rootDir>/libs/service/math",
        "<rootDir>/libs/service-math",
    ],
};
