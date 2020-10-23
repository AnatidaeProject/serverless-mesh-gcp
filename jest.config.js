require('dotenv-flow').config({ path: __dirname, silent: true });
module.exports = {
  projects: [
    '<rootDir>/libs/moleculer-discoverer-firebase',
    '<rootDir>/libs/moleculer-transport-pubsub',
    '<rootDir>/libs/moleculer-transport-gcp-subscription',
    '<rootDir>/apps/functions',
  ],
};
