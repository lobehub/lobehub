import { useEffect } from 'react';

import { useTaskSelectionStore } from './store';

/**
 * Drop the selection when the list behind it changes identity (another tab,
 * sub-scope, page or owner) and when the list unmounts. Rows present in both
 * collections would otherwise stay selected across the switch.
 */
export const useSelectionScope = (scope: string) => {
  useEffect(() => () => useTaskSelectionStore.getState().clear(), [scope]);
};
