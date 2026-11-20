import { count as countRows } from 'drizzle-orm';

import { TopicModel } from '@/database/models/topic';
import {
  UserMemoryActivityModel,
  UserMemoryContextModel,
  UserMemoryExperienceModel,
  UserMemoryModel,
  UserMemoryPreferenceModel,
} from '@/database/models/userMemory';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { buildUserMemoryWhere } from '@/database/models/userMemory/where';
import { userMemories } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type { DeletedResource, DeletedResources } from '../types/common.type';
import type { MemoryCategory } from '../types/memory.type';

/**
 * User memory REST service — the durable, inspectable personal memory a
 * personal agent plans against.
 *
 * Every model here is constructed with the caller's `userId` alone, so the
 * store is intrinsically scoped to the user; there is no cross-user read path
 * to guard. Deleting an entry immediately removes it from future retrieval,
 * which is the contract the memory UI already promises.
 */
export class MemoryRestService extends BaseService {
  private readonly activityModel: UserMemoryActivityModel;
  private readonly contextModel: UserMemoryContextModel;
  private readonly experienceModel: UserMemoryExperienceModel;
  private readonly personaModel: UserPersonaModel;
  private readonly preferenceModel: UserMemoryPreferenceModel;
  private readonly topicModel: TopicModel;
  private readonly userMemoryModel: UserMemoryModel;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    const owner = userId ?? '';
    this.activityModel = new UserMemoryActivityModel(db, owner);
    this.contextModel = new UserMemoryContextModel(db, owner);
    this.experienceModel = new UserMemoryExperienceModel(db, owner);
    this.personaModel = new UserPersonaModel(db, owner);
    this.preferenceModel = new UserMemoryPreferenceModel(db, owner);
    this.topicModel = new TopicModel(db, owner, workspaceId);
    this.userMemoryModel = new UserMemoryModel(db, owner);
  }

  /** The current persona document: its prose plus the one-line tagline. */
  async getPersona(): ServiceResult<{ content: string; summary: string } | null> {
    const latest = await this.personaModel.getLatestPersonaDocument();
    if (!latest) return null;
    return { content: latest.persona ?? '', summary: latest.tagline ?? '' };
  }

  listPersonaVersions(): ServiceResult<unknown> {
    return this.personaModel.listVersions();
  }

  async listCategory(category: MemoryCategory): ServiceResult<unknown> {
    switch (category) {
      case 'identities': {
        return this.userMemoryModel.getAllIdentities();
      }
      case 'preferences': {
        return this.userMemoryModel.searchPreferences({});
      }
      case 'contexts': {
        return this.userMemoryModel.searchContexts({});
      }
      case 'activities': {
        return this.userMemoryModel.searchActivities({});
      }
      case 'experiences': {
        return this.userMemoryModel.searchExperiences({});
      }
    }
  }

  async deleteEntry(category: MemoryCategory, id: string): ServiceResult<DeletedResource> {
    const removed = await this.removeEntry(category, id);
    // The models report a miss instead of throwing; an entry that is not the
    // caller's (or is already gone) must not read as deleted.
    if (!removed) throw this.createNotFoundError('Memory entry not found');
    return { deleted: true, id };
  }

  private async removeEntry(category: MemoryCategory, id: string): Promise<boolean> {
    switch (category) {
      case 'identities': {
        return this.userMemoryModel.removeIdentityEntry(id);
      }
      case 'preferences': {
        return (await this.preferenceModel.delete(id)).success;
      }
      case 'contexts': {
        return (await this.contextModel.delete(id)).success;
      }
      case 'activities': {
        return (await this.activityModel.delete(id)).success;
      }
      case 'experiences': {
        return (await this.experienceModel.delete(id)).success;
      }
    }
  }

  /**
   * Purge everything: memory entries, the persona document, and the per-topic
   * extraction status. Resetting the status matters — without it every topic
   * stays marked "extracted" and the purged memories can never come back.
   */
  async deleteAll(): ServiceResult<DeletedResources> {
    // `count` is the number of memories actually removed: counted inside the
    // same transaction as the delete, with the predicate the model deletes by.
    const count = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ count: countRows() })
        .from(userMemories)
        .where(buildUserMemoryWhere(tx, this.userId, userMemories));
      await new UserMemoryModel(tx, this.userId).deleteAll();
      return Number(row?.count ?? 0);
    });
    await this.personaModel.deletePersona();
    await this.topicModel.resetMemoryExtractStatus();
    return { count, deleted: true };
  }
}
