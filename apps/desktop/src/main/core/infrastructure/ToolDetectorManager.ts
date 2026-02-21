import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { App } from '@/core/App';
import { createLogger } from '@/utils/logger';

const execPromise = promisify(exec);
const logger = createLogger('core:ToolDetectorManager');

/**
 * Tool detection status
 */
export interface ToolStatus {
  available: boolean;
  error?: string;
  lastChecked?: Date;
  path?: string;
  version?: string;
}

/**
 * Tool detector interface - modules implement this to register detection logic
 */
export interface IToolDetector {
  /** Description */
  description?: string;
  /** Detection method */
  detect(): Promise<ToolStatus>;
  /** Tool name, e.g., 'rg', 'mdfind' */
  name: string;
  /** Priority within category, lower number = higher priority */
  priority?: number;
}

/**
 * Tool categories
 */
export type ToolCategory = 'content-search' | 'ast-search' | 'file-search' | 'system' | 'custom';

/**
 * Tool Detector Manager
 *
 * A plugin-style manager for detecting system tools availability.
 * Modules can register their own detectors and query tool status.
 *
 * @example
 * ```typescript
 * // Register a detector
 * manager.register({
 *   name: 'rg',
 *   description: 'ripgrep',
 *   priority: 1,
 *   async detect() { ... }
 * }, 'content-search');
 *
 * // Query status
 * const status = await manager.detect('rg');
 * const bestTool = await manager.getBestTool('content-search');
 * ```
 */
export class ToolDetectorManager {
  private app: App;
  private detectors = new Map<string, IToolDetector>();
  private statusCache = new Map<string, ToolStatus>();
  private categoryMap = new Map<ToolCategory, Set<string>>();
  private initialized = false;

  constructor(app: App) {
    logger.debug('Initializing ToolDetectorManager');
    this.app = app;
  }

  /**
   * Register a tool detector
   * @param detector The detector to register
   * @param category Tool category for grouping
   */
  register(detector: IToolDetector, category: ToolCategory = 'custom'): void {
    const { name } = detector;

    if (this.detectors.has(name)) {
      logger.warn(`Detector for '${name}' already registered, overwriting`);
    }

    this.detectors.set(name, detector);

    // Add to category
    if (!this.categoryMap.has(category)) {
      this.categoryMap.set(category, new Set());
    }
    this.categoryMap.get(category)!.add(name);

    logger.debug(
      `Registered detector: ${name} (category: ${category}, priority: ${detector.priority ?? 'default'})`,
    );
  }

  /**
   * Unregister a tool detector
   * @param name Tool name to unregister
   */
  unregister(name: string): boolean {
    if (!this.detectors.has(name)) {
      return false;
    }

    this.detectors.delete(name);
    this.statusCache.delete(name);

    // Remove from category
    for (const tools of this.categoryMap.values()) {
      tools.delete(name);
    }

    logger.debug(`Unregistered detector: ${name}`);
    return true;
  }

  /**
   * Detect a single tool
   * @param name Tool name
   * @param force Force detection, bypass cache
   */
  async detect(name: string, force = false): Promise<ToolStatus> {
    const detector = this.detectors.get(name);
    if (!detector) {
      return {
        available: false,
        error: `No detector registered for '${name}'`,
      };
    }

    // Return cached result if available and not forced
    if (!force && this.statusCache.has(name)) {
      return this.statusCache.get(name)!;
    }

    try {
      logger.debug(`Detecting tool: ${name}`);
      const status = await detector.detect();
      status.lastChecked = new Date();
      this.statusCache.set(name, status);

      logger.debug(`Tool ${name} detection result:`, {
        available: status.available,
        path: status.path,
        version: status.version,
      });

      return status;
    } catch (error) {
      const status: ToolStatus = {
        available: false,
        error: (error as Error).message,
        lastChecked: new Date(),
      };
      this.statusCache.set(name, status);
      logger.error(`Error detecting tool ${name}:`, error);
      return status;
    }
  }

