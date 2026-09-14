import { BUILTIN_AGENT_SLUGS, quickNoteAnalyzeProtocol } from '@lobechat/builtin-agents';
import {
  QUICK_NOTE_RESOURCE_TYPES,
  type QuickNoteAnalyzeTrigger,
  type QuickNoteProposalKind,
  type QuickNoteResourceReference,
} from '@lobechat/types';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, ne, notInArray, or } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { QuickNoteModel } from '@/database/models/quickNote';
import { ThreadModel } from '@/database/models/thread';
import {
  agentOperations,
  documents,
  messages,
  quickNoteProposals,
  quickNoteResources,
  quickNotes,
  topics,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';

import {
  buildQuickNoteTopicCandidates,
  expandQuickNoteContextSearchTerms,
  normalizeQuickNoteContextQueries,
  type QuickNoteContextCandidate,
  rankQuickNoteContextCandidates,
} from './context';

interface QuickNoteAnalyzeOutput {
  /** Concise Markdown accepted into the Annotation lineage. */
  annotation: string;
  /** Bounded lexical hints used to discover user-owned product context after Analyze. */
  contextQueries: string[];
  /** Optional suggestions that remain inert until the user accepts them. */
  proposals: { content: string; kind: QuickNoteProposalKind }[];
  /** Existing typed product objects the agent judged clearly relevant. */
  relatedResources: QuickNoteResourceReference[];
  /** At most five lightweight labels merged onto the capture. */
  tags: string[];
}

/**
 * Normalizes rich-text JSON into bounded plain source text.
 *
 * Before:
 * - `{ root: { children: [{ text: "First" }, { text: "Second" }] } }`
 *
 * After:
 * - `First\nSecond`
 */
export const renderQuickNoteSourceText = (editorData: Record<string, unknown>): string => {
  const textNodes: string[] = [];

  // Walk only JSON values and collect explicit editor text nodes. This avoids
  // placing Lexical structure and formatting metadata into the model prompt.
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }

    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string' && record.text.trim()) textNodes.push(record.text.trim());
    if (typeof record.markdown === 'string' && record.markdown.trim()) {
      textNodes.push(record.markdown.trim());
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'markdown' && key !== 'text') visit(child);
    }
  };

  visit(editorData);
  return textNodes.join('\n');
};

/**
 * Normalizes Analyze model output into the bounded server-owned contract.
 *
 * Before:
 * - `````json\n{"annotation":"A","tags":["x"]}\n`````
 *
 * After:
 * - `{ annotation: "A", tags: ["x"], relatedResources: [] }`
 */
export const parseQuickNoteAnalyzeOutput = (content: string): QuickNoteAnalyzeOutput => {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const value: unknown = JSON.parse(normalized);

  if (!value || typeof value !== 'object') throw new TypeError('Analyze output must be an object');
  const record = value as Record<string, unknown>;
  if (typeof record.annotation !== 'string' || !record.annotation.trim()) {
    throw new TypeError('Analyze output requires a non-empty annotation');
  }

  const stringArray = (candidate: unknown): string[] =>
    Array.isArray(candidate)
      ? candidate.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [];
  const relatedResources = Array.isArray(record.relatedResources)
    ? record.relatedResources
        .filter((resource): resource is QuickNoteResourceReference =>
          Boolean(
            resource &&
            typeof resource === 'object' &&
            'id' in resource &&
            typeof resource.id === 'string' &&
            resource.id.trim() &&
            'type' in resource &&
            typeof resource.type === 'string' &&
            QUICK_NOTE_RESOURCE_TYPES.includes(resource.type as QuickNoteResourceReference['type']),
          ),
        )
        .map((resource) => {
          const selector =
            resource.selector &&
            typeof resource.selector === 'object' &&
            !Array.isArray(resource.selector)
              ? resource.selector
              : undefined;

          return {
            id: resource.id.trim(),
            ...(selector ? { selector } : {}),
            type: resource.type,
          };
        })
        .filter(
          (resource, index, resources) =>
            resources.findIndex(
              (candidate) => candidate.id === resource.id && candidate.type === resource.type,
            ) === index,
        )
        .slice(0, 5)
    : [];
  const proposals = Array.isArray(record.proposals)
    ? record.proposals
        .filter((proposal): proposal is { content: string; kind: QuickNoteProposalKind } =>
          Boolean(
            proposal &&
            typeof proposal === 'object' &&
            'content' in proposal &&
            typeof proposal.content === 'string' &&
            proposal.content.trim() &&
            'kind' in proposal &&
            proposal.kind === 'task',
          ),
        )
        .slice(0, 3)
        .map((proposal) => ({ content: proposal.content.trim(), kind: proposal.kind }))
    : [];

  return {
    annotation: record.annotation.trim(),
    contextQueries: normalizeQuickNoteContextQueries(stringArray(record.contextQueries)),
    proposals,
    relatedResources,
    tags: stringArray(record.tags).slice(0, 5),
  };
};

