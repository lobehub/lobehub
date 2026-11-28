import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectorConfigureGate } from './useConnectorConfigureGate';

const mocks = vi.hoisted(() => ({
  manageable: {
    canManage: true,
    canManageCredentials: true,
    isPending: false,
    restrictedByPolicy: false,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('@/hooks/useConnectorManagePolicy', () => ({
  useConnectorManageable: () => mocks.manageable,
}));

const connector = { id: 'conn-1', identifier: 'market-mcp', userId: 'creator' } as never;
const gate = (canEdit = true) =>
  renderHook(() => useConnectorConfigureGate(connector, canEdit)).result.current;

describe('useConnectorConfigureGate', () => {
  beforeEach(() => {
    mocks.manageable = {
      canManage: true,
      canManageCredentials: true,
      isPending: false,
      restrictedByPolicy: false,
    };
  });

  it('lets the creator or a workspace owner open the edit drawer', () => {
    expect(gate()).toEqual({ allowed: true, deniedTitle: undefined });
  });

  // The drawer reads the stored credentials (`connector.getForEdit`), which
  // the server refuses to another workspace member
  it("refuses another member's connector, with the reason", () => {
    mocks.manageable.canManageCredentials = false;

    expect(gate()).toEqual({
      allowed: false,
      deniedTitle: 'Only the creator or a workspace owner can manage this connector',
    });
  });

  it('names the workspace policy when it is what restricts the viewer', () => {
    mocks.manageable = {
      ...mocks.manageable,
      canManageCredentials: false,
      restrictedByPolicy: true,
    };

    expect(gate().deniedTitle).toBe('tools.connectorFeedback.manageOnly');
  });

  it('refuses without a reason while the manage policy loads', () => {
    mocks.manageable = { ...mocks.manageable, canManageCredentials: false, isPending: true };

    expect(gate()).toEqual({ allowed: false, deniedTitle: undefined });
  });

  it('refuses without the edit permission', () => {
    expect(gate(false).allowed).toBe(false);
  });
});
