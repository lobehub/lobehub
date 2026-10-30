import type { GoalConfig, GoalCreateConfig, VerifyCheckDefinition } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { GoalModel } from '@/database/models/goal';
import { VerifyCriterionModel } from '@/database/models/verifyCriterion';
import { goalNodes } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { TransferErrorCode } from '@/types/transferError';

import { GoalService } from './GoalService';

/**
 * The part of a goal's config that is policy the owner chose and still means
 * the same thing in another scope. Everything else is either runtime state
 * (manager/supervisor/rollout receipts, planning leases, pause owners, change
 * requests, reports) or names something in the source scope: the task agent,
 * the planning model pair (dropped with the agent it overrides, as `setAgent`
 * does), and the main-Agent policy, which `create` rejects without a goal agent.
 */
const copyableConfig = (config: GoalConfig | null, now: Date): GoalCreateConfig | undefined => {
  if (!config) return undefined;
  const { exploration, maxConcurrentTasks, recovery, rollout, schedule, supervision } = config;
  const deadline = schedule?.deadline;
  return {
    // Criteria ids are re-pointed at the copied rows by the caller; numeric
    // clauses only name series keys, which the copy samples afresh.
    ...(config.acceptance?.metrics?.length
      ? { acceptance: { metrics: config.acceptance.metrics } }
      : {}),
    ...(exploration ? { exploration } : {}),
    ...(maxConcurrentTasks === undefined ? {} : { maxConcurrentTasks }),
    ...(recovery ? { recovery } : {}),
    ...(rollout ? { rollout } : {}),
    // A deadline that already passed would pause the copy the moment it starts.
    ...(deadline && new Date(deadline) > now ? { schedule: { deadline } } : {}),
    ...(supervision?.maxIncidents === undefined
      ? {}
      : { supervision: { enabled: true, maxIncidents: supervision.maxIncidents } }),
  };
};

/**
 * Copy a goal into another scope (personal or a workspace).
 *
 * Like task copy, this clones the goal *definition* only: title, requirement,
 * problem statement, budget, planning policy and acceptance criteria. The
 * copy is a fresh `draft` with its own problem node — no graph progress,
 * Tasks, events, traces, subscriptions or metric observations follow it, and
 * it has no agent or project, since those name rows in the source scope. The
 * owner picks an agent in the target and starts it from the goal page.
 */
