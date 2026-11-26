import type { LobeAgentConfig } from '@lobechat/types';

export type PersonalAgentDefaults = Partial<Pick<LobeAgentConfig, 'model' | 'provider'>>;

/**
 * Business extension point for account-level Agent defaults in personal scope.
 * They apply above the server default and below the user's own default Agent
 * settings. The default implementation adds none.
 */
export const getPersonalAgentDefaults = async (
  _userId: string,
): Promise<PersonalAgentDefaults | undefined> => undefined;
