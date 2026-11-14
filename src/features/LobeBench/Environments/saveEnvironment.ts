import type { EvalCaseEnvironment } from '@lobechat/types';

import { agentEvalService } from '@/services/agentEval';

interface EnvironmentDraft {
  config: EvalCaseEnvironment;
  description: string;
  name: string;
  row?: { id: string };
}

/** A copied environment has no persisted id and must be saved as a new record. */
export const saveEnvironment = async ({ config, description, name, row }: EnvironmentDraft) => {
  if (row?.id) {
    return agentEvalService.updateEnvironment({
      config,
      description: description.trim() || null,
      id: row.id,
      name: name.trim(),
    });
  }
  return agentEvalService.createEnvironment({
    config,
    description: description.trim() || undefined,
    identifier: `env-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
  });
};
