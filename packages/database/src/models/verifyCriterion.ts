import { createHash } from 'node:crypto';

import type { VerifyCheckItem } from '@lobechat/types';
import { verifyCheckDefinitionSchema } from '@lobechat/types';
import { and, arrayContains, desc, eq, ilike, inArray, isNull } from 'drizzle-orm';

import { documents, files } from '../schemas/file';
import type { NewVerifyCriterion, VerifyCriterionItem } from '../schemas/verify';
import { verifyCriteria, verifyRubricCriteria } from '../schemas/verify';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export class VerifyCriterionModel {
  private readonly db: LobeChatDatabase | Transaction;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase | Transaction, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, verifyCriteria);

  create = async (params: Omit<NewVerifyCriterion, 'userId' | 'workspaceId'>) => {
    if (params.definition) verifyCheckDefinitionSchema.parse(params.definition);
    const [result] = await this.db
      .insert(verifyCriteria)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.delete(verifyCriteria).where(and(eq(verifyCriteria.id, id), this.ownership()));
  };

  query = async (filters: { search?: string; tags?: string[]; includeArchived?: boolean } = {}) => {
    return this.db
      .select()
      .from(verifyCriteria)
      .where(
        and(
          this.ownership(),
          filters.includeArchived ? undefined : isNull(verifyCriteria.archivedAt),
          filters.search
            ? ilike(
                verifyCriteria.title,
                `%${filters.search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
              )
            : undefined,
          filters.tags?.length ? arrayContains(verifyCriteria.tags, filters.tags) : undefined,
        ),
      )
      .orderBy(desc(verifyCriteria.updatedAt));
  };

  findById = async (id: string) => {
    const [row] = await this.db
      .select()
      .from(verifyCriteria)
      .where(and(eq(verifyCriteria.id, id), this.ownership()));
    return row;
  };

  /**
   * Resolve a set of criterion ids into their current definitions. Used by the
   * plan generator to instantiate ad-hoc `verifyCriteriaIds` mounted on an agent.
   * Scoped to the active workspace (or personal scope) so a leaked id can't pull
   * another tenant's criterion.
   */
  findByIds = async (ids: string[]): Promise<VerifyCriterionItem[]> => {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(verifyCriteria)
      .where(and(inArray(verifyCriteria.id, ids), this.ownership()));
  };

  /**
   * Give a task private copies of criteria that are still mounted on a reusable
   * rubric. Older task configs could point at the rubric rows directly; editing
   * those rows would silently rewrite the template for every future task.
   *
   * Returned ids preserve the input order. Criteria that are already task-local
   * keep their identity, while rubric-owned criteria are cloned in one transaction.
   */
  forkRubricCriteria = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return [];

    return this.db.transaction(async (tx) => {
      const criteria = await tx
        .select()
        .from(verifyCriteria)
        .where(and(inArray(verifyCriteria.id, ids), this.ownership()));
      const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));

      const rubricLinks = await tx
        .select({ criterionId: verifyRubricCriteria.criterionId })
        .from(verifyRubricCriteria)
        .where(
          and(
            inArray(verifyRubricCriteria.criterionId, ids),
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              verifyRubricCriteria,
            ),
          ),
        );
      const sharedIds = new Set(rubricLinks.map(({ criterionId }) => criterionId));
      const sharedCriteria = ids
        .filter((id, index) => sharedIds.has(id) && ids.indexOf(id) === index)
        .map((id) => criteriaById.get(id))
        .filter((criterion): criterion is VerifyCriterionItem => Boolean(criterion));

      if (sharedCriteria.length === 0) return ids;

      const clones = await tx
        .insert(verifyCriteria)
        .values(
          sharedCriteria.map(
            ({ createdAt: _createdAt, id: _id, updatedAt: _updatedAt, ...criterion }) =>
              buildWorkspacePayload(
                { userId: this.userId, workspaceId: this.workspaceId },
                criterion,
              ),
          ),
        )
        .returning({ id: verifyCriteria.id });
      const forkedById = new Map(
        sharedCriteria.map((criterion, index) => [criterion.id, clones[index].id]),
      );

      return ids.map((id) => forkedById.get(id) ?? id);
    });
  };

  /** Persist generated checks automatically; stable ids make ingest/retries idempotent. */
  materialize = async (items: VerifyCheckItem[], contextId: string): Promise<VerifyCheckItem[]> => {
    return this.db.transaction(async (tx) => {
      const output: VerifyCheckItem[] = [];
      for (const item of items) {
        if (item.definition) verifyCheckDefinitionSchema.parse(item.definition);
        let sourceCriterionId = item.sourceCriterionId;
        if (!sourceCriterionId) {
          const hex = createHash('sha256')
            .update(JSON.stringify([this.workspaceId ?? this.userId, contextId, item.id]))
            .digest('hex');
          sourceCriterionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
          await tx
            .insert(verifyCriteria)
            .values(
              buildWorkspacePayload(
                { userId: this.userId, workspaceId: this.workspaceId },
                {
                  id: sourceCriterionId,
                  title: item.title,
                  description: item.description,
                  definition: item.definition,
                  documentId: item.documentId,
                  verifierType: item.verifierType,
                  verifierConfig: item.verifierConfig,
                  required: item.required,
                  onFail: item.onFail,
                },
              ),
            )
            .onConflictDoNothing();
        }
        const [asset] = await tx
          .select()
          .from(verifyCriteria)
          .where(and(eq(verifyCriteria.id, sourceCriterionId), this.ownership()));
        if (!asset) throw new Error('Check asset not found in current scope');
        const definition = item.definition ??
          asset.definition ?? {
            expected:
              typeof item.verifierConfig.expected === 'string'
                ? item.verifierConfig.expected
                : undefined,
            steps:
              typeof item.verifierConfig.method === 'string'
                ? [{ id: 'legacy-method', instruction: item.verifierConfig.method }]
                : undefined,
          };
        let resourceSnapshot = item.resourceSnapshot;
        if (!resourceSnapshot) {
          resourceSnapshot = { fixtures: [] };
          const documentId = item.documentId ?? asset.documentId;
          if (documentId) {
            const [document] = await tx
              .select()
              .from(documents)
              .where(
                and(
                  eq(documents.id, documentId),
                  buildWorkspaceWhere(
                    { userId: this.userId, workspaceId: this.workspaceId },
                    documents,
                  ),
                ),
              );
            if (!document) throw new Error('Check document unavailable');
            resourceSnapshot.documentContent = document.content ?? '';
          }
          for (const fixture of definition?.fixtures ?? []) {
            if (!fixture.resource) continue;
            if (fixture.resource.type === 'document') {
              const [document] = await tx
                .select()
                .from(documents)
                .where(
                  and(
                    eq(documents.id, fixture.resource.id),
                    buildWorkspaceWhere(
                      { userId: this.userId, workspaceId: this.workspaceId },
                      documents,
                    ),
                  ),
                );
              if (!document) throw new Error('Fixture document unavailable');
              resourceSnapshot.fixtures.push({
                fixtureId: fixture.id,
                content: document.content ?? '',
              });
            } else {
              const [file] = await tx
                .select()
                .from(files)
                .where(
                  and(
                    eq(files.id, fixture.resource.id),
                    buildWorkspaceWhere(
                      { userId: this.userId, workspaceId: this.workspaceId },
                      files,
                    ),
                  ),
                );
              if (!file?.fileHash) throw new Error('Fixture requires an immutable file hash');
              resourceSnapshot.fixtures.push({
                fixtureId: fixture.id,
                fileHash: file.fileHash,
                url: file.url,
              });
            }
          }
        }
        output.push({ ...item, sourceCriterionId, definition, resourceSnapshot });
      }
      return output;
    });
  };

  update = async (id: string, value: Partial<Omit<VerifyCriterionItem, 'id' | 'userId'>>) => {
    if (value.definition) verifyCheckDefinitionSchema.parse(value.definition);
    return this.db
      .update(verifyCriteria)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(verifyCriteria.id, id), this.ownership()));
  };
}
