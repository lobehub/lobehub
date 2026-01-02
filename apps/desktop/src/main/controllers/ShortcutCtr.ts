import { ShortcutUpdateResult } from '@/core/ui/ShortcutManager';

import { ControllerModule, IpcMethod } from '.';

export default class ShortcutController extends ControllerModule {
  static override readonly groupName = 'shortcut';
  /**
   * Get all shortcut configurations
   */
  @IpcMethod()
  getShortcutsConfig() {
    return this.app.shortcutManager.getShortcutsConfig();
  }

  /**
   * Update a single shortcut configuration
   */
  @IpcMethod()
  updateShortcutConfig({
    id,
    accelerator,
  }: {
    accelerator: string;
    id: string;
  }): ShortcutUpdateResult {
    return this.app.shortcutManager.updateShortcutConfig(id, accelerator);
  }
}
