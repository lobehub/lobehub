import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    historySummary?: {
      formattedLength: number;
      injected: boolean;
      originalLength: number;
    };
  }
}

const log = debug('context-engine:provider:HistorySummaryProvider');

/**
 * History Summary Configuration
 */
export interface HistorySummaryConfig {
  /** History summary template function */
  formatHistorySummary?: (summary: string) => string;
  /** History summary content */
  historySummary?: string;
}

/**
 * Default history summary formatter function
 */
const defaultHistorySummaryFormatter = (historySummary: string): string => `<chat_history_summary>
<docstring>Users may have lots of chat messages, here is the summary of the history:</docstring>
<summary>${historySummary}</summary>
</chat_history_summary>`;

/**
 * History Summary Provider
 * Responsible for injecting history conversation summary into system messages
 */
export class HistorySummaryProvider extends BaseSystemRoleProvider {
  readonly name = 'HistorySummaryProvider';

  constructor(
    private config: HistorySummaryConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (!this.config.historySummary) {
      log('No history summary content, skipping processing');
      return null;
    }

    const formatter = this.config.formatHistorySummary || defaultHistorySummaryFormatter;
    return formatter(this.config.historySummary);
  }

  protected onInjected(context: PipelineContext, content: string): void {
    context.metadata.historySummary = {
      formattedLength: content.length,
      injected: true,
      originalLength: this.config.historySummary!.length,
    };
  }
}
