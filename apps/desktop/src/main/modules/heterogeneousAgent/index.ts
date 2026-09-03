import type { LocalHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';

import { ampDriver } from './drivers/amp';
import { claudeCodeDriver } from './drivers/claudeCode';
import { codeBuddyDriver } from './drivers/codeBuddy';
import { codexDriver } from './drivers/codex';
import { cursorDriver } from './drivers/cursor';
import { droidDriver } from './drivers/droid';
import { grokBuildDriver } from './drivers/grokBuild';
import { kimiCodeDriver } from './drivers/kimiCode';
import { opencodeDriver } from './drivers/opencode';
import { piDriver } from './drivers/pi';
import { qoderDriver } from './drivers/qoder';
import { traeDriver } from './drivers/trae';
import type { HeterogeneousAgentDriver } from './types';

const heterogeneousAgentDrivers = {
  'amp': ampDriver,
  'claude-code': claudeCodeDriver,
  'codebuddy': codeBuddyDriver,
  'codex': codexDriver,
  'cursor': cursorDriver,
  'droid': droidDriver,
  'grok-build': grokBuildDriver,
  'kimi-code': kimiCodeDriver,
  'opencode': opencodeDriver,
  'pi': piDriver,
  'qoder': qoderDriver,
  'trae': traeDriver,
} satisfies Record<LocalHeterogeneousAgentType, HeterogeneousAgentDriver>;

export const getHeterogeneousAgentDriver = (agentType: string): HeterogeneousAgentDriver => {
  const driver = heterogeneousAgentDrivers[agentType as keyof typeof heterogeneousAgentDrivers];

  if (!driver) {
    throw new Error(`Unknown heterogeneous agent type: ${agentType}`);
  }

  return driver;
};

export const listHeterogeneousAgentDriverTypes = (): LocalHeterogeneousAgentType[] =>
  Object.keys(heterogeneousAgentDrivers) as LocalHeterogeneousAgentType[];
