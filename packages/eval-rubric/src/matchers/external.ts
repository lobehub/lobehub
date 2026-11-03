import type { MatchResult } from './types';

export const matchExternal = async (): Promise<MatchResult> => {
  return {
    passed: false,
    score: 0,
    reason: 'Waiting for external evaluation...',
  };
};
