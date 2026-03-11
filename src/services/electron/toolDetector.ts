import { type ToolCategory, type ToolInfo, type ToolStatus } from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class ToolDetectorService {
  /**
   * Detect a single tool
   */
  detectTool = async (name: string, force = false): Promise<ToolStatus> => {
    return ensureElectronIpc().toolDetector.detectTool(name, force);
  };

  /**
   * Detect all registered tools
   */
  detectAllTools = async (force = false): Promise<Record<string, ToolStatus>> => {
    return ensureElectronIpc().toolDetector.detectAllTools(force);
  };

  /**
   * Detect all tools in a category
   */
  detectCategory = async (
    category: ToolCategory,
    force = false,
  ): Promise<Record<string, ToolStatus>> => {
    return ensureElectronIpc().toolDetector.detectCategory(category, force);
  };

  /**
   * Get the best available tool in a category
   */
  getBestTool = async (category: ToolCategory): Promise<string | null> => {
    return ensureElectronIpc().toolDetector.getBestTool(category);
  };

  /**
   * Get cached status for a tool (no detection)
   */
  getToolStatus = (name: string): ToolStatus | null => {
    return ensureElectronIpc().toolDetector.getToolStatus(name);
  };

  /**
   * Get all cached statuses (no detection)
   */
  getAllToolStatus = (): Record<string, ToolStatus> => {
    return ensureElectronIpc().toolDetector.getAllToolStatus();
  };

  /**
   * Clear tool status cache
   */
  clearToolCache = (name?: string): void => {
    ensureElectronIpc().toolDetector.clearToolCache(name);
  };

  /**
   * Get list of registered tools
   */
  getRegisteredTools = (): string[] => {
    return ensureElectronIpc().toolDetector.getRegisteredTools();
  };

  /**
   * Get all categories
   */
  getCategories = (): ToolCategory[] => {
    return ensureElectronIpc().toolDetector.getCategories();
  };

  /**
   * Get tools in a category with their info
   */
  getToolsInCategory = (category: ToolCategory): ToolInfo[] => {
    return ensureElectronIpc().toolDetector.getToolsInCategory(category);
  };
}

export const toolDetectorService = new ToolDetectorService();
