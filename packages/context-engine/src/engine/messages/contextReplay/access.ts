import { collectDocumentReads } from '../../../processors/RevokedDocumentResultFilter';
import {
  contextReplayFileIds,
  contextReplayMessageIds,
  contextReplaySnapshots,
} from '../../../utils/contextReplayMessages';
import { filterMemorySources, memorySourceIds } from '../../../utils/memorySources';
import type { MessagesEngineParams } from '../types';

// Losing these changes what the next call may say, not who may read the conversation.
const withholdableSourceTypes = new Set([
  'memory',
  'memory-persona',
  'unverified-memory',
  'skill',
  'tool',
]);
export const isWithholdableContextSource = (source: string) =>
  withholdableSourceTypes.has(source.split(':')[0]);

/** Coarse dependencies deliberately include the entire visible input ancestry. */
export const prepareContextReplay = async (
  params: MessagesEngineParams,
): Promise<MessagesEngineParams> => {
  const replay = params.contextReplay;
  if (!replay) return params;
  const prior = contextReplaySnapshots(params.messages);
  const boundary =
    replay.committedSnapshot?.historyStartId ??
    prior.findLast((snapshot) => snapshot.historyStartId)?.historyStartId;
  const start = boundary
    ? params.messages.findIndex((message) => contextReplayMessageIds([message]).includes(boundary))
    : -1;
  const visibleMessages = start >= 0 ? params.messages.slice(start) : params.messages;
  const documents = (params.agentDocuments ?? []).flatMap((doc) =>
    doc.id ? [`document:${doc.id}`] : [],
  );
  const knowledge = [
    ...(params.knowledge?.fileContents ?? []).map((file) => `file:${file.fileId}`),
    ...(params.knowledge?.knowledgeBases ?? []).map((kb) => `knowledgeBase:${kb.id}`),
  ];
  const initial = params.initialContext;
  const sources: Record<string, string[]> = {
    Attachments: contextReplayFileIds(visibleMessages).map((id) => `file:${id}`),
    HistoricalDocumentReads: collectDocumentReads(visibleMessages).map(
      (read) => `document-read:${read.documentId}`,
    ),
    SystemDocumentSources: documents,
    AgentDocumentContextInjector: documents,
    AgentDocumentMessageInjector: documents,
    ActiveTopicDocumentContextInjector: initial?.activeTopicDocument
      ? [
          `document:${initial.activeTopicDocument.agentDocumentId ?? initial.activeTopicDocument.documentId}`,
        ]
      : [],
    DocumentReferenceContextInjector: (params.documentReferences ?? []).map(
      (ref) => `document:${ref.documentId}`,
    ),
    TopicReferenceContextInjector: (params.topicReferences ?? []).map(
      (ref) => `topic:${ref.topicId}`,
    ),
    GoalContextSyntheticInjector: initial?.goalOverview?.goalId
      ? [`goal:${initial.goalOverview.goalId}`]
      : [],
    KnowledgeInjector: knowledge,
    UserMemoryInjector: await memorySourceIds(params.userMemory),
    SkillContextProvider: (params.skillsConfig?.enabledSkills ?? []).map(
      (skill) => `skill:${skill.identifier}`,
    ),
    ToolSystemRoleProvider: (params.toolsConfig?.manifests ?? []).map(
      (tool) => `tool:${tool.identifier}`,
    ),
    ...replay.sourceIdsByProvider,
  };
  const historical = contextReplaySnapshots(visibleMessages);
  const sourceIds = [
    ...new Set([
      ...Object.values(sources).flat(),
      ...documents,
      ...collectDocumentReads(visibleMessages).map((read) => `document-read:${read.documentId}`),
      ...historical.flatMap((snapshot) => snapshot.sourceIds),
      ...(replay.committedSnapshot?.sourceIds ?? []),
    ]),
  ];
  const localSources = new Set(Object.values(sources).flat());
  const localTypes = new Set(['unverified-memory', 'skill', 'tool']);
  const remoteSources = sourceIds.filter((source) => !localTypes.has(source.split(':')[0]));
  const denied = new Set([
    ...(replay.revokedSourceIds ?? []),
    ...sourceIds.filter(
      (source) =>
        !params.userMemory?.enabled &&
        (source.startsWith('memory:') || source.startsWith('memory-persona:')),
    ),
    ...sourceIds.filter(
      (source) => localTypes.has(source.split(':')[0]) && !localSources.has(source),
    ),
    ...(replay.validateSources ? await replay.validateSources(remoteSources) : []),
    ...(params.revokedDocumentReads ?? []).flatMap((read) =>
      [
        ...read.documentIds,
        ...(read.agentDocumentReadIds ?? []),
        ...(read.unverifiedIds ?? []),
      ].flatMap((id) => [`document:${id}`, `document-read:${id}`]),
    ),
  ]);
  const revoked = new Set([...denied].filter((source) => !isWithholdableContextSource(source)));
  if (
    replay.committedSnapshot?.invalidated ||
    replay.committedSnapshot?.sourceIds.some((source) => revoked.has(source))
  ) {
    throw new Error(
      'Context source access changed; start a new invocation instead of retrying revoked input',
    );
  }
  const unknownSummary = visibleMessages.some(
    (message) => message.role === 'compressedGroup' && !message.metadata?.contextReplay,
  );
  const reset =
    unknownSummary ||
    replay.resetHistory ||
    revoked.size > 0 ||
    historical.some((snapshot) => snapshot.invalidated);
  const latestUser = visibleMessages.findLast((message) => message.role === 'user');
  const messages = reset
    ? latestUser
      ? [
          {
            ...latestUser,
            content:
              typeof latestUser.content === 'string'
                ? latestUser.content
                    .replaceAll(
                      /<!-- SYSTEM CONTEXT \(NOT PART OF USER QUERY\) -->[\s\S]*?<!-- END SYSTEM CONTEXT -->/g,
                      '',
                    )
                    .trim()
                : latestUser.content,
          },
        ]
      : []
    : visibleMessages;
  if (reset)
    for (const message of messages) {
      for (const key of ['fileList', 'imageList', 'audioList', 'videoList'] as const) {
        if (message[key])
          (message as unknown as Record<string, unknown>)[key] = message[key]?.filter(
            (file) => !revoked.has(`file:${file.id}`),
          );
      }
    }
  const allowed = (source: string) => !denied.has(source);
  // Shared answers retain their provenance even when the next actor has its own private baseline.
  sources.InheritedInputSources = reset
    ? []
    : historical.flatMap((snapshot) => snapshot.sourceIds).filter(allowed);
  const updated: MessagesEngineParams = {
    ...params,
    userMemory: await filterMemorySources(params.userMemory, denied),
    historySummary: undefined,
    messages,
    ...(reset && {
      historySummary: undefined,
      agentDocumentChanges: undefined,
      skillChanges: undefined,
    }),
    ...(sources.ProjectContextInjector?.some((id) => !allowed(id)) && {
      projectInstructions: undefined,
    }),
    agentDocuments: params.agentDocuments?.filter(
      (doc) => !doc.id || allowed(`document:${doc.id}`),
    ),
    documentReferences: params.documentReferences?.filter((ref) =>
      allowed(`document:${ref.documentId}`),
    ),
    topicReferences: params.topicReferences?.filter((ref) => allowed(`topic:${ref.topicId}`)),
    knowledge: {
      fileContents: params.knowledge?.fileContents?.filter((file) =>
        allowed(`file:${file.fileId}`),
      ),
      knowledgeBases: params.knowledge?.knowledgeBases?.filter((kb) =>
        allowed(`knowledgeBase:${kb.id}`),
      ),
    },
    initialContext: {
      ...initial,
      ...(sources.ProjectContextInjector?.some((id) => !allowed(id)) && {
        projectContext: undefined,
      }),
      ...(sources.TaskManagerContextInjector?.some((id) => !allowed(id)) && {
        taskManager: undefined,
      }),
      ...(sources.ActiveTopicDocumentContextInjector.some((id) => !allowed(id)) && {
        activeTopicDocument: undefined,
      }),
      ...(sources.GoalContextSyntheticInjector.some((id) => !allowed(id)) && {
        goalOverview: undefined,
      }),
    },
    contextReplay: {
      ...replay,
      historyStartId: reset ? latestUser?.id : boundary,
      withheldSourceIds: [...denied].filter(isWithholdableContextSource),
      sourceIdsByProvider: Object.fromEntries(
        Object.entries(sources).map(([key, ids]) => [key, ids.filter(allowed)]),
      ),
    },
  };
  return updated;
};
