// Fixture: a deliberate override layered on the authoritative env starts from that
// env, not from its inputs (spawnAgent.ts, TRAE ACP spawn).
import { detectCliCommand } from './resolveCliCommand';
import { TraeAcpSession } from './traeAcpSession';

export interface SpawnTraeOptions {
  command: string;
  cwd: string;
  env?: Record<string, string | undefined>;
}

export const spawnTraeAcpAgent = async (options: SpawnTraeOptions) => {
  const childEnv = { ...process.env, ...options.env };
  const commandStatus = await detectCliCommand('trae', options.command, childEnv);
  if (!commandStatus.available || !commandStatus.path) {
    throw new Error(`TRAE command does not expose the required ACP runtime: ${options.command}`);
  }

  return new TraeAcpSession({
    commandPath: commandStatus.path,
    cwd: options.cwd,
    // The login-shell PATH that found the command wins over the inherited one.
    env: {
      ...childEnv,
      ...(commandStatus.resolvedPathEnv ? { PATH: commandStatus.resolvedPathEnv } : {}),
    },
  });
};
