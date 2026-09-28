import path from 'node:path';

/** Live tests must opt in to writes and select their own account home and server. */
export function validateE2EEnvironment(env: NodeJS.ProcessEnv) {
  if (env.LOBEHUB_E2E_ALLOW_WRITES !== '1') {
    throw new Error('Live E2E writes real data. Set LOBEHUB_E2E_ALLOW_WRITES=1 to opt in.');
  }

  const home = env.LOBEHUB_CLI_HOME?.trim();
  if (!home || path.basename(path.normalize(home)) === '.lobehub') {
    throw new Error('Set LOBEHUB_CLI_HOME to a dedicated test account directory, not .lobehub.');
  }

  if (!env.LOBEHUB_SERVER) throw new Error('Set LOBEHUB_SERVER explicitly for live E2E.');
  const server = new URL(env.LOBEHUB_SERVER);
  if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password) {
    throw new Error('LOBEHUB_SERVER must be an HTTP(S) URL without credentials.');
  }
}
