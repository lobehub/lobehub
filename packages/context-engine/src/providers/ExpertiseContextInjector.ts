import type { ExpertisePromptDomain, ExpertisePromptLesson } from '@lobechat/prompts';
import { promptExpertise } from '@lobechat/prompts';
import type { ExpertiseContextSnapshot } from '@lobechat/types';
import { EXPERTISE_CONTEXT_SCHEMA_VERSION } from '@lobechat/types';
import { Md5 } from 'ts-md5';

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
  enabled?: boolean;
  expertise?: ExpertiseContextSnapshot;
}

interface ExpertiseContextDomain extends ExpertisePromptDomain {
  id: string;
}

interface ExpertiseContextLesson extends ExpertisePromptLesson {
  id: string;
}

export interface ExpertiseContextSource {
  listDomainsForAgent: (
    agentId: string,
  ) => Promise<Array<{ domain: Omit<ExpertiseContextDomain, 'lessons'> }>>;
  listLessons: (domainId: string) => Promise<ExpertiseContextLesson[]>;
}

export const buildExpertiseContextSnapshot = async (
  source: ExpertiseContextSource,
  agentId: string,
): Promise<ExpertiseContextSnapshot | undefined> => {
  const bindings = await source.listDomainsForAgent(agentId);
  if (bindings.length === 0) return undefined;

  const domains = await Promise.all(
    bindings.map(async ({ domain }) => ({
      ...domain,
      lessons: await source.listLessons(domain.id),
    })),
  );
  const renderedContext = promptExpertise(domains);

  return {
    contentHash: Md5.hashStr(renderedContext),
    domains: domains.map((domain) => ({
      id: domain.id,
      lessonIds: domain.lessons.map(({ id }) => id),
    })),
    renderedContext,
    schemaVersion: EXPERTISE_CONTEXT_SCHEMA_VERSION,
  };
};

export class ExpertiseContextInjector extends BaseFirstUserContentProvider {
  readonly name = 'ExpertiseContextInjector';

  constructor(
    private readonly config: ExpertiseContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(): null | string {
    if (!this.config.enabled) return null;
    return this.config.expertise?.renderedContext || null;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);
    const snapshot = this.config.expertise;
    if (!this.config.enabled || !snapshot?.renderedContext) return result;

    result.metadata.expertiseContentHash = snapshot.contentHash;
    result.metadata.expertiseDomainCount = snapshot.domains.length;
    result.metadata.expertiseLessonCount = snapshot.domains.reduce(
      (total, domain) => total + domain.lessonIds.length,
      0,
    );
    return result;
  }
}
