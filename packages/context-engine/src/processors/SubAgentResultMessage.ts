import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    subAgentResultMessagesWrapped?: number;
  }
}

const log = debug('context-engine:processor:SubAgentResultMessageProcessor');

const escapeAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/**
 * Sub-Agent Result Message Processor
 *
 * A background sub-agent (`callSubAgent` / `callAgent` with `runInBackground`)
 * reports back as a `user` message whose sender is that sub-agent
 * (`metadata.subAgentCallback`), with its answer as the content. The chat shows
 * it as the sub-agent speaking; the model must not read it as the human, so
 * the content is wrapped in `<sub_agent_result>` — whose `id` is what
 * `callSubAgent({ subAgentId })` takes to follow up.
 */
export class SubAgentResultMessageProcessor extends BaseProcessor {
  readonly name = 'SubAgentResultMessageProcessor';

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let wrapped = 0;

    clonedContext.messages = clonedContext.messages.map((message) => {
      const sender = message.metadata?.subAgentCallback;
      if (message.role !== 'user' || !sender || typeof message.content !== 'string') {
        return message;
      }

      wrapped += 1;
      return {
        ...message,
        content: `<sub_agent_result id="${escapeAttribute(sender.threadId)}" name="${escapeAttribute(sender.name)}" status="${sender.status}">\n${message.content.trim()}\n</sub_agent_result>`,
      };
    });

    clonedContext.metadata.subAgentResultMessagesWrapped = wrapped;
    if (wrapped > 0) log(`Wrapped ${wrapped} sub-agent result message(s)`);

    return this.markAsExecuted(clonedContext);
  }
}
