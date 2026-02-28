import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:SystemDateProvider');

export interface SystemDateProviderConfig {
  enabled?: boolean;
}

export class SystemDateProvider extends BaseProvider {
  readonly name = 'SystemDateProvider';

  constructor(
    private config: SystemDateProviderConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    if (this.config.enabled === false) {
      log('System date injection disabled, skipping');
      return this.markAsExecuted(clonedContext);
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const dateContent = `Current date: ${dateStr}`;

    const existingSystemMessage = clonedContext.messages.find((msg) => msg.role === 'system');

    if (existingSystemMessage) {
      existingSystemMessage.content = [existingSystemMessage.content, dateContent]
        .filter(Boolean)
        .join('\n\n');
    } else {
      clonedContext.messages.unshift({
        content: dateContent,
        createdAt: Date.now(),
        id: `system-date-${Date.now()}`,
        role: 'system' as const,
        updatedAt: Date.now(),
      } as any);
    }

    clonedContext.metadata.systemDateInjected = true;

    log('System date injected: %s', dateStr);

    return this.markAsExecuted(clonedContext);
  }
}
