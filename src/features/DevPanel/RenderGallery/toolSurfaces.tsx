'use client';

import type { UIChatMessage } from '@lobechat/types';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Component, memo, type ReactNode, useMemo } from 'react';

import { type ConversationContext, ConversationProvider } from '@/features/Conversation';

import { DEVTOOLS_AGENT_ID } from './fixtures';
import {
  bodyKindForMode,
  type DerivedFixtureProps,
  type LifecycleMode,
  type ToolRenderFixtureVariant,
} from './lifecycleMode';
import type { ApiEntry } from './useDevtoolsEntries';

const styles = createStaticStyles(({ css, cssVar }) => ({
  missingShell: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/** Catches a render/inspector crash so one bad fixture can't blank the page. */
export class RenderBoundary extends Component<
  { children: ReactNode; label: string },
  { error?: Error | undefined }
> {
  constructor(props: { children: ReactNode; label: string }) {
    super(props);
    this.state = { error: undefined };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <Block padding={16} variant={'outlined'}>
        <Flexbox gap={8}>
          <Text fontSize={14} type={'danger'} weight={500}>
            {this.props.label} crashed
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {this.state.error.message}
          </Text>
        </Flexbox>
      </Block>
    );
  }
}

const Missing = ({ kind }: { kind: string }) => (
  <div className={styles.missingShell}>No {kind} component registered for this API.</div>
);

const coerceInspectorContent = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

interface ToolInspectorSlotProps {
  api: ApiEntry;
  derived: DerivedFixtureProps;
  toolCallId?: string;
  variant: ToolRenderFixtureVariant;
}

/** Renders the API's Inspector with the lifecycle-derived props, or a Missing hint. */
export const ToolInspectorSlot = memo<ToolInspectorSlotProps>(
  ({ api, derived, toolCallId, variant }) => {
    const Inspector = api.inspector;
    if (!Inspector) return <Missing kind={'inspector'} />;

    return (
      <RenderBoundary label={'Inspector'}>
        <Inspector
          apiName={api.apiName}
          args={derived.args}
          identifier={api.identifier}
          isArgumentsStreaming={derived.isArgumentsStreaming}
          isLoading={derived.isLoading}
          partialArgs={derived.partialArgs}
          pluginState={derived.pluginState}
          toolCallId={toolCallId}
          result={{
            content: coerceInspectorContent(variant.content),
            error: derived.pluginError,
            state: derived.pluginState,
          }}
        />
      </RenderBoundary>
    );
  },
);

ToolInspectorSlot.displayName = 'ToolInspectorSlot';

interface InterventionConversationHostProps {
  api: ApiEntry;
  children: ReactNode;
  derived: DerivedFixtureProps;
  messageId: string;
  toolCallId: string;
}

/**
 * Intervention components run their form logic against the conversation store
 * (e.g. draft persistence reads the tool message via `getDbMessageById`), so
 * the standalone By-API preview must seed a `ConversationProvider` with the
 * matching assistant → tool message pair — without it they crash on mount.
 */
const InterventionConversationHost = memo<InterventionConversationHostProps>(
  ({ api, children, derived, messageId, toolCallId }) => {
    const context = useMemo<ConversationContext>(
      () => ({ agentId: DEVTOOLS_AGENT_ID, topicId: `devtools-intervention-${messageId}` }),
      [messageId],
    );

    const messages = useMemo<UIChatMessage[]>(() => {
      const now = Date.now();
      const assistantId = `${messageId}-assistant`;
      return [
        {
          content: '',
          createdAt: now,
          id: assistantId,
          role: 'assistant',
          tools: [
            {
              apiName: api.apiName,
              arguments: JSON.stringify(derived.args ?? {}),
              id: toolCallId,
              identifier: api.identifier,
              source: 'builtin',
              type: 'builtin',
            },
          ],
          updatedAt: now,
        },
        {
          content: '',
          createdAt: now,
          id: messageId,
          parentId: assistantId,
          pluginIntervention: { status: 'pending' },
          role: 'tool',
          tool_call_id: toolCallId,
          updatedAt: now,
        },
      ];
    }, [api, derived.args, messageId, toolCallId]);

    return (
      <ConversationProvider hasInitMessages skipFetch context={context} messages={messages}>
        {children}
      </ConversationProvider>
    );
  },
);

InterventionConversationHost.displayName = 'InterventionConversationHost';

interface ToolBodySlotProps {
  api: ApiEntry;
  derived: DerivedFixtureProps;
  /** Aggregate flow renders nothing for an absent slot instead of a Missing hint. */
  hideMissing?: boolean;
  messageId: string;
  mode: LifecycleMode;
  toolCallId: string;
}

/**
 * Renders the API's body surface for the active lifecycle mode — the dedicated
 * Streaming / Placeholder / Intervention component when the mode targets one,
 * otherwise the Render. Streaming falls back to the Render shown mid-stream when
 * no Streaming slot exists.
 */
export const ToolBodySlot = memo<ToolBodySlotProps>(
  ({ api, derived, mode, messageId, toolCallId, hideMissing }) => {
    const missing = (kind: string) => (hideMissing ? null : <Missing kind={kind} />);

    const renderSlot = () =>
      api.render ? (
        <RenderBoundary label={'Render'}>
          <api.render
            apiName={api.apiName}
            args={derived.args}
            content={derived.content}
            identifier={api.identifier}
            messageId={messageId}
            pluginError={derived.pluginError}
            pluginState={derived.pluginState}
            toolCallId={toolCallId}
          />
        </RenderBoundary>
      ) : (
        missing('render')
      );

    switch (bodyKindForMode(mode)) {
      case 'streaming': {
        if (api.streaming) {
          return (
            <RenderBoundary label={'Streaming'}>
              <api.streaming
                apiName={api.apiName}
                args={derived.args}
                identifier={api.identifier}
                messageId={messageId}
                toolCallId={toolCallId}
              />
            </RenderBoundary>
          );
        }
        // No dedicated Streaming slot — fall back to the Render shown mid-stream.
        return api.render ? renderSlot() : missing('streaming');
      }
      case 'placeholder': {
        return api.placeholder ? (
          <RenderBoundary label={'Placeholder'}>
            <api.placeholder
              apiName={api.apiName}
              args={derived.args}
              identifier={api.identifier}
            />
          </RenderBoundary>
        ) : (
          missing('placeholder')
        );
      }
      case 'intervention': {
        return api.intervention ? (
          <RenderBoundary label={'Intervention'}>
            <InterventionConversationHost
              api={api}
              derived={derived}
              messageId={messageId}
              toolCallId={toolCallId}
            >
              <api.intervention
                apiName={api.apiName}
                args={derived.args}
                identifier={api.identifier}
                interactionMode={'approval'}
                messageId={messageId}
              />
            </InterventionConversationHost>
          </RenderBoundary>
        ) : (
          missing('intervention')
        );
      }
      default: {
        return renderSlot();
      }
    }
  },
);

ToolBodySlot.displayName = 'ToolBodySlot';
