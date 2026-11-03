'use client';

import { createContext, use } from 'react';

/**
 * Capabilities that can be injected into shared tool render components.
 *
 * - local-system: provides all (Electron IPC + store)
 * - cloud-sandbox: provides none (renders without loading state, open file actions)
 */
export interface ToolRenderCapabilities {
  /** Display a path relative to working directory. Returns the path as-is if not provided. */
  displayRelativePath?: (path: string) => string;
  /** Whether a tool call is currently loading for a given messageId */
  isLoading?: (messageId: string) => boolean;
  /** Open a file in the OS file manager */
  openFile?: (path: string) => void;
  /** Open the containing folder of a file in the OS file manager */
  openFolder?: (path: string) => void;
}

const ToolRenderContext = createContext<ToolRenderCapabilities>({});

export const ToolRenderProvider = ToolRenderContext.Provider;

export const useToolRenderCapabilities = () => use(ToolRenderContext);
