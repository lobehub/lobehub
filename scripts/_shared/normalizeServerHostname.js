// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require('node:net');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { hostname: getRuntimeHostname } = require('node:os');

/**
 * Replaces only the runtime-injected container hostname with an all-interface bind address.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env Server environment variables.
 * @param {string} runtimeHostname Hostname reported by the current operating-system runtime.
 */
const normalizeServerHostname = (env = process.env, runtimeHostname = getRuntimeHostname()) => {
  const hostname = env.HOSTNAME;

  // Preserve explicit DNS names and IP bind addresses configured by the operator.
  if (hostname === runtimeHostname && isIP(hostname) === 0) {
    env.HOSTNAME = '0.0.0.0';
  }
};

module.exports = { normalizeServerHostname };
