import { StateCreator } from 'zustand';
import { MCPTool, MCPToolMap } from '@/types/tool';
import { MCPStore } from './store';

export interface MCPActions {
  /**
   * Set the list of tools (replaces all).
   */
  setTools: (tools: MCPTool[]) => void;
  /**
   * Update a specific tool by ID.
   */
  updateTool: (id: string, updates: Partial<MCPTool>) => void;
  /**
   * Remove a tool by ID.
   */
  removeTool: (id: string) => void;
  /**
   * Get all tools as an array.
   */
  getTools: () => MCPTool[];
}

export const createMCPActions: StateCreator<
  MCPStore,
  [],
  [],
  MCPActions
> = (set, get) => ({
  setTools: (tools) => {
    const toolsMap: MCPToolMap = {};
    for (const tool of tools) {
      toolsMap[tool.id] = tool;
    }
    set({ tools: toolsMap });
  },
  updateTool: (id, updates) => {
    const current = get().tools[id];
    if (!current) return;
    const updated = { ...current, ...updates };
    set((state) => ({
      tools: { ...state.tools, [id]: updated },
    }));
  },
  removeTool: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.tools;
      return { tools: rest };
    });
  },
  getTools: () => Object.values(get().tools),
});
