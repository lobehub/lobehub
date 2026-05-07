import { describe, expect, it, vi } from 'vitest';

import { resolveOverlayModelSelectionPayload, shouldShowOverlayModelSelector } from './ChatPanel';
import { resolvePanelPlacement } from './panelPlacement';

vi.mock('./chatPanel.css.ts', () => new Proxy({}, { get: (_, key) => String(key) }));

vi.mock('./cn', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

vi.mock('./Avatar', () => ({
  default: () => null,
}));

vi.mock('@lobehub/icons', () => ({
  ModelIcon: () => null,
}));

describe('ChatPanel', () => {
  it('keeps the last selection placement while a reselection is in progress', () => {
    expect(
      resolvePanelPlacement({
        dockedPlacement: null,
        initialPlacement: { left: 480, top: 720, width: 420 },
        lastSelectionPlacement: { left: 812, top: 168, width: 360 },
      }),
    ).toEqual({
      left: 812,
      top: 168,
      width: 360,
    });
  });

  it('falls back to the initial placement after the remembered position is cleared', () => {
    expect(
      resolvePanelPlacement({
        dockedPlacement: null,
        initialPlacement: { left: 480, top: 720, width: 420 },
        lastSelectionPlacement: null,
      }),
    ).toEqual({
      left: 480,
      top: 720,
      width: 420,
    });
  });

  it('hides the model selector and omits model payload for heterogeneous agents', () => {
    const heterogeneousAgent = {
      heterogeneousType: 'codex',
      id: 'agent-codex',
      title: 'Codex Agent',
    };

    expect(shouldShowOverlayModelSelector(heterogeneousAgent)).toBe(false);
    expect(
      resolveOverlayModelSelectionPayload({
        agent: heterogeneousAgent,
        model: { id: 'gpt-4.1', provider: 'openai' },
        modelId: 'gpt-4.1',
      }),
    ).toEqual({
      modelId: undefined,
      provider: undefined,
    });
  });

  it('keeps the model selector and payload for regular agents', () => {
    const regularAgent = {
      id: 'agent-regular',
      title: 'Regular Agent',
    };

    expect(shouldShowOverlayModelSelector(regularAgent)).toBe(true);
    expect(
      resolveOverlayModelSelectionPayload({
        agent: regularAgent,
        model: { id: 'gpt-4.1', provider: 'openai' },
        modelId: 'gpt-4.1',
      }),
    ).toEqual({
      modelId: 'gpt-4.1',
      provider: 'openai',
    });
  });
});
