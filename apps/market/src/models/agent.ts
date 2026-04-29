import { and, asc, count, desc, eq, ilike, max, or, sql } from 'drizzle-orm';

import type {
  MarketAgentEventItem,
  MarketAgentItem,
  MarketAgentVersionItem,
  NewMarketAgent,
  NewMarketAgentEvent,
  NewMarketAgentVersion,
} from '../../../../packages/database/src/schemas/market';
import {
  marketAgentEvents,
  marketAgents,
  marketAgentVersions,
} from '../../../../packages/database/src/schemas/market';
import type { MarketDatabase } from '../types';

export type MarketAgentStatus = 'published' | 'unpublished' | 'archived' | 'deprecated';
export type MarketAgentVisibility = 'public' | 'private' | 'internal';

export interface AgentListParams {
  includePrivateForOwnerId?: number;
  order?: 'asc' | 'desc';
  ownerId?: number;
  page?: number;
  pageSize?: number;
  query?: string;
  status?: MarketAgentStatus;
  visibility?: MarketAgentVisibility;
}

export interface AgentForkListParams {
  includePrivateForOwnerId?: number;
  status?: MarketAgentStatus;
}

export interface AgentListRow {
  agent: MarketAgentItem;
  version: MarketAgentVersionItem | null;
}

export class AgentModel {
  constructor(private readonly db: MarketDatabase) {}

  async findByIdentifier(identifier: string) {
    const [agent] = await this.db
      .select()
      .from(marketAgents)
      .where(eq(marketAgents.identifier, identifier))
      .limit(1);

    return agent;
  }

  async findById(id: number) {
    const [agent] = await this.db
      .select()
      .from(marketAgents)
      .where(eq(marketAgents.id, id))
      .limit(1);

    return agent;
  }

  async createAgent(values: NewMarketAgent) {
    const [agent] = await this.db.insert(marketAgents).values(values).returning();

    return agent;
  }

  async updateAgent(identifier: string, values: Partial<NewMarketAgent>) {
    const [agent] = await this.db
      .update(marketAgents)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(eq(marketAgents.identifier, identifier))
      .returning();

    return agent;
  }

  async createVersion(values: NewMarketAgentVersion) {
    const [version] = await this.db.transaction(async (tx) => {
      await tx
        .update(marketAgentVersions)
        .set({
          isLatest: false,
          updatedAt: new Date(),
        })
        .where(eq(marketAgentVersions.agentId, values.agentId));

      const insertedVersions = await tx.insert(marketAgentVersions).values(values).returning();
      const [insertedVersion] = insertedVersions;

      await tx
        .update(marketAgents)
        .set({
          currentVersionId: insertedVersion.id,
          updatedAt: new Date(),
        })
        .where(eq(marketAgents.id, values.agentId));

      return insertedVersions;
    });

    return version;
  }

  async updateVersion(id: number, values: Partial<NewMarketAgentVersion>) {
    const [version] = await this.db
      .update(marketAgentVersions)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(eq(marketAgentVersions.id, id))
      .returning();

    return version;
  }

  async findLatestVersion(agentId: number) {
    const [version] = await this.db
      .select()
      .from(marketAgentVersions)
      .where(and(eq(marketAgentVersions.agentId, agentId), eq(marketAgentVersions.isLatest, true)))
      .limit(1);

    return version;
  }

  async findVersionByVersionString(agentId: number, versionString: string) {
    const [version] = await this.db
      .select()
      .from(marketAgentVersions)
      .where(
        and(
          eq(marketAgentVersions.agentId, agentId),
          eq(marketAgentVersions.version, versionString),
        ),
      )
      .limit(1);

    return version;
  }

  async getNextVersionNumber(agentId: number) {
    const [result] = await this.db
      .select({ versionNumber: max(marketAgentVersions.versionNumber) })
      .from(marketAgentVersions)
      .where(eq(marketAgentVersions.agentId, agentId));

    return (result?.versionNumber ?? 0) + 1;
  }

