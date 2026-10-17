import debug from 'debug';

import type { AgentConfigWithId } from '@/server/services/agent';

import type { RunFacts } from '../runFacts';
import type { AgentShareGate } from '../shareGate';

const log = debug('lobe-server:ai-agent-service');

export interface RunSettingsInput {
  agentConfig: AgentConfigWithId;
  runFacts: RunFacts;
  shareGate?: AgentShareGate;
}

export interface RunSettings {
  enableExpertise: boolean;
  globalMemoryEnabled: boolean;
  userTimezone?: string;
}

/** Resolve the run's memory, expertise and timezone settings from the user's rows. */
export const resolveRunSettings = async ({
  agentConfig,
  runFacts,
  shareGate,
}: RunSettingsInput): Promise<RunSettings> => {
  // Agent-level memory config takes priority; fallback to user-level setting
  const agentMemoryEnabled = agentConfig.chatConfig?.memory?.enabled;
  let globalMemoryEnabled = agentMemoryEnabled ?? false;
  let enableExpertise = false;
  let userTimezone: string | undefined;
  try {
    const settings = await runFacts.userSettings();
    const memorySettings = settings?.memory as { enabled?: boolean } | undefined;

    globalMemoryEnabled = agentMemoryEnabled ?? memorySettings?.enabled !== false;

    // Timezone drives the session-date placeholder rendered back to whoever
    // is actually conversing. In a share-visitor run that is the VISITOR,
    // not the creator whose settings this block otherwise reads — memory /
    // expertise intentionally stay creator-scoped below (gated by
    // `allowReadMemory`), but the timezone has no such gate and must not
    // leak the creator's own setting into a visitor's turn.
    if (shareGate) {
      const visitorSettings = await runFacts.userSettings(shareGate.visitorUserId);
      const visitorGeneralSettings = visitorSettings?.general as { timezone?: string } | undefined;
      userTimezone = visitorGeneralSettings?.timezone;
    } else {
      const generalSettings = settings?.general as { timezone?: string } | undefined;
      userTimezone = generalSettings?.timezone;
    }
  } catch (error) {
    log('execAgent: failed to fetch user settings: %O', error);
  }
  try {
    const preference = await runFacts.userPreference();
    enableExpertise = preference?.lab?.enableSelfLearning === true;
  } catch (error) {
    console.error('Failed to resolve expertise injection Lab preference:', error);
  }
  // Share visitors only get the creator's memory (persona + learned
  // expertise) when the share explicitly allows it — both surfaces would
  // otherwise leak the creator's personal context into visitor turns.
  if (shareGate && !shareGate.shareConfig.allowReadMemory) {
    globalMemoryEnabled = false;
    enableExpertise = false;
  }

  return { enableExpertise, globalMemoryEnabled, userTimezone };
};
