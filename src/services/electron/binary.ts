import {
  type BinaryCategory,
  type BinaryInfo,
  type BinaryStatus,
  type ClaudeAuthStatus,
  type DetectHeterogeneousAgentCommandParams,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class BinaryService {
  /**
   * Detect a single binary
   */
  detect = async (name: string, force = false): Promise<BinaryStatus> => {
    return ensureElectronIpc().binary.detect(name, force);
  };

  detectHeterogeneousAgentCommand = async (
    params: DetectHeterogeneousAgentCommandParams,
  ): Promise<BinaryStatus> => {
    return ensureElectronIpc().binary.detectHeterogeneousAgentCommand(params);
  };

  /**
   * Detect all registered binaries
   */
  detectAll = async (force = false): Promise<Record<string, BinaryStatus>> => {
    return ensureElectronIpc().binary.detectAll(force);
  };

  /**
   * Detect all binaries in a category
   */
  detectCategory = async (
    category: BinaryCategory,
    force = false,
  ): Promise<Record<string, BinaryStatus>> => {
    return ensureElectronIpc().binary.detectCategory(category, force);
  };

  /**
   * Get the best available binary in a category
   */
  getBestTool = async (category: BinaryCategory): Promise<string | null> => {
    return ensureElectronIpc().binary.getBestTool(category);
  };

  /**
   * Get cached status for a binary (no detection)
   */
  getStatus = async (name: string): Promise<BinaryStatus | null> => {
    return ensureElectronIpc().binary.getStatus(name);
  };

  /**
   * Get all cached statuses (no detection)
   */
  getAllStatus = async (): Promise<Record<string, BinaryStatus>> => {
    return ensureElectronIpc().binary.getAllStatus();
  };

  /**
   * Clear binary status cache
   */
  clearCache = async (name?: string): Promise<void> => {
    await ensureElectronIpc().binary.clearCache(name);
  };

  /**
   * Get list of registered binary names
   */
  getRegistered = async (): Promise<string[]> => {
    return ensureElectronIpc().binary.getRegistered();
  };

  /**
   * Get all categories
   */
  getCategories = async (): Promise<BinaryCategory[]> => {
    return ensureElectronIpc().binary.getCategories();
  };

  /**
   * Get binaries in a category with their info
   */
  getInCategory = async (category: BinaryCategory): Promise<BinaryInfo[]> => {
    return ensureElectronIpc().binary.getInCategory(category);
  };

  /**
   * Get Claude Code CLI auth/account status
   */
  getClaudeAuthStatus = async (command = 'claude'): Promise<ClaudeAuthStatus | null> => {
    return ensureElectronIpc().binary.getClaudeAuthStatus(command);
  };
}

export const binaryService = new BinaryService();
