import { escapeXmlAttr } from '@lobechat/prompts';
import type {
  ContextReplayInput,
  ContextReplaySegment,
  ContextReplaySnapshot,
  OpenAIChatMessage,
} from '@lobechat/types';
import { stableJsonDigest } from '@lobechat/utils';

import { PlaceholderVariablesProcessor } from '../../../processors/PlaceholderVariables';
import type { ContextProcessor, Message } from '../../../types';
import type { UniformTool } from '../../tools/types';

declare module '../../../types' {
  interface PipelineContextMetadataOverrides {
    contextReplaySnapshot?: ContextReplaySnapshot;
  }
}

/** These providers describe state; their updates must not rewrite earlier turns. */
const sessionProviders = new Set([
  'SystemDateProvider',
  'AgentAccountContextInjector',
  'WorkspaceContextInjector',
  'ToolDiscoveryProvider',
  'SkillContextProvider',
  'ToolSystemRoleProvider',
  'UserMemoryInjector',
  'KnowledgeInjector',
  'AgentDocumentContextInjector',
  'AgentDocumentMessageInjector',
  'AgentDocumentChangesInjector',
  'SkillChangesInjector',
  'ProjectContextInjector',
  'ActiveTopicDocumentContextInjector',
  'TaskManagerContextInjector',
  'GoalContextSyntheticInjector',
  'OnboardingContextInjector',
  'OnboardingSyntheticStateInjector',
  'OnboardingActionHintInjector',
  'TodoInjector',
  'RuntimeAdditionalContextProvider',
  'PlanInjector',
  'AgentBuilderContextInjector',
  'AgentManagementContextInjector',
  'GroupAgentBuilderContextInjector',
  'GroupContextInjector',
  'ExpertiseContextInjector',
  'DiscordContextProvider',
]);
const messageProviders = new Set([
  'SelectedSkillInjector',
  'SelectedToolInjector',
  'DocumentReferenceContextInjector',
  'TopicReferenceContextInjector',
  'SkillImportRouteInjector',
]);
const systemProviders = new Set([
  'AgentDocumentBeforeSystemInjector',
  'SystemRoleInjector',
  'ConnectorOwnershipInjector',
  'ProjectInstructionsInjector',
  'AgentIdentityInjector',
  'EvalContextSystemInjector',
  'BotPlatformContextInjector',
  'ModelInfoProvider',
  'HistorySummaryProvider',
  'AgentDocumentSystemAppendInjector',
  'AgentDocumentSystemReplaceInjector',
]);
const structuralProcessors = new Set([
  'PlaceholderMessageFilterProcessor',
  'HistoryTruncateProcessor',
  'ContextSelectionsInjector',
  'LocalSystemToolSnapshotInjector',
  'SubAgentResultMessageProcessor',
  'InputTemplateProcessor',
  'AgentCouncilFlattenProcessor',
  'GroupMessageFlattenProcessor',
  'TasksFlattenProcessor',
  'TaskMessageProcessor',
  'VerifyMessageProcessor',
  'TaskCallbackMessageProcessor',
  'RevokedDocumentResultFilter',
  'SupervisorRoleRestoreProcessor',
  'CompressedGroupRoleTransformProcessor',
  'GroupOrchestrationFilterProcessor',
  'GroupRoleTransformProcessor',
  'ActivationResultTrimProcessor',
  'StaleToolResultTrimProcessor',
  'PlaceholderVariablesProcessor',
  'ReactionFeedbackProcessor',
  'AgentSenderMessageProcessor',
  'MessageContentProcessor',
  'ToolCallProcessor',
  'ToolMessageReorder',
  'DisabledToolCallFilter',
  'ForceFinishSummaryInjector',
  'ToolActivationAnchorProcessor',
  'MessageCleanupProcessor',
]);

export const contextReplayProcessorScope = (name: string) => {
  if (sessionProviders.has(name)) return 'session' as const;
  if (messageProviders.has(name)) return 'message' as const;
  if (systemProviders.has(name)) return 'system' as const;
  if (structuralProcessors.has(name)) return 'structural' as const;
};

const text = (content: Message['content']): string =>
  typeof content === 'string'
    ? content
    : content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

