import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// Compose forwards an unset `${VAR:-}` as `''`; blank means not configured.
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalPositiveInt = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().positive().optional(),
);

export const getAgentConfig = () => {
  return createEnv({
    runtimeEnv: {
      AGENT_ASYNC_SHELL: process.env.AGENT_ASYNC_SHELL,
      AGENT_ASYNC_SHELL_PARK_WINDOW_MS: process.env.AGENT_ASYNC_SHELL_PARK_WINDOW_MS,
      AGENT_ASYNC_SHELL_TIMEOUT_MS: process.env.AGENT_ASYNC_SHELL_TIMEOUT_MS,
    },

    server: {
      /**
       * Opt-in: a device `runCommand` that outlives its wait window parks the
       * operation instead of handing the model a `shell_id` to poll.
       * On: a device `runCommand` that outlives its wait window parks the
       * operation, and the device's completion report resumes it. Off (the
       * default): the model gets `shell_id` back and keeps polling with
       * `getCommandOutput`, as before.
       *
       * Default off because it changes what the model sees and depends on the
       * gateway understanding a parked operation.
       */
      AGENT_ASYNC_SHELL: z.enum(['true', 'false']).optional(),
      /**
       * How long the gateway's inactivity watchdog is told to hold for. Must
       * stay above `AGENT_ASYNC_SHELL_TIMEOUT_MS`: the server owns the real
       * timeout, this only stops the watchdog from killing a healthy wait.
       */
      AGENT_ASYNC_SHELL_PARK_WINDOW_MS: optionalPositiveInt,
      /** Server-side wait before a parked command is failed and resumed. */
      AGENT_ASYNC_SHELL_TIMEOUT_MS: optionalPositiveInt,
    },
  });
};

export const agentEnv = getAgentConfig();
