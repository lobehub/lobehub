import { isHeterogeneousAgentModelId, LOADING_FLAT } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import type {
  ChatAudioItem,
  ChatFileItem,
  ChatVideoItem,
  HeterogeneousTopicModel,
} from '@lobechat/types';
import {
  ChatErrorType,
  RequestTrigger,
  resolveHeterogeneousProviderTopicModel,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import type { AgentConfigWithId } from '@/server/services/agent';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { shouldSuppressSignal } from '@/server/services/agentSignal/suppressSignal';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { resolveAttachmentsByFileIds } from '@/server/services/file/resolveAttachments';
import { markdownToTxt } from '@/utils/markdownToTxt';

import type { DeviceAccessReason } from '../deviceAccessPolicy';
import { resolveDeviceAccessPolicy } from '../deviceAccessPolicy';
import { ingestAttachment } from '../ingestAttachment';
import type { AgentShareGate } from '../shareGate';
import { reserveShareVisitorTopic, reserveShareVisitorTurn } from '../shareVisitorAbuseGuards';
import type { InternalExecAgentParams } from '../types';

const log = debug('lobe-server:ai-agent-service');

export interface TurnSetupDeps {
  db: LobeChatDatabase;
  messageModel: MessageModel;
  topicModel: TopicModel;
  userId: string;
  workspaceId?: string;
}

export interface RunAttachments {
  audioList?: ChatAudioItem[];
  fileIds?: string[];
  fileList?: ChatFileItem[];
  imageList?: Array<{ alt: string; id: string; url: string }>;
  videoList?: ChatVideoItem[];
  warnings: string[];
}

/**
 * Resolve a run's attachments into the lists the message + context layers
 * consume. This is the single standard ingestion path shared by BOTH branches
 * of {@link AiAgentService.execAgent} — the heterogeneous-agent branch (which
 * returns early) and the normal agent branch — so neither hand-rolls its own
 * upload.
 *
 * Two sources are merged:
 * - `files`: raw buffers / URLs delivered by bot/IM channels (Slack, Telegram,
 *   …). These have never touched our storage, so they're uploaded to S3 here.
 * - `attachedFileIds`: already-uploaded ids (the SPA gateway path). Resolved to
 *   signed URLs and classified via {@link resolveAttachmentsByFileIds}.
 *
 * Per-file ingestion failures are collected into `warnings` and never thrown,
 * so a single bad attachment can't block the run (the text prompt still works).
 */
const resolveRunAttachments = async (
  deps: TurnSetupDeps,
  {
    attachedFileIds,
    files,
    throwIfAborted,
  }: {
    attachedFileIds?: string[];
    files?: InternalExecAgentParams['files'];
    throwIfAborted: (stage: string) => Promise<void>;
  },
): Promise<RunAttachments> => {
  const warnings: string[] = [];
  let fileIds: string[] | undefined;
  let imageList: Array<{ alt: string; id: string; url: string }> | undefined;
  let videoList: ChatVideoItem[] | undefined;
  let audioList: ChatAudioItem[] | undefined;
  let fileList: ChatFileItem[] | undefined;

  // Upload raw bot/IM files to S3 and classify them (image / video / audio / document).
  if (files && files.length > 0) {
    fileIds = [];
    imageList = [];
    videoList = [];
    audioList = [];
    fileList = [];
    const fileService = new FileService(deps.db, deps.userId, deps.workspaceId);
    const documentService = new DocumentService(deps.db, deps.userId, deps.workspaceId);

    for (const file of files) {
      await throwIfAborted('file upload');

      try {
        const result = await ingestAttachment(file, fileService, deps.userId);
        fileIds.push(result.fileId);

        if (result.isImage) {
          imageList.push({
            alt: file.name || 'image',
            id: result.fileId,
            url: result.resolvedUrl,
          });
          continue;
        }

        if (result.isVideo) {
          videoList.push({
            alt: file.name || 'video',
            id: result.fileId,
            url: result.resolvedUrl,
          });
          continue;
        }

        if (result.isAudio) {
          audioList.push({
            alt: file.name || 'audio',
            id: result.fileId,
            url: result.resolvedUrl,
          });
          continue;
        }

        // Non-image / non-video / non-audio: parse file content into the documents table so
        // the MessageContentProcessor can inject it via filesPrompts(). Mirrors
        // what the web upload path does, ensuring bot-uploaded PDFs / text /
        // JSON / .skill files are actually visible to the LLM (instead of
        // being silently uploaded but never read).
        let content: string | undefined;
        try {
          const document = await documentService.parseFile(result.fileId);
          content = document.content ?? undefined;
        } catch (parseError) {
          log(
            'execAgent: parseFile failed for %s (fileId=%s): %O',
            file.name,
            result.fileId,
            parseError,
          );
          warnings.push(
            `File "${file.name || 'unknown'}" was uploaded but its contents could not be extracted.`,
          );
        }

        fileList.push({
          content,
          fileType: file.mimeType ?? 'application/octet-stream',
          id: result.fileId,
          name: file.name ?? 'file',
          size: file.size ?? 0,
          url: result.resolvedUrl || '',
        });
      } catch (error) {
        log('execAgent: failed to ingest file %s: %O', file.name || file.url, error);
        warnings.push(`File "${file.name || 'unknown'}" could not be uploaded and was skipped.`);
      }
    }

    if (fileIds.length > 0) {
      log(
        'execAgent: uploaded %d files to S3 (%d images, %d videos, %d audios, %d documents)',
        fileIds.length,
        imageList.length,
        videoList.length,
        audioList.length,
        fileList.length,
      );
    }
    if (imageList.length === 0) imageList = undefined;
    if (videoList.length === 0) videoList = undefined;
    if (audioList.length === 0) audioList = undefined;
    if (fileList.length === 0) fileList = undefined;
  }

  // Attach already-uploaded files referenced by fileIds (e.g. SPA Gateway mode).
  // These files are already in the `files` table; resolve URLs + classify, and
  // merge into the imageList/videoList/fileList passed to the LLM and stored
  // as message relations via messagesFiles.
  if (attachedFileIds && attachedFileIds.length > 0) {
    await throwIfAborted('file resolution');

    try {
      const resolved = await resolveAttachmentsByFileIds({
        db: deps.db,
        fileIds: attachedFileIds,
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      });

      warnings.push(...resolved.warnings);

      if (resolved.orderedFileIds.length > 0) {
        fileIds = [...(fileIds ?? []), ...resolved.orderedFileIds];

        if (resolved.imageList.length > 0) {
          imageList = [...(imageList ?? []), ...resolved.imageList];
        }
        if (resolved.videoList.length > 0) {
          videoList = [...(videoList ?? []), ...resolved.videoList];
        }
        if (resolved.audioList.length > 0) {
          audioList = [...(audioList ?? []), ...resolved.audioList];
        }
        if (resolved.fileList.length > 0) {
          fileList = [...(fileList ?? []), ...resolved.fileList];
        }
      }
    } catch (err) {
      // Non-fatal: a resolver hiccup (S3 / DB blip) must not block the run —
      // the text prompt still works. Persist the file→message relation anyway
      // so the attachment isn't lost; only its preview / parsed content is.
      log('execAgent: attachment resolution failed, continuing without previews: %O', err);
      fileIds = Array.from(new Set([...(fileIds ?? []), ...attachedFileIds]));
    }
  }

  // Normalize an empty (all-failed) upload to undefined so callers don't attach
  // an empty messagesFiles relation.
  if (fileIds && fileIds.length === 0) fileIds = undefined;

  return { audioList, fileIds, fileList, imageList, videoList, warnings };
};

export interface TurnSetupInput {
  agentConfig: AgentConfigWithId;
  agentSlug?: string | null;
  appContext?: InternalExecAgentParams['appContext'];
  assistantAgentId: string;
  attachedFileIds?: string[];
  /** Spine anchor for a batch approval — overrides the assistant's parent. */
  batchApprovalAnchorId?: string;
  botContext?: InternalExecAgentParams['botContext'];
  clientIds?: InternalExecAgentParams['clientIds'];
  /** Stable assistant id for a generic intervention continuation. */
  continuationAssistantId?: string;
  conversationAgentId: string;
  createdThreadId?: string;
  cronJobId?: string;
  files?: InternalExecAgentParams['files'];
  modelOverride?: string;
  operationTaskId?: string;
  parentMessageId?: string;
  prompt: string;
  providerOverride?: string;
  requestedDeviceId?: string;
  resolvedAgentId: string;
  /** Raw resume flag — a resume run must land on an existing topic. */
  resume?: boolean;
  runFromHistory: boolean;
  /** Shared-agent visitor gate — set only by the shareChat router. */
  shareGate?: AgentShareGate;
  throwIfExecutionAborted: (stage: string) => Promise<void>;
  title?: string;
  trigger?: string;
}

export interface TurnSetupResult {
  assistantMessageId: string;
  canUseDevice: boolean;
  deviceAccessReason: DeviceAccessReason;
  effectiveRequestedDeviceId?: string;
  heterogeneousProvider?: NonNullable<AgentConfigWithId['agencyConfig']>['heterogeneousProvider'];
  heteroType: HeterogeneousAgentType;
  isFixedDeviceTarget: boolean;
  isHeteroAgent: boolean;
  /** Effective model/provider after the topic-pinned model is applied. */
  model: string;
  pinnedHeterogeneousTopicModel?: HeterogeneousTopicModel;
  provider: string;
  requestTriggerMetadata: {
    agentDispatch?: { kind: 'callAgent'; visibility: 'internal' };
    trigger?: RequestTrigger;
  };
  runAttachments: RunAttachments;
  /** Rows THIS turn persisted — the history loader must exclude them. */
  selfMessageIds: Set<string>;
  topicBoundDeviceId?: string | null;
  topicId: string;
  userMessageId?: string;
}

/**
 * Stage 3 + the shared turn setup of {@link AiAgentService.execAgent}: topic
 * creation/reuse (with the topic-pinned model), device-access policy, hetero
 * detection, attachment ingestion, and persisting the user + assistant turn.
 *
 * Everything here runs for BOTH hetero and normal agents, so it lives before
 * the execution fork and both branches consume the same records. Keeping it in
 * one place is what guarantees the hetero path can't drift from the standard
 * path again (the bot-image bug came from the hetero branch re-implementing —
 * and skipping — this step).
 */
export const setupTurn = async (
  deps: TurnSetupDeps,
  input: TurnSetupInput,
): Promise<TurnSetupResult> => {
  const {
    agentConfig,
    agentSlug,
    appContext,
    assistantAgentId,
    attachedFileIds,
    batchApprovalAnchorId,
    botContext,
    clientIds,
    continuationAssistantId,
    conversationAgentId,
    createdThreadId,
    cronJobId,
    files,
    modelOverride,
    operationTaskId,
    parentMessageId,
    prompt,
    providerOverride,
    requestedDeviceId,
    resolvedAgentId,
    resume,
    runFromHistory,
    shareGate,
    throwIfExecutionAborted,
    title,
    trigger,
  } = input;

  let topicId = appContext?.topicId;

  const isFixedExecutionTargetSelection =
    !!deps.workspaceId && agentConfig.agencyConfig?.executionTargetSelectionPolicy === 'fixed';
  const isFixedDeviceTarget =
    isFixedExecutionTargetSelection && agentConfig.agencyConfig?.executionTarget === 'device';
  const effectiveRequestedDeviceId = isFixedExecutionTargetSelection
    ? undefined
    : requestedDeviceId;
  const topicBoundDeviceId = isFixedDeviceTarget
    ? agentConfig.agencyConfig?.boundDeviceId
    : isFixedExecutionTargetSelection
      ? undefined
      : requestedDeviceId;

  // Effective model/provider for this run. Defaults to the agent config, but a
  // topic pins its own model in the top-level `topics.model`/`provider` columns
  // (config source of truth) — snapshotted on creation, and honored below when
  // reusing a topic whose model was switched while active. Keeps the Gateway/
  // cloud path in sync with the client local path (see streamingExecutor +
  // getTopicModelById).
  let model = agentConfig.model!;
  let provider = agentConfig.provider!;
  const heterogeneousProvider = agentConfig.agencyConfig?.heterogeneousProvider;
  const heterogeneousTopicModelSnapshot = heterogeneousProvider
    ? resolveHeterogeneousProviderTopicModel(heterogeneousProvider)
    : undefined;
  let pinnedHeterogeneousTopicModel: HeterogeneousTopicModel | undefined;

  // Share-visitor fail-closed gate — reject a heterogeneous (Claude Code /
  // Codex / …) agent BEFORE any topic/message row is written. Heterogeneous
  // agents are not available for shared visitor runs. Checked here (using the
  // agent-level config, before any topic-pinned model override) rather than
  // at the later hetero-detection site (`isHeteroAgent`) so it runs ahead of
  // ALL row creation, not just the message rows.
  if (shareGate && (heterogeneousProvider?.type || isHeterogeneousAgentModelId(model))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: ChatErrorType.ShareHeterogeneousAgentUnsupported,
    });
  }

  if (!topicId) {
    if (resume) {
      throw new Error('Resume mode requires the parent message to belong to a topic');
    }

    // Prepare metadata with cronJobId, taskId, botContext, bound device, and any
    // client-supplied initial metadata (e.g. repos selected before first message).
    const initialTopicMeta = appContext?.initialTopicMetadata;
    // Builder conversations are owned by a builtin builder agent and get no
    // `groupId` / `sessionId` (those columns mark the target's own chat), so
    // without this the row keeps no trace of what it was configuring. The
    // association exists only at run time: a topic written without it can
    // never be attributed afterwards, which is why it is stamped even though
    // nothing filters on it yet.
    const { editingAgentId, editingGroupId } = appContext ?? {};
    const metadata =
      cronJobId ||
      operationTaskId ||
      botContext ||
      topicBoundDeviceId ||
      initialTopicMeta ||
      editingGroupId ||
      editingAgentId
        ? {
            bot: botContext,
            boundDeviceId: topicBoundDeviceId,
            cronJobId: cronJobId || undefined,
            ...(editingAgentId && { editingAgentId }),
            ...(editingGroupId && { editingGroupId }),
            taskId: operationTaskId,
            ...(initialTopicMeta?.repos && { repos: initialTopicMeta.repos }),
            ...(initialTopicMeta?.workingDirectory && {
              workingDirectory: initialTopicMeta.workingDirectory,
            }),
            ...(initialTopicMeta?.workingDirectoryConfig && {
              workingDirectoryConfig: initialTopicMeta.workingDirectoryConfig,
            }),
          }
        : undefined;

    const fallbackTitleSource = markdownToTxt(prompt);
    // Heterogeneous topics use the same snapshot rule as the client: persist
    // the selected CLI model (including `default`) or user-provider API binding.
    // Runtimes without a model selector, legacy rows, and Agent-scoped
    // server-default API configs still pin only the runtime type.
    const heteroSnapshotType =
      heterogeneousProvider?.type ?? (isHeterogeneousAgentModelId(model) ? model : undefined);
    // Second argument: the id the client already rendered this topic under
    // (sidebar row, message bucket). Absent → the model mints one as before.
    const newTopicParams = {
      agentId: resolvedAgentId,
      // Persist the group association when running inside a group conversation.
      // Without it the topic is created group-less and only shows under the
      // member agent's topic list — never in the group sidebar (which queries
      // `topics.groupId`), so the conversation silently "disappears" from the
      // group. execGroupAgent normally pre-creates the topic, but any path
      // that reaches execAgent without a topicId (e.g. the async/queue run)
      // must carry the groupId through too (group topic sidebar + ownership fix).
      groupId: appContext?.groupId,
      metadata,
      // Snapshot the effective model as the topic's pinned model (config).
      model: heterogeneousTopicModelSnapshot?.model ?? (heteroSnapshotType ? undefined : model),
      provider: heterogeneousTopicModelSnapshot?.provider ?? heteroSnapshotType ?? provider,
      // Share-visitor runs: the topic row belongs to the creator
      // (`deps.userId`), but stamping the visitor's id here is what
      // `TopicModel`'s creator-facing reads (`query`, `count`, `queryTopics`,
      // `queryRecent`, `rank`) filter out via `notShareVisitorTopic()`, and
      // what lets shareChat scope reads per visitor (`queryBySender` /
      // `countBySender`). There is no share-instance column — a visitor
      // topic is tied to its share purely through `(agentId, senderId)`,
      // which is unambiguous because `agent_shares` is 1:1 per agent.
      senderId: shareGate?.visitorUserId,
      title:
        title !== undefined
          ? title
          : fallbackTitleSource.slice(0, 50) + (fallbackTitleSource.length > 50 ? '...' : ''),
      trigger,
    };
    // Share-visitor runs must reserve the `maxTopicsPerVisitor` slot and
    // insert the topic in ONE locked transaction — see
    // `reserveShareVisitorTopic`'s JSDoc for the race this closes. Non-share
    // runs (no per-visitor cap to enforce) keep the plain unlocked insert.
    const newTopic = shareGate
      ? await reserveShareVisitorTopic(
          {
            agentId: resolvedAgentId,
            db: deps.db,
            expectedShareId: shareGate.shareId,
            ownerId: deps.userId,
            visitorUserId: shareGate.visitorUserId,
            workspaceId: deps.workspaceId,
          },
          newTopicParams,
          clientIds?.topicId,
        )
      : await deps.topicModel.create(newTopicParams, clientIds?.topicId);
    topicId = newTopic.id;
    log(
      'execAgent: created new topic %s with trigger %s, groupId %s, cronJobId %s',
      topicId,
      trigger || 'default',
      appContext?.groupId || 'none',
      cronJobId || 'none',
    );
  } else {
    log('execAgent: reusing existing topic %s', topicId);

    // Honor a topic-pinned model (snapshotted on creation, updated when the
    // user switched model while the topic was active) over the agent default.
    // Explicit per-run values (such as callSubAgent) override their own field.
    // The pinned model lives in the top-level `topics.model`/`provider` columns
    // (config source of truth), NOT in metadata.
    const existingTopic = await deps.topicModel.findById(topicId);

    // Fail-closed guard: a non-share run must never operate on a share-visitor
    // topic. `findById` is ownership-scoped but deliberately does NOT exclude
    // visitor topics (see its JSDoc) — they carry the CREATOR's own userId for
    // billing attribution, so `deps.userId`'s ownership check alone lets a
    // creator-authenticated but non-share call (e.g. hitting `aiAgent.execAgent`
    // directly with a leaked/guessed visitor topicId) load a visitor
    // conversation as if it were their own. A share visitor's own run is
    // authorized separately via `shareGate` — already re-validated upstream by
    // `findVisitorTopicOrThrow` in `shareChat.ts` — and must keep working.
    if (!shareGate && existingTopic?.senderId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
    }

    const pinnedModel = existingTopic?.model;
    if (pinnedModel) {
      model = modelOverride || pinnedModel;
      provider = providerOverride || existingTopic?.provider || provider;
      pinnedHeterogeneousTopicModel = { model, provider };
      log(
        'execAgent: using topic-pinned model=%s provider=%s for topic %s',
        model,
        provider,
        topicId,
      );
    }

    // Re-assert the share restriction after topic overrides are applied.
    // Heterogeneous agents are not available for shared visitor runs.
    if (shareGate && isHeterogeneousAgentModelId(model)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: ChatErrorType.ShareHeterogeneousAgentUnsupported,
      });
    }
  }

  await throwIfExecutionAborted('topic setup');

  // Resolve device-tool access ONCE per turn, BEFORE the hetero early exit —
  // hetero dispatch routes the whole run to a user machine, so it must honour
  // the same policy as native device tools. Discord-only flows (no
  // botContext) keep the legacy first-party allow path; an external bot
  // sender returns canUseDevice=false and reason='bot-external-sender',
  // which degrades device-capable targets (hetero → sandbox, native → plain
  // chat) and stops the device list from leaking into the LLM context.
  const { canUseDevice, reason: deviceAccessReason } = resolveDeviceAccessPolicy({
    botContext,
    shareVisitor: !!shareGate,
  });
  log(
    'execAgent: device access policy → canUseDevice=%s, reason=%s, hasBotContext=%s',
    canUseDevice,
    deviceAccessReason,
    !!botContext,
  );

  // Hetero detection: prefer agencyConfig.heterogeneousProvider.type (set by
  // the UI), fall back to the legacy `model` field for backwards compatibility
  // (shared with the inbox write guard via `isHeterogeneousAgentModelId`).
  const heteroProviderType = agentConfig.agencyConfig?.heterogeneousProvider?.type;
  const isHeteroAgent = !!heteroProviderType || isHeterogeneousAgentModelId(model);
  const heteroType = (heteroProviderType ?? model) as HeterogeneousAgentType;

  // ── Shared turn setup (runs for BOTH hetero and normal agents) ──────────
  const requestTriggerMetadata = {
    ...(trigger && Object.values(RequestTrigger).includes(trigger as RequestTrigger)
      ? { trigger: trigger as RequestTrigger }
      : undefined),
    ...(appContext?.conversationAgentId && appContext.scope === 'sub_agent'
      ? { agentDispatch: { kind: 'callAgent' as const, visibility: 'internal' as const } }
      : undefined),
  };

  // Attachment ingestion: raw bot/IM `files` → S3, pre-uploaded
  // `attachedFileIds` → signed URLs + classification.
  const runAttachments = await resolveRunAttachments(deps, {
    attachedFileIds,
    files,
    throwIfAborted: throwIfExecutionAborted,
  });

  await throwIfExecutionAborted('message creation');

  // Persist the user turn. `selfMessageIds` lets the normal-path history loader
  // exclude this freshly-created turn — history must be the PRIOR turns only,
  // otherwise the new prompt is double-counted in the LLM context.
  const selfMessageIds = new Set<string>();
  // Anchor the new user turn on the conversation tail. Never leave it
  // undefined for a topic that already has messages: `parentId: undefined`
  // persists a second ROOT, and the renderer walks the parentId forest
  // depth-first — an earlier root's still-growing subtree is emitted before a
  // later root, so the newest reply lands ABOVE older messages.
  //
  // `getLatestSpineMessageId` skips tool rows and toolless signal turns, so it
  // can come back empty on a topic built entirely from signal callbacks; fall
  // back to the latest non-tool row rather than orphaning the turn.
  const resolveUserMessageParentId = async () => {
    if (runFromHistory) return undefined;
    if (parentMessageId) return parentMessageId;
    // A thread created for THIS turn is empty, so there is no spine head to
    // anchor on. Its branch point is the source message — the same anchor the
    // non-gateway path keeps for a brand-new thread. Without it the first turn
    // persists as a second root and the renderer's parentId walk emits it out
    // of order.
    if (createdThreadId) return appContext?.newThread?.sourceMessageId;

    const threadId = appContext?.threadId ?? null;
    const spineId = await deps.messageModel.getLatestSpineMessageId({ threadId, topicId });
    if (spineId) return spineId;

    const fallbackId = await deps.messageModel.getLatestNonToolMessageId({ threadId, topicId });
    if (fallbackId) {
      log(
        'execAgent: no spine head for topic %s, anchoring user turn on latest non-tool message %s',
        topicId,
        fallbackId,
      );
    }
    return fallbackId;
  };
  const userMessageParentId = await resolveUserMessageParentId();
  const userMessageParams = {
    agentId: conversationAgentId,
    content: prompt,
    files: runAttachments.fileIds,
    // Group reads filter on messages.groupId (MessageModel.query group
    // branch), so a group turn must stamp groupId or the message never
    // shows when the topic is reopened (group topic sidebar + ownership fix).
    groupId: appContext?.groupId ?? undefined,
    metadata: requestTriggerMetadata,
    parentId: userMessageParentId,
    role: 'user' as const,
    threadId: appContext?.threadId ?? undefined,
    topicId,
  };
  // Share-visitor runs must reserve the `maxTurnsPerTopic` slot and insert
  // the user message in ONE locked transaction — see
  // `reserveShareVisitorTurn`'s JSDoc for the race this closes (same class of
  // count-then-act bug as the topic cap above). Harmless no-op on a topic
  // this same call just created (count is 0). Non-share runs (no per-turn
  // cap) keep the plain unlocked insert.
  const userMessageRecord = runFromHistory
    ? undefined
    : shareGate
      ? await reserveShareVisitorTurn(
          {
            agentId: shareGate.agentId,
            db: deps.db,
            expectedShareId: shareGate.shareId,
            ownerId: deps.userId,
            topicId,
            workspaceId: deps.workspaceId,
          },
          userMessageParams,
          // The id the client's optimistic user row already renders under.
          clientIds?.userMessageId,
        )
      : await deps.messageModel.create(
          userMessageParams,
          // The id the client's optimistic user row already renders under.
          clientIds?.userMessageId,
        );
  if (userMessageRecord) {
    selfMessageIds.add(userMessageRecord.id);
    log('execAgent: created user message %s', userMessageRecord.id);
  }

  // Snapshot the author's group orchestration role onto the assistant message
  // so the role survives the server round-trip (gateway step_start snapshot /
  // message.getMessages). Without this the client's optimistic isSupervisor flag
  // is lost on refetch and the supervisor renders as a generic assistant.
  // The persisted message `role` stays 'assistant' — only metadata carries the
  // orchestration role, keeping the data training-friendly.
  const orchestrationMetadata = appContext?.orchestrationRole
    ? {
        ...(appContext.orchestrationRole === 'supervisor' ? { isSupervisor: true } : {}),
        orchestrationRole: appContext.orchestrationRole,
      }
    : undefined;

  // Assistant placeholder (shows the spinner in the UI). A hetero run seeds
  // ONLY the provider — the CLI reports the real model later via `stream_start`
  // / `turn_metadata` (backfilled by HeterogeneousPersistenceHandler), and
  // seeding the agent's chat model would leak it into the model tag. A normal
  // run seeds model + provider as usual.
  const assistantParentId = userMessageRecord?.id ?? batchApprovalAnchorId ?? parentMessageId;
  const existingContinuationAssistant = continuationAssistantId
    ? await deps.messageModel.findById(continuationAssistantId)
    : undefined;

  if (
    existingContinuationAssistant &&
    (existingContinuationAssistant.role !== 'assistant' ||
      existingContinuationAssistant.topicId !== topicId ||
      (existingContinuationAssistant.threadId ?? undefined) !==
        (appContext?.threadId ?? undefined) ||
      (existingContinuationAssistant.parentId ?? undefined) !== assistantParentId ||
      existingContinuationAssistant.agentId !== assistantAgentId)
  ) {
    throw new Error(
      `Intervention continuation assistant identity conflict: ${continuationAssistantId}`,
    );
  }

  const assistantMessageRecord =
    existingContinuationAssistant ??
    (await deps.messageModel.create(
      {
        agentId: assistantAgentId,
        content: LOADING_FLAT,
        // Stamp groupId so the assistant turn is visible in the group read path
        // (MessageModel.query filters group chats by messages.groupId).
        groupId: appContext?.groupId ?? undefined,
        metadata: orchestrationMetadata,
        model: isHeteroAgent ? undefined : model,
        // Chain onto the user turn we just persisted; `parentMessageId` is the
        // anchor only on a resume, where no user message is created. A batch
        // approval overrides it with the assistant that emitted the batch — the
        // previous LLM call — so the spine stays one node per call and never
        // depends on which of the batch's tool rows the client sent as anchor.
        parentId: assistantParentId,
        provider: isHeteroAgent ? heteroType : provider,
        role: 'assistant',
        threadId: appContext?.threadId ?? undefined,
        topicId,
      },
      // Generic intervention continuations use a stable placeholder so a
      // crash after this insert but before operation-state creation can
      // safely re-enter without creating a second assistant turn.
      continuationAssistantId ?? clientIds?.assistantMessageId,
    ));
  selfMessageIds.add(assistantMessageRecord.id);
  log('execAgent: created assistant message %s', assistantMessageRecord.id);

  // Agent Signal is a governance side-channel (feedback / self-iteration). It
  // only applies to the server-side LLM pipeline, so it is intentionally NOT
  // enqueued for hetero runs (which hand off to an external CLI). Skip when this
  // invocation is itself an Agent Signal background run to avoid recursion.
  //
  // Share-visitor fail-closed gate — never enqueue this event for a
  // share-visitor turn. `enqueueAgentSignalSourceEvent` is always called with
  // `userId: deps.userId`, which is the share CREATOR (this service is
  // instantiated with `share.ownerId` for every visitor run — see
  // `shareChat.ts`), never `shareGate.visitorUserId`. The `agent.user.message`
  // event it produces feeds policies that can reach the `userMemory` action
  // and WRITE to the creator's memory. `allowReadMemory` only grants READING
  // the creator's memory through the visible memory tool, so this gate must
  // never be conditional on it: any share configuration would otherwise let a
  // link visitor mutate the creator's account via this out-of-band channel.
  if (
    userMessageRecord &&
    !isHeteroAgent &&
    !shareGate &&
    !shouldSuppressSignal({ appContext, slug: agentSlug ?? undefined })
  ) {
    void enqueueAgentSignalSourceEvent(
      {
        payload: {
          agentId: resolvedAgentId,
          message: prompt,
          messageId: userMessageRecord.id,
          threadId: appContext?.threadId ?? undefined,
          topicId,
          trigger,
        },
        sourceId: userMessageRecord.id,
        sourceType: 'agent.user.message',
      },
      {
        agentId: resolvedAgentId,
        userId: deps.userId,
      },
    ).catch((error) => {
      log('execAgent: failed to enqueue user message Agent Signal source event: %O', error);
    });
  }

  return {
    assistantMessageId: assistantMessageRecord.id,
    canUseDevice,
    deviceAccessReason,
    effectiveRequestedDeviceId,
    heteroType,
    heterogeneousProvider,
    isFixedDeviceTarget,
    isHeteroAgent,
    model,
    pinnedHeterogeneousTopicModel,
    provider,
    requestTriggerMetadata,
    runAttachments,
    selfMessageIds,
    topicBoundDeviceId,
    topicId,
    userMessageId: userMessageRecord?.id,
  };
};