const comparable = (messages: OpenAIChatMessage[]) =>
  JSON.stringify(
    messages.map((message) => ({
      content: message.content,
      role: message.role,
      calls: message.tool_calls?.map((call) => call.function),
    })),
  );

const wireMessage = (message: Message): OpenAIChatMessage => ({
  content: message.content,
  role: message.role as OpenAIChatMessage['role'],
  ...(message.tool_calls && { tool_calls: message.tool_calls }),
  ...(message.tool_call_id && { tool_call_id: message.tool_call_id }),
  ...(message.name && { name: message.name }),
});

export class ContextReplayCoordinator {
  private candidates = new Map<string, ContextReplaySegment>();

  constructor(
    private input: ContextReplayInput,
    private sessionKey: string,
    private variables: Record<string, () => string> = {},
    private tools: UniformTool[] = [],
  ) {
    if (input.runtimeContext)
      this.candidates.set('runtime_configuration', {
        key: 'runtime_configuration',
        sourceIds: [],
        messages: [
          {
            id: 'runtime_configuration',
            role: 'user',
            content: JSON.stringify(input.runtimeContext),
          },
        ],
      });
    if (input.committedSnapshot && input.committedSnapshot.invocationId !== input.invocationId)
      throw new Error('Context snapshot belongs to another invocation');
  }

  wrap(processor: ContextProcessor): ContextProcessor {
    const scope = contextReplayProcessorScope(processor.name);
    if (scope !== 'session' && scope !== 'message') return processor;
    return {
      name: processor.name,
      process: async (context) => {
        if (this.input.committedSnapshot) return context;
        // Wire-only histories may omit IDs. Give the provider temporary identities so
        // cloned anonymous messages cannot all match the last undefined map key.
        // They stay local to capture; the original history is returned unchanged.
        const existingIds = new Set(context.messages.map((message) => message.id));
        const captureMessages = context.messages.map((message, index) => {
          if (message.id) return message;
          let id = `replay-input:${this.input.invocationId}:${index}`;
          while (existingIds.has(id)) id += ':';
          existingIds.add(id);
          return { ...message, id };
        });
        const result = await processor.process({ ...context, messages: captureMessages });
        if (result.isAborted) return result;
        const before = new Map(captureMessages.map((message) => [message.id, message]));
        const parts: Message[] = [];
        for (const message of result.messages) {
          const original = before.get(message.id);
          if (!original) {
            parts.push(message);
            continue;
          }
          if (message.content === original.content) continue;
          const initial = text(original.content);
          const updated = text(message.content);
          if (initial === updated) continue;
          const index = updated.indexOf(initial);
          if (index < 0)
            throw new Error(`Context provider ${processor.name} replaced historical content`);
          const contribution = updated.slice(0, index) + updated.slice(index + initial.length);
          if (contribution.trim()) parts.push({ content: contribution.trim(), role: 'user' });
        }
        const anchor = context.messages.findLast((message) => message.role === 'user')?.id;
        const key = scope === 'session' ? processor.name : `${processor.name}:${anchor}`;
        const messages = parts.map((message, index) => ({
          ...wireMessage(message.role === 'system' ? { ...message, role: 'user' } : message),
          id: `${key}:${index}`,
        }));
        if (scope === 'session' || messages.length)
          this.candidates.set(key, {
            key,
            messages,
            sourceIds: this.input.sourceIdsByProvider?.[processor.name] ?? [],
          });
        return { ...context, metadata: result.metadata };
      },
    };
  }

