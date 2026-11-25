import { escapeXmlAttr } from '@lobechat/prompts';
import type {
  ContextReplayInput,
  ContextReplaySegment,
  ContextReplaySnapshot,
  OpenAIChatMessage,
} from '@lobechat/types';

import type { ContextProcessor, Message } from '../../../types';

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
  'ProjectContextInjector',
  'ActiveTopicDocumentContextInjector',
  'TaskManagerContextInjector',
  'GoalContextSyntheticInjector',
  'OnboardingContextInjector',
  'OnboardingSyntheticStateInjector',
  'OnboardingActionHintInjector',
  'TodoInjector',
  'RuntimeAdditionalContextProvider',
]);
const messageProviders = new Set([
  'SelectedSkillInjector',
  'SelectedToolInjector',
  'DocumentReferenceContextInjector',
  'TopicReferenceContextInjector',
  'SkillImportRouteInjector',
]);

const text = (content: Message['content']): string =>
  typeof content === 'string'
    ? content
    : content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');

const comparable = (messages: ContextReplaySegment['messages']) =>
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
  ) {
    if (input.committedSnapshot && input.committedSnapshot.invocationId !== input.invocationId)
      throw new Error('Context snapshot belongs to another invocation');
  }

  wrap(processor: ContextProcessor): ContextProcessor {
    const scope = sessionProviders.has(processor.name)
      ? 'session'
      : messageProviders.has(processor.name)
        ? 'message'
        : undefined;
    if (!scope) return processor;
    return {
      name: processor.name,
      process: async (context) => {
        if (this.input.committedSnapshot) return context;
        const result = await processor.process(context);
        if (result.isAborted) return result;
        const before = new Map(context.messages.map((message) => [message.id, message]));
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
        return snapshot?.version === 1 && snapshot.invocationId === message.id
          ? [{ messageId: message.id as string, snapshot }]
          : [];
      });
      const own = this.input.committedSnapshot;
      const previous = history.at(-1)?.snapshot;
      const baseline =
        own?.system ??
        (previous?.sessionKey === this.sessionKey
          ? history.findLast((entry) => entry.snapshot.system)?.snapshot.system
          : undefined);
      const currentSystem = context.messages
        .filter((message) => message.role === 'system')
        .map(wireMessage);
      const system = baseline ?? currentSystem;
      const latest = new Map<string, ContextReplaySegment>();
      for (const entry of history)
        for (const change of entry.snapshot.changes) latest.set(change.key, change);
      const changes =
        own?.changes ??
        [...this.candidates.values()].filter(
          (candidate) =>
            comparable(candidate.messages) !==
            comparable(latest.get(candidate.key)?.messages ?? []),
        );
      const canonicalChanges = own ? changes : this.canonicalize(changes);
      const sourceIds = [
        ...new Set([
          ...history.flatMap((entry) => entry.snapshot.sourceIds),
          ...canonicalChanges.flatMap((change) => change.sourceIds),
        ]),
      ];
      const snapshot: ContextReplaySnapshot = own ?? {
        changes: canonicalChanges,
        invocationId: this.input.invocationId,
        parentSnapshotId: previous?.invocationId,
        sessionKey: this.sessionKey,
        sourceIds,
        ...(!baseline && { system }),
        version: 1,
      };
      const events = new Map(history.map((entry) => [entry.messageId, entry.snapshot.changes]));
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
