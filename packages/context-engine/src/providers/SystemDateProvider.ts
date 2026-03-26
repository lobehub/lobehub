import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    systemDateInjected?: boolean;
  }
}

const log = debug('context-engine:provider:SystemDateProvider');

export interface SystemDateProviderConfig {
  enabled?: boolean;
  timezone?: string | null;
}

export class SystemDateProvider extends BaseSystemRoleProvider {
  readonly name = 'SystemDateProvider';

  constructor(
    private config: SystemDateProviderConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) {
      log('System date injection disabled, skipping');
      return null;
    }

    const tz = this.config.timezone || 'UTC';
    const today = new Date();

    const year = today.toLocaleString('en-US', { timeZone: tz, year: 'numeric' });
    const month = today.toLocaleString('en-US', { month: '2-digit', timeZone: tz });
    const day = today.toLocaleString('en-US', { day: '2-digit', timeZone: tz });
    const dateStr = `${year}-${month}-${day}`;

    log('System date injected: %s', dateStr);
    return `Current date: ${dateStr} (${tz})`;
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.systemDateInjected = true;
  }
}
