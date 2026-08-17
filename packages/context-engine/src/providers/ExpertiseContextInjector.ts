import type { ExpertiseContextSnapshot } from '@lobechat/types';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    expertiseContentHash?: string;
    expertiseDomainCount?: number;
    expertiseLessonCount?: number;
  }
}

export interface ExpertiseContextInjectorConfig {
  expertise?: ExpertiseContextSnapshot;
}

export class ExpertiseContextInjector extends BaseFirstUserContentProvider {
  readonly name = 'ExpertiseContextInjector';

  constructor(
    private readonly config: ExpertiseContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(): null | string {
    return this.config.expertise?.renderedContext || null;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);
    const snapshot = this.config.expertise;
    if (!snapshot?.renderedContext) return result;

    result.metadata.expertiseContentHash = snapshot.contentHash;
    result.metadata.expertiseDomainCount = snapshot.domains.length;
    result.metadata.expertiseLessonCount = snapshot.domains.reduce(
      (total, domain) => total + domain.lessonIds.length,
      0,
    );
    return result;
  }
}
