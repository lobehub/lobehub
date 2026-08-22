import { describe, expect, it } from 'vitest';

import { selectRuntimeType } from '../dispatch/agentDispatcher';

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

describe('selectRuntimeType', () => {
  describe('on web (isDesktop = false)', () => {
    const opts = { isDesktop: false };

    it('returns client when no signal is set', () => {
      expect(selectRuntimeType({ isGatewayMode: false }, opts)).toBe('client');
    });

    it('returns gateway when gateway mode is enabled', () => {
      expect(selectRuntimeType({ isGatewayMode: true }, opts)).toBe('gateway');
    });

    it('routes local heterogeneousProvider to gateway on web', () => {
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: true }, opts),
      ).toBe('gateway');
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: false }, opts),
      ).toBe('gateway');
    });

    it('routes remote platform agents (openclaw/hermes) to gateway on web', () => {
      expect(
        selectRuntimeType(
          { heterogeneousProvider: remoteHeteroProvider, isGatewayMode: false },
          opts,
        ),
      ).toBe('gateway');
      expect(
        selectRuntimeType(
          { heterogeneousProvider: remoteHeteroProviderHermes, isGatewayMode: false },
          opts,
        ),
      ).toBe('gateway');
    });
  });

  describe('on desktop (isDesktop = true)', () => {
    const opts = { isDesktop: true };

    it('returns hetero for local CLI agents (claude-code, codex)', () => {
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: true }, opts),
      ).toBe('hetero');
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: false }, opts),
      ).toBe('hetero');
    });

    it('routes remote platform agents (openclaw/hermes) to gateway even on desktop', () => {
      // openclaw and hermes use device gateway, not desktop subprocess — must not go to hetero
      expect(
        selectRuntimeType(
          { heterogeneousProvider: remoteHeteroProvider, isGatewayMode: false },
          opts,
        ),
      ).toBe('gateway');
      expect(
        selectRuntimeType(
          { heterogeneousProvider: remoteHeteroProviderHermes, isGatewayMode: false },
          opts,
        ),
      ).toBe('gateway');
    });

    it('falls back to gateway/client when no hetero provider', () => {
      expect(selectRuntimeType({ isGatewayMode: true }, opts)).toBe('gateway');
      expect(selectRuntimeType({ isGatewayMode: false }, opts)).toBe('client');
    });
  });

  describe('executionTarget routing for local CLI hetero', () => {
    it('allows Claude Code API mode only for Desktop local execution', () => {
      expect(
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: apiHeteroProvider,
            isGatewayMode: false,
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'sandbox',
            heterogeneousProvider: apiHeteroProvider,
            isGatewayMode: false,
          },
          { isDesktop: true },
        ),
      ).toThrow(/Desktop local execution/);

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: apiHeteroProvider,
            isGatewayMode: false,
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
            isGatewayMode: false,
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'sandbox',
            heterogeneousProvider: serverDefaultApiHeteroProvider,
            isGatewayMode: false,
          },
          { isDesktop: true },
        ),
      ).toThrow(/Desktop local execution/);

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'local',
            heterogeneousProvider: serverDefaultApiHeteroProvider,
            isGatewayMode: false,
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
            isGatewayMode: false,
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');

      expect(() =>
        selectRuntimeType(
          {
            executionTarget: 'sandbox',
            heterogeneousProvider: codexApiHeteroProvider,
            isGatewayMode: false,
          },
          { isDesktop: true },
        ),
      ).toThrow(/Desktop local execution/);
    });

    it.each(['client', 'gateway'] as const)(
      'rejects API mode inherited from the %s parent runtime',
      (parentRuntime) => {
        expect(() =>
          selectRuntimeType(
            {
              executionTarget: 'local',
              heterogeneousProvider: apiHeteroProvider,
              isGatewayMode: false,
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
            isGatewayMode: false,
            parentRuntime: 'hetero',
          },
          { isDesktop: true },
        ),
      ).toBe('hetero');
    });

    it.each(['client', 'gateway', 'hetero'] as const)(
      'rejects every %s parent runtime for API mode on web',
      (parentRuntime) => {
        expect(() =>
          selectRuntimeType(
            {
              executionTarget: 'local',
              heterogeneousProvider: apiHeteroProvider,
              isGatewayMode: false,
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
            isGatewayMode: false,
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
            isGatewayMode: false,
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
            isGatewayMode: false,
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
            isGatewayMode: false,
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
            isGatewayMode: false,
          },
          { isDesktop: false },
        ),
      ).toBe('gateway');
    });

    it('preserves legacy default when executionTarget is unset (desktop → hetero, web → gateway)', () => {
      expect(
        selectRuntimeType(
          { heterogeneousProvider: heteroProvider, isGatewayMode: false },
          { isDesktop: true },
        ),
      ).toBe('hetero');
      expect(
        selectRuntimeType(
          { heterogeneousProvider: heteroProvider, isGatewayMode: false },
          { isDesktop: false },
        ),
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
            isGatewayMode: false,
            workspaceScoped: true,
          },
          { isDesktop: true },
        ),
      ).toBe('gateway');
      expect(
        selectRuntimeType(
          { heterogeneousProvider: heteroProvider, isGatewayMode: false, workspaceScoped: true },
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
            isGatewayMode: false,
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
            isGatewayMode: false,
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
            isGatewayMode: false,
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
            isGatewayMode: false,
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
            isGatewayMode: false,
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
          {
            parentRuntime: 'client',
            heterogeneousProvider: heteroProvider,
            isGatewayMode: true,
          },
          { isDesktop: true },
        ),
      ).toBe('client');

      expect(
        selectRuntimeType({ parentRuntime: 'gateway', isGatewayMode: false }, { isDesktop: false }),
      ).toBe('gateway');

      expect(
        selectRuntimeType({ parentRuntime: 'hetero', isGatewayMode: true }, { isDesktop: false }),
      ).toBe('hetero');
    });
  });
});
