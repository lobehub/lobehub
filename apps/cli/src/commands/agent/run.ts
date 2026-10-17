import { readFileSync } from 'node:fs';

import { type Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { getAgentStreamAuthInfo } from '../../api/http';
import { resolveAgentGatewayUrl } from '../../settings';
import type { AgentRunOutcome } from '../../utils/agentRunOutcome';
import { AGENT_RUN_EXIT_CODES } from '../../utils/agentRunOutcome';
import {
  replayAgentEvents,
  streamAgentEvents,
  streamAgentEventsViaWebSocket,
} from '../../utils/agentStream';
import { resolveLocalDeviceId } from '../../utils/device';
import { outputJson } from '../../utils/format';
import { log, setVerbose } from '../../utils/logger';
import { pollAgentRunStatus, probeRunOutcome, RUN_POLL_INTERVAL_MS } from './runStatus';

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
    .option('--sse', 'Force SSE stream instead of WebSocket gateway')
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
        sse?: boolean;
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
        const input: Record<string, any> = { prompt: options.prompt, trigger: 'cli' };
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
        }

        const result = await client.aiAgent.execAgent.mutate(input as any);
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

        // 2. Connect to stream (WebSocket via Gateway, or fallback to SSE)
        const { serverUrl, headers, token, tokenType } = await getAgentStreamAuthInfo();
        const agentGatewayUrl = options.sse ? undefined : resolveAgentGatewayUrl();

        const waitForRun = async (): Promise<AgentRunOutcome> => {
          let streamed: AgentRunOutcome | undefined;
          try {
            if (agentGatewayUrl) {
              streamed = await streamAgentEventsViaWebSocket({
                gatewayUrl: agentGatewayUrl,
                json: options.json,
                // A quiet stream is checked against the run status rather than
                // treated as finished or failed — a long tool call can be silent.
                onStall: () => probeRunOutcome(client, operationId, { json: options.json }),
                operationId,
                serverUrl,
                token,
                tokenType,
                verbose: options.verbose,
              });
            } else {
              const streamUrl = `${serverUrl}/api/agent/stream?operationId=${encodeURIComponent(operationId)}`;
              streamed = await streamAgentEvents(streamUrl, headers, {
                json: options.json,
                // SSE heartbeats keep the response open even when the terminal
                // event was published before this subscription (in-memory event
                // manager), so a quiet stream is checked against the run status.
                onStall: () => probeRunOutcome(client, operationId, { json: options.json }),
                verbose: options.verbose,
              });
            }
          } catch (error) {
            // The live stream (gateway WS / SSE) dropped before the run finished —
            // the run may still be executing server-side, in --json mode too.
            // Fall back to polling the run status until it reaches a terminal state.
            log.warn(
              `Live stream unavailable (${(error as Error).message}). Polling run status every ${RUN_POLL_INTERVAL_MS / 1000}s…`,
            );
            return pollAgentRunStatus(client, operationId, { json: options.json });
          }

          // The stream closed without a terminal event: that is not a success
          // signal, so ask the server how the run actually ended.
          return streamed ?? pollAgentRunStatus(client, operationId, { json: options.json });
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
