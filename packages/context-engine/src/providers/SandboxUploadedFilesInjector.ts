import debug from 'debug';

import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import type { Message, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:SandboxUploadedFilesInjector');

export interface SandboxUploadedFilesInjectorConfig {
  enabled?: boolean;
  /** Pre-formatted `<uploaded_files>` blocks keyed by the user message that uploaded them. */
  filesByMessage?: Record<string, string>;
}

/**
 * Attaches sandbox `/mnt/data` upload notices onto the user message that
 * introduced each attachment.
 *
 * Putting topic attachments into `{{sandbox_uploaded_files}}` inside message
 * `[0]` rewrites the leading system prompt whenever the user uploads a new file
 * on a later turn, invalidating the prompt cache for the entire conversation
 * behind it. Anchoring each message's uploads onto that message keeps message
 * `[0]` and all earlier turns byte-identical; session-level files and uploads
 * whose originating message fell out of the visible history window fall back to
 * `{{sandbox_uploaded_files}}` in message `[0]`.
 */
export class SandboxUploadedFilesInjector extends BaseEveryUserContentProvider {
  readonly name = 'SandboxUploadedFilesInjector';

  constructor(
    private config: SandboxUploadedFilesInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContentForMessage(
    message: Message,
  ): { content: string; contextType: string } | null {
    if (this.config.enabled === false || !message.id) return null;

    const content = this.config.filesByMessage?.[message.id];
    if (!content) return null;

    log('Attaching sandbox uploaded files notice to message %s', message.id);
    return { content, contextType: 'sandbox_uploaded_files' };
  }
}