export class GoalCopyService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /**
   * The readable fixture resources a copy will duplicate in the target scope,
   * so the caller can check target permissions and storage before writing.
   */
  fixtureResources = async (
    goalId: string,
  ): Promise<{ documentIds: string[]; files: { id: string; size: number }[] }> => {
    const source = await this.findSource(goalId);
    const criteria = await new VerifyCriterionModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findByIds(source.config?.acceptance?.criteriaIds ?? []);
    const documentIds = new Set<string>();
    const fileIds = new Set<string>();
    for (const criterion of criteria)
      for (const { resource } of criterion.definition?.fixtures ?? [])
        if (resource) (resource.type === 'document' ? documentIds : fileIds).add(resource.id);

    const sourceDocuments = new DocumentModel(this.db, this.userId, this.workspaceId);
    const sourceFiles = new FileModel(this.db, this.userId, this.workspaceId);
    const readableDocumentIds: string[] = [];
    for (const id of documentIds)
      if (await sourceDocuments.findById(id)) readableDocumentIds.push(id);
    const files: { id: string; size: number }[] = [];
    for (const id of fileIds) {
      const file = await sourceFiles.findById(id);
      if (file) files.push({ id, size: file.size });
    }
    return { documentIds: readableDocumentIds, files };
  };

  copyToWorkspace = async (
    goalId: string,
    targetWorkspaceId: string | null,
  ): Promise<{ goalId: string }> => {
    const source = await this.findSource(goalId);

    const [problem] = await this.db
      .select({ description: goalNodes.description })
      .from(goalNodes)
      .where(and(eq(goalNodes.goalId, source.id), eq(goalNodes.kind, 'problem')))
      .orderBy(asc(goalNodes.createdAt))
      .limit(1);

    const targetScope = targetWorkspaceId ?? undefined;

    return this.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      const criteriaIds = await this.copyCriteria(
        db,
        source.config?.acceptance?.criteriaIds ?? [],
        targetScope,
      );
      const config = copyableConfig(source.config, new Date());
      const graph = await new GoalService(db, this.userId, targetScope).create({
        config: criteriaIds.length
          ? { ...config, acceptance: { ...config?.acceptance, criteriaIds } }
          : config,
        draft: true,
        maxRounds: source.maxRounds ?? undefined,
        maxTotalCost: source.maxTotalCost ?? undefined,
        problemDescription: problem?.description ?? undefined,
        requirement: source.requirement ?? undefined,
        title: source.title,
      });
      return { goalId: graph.goal.id };
    });
  };

  private findSource = async (goalId: string) => {
    const source = await new GoalModel(this.db, this.userId, this.workspaceId).findById(goalId);
    if (!source)
      throw new TRPCError({
        cause: { data: { code: TransferErrorCode.ResourceNotFound } },
        code: 'NOT_FOUND',
        message: 'Goal not found',
      });
    return source;
  };

  /**
   * Clone the goal's acceptance criteria into the target scope, instruction
   * documents and fixture resources included: criteria, documents and files are
   * scoped rows, and verification resolves them in the copy's scope, so the
   * copy cannot keep pointing at the source's. Returned ids keep the source
   * order; a criterion the caller can no longer read is skipped.
   */
  private copyCriteria = async (
    db: LobeChatDatabase,
    ids: string[],
    targetWorkspaceId: string | undefined,
  ): Promise<string[]> => {
    if (ids.length === 0) return [];
    const sourceCriteria = new VerifyCriterionModel(db, this.userId, this.workspaceId);
    const sourceDocuments = new DocumentModel(db, this.userId, this.workspaceId);
    const sourceFiles = new FileModel(db, this.userId, this.workspaceId);
    const targetCriteria = new VerifyCriterionModel(db, this.userId, targetWorkspaceId);
    const targetDocuments = new DocumentModel(db, this.userId, targetWorkspaceId);

    // Source resource id → its copy, so a resource shared by several criteria is copied once.
    const copiedDocuments = new Map<string, string | undefined>();
    const copiedFiles = new Map<string, string | undefined>();

    const copyDocument = async (id: string): Promise<string | undefined> => {
      if (copiedDocuments.has(id)) return copiedDocuments.get(id);
      const document = await sourceDocuments.findById(id);
      const copy = document
        ? await targetDocuments.create({
            content: document.content,
            fileType: document.fileType,
            source: document.source,
            sourceType: document.sourceType,
            title: document.title,
            totalCharCount: document.totalCharCount,
            totalLineCount: document.totalLineCount,
          })
        : undefined;
      copiedDocuments.set(id, copy?.id);
      return copy?.id;
    };

    // The row is copied; the blob is shared through its file hash.
    const copyFile = async (id: string): Promise<string | undefined> => {
      if (copiedFiles.has(id)) return copiedFiles.get(id);
      const copy = (await sourceFiles.findById(id))
        ? await sourceFiles.copyToWorkspace(id, targetWorkspaceId ?? null, this.userId)
        : undefined;
      copiedFiles.set(id, copy?.fileId);
      return copy?.fileId;
    };

    const copyDefinition = async (
      definition: VerifyCheckDefinition | null,
    ): Promise<VerifyCheckDefinition | null> => {
      if (!definition?.fixtures?.length) return definition;
      const fixtures = [];
      for (const fixture of definition.fixtures) {
        const { resource } = fixture;
        if (!resource) {
          fixtures.push(fixture);
          continue;
        }
        const id =
          resource.type === 'document'
            ? await copyDocument(resource.id)
            : await copyFile(resource.id);
        // A resource the caller can no longer read is dropped from the fixture
        // rather than left pointing into the source scope.
        fixtures.push(
          id ? { ...fixture, resource: { ...resource, id } } : { ...fixture, resource: undefined },
        );
      }
      return { ...definition, fixtures };
    };

    const rows = new Map((await sourceCriteria.findByIds(ids)).map((row) => [row.id, row]));
    const copied: string[] = [];
    for (const id of ids) {
      const row = rows.get(id);
      if (!row) continue;
      const documentId = row.documentId ? await copyDocument(row.documentId) : undefined;
      const criterion = await targetCriteria.create({
        definition: await copyDefinition(row.definition),
        description: row.description,
        documentId: documentId ?? null,
        onFail: row.onFail,
        required: row.required,
        tags: row.tags,
        title: row.title,
        verifierConfig: row.verifierConfig,
        verifierType: row.verifierType,
      });
      copied.push(criterion.id);
    }
    return copied;
  };
}
