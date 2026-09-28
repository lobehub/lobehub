import type { TabPreviewCaptureParams } from '@lobechat/electron-client-ipc';

import { getIpcContext } from '@/utils/ipc';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:TabPreviewCtr');

const PREVIEW_WIDTH = 320;
const PREVIEW_QUALITY = 60;
const MAX_ENTRIES = 24;

export default class TabPreviewCtr extends ControllerModule {
  static override readonly groupName = 'tabPreview';

  private previews = new Map<string, string>();

  @IpcMethod()
  async capture({ rect, tabId }: TabPreviewCaptureParams): Promise<void> {
    const sender = getIpcContext()?.sender;
    if (!sender || sender.isDestroyed()) return;

    // `capturePage` takes device-independent pixels of the window; the renderer
    // measures CSS pixels of the page, and the two diverge once the user zooms.
    const scale = sender.getZoomFactor();
    const width = Math.floor(rect.width * scale);
    const height = Math.floor(rect.height * scale);
    if (width < 8 || height < 8) return;

    const image = await sender.capturePage({
      height,
      width,
      x: Math.floor(rect.x * scale),
      y: Math.floor(rect.y * scale),
    });
    if (image.isEmpty()) return;

    const thumbnail =
      image.getSize().width > PREVIEW_WIDTH ? image.resize({ width: PREVIEW_WIDTH }) : image;

    this.previews.delete(tabId);
    this.previews.set(
      tabId,
      `data:image/jpeg;base64,${thumbnail.toJPEG(PREVIEW_QUALITY).toString('base64')}`,
    );

    while (this.previews.size > MAX_ENTRIES) {
      const oldest = this.previews.keys().next().value;
      if (oldest === undefined) break;
      this.previews.delete(oldest);
    }

    logger.debug(`captured preview for ${tabId} (${width}x${height} @${scale})`);
  }

  @IpcMethod()
  async get(tabId: string): Promise<string | undefined> {
    return this.previews.get(tabId);
  }
}
