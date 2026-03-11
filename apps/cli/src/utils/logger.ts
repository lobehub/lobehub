/* eslint-disable no-console */
import pc from 'picocolors';

let verbose = false;

export const setVerbose = (v: boolean) => {
  verbose = v;
};

const timestamp = (): string => {
  const now = new Date();
  return pc.dim(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
  );
};

export const log = {
  debug: (msg: string, ...args: unknown[]) => {
    if (verbose) {
      console.log(`${timestamp()} ${pc.dim('[DEBUG]')} ${msg}`, ...args);
    }
  },

  error: (msg: string, ...args: unknown[]) => {
    console.error(`${timestamp()} ${pc.red('[ERROR]')} ${pc.red(msg)}`, ...args);
  },

  heartbeat: () => {
    if (verbose) {
      process.stdout.write(pc.dim('.'));
    }
  },

  info: (msg: string, ...args: unknown[]) => {
    console.log(`${timestamp()} ${pc.blue('[INFO]')} ${msg}`, ...args);
  },

  status: (status: string) => {
    const color =
      status === 'connected' ? pc.green : status === 'disconnected' ? pc.red : pc.yellow;
    console.log(`${timestamp()} ${pc.bold('[STATUS]')} ${color(status)}`);
  },

  toolCall: (apiName: string, requestId: string, args?: string) => {
    console.log(
      `${timestamp()} ${pc.magenta('[TOOL]')} ${pc.bold(apiName)} ${pc.dim(`(${requestId})`)}`,
    );
    if (args && verbose) {
      console.log(`  ${pc.dim(args)}`);
    }
  },

  toolResult: (requestId: string, success: boolean, content?: string) => {
    const icon = success ? pc.green('OK') : pc.red('FAIL');
    console.log(`${timestamp()} ${pc.magenta('[RESULT]')} ${icon} ${pc.dim(`(${requestId})`)}`);
    if (content && verbose) {
      const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
      console.log(`  ${pc.dim(preview)}`);
    }
  },

  warn: (msg: string, ...args: unknown[]) => {
    console.warn(`${timestamp()} ${pc.yellow('[WARN]')} ${pc.yellow(msg)}`, ...args);
  },
};
