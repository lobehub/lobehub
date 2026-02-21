import { ToolCategory, ToolStatus } from '@/core/infrastructure/ToolDetectorManager';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:ToolDetectorCtr');

/**
 * Tool Detector Controller
 *
 * Provides IPC interface for querying tool detection status.
 * Frontend can use these methods to display tool availability to users.
 */
export default class ToolDetectorCtr extends ControllerModule {
  static override readonly groupName = 'toolDetector';

  private get manager() {
    return this.app.toolDetectorManager;
  }

  /**
   * Detect a single tool
   */
  @IpcMethod()
  async detectTool(name: string, force = false): Promise<ToolStatus> {
    logger.debug(`Detecting tool: ${name}, force: ${force}`);
    return this.manager.detect(name, force);
  }

  /**
   * Detect all registered tools
   */
  @IpcMethod()
  async detectAllTools(force = false): Promise<Record<string, ToolStatus>> {
    logger.debug(`Detecting all tools, force: ${force}`);
    const results = await this.manager.detectAll(force);
    return Object.fromEntries(results);
  }

  /**
   * Detect all tools in a category
   */
  @IpcMethod()
  async detectCategory(category: ToolCategory, force = false): Promise<Record<string, ToolStatus>> {
    logger.debug(`Detecting category: ${category}, force: ${force}`);
    const results = await this.manager.detectCategory(category, force);
    return Object.fromEntries(results);
  }

  /**
   * Get the best available tool in a category
   */
  @IpcMethod()
  async getBestTool(category: ToolCategory): Promise<string | null> {
    logger.debug(`Getting best tool for category: ${category}`);
    return this.manager.getBestTool(category);
  }

  /**
   * Get cached status for a tool (no detection)
   */
  @IpcMethod()
  getToolStatus(name: string): ToolStatus | null {
    return this.manager.getStatus(name) || null;
  }

  /**
   * Get all cached statuses (no detection)
   */
  @IpcMethod()
  getAllToolStatus(): Record<string, ToolStatus> {
    return Object.fromEntries(this.manager.getAllStatus());
  }

  /**
   * Clear tool status cache
   */
  @IpcMethod()
  clearToolCache(name?: string): void {
    this.manager.clearCache(name);
    logger.debug(`Cleared tool cache${name ? ` for: ${name}` : ''}`);
  }

  /**
   * Get list of registered tools
   */
  @IpcMethod()
  getRegisteredTools(): string[] {
    return this.manager.getRegisteredTools();
  }

  /**
   * Get all categories
   */
  @IpcMethod()
  getCategories(): ToolCategory[] {
    return this.manager.getCategories();
  }

  /**
   * Get tools in a category with their info
   */
  @IpcMethod()
  getToolsInCategory(category: ToolCategory): Array<{
    description?: string;
    name: string;
    priority?: number;
  }> {
    return this.manager.getToolsInCategory(category).map((detector) => ({
      description: detector.description,
      name: detector.name,
      priority: detector.priority,
    }));
  }
}
