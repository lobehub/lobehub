// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require('node:net');

const normalizeServerHostname = (env = process.env) => {
  const hostname = env.HOSTNAME;

  if (hostname && isIP(hostname) === 0) {
    env.HOSTNAME = '0.0.0.0';
  }
};

module.exports = { normalizeServerHostname };
