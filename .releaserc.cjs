const config = require('@lobehub/semantic-release-config').default;

config.branches = [
  'main',
  {
    name: 'next',
    prerelease: true,
  },
];

config.plugins.push([
  '@semantic-release/exec',
  {
    prepareCmd: 'npm run workflow:changelog',
  },
]);

module.exports = config;
