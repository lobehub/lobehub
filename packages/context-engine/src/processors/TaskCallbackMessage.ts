import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    taskCallbackMessagesSurfaced?: number;
  }
}

const log = debug('context-engine:processor:TaskCallbackMessageProcessor');

/**
 * Task Callback Message Processor
 *
 * `role='taskCallback'` messages are the result-bridge cards: when a task
 * dispatched from this conversation finishes, the lifecycle injects one carrying
 * the handoff summary (LOBE-10625). `taskCallback` is not a valid model role, so
 * it can't reach the model as-is. We surface it as a `user` turn wrapped in a
 * `<task_result>` tag — so the creator agent reads it as the task reporting back
 * (not as human input) and continues the conversation off it.
 *
 * An empty-content card (no handoff text) is dropped from the model context; it
 * stays persisted + rendered as a UI-only card.
 */
export class TaskCallbackMessageProcessor extends BaseProcessor {
  readonly name = 'TaskCallbackMessageProcessor';

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let surfaced = 0;

    clonedContext.messages = clonedContext.messages.flatMap((message) => {
      if (message.role !== 'taskCallback') return [message];

      const content = typeof message.content === 'string' ? message.content.trim() : '';
      // UI-only card with no handoff text — drop it from the model context.
      if (!content) return [];

      const callback = message.metadata?.taskCallback;
      const identifier = callback?.identifier ?? 'task';
      const reason = callback?.reason ?? 'done';

      surfaced += 1;
      return [
        {
          ...message,
          content: `<task_result task="${identifier}" status="${reason}">\n${content}\n</task_result>`,
          role: 'user' as const,
        },
      ];
    });

    clonedContext.metadata.taskCallbackMessagesSurfaced = surfaced;
    if (surfaced > 0) log(`Surfaced ${surfaced} task-callback message(s) as user turn(s)`);

    return this.markAsExecuted(clonedContext);
  }
}