  async list(params: AgentListParams = {}) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const filters = [
      params.ownerId === undefined ? undefined : eq(marketAgents.ownerId, params.ownerId),
      params.status === undefined ? undefined : eq(marketAgents.status, params.status),
      params.visibility === undefined
        ? params.includePrivateForOwnerId === undefined
          ? eq(marketAgents.visibility, 'public')
          : or(
              eq(marketAgents.visibility, 'public'),
              and(
                eq(marketAgents.ownerId, params.includePrivateForOwnerId),
                or(eq(marketAgents.visibility, 'private'), eq(marketAgents.visibility, 'internal')),
              ),
            )
        : eq(marketAgents.visibility, params.visibility),
      params.query === undefined || params.query.trim() === ''
        ? undefined
        : or(
            ilike(marketAgents.identifier, `%${params.query}%`),
            ilike(marketAgents.name, `%${params.query}%`),
          ),
    ].filter((filter) => filter !== undefined);
    const where = filters.length > 0 ? and(...filters) : undefined;
    const orderBy =
      params.order === 'asc' ? asc(marketAgents.updatedAt) : desc(marketAgents.updatedAt);

    const [items, totalRows] = await Promise.all([
      this.db
        .select({ agent: marketAgents, version: marketAgentVersions })
        .from(marketAgents)
        .innerJoin(marketAgentVersions, eq(marketAgents.currentVersionId, marketAgentVersions.id))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ count: count(marketAgents.id) })
        .from(marketAgents)
        .innerJoin(marketAgentVersions, eq(marketAgents.currentVersionId, marketAgentVersions.id))
        .where(where),
    ]);

    return {
      items,
      totalCount: totalRows[0]?.count ?? 0,
    };
  }

  async listForks(sourceAgentId: number, params: AgentForkListParams = {}) {
    return await this.db
      .select()
      .from(marketAgents)
      .where(
        and(
          eq(marketAgents.forkedFromAgentId, sourceAgentId),
          params.status === undefined ? undefined : eq(marketAgents.status, params.status),
          params.includePrivateForOwnerId === undefined
            ? eq(marketAgents.visibility, 'public')
            : or(
                eq(marketAgents.visibility, 'public'),
                and(
                  eq(marketAgents.ownerId, params.includePrivateForOwnerId),
                  or(
                    eq(marketAgents.visibility, 'private'),
                    eq(marketAgents.visibility, 'internal'),
                  ),
                ),
              ),
        ),
      )
      .orderBy(desc(marketAgents.createdAt));
  }

  async listIdentifiers() {
    return await this.db
      .select({ id: marketAgents.identifier, lastModified: marketAgents.updatedAt })
      .from(marketAgents)
      .where(and(eq(marketAgents.status, 'published'), eq(marketAgents.visibility, 'public')))
      .orderBy(asc(marketAgents.identifier));
  }

  async listCategories() {
    return await this.db
      .select({
        category: marketAgentVersions.category,
        count: sql<number>`cast(count(${marketAgents.id}) as integer)`,
      })
      .from(marketAgents)
      .innerJoin(marketAgentVersions, eq(marketAgents.currentVersionId, marketAgentVersions.id))
      .where(
        and(
          eq(marketAgents.status, 'published'),
          eq(marketAgents.visibility, 'public'),
          sql`${marketAgentVersions.category} is not null`,
        ),
      )
      .groupBy(marketAgentVersions.category)
      .orderBy(asc(marketAgentVersions.category));
  }

  async increaseInstallCount(identifier: string) {
    const [agent] = await this.db
      .update(marketAgents)
      .set({
        installCount: sql`${marketAgents.installCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(marketAgents.identifier, identifier))
      .returning();

    return agent;
  }

  async createEvent(values: NewMarketAgentEvent): Promise<MarketAgentEventItem | undefined> {
    const [event] = await this.db.insert(marketAgentEvents).values(values).returning();

    return event;
  }
}
