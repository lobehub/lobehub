import { isDesktop } from '@lobechat/const';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';

/** Where a conversation offers its way into the terminal panel. */
export type TerminalEntryPlacement = 'header' | 'overview';

/**
 * Whether the terminal entry at `placement` shows for the current agent.
 *
 * A coding agent (Claude Code, Codex, …) works in a shell, so its terminal
 * sits one click away in the conversation header. For any other agent it is
 * an occasional tool and lives with the workspace resources in the Overview
 * instead of taking a header slot.
 *
 * Either way it needs somewhere to run: the desktop always has its own shell;
 * the web needs a connected device that can host one.
 */
export const useTerminalEntry = (placement: TerminalEntryPlacement): boolean => {
  const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const hasDevice = useDeviceStore(deviceSelectors.hasTerminalTarget);

  if (!isDesktop && !hasDevice) return false;
  return placement === 'header' ? isHetero : !isHetero;
};
