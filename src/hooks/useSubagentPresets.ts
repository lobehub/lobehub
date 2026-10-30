import { useClientDataSWR } from '@/libs/swr';
import { subagentService } from '@/services/subagent';

/** Subagent presets of one parent agent; skipped until an agent id is known. */
export const useSubagentPresets = (parentAgentId?: string, enabled = true) =>
  useClientDataSWR(enabled && parentAgentId ? ['subagent-presets', parentAgentId] : null, () =>
    subagentService.getSubagents(parentAgentId!),
  );

/** A single subagent preset; skipped for threads the main agent ran directly. */
export const useSubagentPreset = (id?: string | null) =>
  useClientDataSWR(id ? ['subagent-preset', id] : null, () => subagentService.getSubagent(id!));