/**
 * Orchestrates immutable Quick Note Analyze and user-triggered Dive Runs.
 *
 * Call stack:
 *
 * QuickNote router / Agent Signal handler
 *   -> {@link QuickNoteProcessingService.startAnalyze} / {@link QuickNoteProcessingService.startDive}
 *     -> {@link QuickNoteModel.claimRun}
 *       -> {@link AiAgentService.execAgent}
 *         -> completion hook
 *           -> {@link QuickNoteProcessingService.onRunComplete}
 *             -> {@link QuickNoteModel.acceptAnnotation}
 *
 * Use when:
 * - Dispatching a lightweight background interpretation.
 * - Starting a manual Dive in the capture's stable Topic.
 *
 * Expects:
 * - The caller has already enforced the relevant user setting for Analyze.
 * - All reads and writes stay within the constructor's user/workspace scope.
 *
 * Returns:
 * - Domain Run and Agent Operation identities suitable for progress recovery.
 */
export class QuickNoteProcessingService {
  private readonly db: LobeChatDatabase;
  private readonly model: QuickNoteModel;
  private readonly threadModel: ThreadModel;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.model = new QuickNoteModel(db, userId, workspaceId);
    this.threadModel = new ThreadModel(db, userId, workspaceId);
  }

  /**
   * Claims and dispatches a projection-only Analyze Run.
   *
   * Use when:
   * - A quiet-period claim or server sweep has confirmed Automatic Analyze is enabled.
   *
   * Expects:
   * - The Quick Note is owned by this service scope.
   *
   * Returns:
   * - The active/new Run plus its operation identity, or `undefined` when inaccessible.
   */
  startAnalyze = async (quickNoteId: string, trigger: QuickNoteAnalyzeTrigger = 'automatic') => {
    if (
      trigger === 'automatic' &&
      !(await QuickNoteModel.isAutomaticAnalyzeEnabled(this.db, this.userId))
    ) {
      return undefined;
    }
    const run = await this.model.claimRun(quickNoteId, { kind: 'analyze', trigger });
    if (!run) return undefined;
    if (run.operationId) return run;

    return this.executeAnalyze(run.id);
  };

  /**
   * Starts an Analyze Run already claimed by an Agent Signal producer.
   *
   * Use when:
   * - The `quick_note.analyze.requested` handler consumes a queued source.
   *
   * Expects:
   * - `runId` pins an immutable source history and belongs to this service scope.
   *
   * Returns:
   * - The running Run, existing active operation, or `undefined`.
   */
  dispatchAnalyzeRun = async (runId: string) => {
    const run = await this.model.getRunContext(runId);
    if (!run || run.kind !== 'analyze') return undefined;
    if (
      run.trigger === 'automatic' &&
      !(await QuickNoteModel.isAutomaticAnalyzeEnabled(this.db, this.userId))
    ) {
      return undefined;
    }
    if (run.operationId) return run;

    return this.executeAnalyze(runId);
  };

  /**
   * Claims a Dive, creates its standalone Thread, and starts the Dive Agent.
   *
   * Use when:
   * - The user explicitly clicks the existing Dive button.
   *
   * Expects:
   * - Manual Dive remains available regardless of Automatic Analyze settings.
   *
   * Returns:
   * - The active/new Dive Run plus operation identity, or `undefined`.
   */
  startDive = async (quickNoteId: string) => {
    const run = await this.model.claimRun(quickNoteId, { kind: 'dive' });
    if (!run) return undefined;
    if (run.operationId) return run;

    const note = await this.model.findWithContent(quickNoteId);
    if (!note) return undefined;

    const thread = await this.threadModel.create({
      title: 'Quick Note Dive',
      topicId: note.topicId,
      type: 'standalone',
    });

    return this.execute(run.id, {
      maxSteps: 12,
      slug: BUILTIN_AGENT_SLUGS.quickNoteDive,
      threadId: thread.id,
    });
  };

  /** Resolves the current Analyze binding once, then pins it to the immutable Run. */
  private executeAnalyze = async (runId: string) => {
    const settings = await QuickNoteModel.getAnalyzeSettings(this.db, this.userId);

    return this.execute(runId, {
      ...(settings.analyzeAgentId
        ? { agentId: settings.analyzeAgentId }
        : { slug: BUILTIN_AGENT_SLUGS.quickNoteAnalyze }),
      instructions: quickNoteAnalyzeProtocol,
      maxSteps: settings.maxAnalyzeSteps,
    });
  };

  /**
   * Projects terminal Agent output back into the Run's Annotation lineage.
   *
   * Use when:
   * - An in-process hook or QStash-authenticated completion callback fires.
   *
   * Expects:
   * - `lastAssistantContent` is the terminal assistant projection for this Run.
   *
   * Returns:
   * - The accepted Resource output, or a failed Run when projection is invalid.
   */
  onRunComplete = async (params: {
    errorMessage?: string;
    lastAssistantContent?: string;
    reason: string;
    runId: string;
  }) => {
    const run = await this.model.getRunContext(params.runId);
    if (!run) return undefined;

    if (params.reason !== 'done' || !params.lastAssistantContent?.trim()) {
      return this.model.failRun(
        params.runId,
        params.errorMessage || `Agent completed without accepted output (${params.reason})`,
      );
    }

    try {
      if (run.kind === 'analyze' || run.kind === 'signal_enrichment') {
        const output = parseQuickNoteAnalyzeOutput(params.lastAssistantContent);
        const foundResources = await this.findContextResources(
          output.contextQueries,
          run.sourceDocumentId,
          run.topicId,
        );
        const relatedResources = [
          ...output.relatedResources,
          ...foundResources.filter(({ type }) => type === 'document' || type === 'page'),
          ...foundResources.filter(({ type }) => type !== 'document' && type !== 'page'),
        ]
          .filter(
            (resource, index, resources) =>
              resources.findIndex(
                (candidate) => candidate.id === resource.id && candidate.type === resource.type,
              ) === index,
          )
          .slice(0, 5);
        const annotation = await this.model.acceptAnnotation(params.runId, {
          content: output.annotation,
          editorData: { markdown: output.annotation },
          proposals: output.proposals,
          tags: output.tags,
        });
        if (!annotation) return undefined;
        await Promise.all(
          relatedResources.map((resource) => this.model.linkResource(params.runId, resource)),
        );
        return annotation;
      }

      return this.model.acceptAnnotation(params.runId, {
        content: params.lastAssistantContent.trim(),
        editorData: { markdown: params.lastAssistantContent.trim() },
      });
    } catch (error) {
      return this.model.failRun(
        params.runId,
        error instanceof Error ? error.message : 'Failed to project Quick Note output',
      );
    }
  };

  /**
   * Starts one version-pinned Quick Note Agent Run and projects all startup failures.
   *
   * Call stack:
   *
   * QuickNoteProcessingService.dispatchRun
   *   -> QuickNoteProcessingService.execute
   *     -> QuickNoteModel.getRunContext
   *       -> ThreadModel.create
   *         -> QuickNoteModel.attachThread
   *       -> AiAgentService.execAgent
   */
  private execute = async (
    runId: string,
    options: {
      agentId?: string;
      instructions?: string;
      maxSteps: number;
      slug?: string;
      threadId?: string;
    },
  ) => {
    const model = this.model;
    try {
      const context = await model.getRunContext(runId);
      if (!context) return undefined;

      const sourceText = renderQuickNoteSourceText(context.sourceEditorData);
      const comments = context.inputs
        .filter((input) => input.role === 'comment' && input.commentRevisionId)
        .map((input) => ({
          content: input.commentContent ?? '',
          revisionId: input.commentRevisionId,
        }));
      const proposals = context.inputs
        .filter((input) => input.role === 'proposal' && input.documentHistoryId)
        .map((input) => ({
          content: input.documentEditorData
            ? renderQuickNoteSourceText(input.documentEditorData)
            : '',
          historyId: input.documentHistoryId,
        }));
      const candidates = await this.collectContextCandidates(
        context.quickNoteId,
        context.sourceHistoryId,
        context.topicId,
      );
      const configuredAgentIdentifier = options.agentId ?? options.slug;
      if (!configuredAgentIdentifier) throw new Error('Quick Note Agent run requires an Agent');
      const agentModel = new AgentModel(this.db, this.userId, this.workspaceId);
      let configuredAgent = await agentModel.getAgentConfig(configuredAgentIdentifier);
      if (!configuredAgent && options.slug) {
        await agentModel.getBuiltinAgent(options.slug);
        configuredAgent = await agentModel.getAgentConfig(options.slug);
      }
      const webSearchEnabled = ['auto', 'on'].includes(
        configuredAgent?.chatConfig?.searchMode ?? 'off',
      );
      const prompt = [
        `<quick_note source_history_id="${context.sourceHistoryId}">`,
        sourceText,
        '</quick_note>',
        '<quick_note_comments>',
        JSON.stringify(comments),
        '</quick_note_comments>',
        '<pending_proposals>',
        JSON.stringify(proposals),
        '</pending_proposals>',
        '<recent_context_candidates>',
        JSON.stringify(candidates),
        '</recent_context_candidates>',
        `<runtime_capabilities web_search="${webSearchEnabled ? 'enabled' : 'disabled'}" />`,
      ].join('\n');
      let runThreadId = options.threadId ?? context.threadId;
      if (!runThreadId) {
        const runThread = await this.threadModel.create({
          title: context.kind === 'analyze' ? 'Quick Note Analyze' : 'Quick Note Dive',
          topicId: context.topicId,
          type: 'standalone',
        });
        runThreadId = runThread.id;
      }
      if (!runThreadId) throw new Error('Quick Note Agent run requires a Thread');

      const attachedRun = await model.attachThread(runId, runThreadId);
      if (!attachedRun) return undefined;

      const userId = this.userId;
      const service = new AiAgentService(this.db, this.userId, { workspaceId: this.workspaceId });
      const result = await service.execAgent({
        appContext: {
          documentId: context.sourceDocumentId,
          scope: 'quick_note',
          suppressSignal: true,
          threadId: runThreadId,
          topicId: context.topicId,
        },
        hooks: [
          {
            handler: async (event) => {
              await this.onRunComplete({
                errorMessage: event.errorMessage,
                lastAssistantContent: event.lastAssistantContent,
                reason: event.reason || 'done',
                runId,
              });
            },
            id: 'quick-note-on-complete',
            type: 'onComplete' as const,
            webhook: {
              body: { runId, userId },
              delivery: 'qstash' as const,
              fallback: 'none' as const,
              url: '/api/workflows/quick-note/on-run-complete',
            },
          },
        ],
        ...(options.agentId ? { agentId: options.agentId } : { slug: options.slug }),
        instructions: options.instructions,
        maxSteps: options.maxSteps,
        prompt,
        trigger: context.kind === 'dive' ? 'quick-note-dive' : 'quick-note-analyze',
      });

      const agentConfig = await agentModel.getAgentConfig(result.agentId);
      const [operation] = await this.db
        .select({
          maxSteps: agentOperations.maxSteps,
          model: agentOperations.model,
          provider: agentOperations.provider,
        })
        .from(agentOperations)
        .where(eq(agentOperations.id, result.operationId))
        .limit(1);
      const pluginIds = [...(agentConfig?.plugins ?? [])];

      return model.attachOperation(runId, {
        agentId: result.agentId,
        executionConfig: {
          agentId: result.agentId,
          agentSlug: agentConfig?.slug,
          maxSteps: operation?.maxSteps ?? options.maxSteps,
          model: operation?.model ?? agentConfig?.model,
          pluginIds,
          provider: operation?.provider ?? agentConfig?.provider,
          searchMode: agentConfig?.chatConfig?.searchMode,
          toolMode: agentConfig?.chatConfig?.toolMode,
          useModelBuiltinSearch: agentConfig?.chatConfig?.useModelBuiltinSearch,
        },
        operationId: result.operationId,
        threadId: runThreadId,
      });
    } catch (error) {
      await model.failRun(
        runId,
        error instanceof Error ? error.message : 'Failed to start Quick Note Agent',
      );
      throw error;
    }
  };

  private collectContextCandidates = async (
    quickNoteId: string,
    sourceHistoryId: string,
    quickNoteTopicId: string,
  ): Promise<QuickNoteContextCandidate[]> => {
    const workspaceWhere = this.workspaceId
      ? eq(topics.workspaceId, this.workspaceId)
      : and(eq(topics.userId, this.userId), isNull(topics.workspaceId));
    const documentWhere = this.workspaceId
      ? and(
          eq(documents.workspaceId, this.workspaceId),
          or(eq(documents.visibility, 'public'), eq(documents.userId, this.userId)),
        )
      : and(eq(documents.userId, this.userId), isNull(documents.workspaceId));

    const noteScope = this.workspaceId
      ? eq(quickNotes.workspaceId, this.workspaceId)
      : and(eq(quickNotes.userId, this.userId), isNull(quickNotes.workspaceId));
    const quickNoteContainers = await this.db
      .select({ documentId: quickNotes.documentId, topicId: quickNotes.topicId })
      .from(quickNotes)
      .where(noteScope);
    const quickNoteTopicIds = quickNoteContainers.map(({ topicId }) => topicId);

    const [linkedDocuments, linkedTopics, topicCandidates, recentDocuments] = await Promise.all([
      this.db
        .select({ content: documents.content, id: documents.id, title: documents.title })
        .from(quickNoteResources)
        .innerJoin(documents, eq(documents.id, quickNoteResources.documentId))
        .where(
          and(
            eq(quickNoteResources.quickNoteId, quickNoteId),
            eq(quickNoteResources.sourceHistoryId, sourceHistoryId),
            ne(quickNoteResources.role, 'annotation'),
            documentWhere,
          ),
        )
        .orderBy(desc(quickNoteResources.updatedAt))
        .limit(5),
      this.db
        .select({
          content: topics.content,
          id: topics.id,
          title: topics.title,
        })
        .from(quickNoteResources)
        .innerJoin(topics, eq(topics.id, quickNoteResources.resourceId))
        .where(
          and(
            eq(quickNoteResources.quickNoteId, quickNoteId),
            eq(quickNoteResources.sourceHistoryId, sourceHistoryId),
            inArray(quickNoteResources.resourceType, ['conversation', 'topic']),
            workspaceWhere,
          ),
        )
        .orderBy(desc(quickNoteResources.updatedAt))
        .limit(5),
      this.collectTopicContextCandidates(quickNoteTopicId, quickNoteTopicIds, workspaceWhere),
      this.db
        .select({ content: documents.content, id: documents.id, title: documents.title })
        .from(documents)
        .where(
          and(
            documentWhere,
            // Quick Note source, Annotation, and Proposal Documents are internal
            // evidence. Agent/Task output Documents remain valid recent context.
            or(isNull(documents.sourceType), ne(documents.sourceType, 'quick-note')),
          ),
        )
        .orderBy(desc(documents.updatedAt))
        .limit(5),
    ]);

    const documentCandidates = new Map(
      [...linkedDocuments, ...recentDocuments].map((document) => [
        document.id,
        { ...document, content: document.content?.slice(0, 2000) },
      ]),
    );

    return [
      ...linkedTopics.map((topic) => ({ ...topic, type: 'topic' as const })),
      ...topicCandidates,
      ...[...documentCandidates.values()].map((document) => ({
        ...document,
        type: 'document' as const,
      })),
    ];
  };

  private collectTopicContextCandidates = async (
    quickNoteTopicId: string,
    quickNoteTopicIds: string[],
    workspaceWhere: ReturnType<typeof and>,
  ): Promise<QuickNoteContextCandidate[]> => {
    const recentTopics = await this.db
      .select({
        content: topics.content,
        description: topics.description,
        historySummary: topics.historySummary,
        id: topics.id,
        title: topics.title,
      })
      .from(topics)
      .where(
        and(
          workspaceWhere,
          ne(topics.id, quickNoteTopicId),
          quickNoteTopicIds.length > 0 ? notInArray(topics.id, quickNoteTopicIds) : undefined,
        ),
      )
      .orderBy(desc(topics.updatedAt))
      .limit(5);
    if (recentTopics.length === 0) return [];

    const messageWhere = this.workspaceId
      ? eq(messages.workspaceId, this.workspaceId)
      : and(eq(messages.userId, this.userId), isNull(messages.workspaceId));
    const recentMessages = await this.db
      .select({ content: messages.content, topicId: messages.topicId })
      .from(messages)
      .where(
        and(
          messageWhere,
          inArray(
            messages.topicId,
            recentTopics.map((topic) => topic.id),
          ),
          isNull(messages.deletedAt),
        ),
      )
      .orderBy(desc(messages.updatedAt))
      .limit(25);

    return buildQuickNoteTopicCandidates(recentTopics, recentMessages).filter((candidate) =>
      Boolean(candidate.content?.trim()),
    );
  };

  /**
   * Finds a few user-owned Topics and Documents from Agent-authored lexical hints.
   *
   * The Agent performs semantic interpretation; this provider only runs bounded
   * literal lookup. It intentionally avoids embeddings, entity extraction, or a
   * multi-signal ranking stack for the lightweight Analyze path.
   */
  private findContextResources = async (
    contextQueries: string[],
    sourceDocumentId: string,
    sourceTopicId: string,
  ): Promise<QuickNoteResourceReference[]> => {
    const queries = normalizeQuickNoteContextQueries(contextQueries);
    if (queries.length === 0) return [];

    const workspaceWhere = this.workspaceId
      ? eq(topics.workspaceId, this.workspaceId)
      : and(eq(topics.userId, this.userId), isNull(topics.workspaceId));
    const messageWhere = this.workspaceId
      ? eq(messages.workspaceId, this.workspaceId)
      : and(eq(messages.userId, this.userId), isNull(messages.workspaceId));
    const documentWhere = this.workspaceId
      ? and(
          eq(documents.workspaceId, this.workspaceId),
          or(eq(documents.visibility, 'public'), eq(documents.userId, this.userId)),
        )
      : and(eq(documents.userId, this.userId), isNull(documents.workspaceId));
    const noteScope = this.workspaceId
      ? eq(quickNotes.workspaceId, this.workspaceId)
      : and(eq(quickNotes.userId, this.userId), isNull(quickNotes.workspaceId));
    const noteContainers = await this.db
      .select({ documentId: quickNotes.documentId, topicId: quickNotes.topicId })
      .from(quickNotes)
      .where(noteScope);
    const annotationResources = await this.db
      .select({
        documentId: quickNoteResources.documentId,
        resourceId: quickNoteResources.resourceId,
      })
      .from(quickNoteResources)
      .innerJoin(quickNotes, eq(quickNotes.id, quickNoteResources.quickNoteId))
      .where(
        and(
          noteScope,
          eq(quickNoteResources.role, 'annotation'),
          or(
            isNotNull(quickNoteResources.documentId),
            and(
              eq(quickNoteResources.resourceType, 'document'),
              isNotNull(quickNoteResources.resourceId),
            ),
          ),
        ),
      );
    const proposalDocuments = await this.db
      .select({ documentId: quickNoteProposals.documentId })
      .from(quickNoteProposals)
      .innerJoin(quickNotes, eq(quickNotes.id, quickNoteProposals.quickNoteId))
      .where(noteScope);
    const excludedDocumentIds = Array.from(
      new Set(
        [
          sourceDocumentId,
          ...noteContainers.map(({ documentId }) => documentId),
          ...annotationResources.flatMap(({ documentId, resourceId }) => [documentId, resourceId]),
          ...proposalDocuments.map(({ documentId }) => documentId),
        ].filter((id): id is string => Boolean(id)),
      ),
    );
    const excludedTopicIds = Array.from(
      new Set([sourceTopicId, ...noteContainers.map(({ topicId }) => topicId)]),
    );
    const searchTerms = expandQuickNoteContextSearchTerms(queries);
    const patterns = searchTerms.map((query) => `%${query}%`);

    const [productSearchResults, literalTopics, literalMessages, matchingDocuments] =
      await Promise.all([
        createFtsSearchRepo({
          db: this.db,
          usage: 'quick_note_analyze',
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
          .then((repository) =>
            Promise.all(
              searchTerms.flatMap((query) => [
                repository.search({ limitPerType: 6, query, type: 'topic' }),
                repository.search({ limitPerType: 6, query, type: 'message' }),
              ]),
            ),
          )
          .then((results) => results.flat())
          // Internal retrieval is optional bootstrap context. A deployment with
          // no configured search provider must still complete Analyze.
          .catch(() => []),
        this.db
          .select({
            content: topics.content,
            description: topics.description,
            historySummary: topics.historySummary,
            id: topics.id,
            title: topics.title,
          })
          .from(topics)
          .where(
            and(
              workspaceWhere,
              excludedTopicIds.length > 0 ? notInArray(topics.id, excludedTopicIds) : undefined,
              or(
                ...patterns.flatMap((pattern) => [
                  ilike(topics.title, pattern),
                  ilike(topics.description, pattern),
                  ilike(topics.content, pattern),
                  ilike(topics.historySummary, pattern),
                ]),
              ),
            ),
          )
          .orderBy(desc(topics.updatedAt))
          .limit(40),
        this.db
          .select({ content: messages.content, topicId: messages.topicId })
          .from(messages)
          .where(
            and(
              messageWhere,
              isNull(messages.deletedAt),
              excludedTopicIds.length > 0
                ? notInArray(messages.topicId, excludedTopicIds)
                : undefined,
              or(...patterns.map((pattern) => ilike(messages.content, pattern))),
            ),
          )
          .orderBy(desc(messages.updatedAt))
          .limit(80),
        this.db
          .select({
            content: documents.content,
            id: documents.id,
            title: documents.title,
          })
          .from(documents)
          .where(
            and(
              documentWhere,
              excludedDocumentIds.length > 0
                ? notInArray(documents.id, excludedDocumentIds)
                : undefined,
              or(
                ...patterns.flatMap((pattern) => [
                  ilike(documents.title, pattern),
                  ilike(documents.content, pattern),
                ]),
              ),
            ),
          )
          .orderBy(desc(documents.updatedAt))
          .limit(40),
      ]);

    const indexedTopics = productSearchResults
      .filter((result) => result.type === 'topic')
      .filter((result) => !excludedTopicIds.includes(result.id))
      // Rank Topic search hits only by their canonical title. Search-provider
      // snippets can contain query text that does not belong to the Topic and
      // would otherwise turn an unrelated hit into a Resource Link.
      .map((result) => ({ id: result.id, title: result.title }));
    const indexedMessages = productSearchResults.flatMap((result) =>
      result.type === 'message' ? [{ content: result.content, topicId: result.topicId }] : [],
    );
    const matchingMessages = [
      ...indexedMessages.filter(
        (result) => Boolean(result.topicId) && !excludedTopicIds.includes(result.topicId!),
      ),
      ...literalMessages,
    ];

    const messageTopicIds = Array.from(
      new Set(
        matchingMessages
          .map(({ topicId }) => topicId)
          .filter((topicId): topicId is string => Boolean(topicId))
          .filter((topicId) => !excludedTopicIds.includes(topicId)),
      ),
    );
    const messageTopics =
      messageTopicIds.length === 0
        ? []
        : await this.db
            .select({ id: topics.id, title: topics.title })
            .from(topics)
            .where(and(workspaceWhere, inArray(topics.id, messageTopicIds)));
    const messageContentByTopic = new Map<string, string[]>();
    for (const message of matchingMessages) {
      if (!message.topicId || !message.content) continue;
      const snippets = messageContentByTopic.get(message.topicId) ?? [];
      if (snippets.length < 2) snippets.push(message.content.slice(0, 800));
      messageContentByTopic.set(message.topicId, snippets);
    }

    const topicCandidates = rankQuickNoteContextCandidates(
      [
        ...indexedTopics.map((topic) => ({ ...topic, type: 'topic' as const })),
        ...literalTopics.map((topic) => ({
          content: [topic.historySummary, topic.description, topic.content]
            .filter((value): value is string => Boolean(value))
            .join('\n'),
          id: topic.id,
          title: topic.title,
          type: 'topic' as const,
        })),
        ...messageTopics.map((topic) => ({
          content: messageContentByTopic.get(topic.id)?.join('\n'),
          id: topic.id,
          title: topic.title,
          type: 'topic' as const,
        })),
      ],
      searchTerms,
      3,
    );
    const documentCandidates = rankQuickNoteContextCandidates(
      matchingDocuments.map((document) => ({ ...document, type: 'document' as const })),
      searchTerms,
      2,
    );

    return [...topicCandidates, ...documentCandidates].map(({ id, type }) => ({ id, type }));
  };
}