  /**
   * Detect all registered tools
   * @param force Force detection, bypass cache
   */
  async detectAll(force = false): Promise<Map<string, ToolStatus>> {
    const results = new Map<string, ToolStatus>();

    await Promise.all(
      Array.from(this.detectors.keys()).map(async (name) => {
        const status = await this.detect(name, force);
        results.set(name, status);
      }),
    );

    return results;
  }

  /**
   * Detect all tools in a category
   * @param category Tool category
   * @param force Force detection, bypass cache
   */
  async detectCategory(category: ToolCategory, force = false): Promise<Map<string, ToolStatus>> {
    const tools = this.categoryMap.get(category);
    if (!tools) {
      return new Map();
    }

    const results = new Map<string, ToolStatus>();

    await Promise.all(
      Array.from(tools).map(async (name) => {
        const status = await this.detect(name, force);
        results.set(name, status);
      }),
    );

    return results;
  }

  /**
   * Get cached status for a tool
   * @param name Tool name
   */
  getStatus(name: string): ToolStatus | undefined {
    return this.statusCache.get(name);
  }

  /**
   * Get all cached statuses
   */
  getAllStatus(): Map<string, ToolStatus> {
    return new Map(this.statusCache);
  }

  /**
   * Get the best available tool in a category
   * Returns the first available tool sorted by priority
   * @param category Tool category
   */
  async getBestTool(category: ToolCategory): Promise<string | null> {
    const tools = this.categoryMap.get(category);
    if (!tools || tools.size === 0) {
      return null;
    }

    // Get detectors and sort by priority
    const sortedDetectors = Array.from(tools)
      .map((name) => this.detectors.get(name)!)
      .filter(Boolean)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    // Find first available tool
    for (const detector of sortedDetectors) {
      const status = await this.detect(detector.name);
      if (status.available) {
        return detector.name;
      }
    }

    return null;
  }

  /**
   * Get all tools in a category, sorted by priority
   * @param category Tool category
   */
  getToolsInCategory(category: ToolCategory): IToolDetector[] {
    const tools = this.categoryMap.get(category);
    if (!tools) {
      return [];
    }

    return Array.from(tools)
      .map((name) => this.detectors.get(name)!)
      .filter(Boolean)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /**
   * Clear status cache
   * @param name Optional tool name; if not provided, clears all
   */
  clearCache(name?: string): void {
    if (name) {
      this.statusCache.delete(name);
      logger.debug(`Cleared cache for: ${name}`);
    } else {
      this.statusCache.clear();
      logger.debug('Cleared all cache');
    }
  }

  /**
   * Get all registered tool names
   */
  getRegisteredTools(): string[] {
    return Array.from(this.detectors.keys());
  }

  /**
   * Get all categories
   */
  getCategories(): ToolCategory[] {
    return Array.from(this.categoryMap.keys());
  }

  /**
   * Check if a tool is registered
   */
  isRegistered(name: string): boolean {
    return this.detectors.has(name);
  }
}

// ========================================
// Helper: Create a command-based detector
// ========================================

/**
 * Create a simple command-based detector
 * Useful for common tools that follow standard patterns
 */
export function createCommandDetector(
  name: string,
  options: {
    description?: string;
    priority?: number;
    versionFlag?: string;
    whichCommand?: string;
  } = {},
): IToolDetector {
  const { description, priority, versionFlag = '--version', whichCommand } = options;

  return {
    description,
    async detect(): Promise<ToolStatus> {
      try {
        // Check if tool exists
        const whichCmd = whichCommand || (process.platform === 'win32' ? 'where' : 'which');
        const { stdout: pathOut } = await execPromise(`${whichCmd} ${name}`, { timeout: 3000 });
        const toolPath = pathOut.trim().split('\n')[0];

        // Try to get version
        let version: string | undefined;
        try {
          const { stdout: versionOut } = await execPromise(`${name} ${versionFlag}`, {
            timeout: 3000,
          });
          version = versionOut.trim().split('\n')[0];
        } catch {
          // Some tools don't support version flag
        }

        return {
          available: true,
          path: toolPath,
          version,
        };
      } catch {
        return {
          available: false,
        };
      }
    },
    name,
    priority,
  };
}