  readonly materialize: ContextProcessor = {
    name: 'ContextReplay',
    process: async (context) => {
      const history = context.messages.flatMap((message) => {
        const snapshot = message.metadata?.contextReplay as ContextReplaySnapshot | undefined;
        return snapshot?.version === 1 &&
          snapshot.invocationId === message.id &&
          snapshot.sessionKey === this.sessionKey
          ? [{ messageId: message.id as string, snapshot }]
          : [];
      });
      const own = this.input.committedSnapshot;
      const previous = history.at(-1)?.snapshot;
      const historicalBaseline =
        previous?.sessionKey === this.sessionKey
          ? history.findLast((entry) => entry.snapshot.system)?.snapshot.system
          : undefined;
      const currentSystem = context.messages
        .filter((message) => message.role === 'system')
        .map(wireMessage);
      // An edited system prompt starts a new baseline so it keeps system authority.
      const baseline = own
        ? (own.system ?? historicalBaseline)
        : historicalBaseline && comparable(historicalBaseline) === comparable(currentSystem)
          ? historicalBaseline
          : undefined;
      const system = baseline ?? currentSystem;
      const withheld = new Set(this.input.withheldSourceIds ?? []);
      const visibleChanges = (snapshot: ContextReplaySnapshot) =>
        snapshot.changes.filter(
          (change) => !change.sourceIds.some((source) => withheld.has(source)),
        );
      const latest = new Map<string, ContextReplaySegment>();
      for (const entry of history)
        for (const change of visibleChanges(entry.snapshot)) latest.set(change.key, change);
      const candidates = await Promise.all(
        [...this.candidates.values()].map(async (candidate) => {
          const resolved = await new PlaceholderVariablesProcessor({
            variableGenerators: this.variables,
          }).process({ ...context, messages: candidate.messages });
          return { ...candidate, messages: resolved.messages as ContextReplaySegment['messages'] };
        }),
      );
      const changes = own
        ? visibleChanges(own)
        : candidates.filter(
            (candidate) =>
              !(messageProviders.has(candidate.key.split(':')[0]) && latest.has(candidate.key)) &&
              comparable(candidate.messages) !==
                comparable(latest.get(candidate.key)?.messages ?? []),
          );
      const canonicalChanges = own ? changes : this.canonicalize(changes);
      const sourceIds = [
        ...new Set([
          ...history.flatMap((entry) => entry.snapshot.sourceIds),
          ...canonicalChanges.flatMap((change) => change.sourceIds),
          ...Object.values(this.input.sourceIdsByProvider ?? {}).flat(),
        ]),
      ].filter((source) => !withheld.has(source));
      const snapshot: ContextReplaySnapshot = own ?? {
        executionBinding: this.input.executionBinding,
        toolDefinitions: Object.fromEntries(
          await Promise.all(
            this.tools.map(async (tool) => [tool.function.name, await stableJsonDigest(tool)]),
          ),
        ),
        historyStartId: this.input.historyStartId,
        changes: canonicalChanges,
        invocationId: this.input.invocationId,
        parentSnapshotId: previous?.invocationId,
        sessionKey: this.sessionKey,
        sourceIds,
        ...(!baseline && { system }),
        version: 1,
      };
      const events = new Map(
        history.map((entry) => [entry.messageId, visibleChanges(entry.snapshot)]),
      );
      const messages: Message[] = system.map((message) => ({ ...message }));
      for (const message of context.messages) {
        if (message.role === 'system') continue;
        for (const change of events.get(message.id) ?? []) messages.push(...this.render(change));
        messages.push(message);
      }
      for (const change of canonicalChanges) messages.push(...this.render(change));
      return {
        ...context,
        messages,
        metadata: { ...context.metadata, contextReplaySnapshot: snapshot },
      };
    },
  };

  private render(change: ContextReplaySegment): Message[] {
    if (!change.messages.length)
      return [
        {
          content: `<context_update source="${escapeXmlAttr(change.key)}" cleared="true" />`,
          role: 'user',
        },
      ];
    return change.messages.map((message) =>
      message.role === 'user'
        ? {
            ...message,
            content: `<runtime_context source="${escapeXmlAttr(change.key)}">\n${message.content}\n</runtime_context>`,
          }
        : { ...message },
    );
  }

  private canonicalize(changes: ContextReplaySegment[]): ContextReplaySegment[] {
    return changes.map((change, eventIndex) => {
      const calls = new Map<string, string>();
      for (const message of change.messages)
        message.tool_calls?.forEach((call, index) =>
          calls.set(call.id, `ctx_${this.input.invocationId}_${eventIndex}_${index}`),
        );
      return {
        ...change,
        messages: change.messages.map((message, index) => ({
          ...message,
          id: `context:${this.input.invocationId}:${eventIndex}:${index}`,
          ...(message.tool_calls && {
            tool_calls: message.tool_calls.map((call) => ({ ...call, id: calls.get(call.id)! })),
          }),
          ...(message.tool_call_id && {
            tool_call_id: calls.get(message.tool_call_id) ?? message.tool_call_id,
          }),
        })),
      };
    });
  }
}
