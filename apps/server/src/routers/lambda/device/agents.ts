import {
  type HeterogeneousAgentScanMap,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
} from '@lobechat/heterogeneous-agents';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { deviceGateway } from '@/server/services/deviceGateway';

import { deviceProcedure } from './procedures';

// Derive the zod enum from the canonical config so new platforms are
// automatically covered without touching this file.
const remotePlatformEnum = z.enum(
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map((c) => c.type) as [
    (typeof REMOTE_HETEROGENEOUS_AGENT_CONFIGS)[number]['type'],
    ...(typeof REMOTE_HETEROGENEOUS_AGENT_CONFIGS)[number]['type'][],
  ],
);

const CAPABILITY_TIMEOUT_MS = 5_000;

const PROFILE_TIMEOUT_MS = 5_000;

// Batch scan probes every agent type (which + --version per binary, with
// login-shell PATH fallback), so it gets a longer budget than a single probe.
const SCAN_TIMEOUT_MS = 10_000;

export const agentsRouter = router({
  /**
   * Probe whether a specific agent platform (openclaw / hermes) is available
   * on the given device. Dispatches a `checkPlatformCapability` tool call to
   * the device via the gateway and waits up to 5 s for a response.
   */
  checkCapability: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        platform: remotePlatformEnum,
        scope: z.enum(['personal', 'workspace']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.executeToolCall(
        {
          deviceId: input.deviceId,
          userId: ctx.userId,
          workspaceId: input.scope === 'personal' ? undefined : ctx.workspaceId,
        },
        {
          apiName: 'checkPlatformCapability',
          arguments: JSON.stringify({ platform: input.platform }),
          identifier: 'local',
        },
        CAPABILITY_TIMEOUT_MS,
      );

      if (!result.success) {
        return { available: false, reason: result.error ?? 'Device tool call failed' };
      }

      try {
        return JSON.parse(result.content) as {
          available: boolean;
          reason?: string;
          version?: string;
        };
      } catch {
        return { available: false, reason: 'Invalid response from device' };
      }
    }),
  /**
   * Scan the given device for every known heterogeneous agent type in one
   * pass. Dispatches a `scanHeterogeneousAgents` tool call to the device via
   * the gateway; the device probes each binary and returns an availability
   * map. On gateway failure (offline device, older client without the tool)
   * returns an empty map plus the error so the client can distinguish
   * "nothing installed" from "scan failed".
   */
  scanAgents: deviceProcedure
    .input(z.object({ deviceId: z.string() }))
    .query(
      async ({ ctx, input }): Promise<{ agents: HeterogeneousAgentScanMap; error?: string }> => {
        const result = await deviceGateway.executeToolCall(
          { deviceId: input.deviceId, userId: ctx.userId, workspaceId: ctx.workspaceId },
          {
            apiName: 'scanHeterogeneousAgents',
            arguments: JSON.stringify({}),
            identifier: 'local',
          },
          SCAN_TIMEOUT_MS,
        );

        if (!result.success) {
          return { agents: {}, error: result.error ?? 'Device tool call failed' };
        }

        try {
          const parsed = JSON.parse(result.content) as { agents?: HeterogeneousAgentScanMap };
          return { agents: parsed.agents ?? {} };
        } catch {
          return { agents: {}, error: 'Invalid response from device' };
        }
      },
    ),
  /**
   * Claude Code subscription quota sampled by the device with its own local
   * credentials, so web clients can show live quota for a bound-device run.
   * `null` when the device is offline or its client predates this RPC.
   */
  getClaudeCodeQuota: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        env: z.record(z.string(), z.string()).optional(),
        force: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.claudeCodeQuota({
        deviceId: input.deviceId,
        env: input.env,
        force: input.force,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      return result ?? null;
    }),
  /** Query a heterogeneous CLI's model catalog on the device that will execute the agent. */
  listHeterogeneousAgentModels: deviceProcedure
    .input(
      z.object({
        args: z.array(z.string()).optional(),
        command: z.string().optional(),
        cwd: z.string().optional(),
        deviceId: z.string(),
        env: z.record(z.string(), z.string()).optional(),
        type: z.enum([
          'codebuddy',
          'codex',
          'cursor',
          'droid',
          'devin',
          'grok-build',
          'kimi-code',
          'opencode',
          'pi',
          'qoder',
          'trae',
        ]),
      }),
    )
    .query(async ({ ctx, input }) =>
      deviceGateway.listHeterogeneousAgentModels({
        args: input.args,
        command: input.command,
        cwd: input.cwd,
        deviceId: input.deviceId,
        env: input.env,
        type: input.type,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      }),
    ),
  /**
   * Fetch the agent profile (title, description, avatar) from the platform
   * installed on the given device. Used to pre-fill the creation modal.
   * Returns an empty object on failure or when the platform has no profile.
   */
  getAgentProfile: deviceProcedure
    .input(
      z.object({
        deviceId: z.string(),
        platform: remotePlatformEnum,
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await deviceGateway.executeToolCall(
        { deviceId: input.deviceId, userId: ctx.userId, workspaceId: ctx.workspaceId },
        {
          apiName: 'getAgentProfile',
          arguments: JSON.stringify({ platform: input.platform }),
          identifier: 'local',
        },
        PROFILE_TIMEOUT_MS,
      );

      if (!result.success) return {};

      try {
        return JSON.parse(result.content) as {
          avatar?: string;
          description?: string;
          title?: string;
        };
      } catch {
        return {};
      }
    }),
});
