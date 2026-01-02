'use client';

import { createContext, useContext } from 'react';

/**
 * Common placement values supported by both Dropdown and Popover
 */
type DropdownPlacement = 'bottom' | 'bottomLeft' | 'bottomRight' | 'top' | 'topLeft' | 'topRight';

export interface ActionBarContextValue {
  dropdownPlacement?: DropdownPlacement;
}

export const ActionBarContext = createContext<ActionBarContextValue>({});

export const useActionBarContext = () => useContext(ActionBarContext);

export type { DropdownPlacement };
