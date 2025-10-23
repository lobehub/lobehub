/**
 * Shared tool filtering logic used across both runtime (ToolsEngine)
 * and display layer (selectors)
 */
import { isDesktop } from '@lobechat/const';

import { LocalSystemManifest } from '@/tools/local-system';

/**
 * Check if a tool should be enabled based on platform-specific constraints
 * @param toolId - The tool identifier to check
 * @returns true if the tool should be enabled, false otherwise
 */
export const shouldEnableTool = (toolId: string): boolean => {
  // Filter LocalSystem tool in non-desktop environment
  if (toolId === LocalSystemManifest.identifier) {
    return isDesktop;
  }

  // Add more platform-specific filters here as needed
  // if (toolId === SomeOtherPlatformSpecificTool.identifier) {
  //   return someCondition;
  // }

  return true;
};

/**
 * Filter tool IDs based on platform constraints
 * @param toolIds - Array of tool identifiers to filter
 * @returns Filtered array of tool identifiers
 */
export const filterToolIds = (toolIds: string[]): string[] => {
  return toolIds.filter(shouldEnableTool);
};
