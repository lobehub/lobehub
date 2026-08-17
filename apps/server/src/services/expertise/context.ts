import { createHash } from 'node:crypto';

import { promptExpertise } from '@lobechat/prompts';
import type { ExpertiseContextSnapshot } from '@lobechat/types';

import { ExpertiseModel } from '@/database/models/expertise';
import type { LobeChatDatabase } from '@/database/type';

const SNAPSHOT_SCHEMA_VERSION = 1;

export class ExpertiseContextService {
  private readonly model: Pick<ExpertiseModel, 'listDomainsForAgent' | 'listLessons'>;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    model?: Pick<ExpertiseModel, 'listDomainsForAgent' | 'listLessons'>,
  ) {
    this.model = model ?? new ExpertiseModel(db, userId, workspaceId);
  }

  buildSnapshot = async (agentId: string): Promise<ExpertiseContextSnapshot | undefined> => {
    const bindings = await this.model.listDomainsForAgent(agentId);
    if (bindings.length === 0) return undefined;

    const domains = await Promise.all(
      bindings.map(async ({ domain }) => ({
        canonEntries: domain.canonEntries,
        domainFilter: domain.domainFilter,
        flow: domain.flow,
        id: domain.id,
        lessons: (await this.model.listLessons(domain.id)).map((lesson) => ({
          code: lesson.code,
          id: lesson.id,
          layer: lesson.layer,
          polarity: lesson.polarity,
          sections: lesson.sections,
          title: lesson.title,
        })),
        outOfScope: domain.outOfScope,
        slug: domain.slug,
        title: domain.title,
      })),
    );
    const renderedContext = promptExpertise(domains);

    return {
      contentHash: createHash('sha256').update(renderedContext).digest('hex'),
      domains: domains.map((domain) => ({
        id: domain.id,
        lessonIds: domain.lessons.map(({ id }) => id),
      })),
      renderedContext,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    };
  };
}
