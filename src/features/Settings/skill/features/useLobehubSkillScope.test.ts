import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type LobehubSkillServer,
  LobehubSkillStatus,
} from '@/store/tool/slices/lobehubSkillStore/types';

import { useLobehubSkillScope } from './useLobehubSkillScope';

const mocks = vi.hoisted(() => ({
  permission: { allowed: true, reason: undefined as string | undefined },
  profiles: new Map<string, { fullName?: string | null }>(),
  workspaces: [] as { id: string; name: string }[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => mocks.permission }));
vi.mock('@/business/client/hooks/useWorkspaceMemberProfiles', () => ({
  useWorkspaceMemberProfiles: () => mocks.profiles,
}));
vi.mock('@/business/client/hooks/useWorkspaces', () => ({
  useWorkspaces: () => mocks.workspaces,
}));

const server = (patch: Partial<LobehubSkillServer> = {}): LobehubSkillServer => ({
  identifier: 'github',
  isConnected: true,
  name: 'GitHub',
  status: LobehubSkillStatus.CONNECTED,
  ...patch,
});

const scopeOf = (value: LobehubSkillServer | undefined) =>
  renderHook(() => useLobehubSkillScope(value, 'GitHub')).result.current;

describe('useLobehubSkillScope', () => {
  beforeEach(() => {
    mocks.permission = { allowed: true, reason: undefined };
    mocks.profiles = new Map();
    mocks.workspaces = [];
  });

  it('should leave a connection of the space itself unannotated', () => {
    expect(scopeOf(server())).toEqual({ canManage: true, manageReason: undefined });
  });

  it('should keep workspace members read-only', () => {
    mocks.permission = { allowed: false, reason: 'requires admin' };

    expect(scopeOf(server())).toMatchObject({ canManage: false, manageReason: 'requires admin' });
  });

  it('should name the member whose personal authorization the workspace uses', () => {
    mocks.profiles = new Map([['user_owner', { fullName: 'Ada' }]]);

    const scope = scopeOf(
      server({ reference: { sourceDisplayName: 'ada-market', sourceUserId: 'user_owner' } }),
    );

    expect(scope.referenceNote).toBe('tools.lobehubSkill.reference.note {"name":"Ada"}');
    expect(scope.disconnectNote).toBe(
      'tools.lobehubSkill.reference.disconnectDesc {"name":"Ada","provider":"GitHub"}',
    );
  });

  it('should fall back to the market name, then to a generic member', () => {
    expect(
      scopeOf(server({ reference: { sourceDisplayName: 'ada-market', sourceUserId: 'gone' } }))
        .referenceNote,
    ).toBe('tools.lobehubSkill.reference.note {"name":"ada-market"}');
    expect(scopeOf(server({ reference: { sourceUserId: null } })).referenceNote).toBe(
      'tools.lobehubSkill.reference.note {"name":"tools.lobehubSkill.reference.unknownMember"}',
    );
  });

  it('should warn the owner which workspaces lose a personal authorization', () => {
    mocks.workspaces = [
      { id: 'wks_1', name: 'Acme' },
      { id: 'wks_2', name: 'Beta' },
    ];

    const scope = scopeOf(server({ referencedByWorkspaceIds: ['wks_1', 'wks_2'] }));

    expect(scope.referenceNote).toBeUndefined();
    expect(scope.disconnectNote).toBe(
      'tools.lobehubSkill.disconnectConfirm.sharedWorkspaces {"provider":"GitHub","workspaces":"Acmetools.lobehubSkill.reference.listSeparatorBeta"}',
    );
  });
});
