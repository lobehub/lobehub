import { readFileSync } from 'node:fs';

import type { UserInterventionConfig } from '@lobechat/types';
import { type Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import type { AgentRunOutcome } from '../../utils/agentRunOutcome';
import { AGENT_RUN_EXIT_CODES } from '../../utils/agentRunOutcome';
import { replayAgentEvents } from '../../utils/agentStream';
import { resolveLocalDeviceId } from '../../utils/device';
import { outputJson } from '../../utils/format';
import { log, setVerbose } from '../../utils/logger';
import { followAgentRun } from './followRun';
import { pollAgentRunStatus, probeRunOutcome, RUN_POLL_INTERVAL_MS } from './runStatus';

/**
 * Start a run, retrying without `streamFeatures` on a server old enough to
 * validate its input strictly: the CLI ships independently of the server, and
 * `streamFeatures` is an optional key that such a server rejects outright.
 */
const startAgentRun = async (
  client: Awaited<ReturnType<typeof getTrpcClient>>,
  input: Record<string, any>,
) => {
  try {
    return await client.aiAgent.execAgent.mutate(input as any);
  } catch (error) {
    const { data, message } = (error ?? {}) as { data?: { code?: string }; message?: unknown };
    if (
      data?.code !== 'BAD_REQUEST' ||
      typeof message !== 'string' ||
      !message.includes('unrecognized_keys') ||
      !message.includes('streamFeatures')
    ) {
      throw error;
    }
    const { streamFeatures: _rejected, ...legacyInput } = input;
    return await client.aiAgent.execAgent.mutate(legacyInput as any);
  }
};

export function registerAgentRunCommand(agent: Command) {
  agent
    .command('run')
    .description('Run an agent with a prompt')
    .option('-a, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-p, --prompt <text>', 'User prompt')
    .option('-t, --topic-id <id>', 'Reuse an existing topic')
    .option('--no-auto-start', 'Do not auto-start the agent')
    .option(
      '--device <target>',
      'Target device ID, or use "local" for the current connected device',
    )
    .option(
      '--no-headless',
      "Disable headless mode: tool calls that need approval park the run for a human (default: headless — tools auto-run, matching the CLI's non-interactive nature). The CLI does not wait for that approval; it returns with exit code 2 and the run continues once it is answered in LobeHub",
    )
    .option(
      '--tool <id>',
      "Enable a tool for this run on top of the agent's own, like @-mentioning it in chat (repeatable)",
      collectId,
    )
    .option(
      '--skill <id>',
      'Load a skill for this run and the rest of its topic, like selecting it in chat (repeatable)',
      collectId,
    )
    .option('--json', 'Output full JSON event stream')
    .option('--detach', 'Start the operation and return its IDs without waiting for events')
    .option('-v, --verbose', 'Show detailed tool call info')
    .option('--replay <file>', 'Replay events from a saved JSON file (offline)')
    .option(
      '--timeout <seconds>',
      'Stop waiting after this many seconds (exit code 3; the run keeps going server-side). Default: wait as long as the server reports the run active',
      parsePositiveSeconds,
    )
    .addHelpText(
      'after',
      `
Exit codes:
  0  the run finished (done)
  1  the run failed or was interrupted
  2  the run is paused waiting for human approval / input
  3  the outcome could not be confirmed (no or unreadable status, status checks kept failing, or --timeout reached)`,
    )
    .action(
      async (options: {
        agentId?: string;
        autoStart?: boolean;
        device?: string;
        detach?: boolean;
        headless?: boolean;
        json?: boolean;
        prompt?: string;
        replay?: string;
        skill?: string[];
        slug?: string;
        timeout?: number;
        tool?: string[];
        topicId?: string;
        verbose?: boolean;
      }) => {
        if (options.verbose) setVerbose(true);

        // Replay mode: render from saved JSON file, no network needed
        if (options.replay) {
          const data = readFileSync(options.replay, 'utf8');
          const events = JSON.parse(data);
          const replayed = replayAgentEvents(events, {
            json: options.json,
            verbose: options.verbose,
          });
          // A recording without a terminal event cannot tell how the run ended.
          const replayExitCode = AGENT_RUN_EXIT_CODES[(replayed ?? { kind: 'unknown' }).kind];
          if (replayExitCode !== 0) process.exitCode = replayExitCode;
          return;
        }

        if (!options.agentId && !options.slug) {
          log.error('Either --agent-id or --slug is required.');
          process.exit(1);
          return;
        }
        if (!options.prompt) {
          log.error('--prompt is required.');
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();

        let deviceId: string | undefined;
        if (options.device !== undefined) {
          if (options.device === 'local') {
            deviceId = resolveLocalDeviceId();
            if (!deviceId) {
              log.error(
                "No local device found. Run 'lh connect' first, then retry with --device local.",
              );
              process.exit(1);
              return;
            }
          } else {
            deviceId = options.device;
          }

          const devices = await client.device.listDevices.query();
          const matchedDevice = devices.find(
            (device: { deviceId?: string; online?: boolean }) => device.deviceId === deviceId,
          );
          if (!matchedDevice) {
            log.error(`Device "${deviceId}" was not found. Check 'lh device list' and try again.`);
            process.exit(1);
            return;
          }
          if (!matchedDevice.online) {
            log.error(
              options.device === 'local'
                ? `Local device "${deviceId}" is not online. Reconnect with 'lh connect' and try again.`
                : `Device "${deviceId}" is not online. Bring it online and try again.`,
            );
            process.exit(1);
            return;
          }
        }

        // 1. Exec agent to get operationId
        const input: Record<string, any> = {
          prompt: options.prompt,
          trigger: 'cli',
          // A group/supervisor run mirrors each member's events onto this
          // operation's socket. Declaring the feature is what makes the server
          // forward a member's terminal as the non-terminal `member_runtime_end`
          // instead of `agent_runtime_end` — the Gateway closes the session on
          // the latter, which would drop every later member and supervisor event
          // before this CLI could render it.
          streamFeatures: ['member_runtime_end'],
        };
        if (options.agentId) input.agentId = options.agentId;
        if (deviceId) input.deviceId = deviceId;
        if (options.slug) input.slug = options.slug;
        if (options.topicId) input.appContext = { topicId: options.topicId };
        if (options.autoStart === false) input.autoStart = false;
        if (options.tool?.length) input.selectedToolIds = options.tool;
        if (options.skill?.length) input.selectedSkillIds = options.skill;
        // When another agent launched this command, its environment carries the
        // operation the launcher's run belongs to (LOBEHUB_OPERATION_ID) — but
        // deliberately not its agent id or its topic, which device-dispatched
        // runs strip. Forward the operation so the target's conversation
        // attributes the turn to the launching agent; the server reads the topic
        // and agent from that operation row. A person running `lh` from a
        // terminal has no ambient operation, and nothing is stamped.
        const sourceOperationId = process.env.LOBEHUB_OPERATION_ID;
        if (sourceOperationId) input.sourceOperationId = sourceOperationId;
        // commander's --no-headless sets `headless` to false. Anything else
        // (undefined, true) → headless mode is on and tool calls auto-execute.
        if (options.headless !== false) {
          input.userInterventionConfig = { approvalMode: 'headless' };
        } else {
          // --no-headless must actually disable headless mode. Omitting the
          // config here is not enough: the server falls back to
          // `{ approvalMode: 'headless' }` for every run that does not carry
          // one (the default for cron and bot triggers), so an omitted config
          // re-enables exactly what the flag promised to turn off. Resolve the
          // user's saved tool approval mode instead, and fall back to `manual`
          // — the server's documented default — when the state read fails or
          // the setting is unset. Tools that need approval then park the run
          // for a human, as this flag's help text promises.
          const savedConfig = (
            (await client.user.getUserState.query().catch(() => undefined)) as
              | { settings?: { tool?: { humanIntervention?: UserInterventionConfig } } }
              | undefined
          )?.settings?.tool?.humanIntervention;
          // The Web tool-intervention selector treats a persisted 'headless' as
          // a backend-only value and shows 'auto-run' instead (settings
          // selectors/toolIntervention.ts). Mirror that here so a legacy or raw
          // persisted 'headless' can never leak back into a run the user
          // explicitly asked to supervise with --no-headless — in headless mode
          // the agent converts intervention-required calls into blocked results
          // instead of parking them for a human.
          const approvalMode =
            savedConfig?.approvalMode === 'auto-run' || savedConfig?.approvalMode === 'allow-list'
              ? savedConfig.approvalMode
              : savedConfig?.approvalMode === 'headless'
                ? 'auto-run'
                : 'manual';
          // In allow-list mode the saved list must travel with the mode:
          // GeneralChatAgent defaults an omitted allowList to [], which would
          // park again every tool the user previously approved.
          input.userInterventionConfig = {
            approvalMode,
            ...(approvalMode === 'allow-list' ? { allowList: savedConfig?.allowList ?? [] } : {}),
          };
        }

        const result = await startAgentRun(client, input);
        const r = result as any;

        if (!r.success) {
          log.error(`Failed to start agent: ${r.error || r.message || 'Unknown error'}`);
          process.exit(1);
        }

        const operationId = r.operationId;
        if (options.detach) {
          const started = {
            autoStarted: r.autoStarted,
            operationId,
            status: r.status,
            topicId: r.topicId,
          };
          if (options.json) outputJson(started);
          else log.info(`Operation: ${pc.dim(operationId)} · Topic: ${pc.dim(r.topicId || 'n/a')}`);
          return;
        }
        if (!options.json) {
          log.info(`Operation: ${pc.dim(operationId)} · Topic: ${pc.dim(r.topicId || 'n/a')}`);
        }

        // 2. Follow the run over the agent gateway WebSocket
        const waitForRun = async (): Promise<AgentRunOutcome> => {
          try {
            return await followAgentRun(operationId, {
              json: options.json,
              // A quiet stream is checked against the run status rather than
              // treated as finished or failed — a long tool call can be silent.
              onStall: () => probeRunOutcome(client, operationId, { json: options.json }),
              verbose: options.verbose,
            });
          } catch (error) {
            // The live stream could not be followed at all — the run may still
            // be executing server-side, in --json mode too. Fall back to polling
            // the run status until it reaches a terminal state.
            log.warn(
              `Live stream unavailable (${(error as Error).message}). Polling run status every ${RUN_POLL_INTERVAL_MS / 1000}s…`,
            );
            return pollAgentRunStatus(client, operationId, { json: options.json });
          }
        };

        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        let didTimeOut = false;
        const timedOut =
          options.timeout === undefined
            ? undefined
            : new Promise<AgentRunOutcome>((resolve) => {
                timeoutTimer = setTimeout(() => {
                  didTimeOut = true;
                  log.error(
                    `Stopped waiting after ${options.timeout}s (--timeout). The run may still be executing — check it with 'lh agent status ${operationId}'.`,
                  );
                  resolve({ kind: 'unknown' });
                }, options.timeout! * 1000);
              });

        const outcome = await (timedOut ? Promise.race([waitForRun(), timedOut]) : waitForRun());
        clearTimeout(timeoutTimer);

        const exitCode = AGENT_RUN_EXIT_CODES[outcome.kind];
        if (exitCode !== 0) {
          // A timeout leaves the stream / poll pending, so exit hard; otherwise
          // set the code and let stdout (possibly a large --json array) drain.
          if (didTimeOut) process.exit(exitCode);
          process.exitCode = exitCode;
        }
      },
    );
}

const collectId = (value: string, previous: string[] = []): string[] => [...previous, value];

function parsePositiveSeconds(value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new InvalidArgumentError('Expected a positive number of seconds.');
  }
  return seconds;
}
