import { describe, expect, it } from 'vitest';

import { type RuntimeSelectionContext, selectRuntimeType } from '../dispatch/agentDispatcher';

const heteroProvider = { command: 'claude', type: 'claude-code' as const };
const apiHeteroProvider = {
  apiConfig: { model: 'claude-test', providerId: 'anthropic' },
  authMode: 'api' as const,
  command: 'claude',
  type: 'claude-code' as const,
};
const serverDefaultApiHeteroProvider = {
  apiConfig: { model: 'claude-sonnet', source: 'server-default' as const },
  authMode: 'api' as const,
  command: 'claude',
  type: 'claude-code' as const,
};
const codexApiHeteroProvider = {
  apiConfig: { model: 'gpt-test', providerId: 'openai' },
  authMode: 'api' as const,
  command: 'codex',
  type: 'codex' as const,
};
const remoteHeteroProvider = { type: 'openclaw' as const };
const remoteHeteroProviderHermes = { type: 'hermes' as const };
const codexCliProvider = { command: 'codex', type: 'codex' as const };

describe('selectRuntimeType', () => {
  describe('on web (isDesktop = false)', () => {
    const opts = { isDesktop: false };

    it('returns gateway when no signal is set (there is no client runtime)', () => {
      expect(selectRuntimeType({}, opts)).toBe('gateway');
    });

    it('keeps device-only model providers (Ollama / LM Studio) on gateway', () => {
      // The agent's model provider is deliberately not a routing input: a
      // provider only this device can reach still runs its loop on the server,
      // which relays each LLM attempt back to this client (`agent_llm_relay`).
      // There is no client runtime to fall back to (#19624).
      const localModelAgent: RuntimeSelectionContext & { model: string; provider: string } = {
        model: 'qwen3',
        provider: 'lmstudio',
      };
      expect(selectRuntimeType(localModelAgent, opts)).toBe('gateway');
    });

    it('routes local heterogeneousProvider to gateway on web', () => {
      expect(selectRuntimeType({ heterogeneousProvider: heteroProvider }, opts)).toBe('gateway');
      expect(selectRuntimeType({ heterogeneousProvider: heteroProvider }, opts)).toBe('gateway');
    });

    it('routes remote platform agents (openclaw/hermes) to gateway on web', () => {
      expect(selectRuntimeType({ heterogeneousProvider: remoteHeteroProvider }, opts)).toBe(
        'gateway',
      );
      expect(selectRuntimeType({ heterogeneousProvider: remoteHeteroProviderHermes }, opts)).toBe(
        'gateway',
      );
    });

    it('routes Codex device execution to gateway on Android (isDesktop=false)', () => {
      // Android cannot spawn the CLI in-process. A bound macOS device must go
      // through Agent Gateway.
      expect(
        selectRuntimeType(
          {
            boundDeviceId: 'macos-device',
            executionTarget: 'device',
            heterogeneousProvider: codexCliProvider,
          },
          opts,
        ),
      ).toBe('gateway');
      expect(
        selectRuntimeType(
          {
            boundDeviceId: 'macos-device',
            executionTarget: 'device',
            heterogeneousProvider: codexCliProvider,
          },
          opts,
        ),
      ).toBe('gateway');
    });
  });

  describe('on desktop (isDesktop = true)', () => {
    const opts = { isDesktop: true };

    it('returns hetero for local CLI agents (claude-code, codex)', () => {
      expect(selectRuntimeType({ heterogeneousProvider: heteroProvider }, opts)).toBe('hetero');
      expect(selectRuntimeType({ heterogeneousProvider: heteroProvider }, opts)).toBe('hetero');
    });

    it('routes remote platform agents (openclaw/hermes) to gateway even on desktop', () => {
      // openclaw and hermes use device gateway, not desktop subprocess — must not go to hetero
      expect(selectRuntimeType({ heterogeneousProvider: remoteHeteroProvider }, opts)).toBe(
        'gateway',
      );
      expect(selectRuntimeType({ heterogeneousProvider: remoteHeteroProviderHermes }, opts)).toBe(
        'gateway',
      );
    });

    it('falls back to gateway when no hetero provider', () => {
      expect(selectRuntimeType({}, opts)).toBe('gateway');
    });
  });

  describe('regression: the browser client runtime is gone', () => {
    it.each([false, true])(
      'resolves a non-hetero agent without gateway context to gateway (isDesktop=%s)',
      (isDesktop) => {
        const result = selectRuntimeType({}, { isDesktop });
        expect(result).toBe('gateway');
        expect(result).not.toBe('client');
      },
    );

    it('ignores a stale isGatewayMode=false signal from old callers', () => {
      const legacyCtx = { isGatewayMode: false } as RuntimeSelectionContext;
      expect(selectRuntimeType(legacyCtx, { isDesktop: false })).toBe('gateway');
      expect(selectRuntimeType(legacyCtx, { isDesktop: true })).toBe('gateway');
    });
  });

  describe('executionTarget routing for local CLI hetero', () => {
    it('allows Claude Code API mode only for Desktop local execution', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: apiHeteroProvider,
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'sandbox',
            heterogeneousProvider: apiHeteroProvider,
          },
          { isDesktop: true },
        ),
      ).toThrow(/Desktop local execution/);

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: apiHeteroProvider,
          },
          { isDesktop: false },
        ),
      ).toThrow(/Desktop local execution/);
    });

    it('allows the deployment-default API source only for Desktop local execution', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: serverDefaultApiHeteroProvider,
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'sandbox',
            heterogeneousProvider: serverDefaultApiHeteroProvider,
          },
          { isDesktop: true },
        ),
      ).toThrow(/Desktop local execution/);

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: serverDefaultApiHeteroProvider,
          },
          { isDesktop: false },
        ),
      ).toThrow(/Desktop local execution/);
    });

    it('applies the same Desktop-local guard to Codex provider binding', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: codexApiHeteroProvider,
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'sandbox',
            heterogeneousProvider: codexApiHeteroProvider,
          },
          { isDesktop: true },
        ),
      ).toThrow(/Desktop local execution/);
    });

    it.each(['gateway'] as const)(
      'rejects API mode inherited from the %s parent runtime',
      (parentRuntime) => {
        expect(() =>
          selectRuntimeType(
            {
              executionTarget: 'local',
              heterogeneousProvider: apiHeteroProvider,
              parentRuntime,
            },
            { isDesktop: true },
          ),
        ).toThrow(/Desktop local execution/);
      },
    );

    it('allows API mode inherited from the Desktop hetero parent runtime', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: apiHeteroProvider,
            parentRuntime: 'hetero',
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');
    });

    it.each(['gateway', 'hetero'] as const)(
      'rejects every %s parent runtime for API mode on web',
      (parentRuntime) => {
        expect(() =>
          selectRuntimeType(
            {
              executionTarget: 'local',
              heterogeneousProvider: apiHeteroProvider,
              parentRuntime,
            },
            { isDesktop: false },
          ),
        ).toThrow(/Desktop local execution/);
      },
    );

    it('routes to gateway when executionTarget = device on desktop', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'device',
            heterogeneousProvider: heteroProvider,
          },
          { isDesktop: true },
        ),
      ).toBe('gateway');
    });

    it('routes to gateway even when the bound device IS this desktop (observability choice)', () => {
      // `device` vs `local` on the same machine is a user-facing semantic
      // choice, not a transport detail: gateway dispatch streams progress
      // through the server so other clients (mobile/web) can follow the run,
      // while `local` IPC is faster but desktop-session-only. NEVER collapse
      // `device(currentDeviceId)` into the in-process path.
      expect(
        selectRuntimeType(
          {
            boundDeviceId: 'this-desktop-device-id',
            executionTarget: 'device',
            heterogeneousProvider: heteroProvider,
          },
          { isDesktop: true },
        ),
      ).toBe('gateway');
    });

    it('routes to gateway when executionTarget = sandbox on desktop', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'sandbox',
            heterogeneousProvider: heteroProvider,
          },
          { isDesktop: true },
        ),
      ).toBe('gateway');
    });

    it('keeps hetero when executionTarget = local on desktop', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: heteroProvider,
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');
    });

    it('falls back to gateway when executionTarget = local on web (sandbox or bound device)', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: heteroProvider,
          },
          { isDesktop: false },
        ),
      ).toBe('gateway');
    });

    it('preserves legacy default when executionTarget is unset (desktop → hetero, web → gateway)', () => {
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider }, { isDesktop: true }),
      ).toBe('hetero');
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider }, { isDesktop: false }),
      ).toBe('gateway');
    });
  });

  describe('workspaceScoped — unmerged shared configs never spawn in-process on the member desktop', () => {
    it('routes desktop local / unset targets to gateway for workspace-scoped configs', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: heteroProvider,
            workspaceScoped: true,
          },
          { isDesktop: true },
        ),
      ).toBe('gateway');
      expect(
        selectRuntimeType(
          { heterogeneousProvider: heteroProvider, workspaceScoped: true },
          { isDesktop: true },
        ),
      ).toBe('gateway');
    });
  });

  describe('isWorkspaceAgent — provider binding resolves credentials in the personal scope only', () => {
    // Regression: the author of a workspace agent (or a member with an explicit
    // local override) has workspaceScoped=false and CAN spawn in-process, but
    // their binding was configured against workspace-scoped providers while
    // Desktop main resolves the reference in the personal scope. A colliding
    // personal provider id would silently supply different credentials, so the
    // run must be rejected before IPC.
    it('rejects API mode for workspace agents even when the author could run locally', () => {
      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: apiHeteroProvider,
            isWorkspaceAgent: true,
            workspaceScoped: false,
          },
          { isDesktop: true },
        ),
      ).toThrow(/not supported for workspace agents/);

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: codexApiHeteroProvider,
            isWorkspaceAgent: true,
            workspaceScoped: false,
          },
          { isDesktop: true },
        ),
      ).toThrow(/not supported for workspace agents/);
    });

    it('keeps deployment-default API workspace agents spawnable by their author', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: serverDefaultApiHeteroProvider,
            isWorkspaceAgent: true,
            workspaceScoped: false,
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');
    });

    it('keeps subscription-auth workspace agents spawnable by their author', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: heteroProvider,
            isWorkspaceAgent: true,
            workspaceScoped: false,
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');
    });

    it('keeps API mode working for personal agents', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: apiHeteroProvider,
            isWorkspaceAgent: false,
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');
    });
  });

  describe('parentRuntime override', () => {
    it('parentRuntime wins over every other signal', () => {
      expect(
        selectRuntimeType(
          { heterogeneousProvider: heteroProvider, parentRuntime: 'gateway' },
          { isDesktop: true },
        ),
      ).toBe('gateway');

      expect(selectRuntimeType({ parentRuntime: 'gateway' }, { isDesktop: false })).toBe('gateway');

      expect(selectRuntimeType({ parentRuntime: 'hetero' }, { isDesktop: false })).toBe('hetero');
    });
  });
});
