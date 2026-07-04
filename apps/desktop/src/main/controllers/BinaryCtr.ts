import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  ClaudeAuthStatus,
  DetectHeterogeneousAgentCommandParams,
} from '@lobechat/electron-client-ipc';

import type { BinaryCategory, BinaryStatus } from '@/core/infrastructure/BinaryManager';
import { detectHeterogeneousCliCommand } from '@/modules/binaries';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const execFilePromise = promisify(execFile);

const logger = createLogger('controllers:BinaryCtr');

/**
 * Binary Controller
 *
 * Provides IPC interface for querying binary detection status.
 * Frontend can use these methods to display binary availability to users.
 */
export default class BinaryCtr extends ControllerModule {
  static override readonly groupName = 'binary';

  private get manager() {
    return this.app.binaryManager;
  }

  /**
   * Detect a single binary
   */
  @IpcMethod()
  async detect(name: string, force = false): Promise<BinaryStatus> {
    logger.debug(`Detecting binary: ${name}, force: ${force}`);
    return this.manager.detect(name, force);
  }

  @IpcMethod()
  async detectHeterogeneousAgentCommand(
    params: DetectHeterogeneousAgentCommandParams,
  ): Promise<BinaryStatus> {
    logger.debug('Detecting heterogeneous agent command:', params);
    return detectHeterogeneousCliCommand(params.agentType, params.command);
  }

  /**
   * Detect all registered binaries
   */
  @IpcMethod()
  async detectAll(force = false): Promise<Record<string, BinaryStatus>> {
    logger.debug(`Detecting all binaries, force: ${force}`);
    const results = await this.manager.detectAll(force);
    return Object.fromEntries(results);
  }

  /**
   * Detect all binaries in a category
   */
  @IpcMethod()
  async detectCategory(
    category: BinaryCategory,
    force = false,
  ): Promise<Record<string, BinaryStatus>> {
    logger.debug(`Detecting category: ${category}, force: ${force}`);
    const results = await this.manager.detectCategory(category, force);
    return Object.fromEntries(results);
  }

  /**
   * Get the best available binary in a category
   */
  @IpcMethod()
  async getBestTool(category: BinaryCategory): Promise<string | null> {
    logger.debug(`Getting best binary for category: ${category}`);
    return this.manager.getBestTool(category);
  }

  /**
   * Get cached status for a binary (no detection)
   */
  @IpcMethod()
  getStatus(name: string): BinaryStatus | null {
    return this.manager.getStatus(name) || null;
  }

  /**
   * Get all cached statuses (no detection)
   */
  @IpcMethod()
  getAllStatus(): Record<string, BinaryStatus> {
    return Object.fromEntries(this.manager.getAllStatus());
  }

  /**
   * Clear binary status cache
   */
  @IpcMethod()
  clearCache(name?: string): void {
    this.manager.clearCache(name);
    logger.debug(`Cleared binary cache${name ? ` for: ${name}` : ''}`);
  }

  /**
   * Get list of registered binary names
   */
  @IpcMethod()
  getRegistered(): string[] {
    return this.manager.getRegistered();
  }

  /**
   * Get all categories
   */
  @IpcMethod()
  getCategories(): BinaryCategory[] {
    return this.manager.getCategories();
  }

  /**
   * Get binaries in a category with their info
   */
  @IpcMethod()
  getInCategory(category: BinaryCategory): Array<{
    description?: string;
    name: string;
    priority?: number;
  }> {
    return this.manager.getInCategory(category).map((spec) => ({
      description: spec.description,
      name: spec.name,
      priority: spec.priority,
    }));
  }

  /**
   * Get Claude Code CLI auth/account status by running `claude auth status --json`.
   * Returns null if the CLI is unavailable or the command fails.
   */
  @IpcMethod()
  async getClaudeAuthStatus(command = 'claude'): Promise<ClaudeAuthStatus | null> {
    const resolvedCommand = command.trim() || 'claude';

    try {
      const { stdout } = await execFilePromise(resolvedCommand, ['auth', 'status', '--json'], {
        timeout: 5000,
        windowsHide: true,
      });
      return JSON.parse(stdout.trim()) as ClaudeAuthStatus;
    } catch (error) {
      logger.debug('Failed to get claude auth status:', error);
      return null;
    }
  }
}
