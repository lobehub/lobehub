import { describe, expect, it } from 'vitest';

import type { AgentShareConfig } from '../schemas';
import {
  AGENT_SHARE_SETTING_AUTHORIZATION_KIND,
  diffAgentShareAuthorization,
} from './agentShareAuthorization';

/** A value differing from each setting's default; a new setting needs one here. */
const CHANGED: Required<AgentShareConfig> = {
  allowCreatorViewSessions: true,
  allowReadMemory: true,
  autoGrantAgentTools: true,
  declinedGrantIds: ['grant-1'],
  demoCases: [{ description: 'd', prompt: 'p' }],
  deviceAccess: 'everyone',
  deviceAllowUserIds: ['user-1'],
  featuredWorkIds: ['work-1'],
  listedInMarket: true,
  maxFileStorage: 1,
  maxMessagesPerVisitor: 1,
  monthlySpendLimit: 1,
  seedDefaultGrants: true,
  skillGrants: ['skill-1'],
  slug: 'changed',
  tipsEnabled: false,
  toolGrants: [{ identifier: 'tool-1' }],
};

/** The config a setting needs before its change grants anything. */
const PRECONDITION: Partial<Record<keyof AgentShareConfig, AgentShareConfig>> = {
  declinedGrantIds: { autoGrantAgentTools: true },
};

const live = (shareConfig: AgentShareConfig) => ({
  id: 'share-1',
  shareConfig,
  visibility: 'link',
});

describe('diffAgentShareAuthorization', () => {
  it.each(Object.entries(AGENT_SHARE_SETTING_AUTHORIZATION_KIND))(
    'reports a change to %s as %s',
    (setting, kind) => {
      expect(CHANGED).toHaveProperty(setting);
      const base = PRECONDITION[setting as keyof AgentShareConfig] ?? {};
      const patch = { ...base, [setting]: CHANGED[setting as keyof AgentShareConfig] };

      const kinds = diffAgentShareAuthorization(live(base), live(patch)).map(
        (change) => change.kind,
      );

      expect(kinds).toEqual(kind ? [kind] : []);
    },
  );

  it('reports nothing for declining a tool while automatic grants are off', () => {
    expect(diffAgentShareAuthorization(live({}), live({ declinedGrantIds: ['grant-1'] }))).toEqual(
      [],
    );
  });

  it('reports switching automatic grants on with the identifiers they leave closed', () => {
    const [change] = diffAgentShareAuthorization(
      live({ declinedGrantIds: ['grant-2', 'grant-1'] }),
      live({ autoGrantAgentTools: true, declinedGrantIds: ['grant-2', 'grant-1'] }),
    );

    expect(change).toMatchObject({
      after: { autoGrantAgentTools: true, declinedGrantIds: ['grant-1', 'grant-2'] },
      before: { autoGrantAgentTools: false, declinedGrantIds: [] },
      kind: 'agent_share.capabilities',
    });
  });

  it('reports a reordered list as no change', () => {
    expect(
      diffAgentShareAuthorization(
        live({ deviceAllowUserIds: ['a', 'b'], skillGrants: ['x', 'y'] }),
        live({ deviceAllowUserIds: ['b', 'a'], skillGrants: ['y', 'x'] }),
      ),
    ).toEqual([]);
  });
});
