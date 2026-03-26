import debug from 'debug';

import type { PipelineContext, ProcessorOptions } from '../types';
import { BaseProcessor } from './BaseProcessor';

const log = debug('context-engine:base:BaseSystemRoleProvider');

/**
 * Base class for providers that append content to the system message.
 *
 * Subclasses implement `buildSystemRoleContent()` to return the content
 * to append (or `null` to skip). The base class handles finding or
 * creating the system message and joining content with `\n\n`.
 */
export abstract class BaseSystemRoleProvider extends BaseProcessor {
  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  /**
   * Return the content string to append to the system message,
   * or `null` / empty string to skip injection.
   */
  protected abstract buildSystemRoleContent(
    context: PipelineContext,
  ): Promise<string | null> | string | null;

  /**
   * Called after content is successfully injected into the system message.
   * Override to update pipeline metadata (e.g. tracking flags, stats).
   */
  protected onInjected(_context: PipelineContext, _content: string): void {}

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const content = await this.buildSystemRoleContent(context);

    if (!content || content.trim() === '') {
      log('[%s] No content to inject, skipping', this.name);
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);

    const systemMsgIndex = clonedContext.messages.findIndex((m) => m.role === 'system');

    if (systemMsgIndex >= 0) {
      const existing = clonedContext.messages[systemMsgIndex];
      clonedContext.messages[systemMsgIndex] = {
        ...existing,
        content: [existing.content, content].filter(Boolean).join('\n\n'),
      };
      log('[%s] Appended to existing system message', this.name);
    } else {
      clonedContext.messages.unshift({
        content,
        createdAt: Date.now(),
        id: `system-${this.name}-${Date.now()}`,
        role: 'system' as const,
        updatedAt: Date.now(),
      } as any);
      log('[%s] Created new system message', this.name);
    }

    this.onInjected(clonedContext, content);

    return this.markAsExecuted(clonedContext);
  }
}
