import type { DropdownItem } from '@lobehub/ui';

/**
 * "Report Bug" in the sidebar help menu, which submits a report about the
 * user's most recent topic to a support inbox. Nothing by default: only a
 * deployment with such an inbox can act on it.
 */
export const useHelpMenuBugReportItem = (): DropdownItem | null => null;
