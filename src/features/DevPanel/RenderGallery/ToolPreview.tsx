'use client';

import { Block, Flexbox, Segmented, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Component, type ReactNode, useMemo, useState } from 'react';

import {
  bodyKindForMode,
  deriveFixtureProps,
  type FixtureBodyKind,
  type LifecycleMode,
  type ToolRenderFixtureVariant,
} from './lifecycleMode';
import type { ApiEntry } from './useDevtoolsEntries';
import { toApiAnchor } from './useDevtoolsEntries';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    scroll-margin-block-start: 16px;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 20px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  cardBody: css`
    padding: 20px;
  `,
  cardHeader: css`
    gap: 10px;

    padding-block: 20px;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: linear-gradient(
      180deg,
      ${cssVar.colorFillQuaternary} 0%,
      ${cssVar.colorBgContainer} 100%
    );
  `,
  code: css`
    overflow: auto;

    max-height: 320px;
    margin: 0;
    padding: 12px;
    border-radius: 12px;

    font-size: 12px;
    line-height: 1.55;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  fixtureSummary: css`
    cursor: pointer;
    user-select: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  missingShell: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  previewShell: css`
    padding: 16px;
    border-radius: 16px;
    background: ${cssVar.colorFillQuaternary};
  `,
  sectionLabel: css`
    gap: 8px;
    align-items: center;
  `,
}));

class RenderBoundary extends Component<
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

const coerceInspectorContent = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const Missing = ({ kind }: { kind: string }) => (
  <div className={styles.missingShell}>No {kind} component registered for this API.</div>
);

interface ToolPreviewProps {
  api: ApiEntry;
  mode: LifecycleMode;
}

const ToolPreview = ({ api, mode }: ToolPreviewProps) => {
  const messageId = `devtools-${api.identifier}-${api.apiName}`;
  const toolCallId = `${messageId}-tool`;

  const Inspector = api.inspector;
  const Render = api.render;
  const Streaming = api.streaming;
  const Placeholder = api.placeholder;
  const Intervention = api.intervention;

  const variants = api.fixture.variants;
  const [activeVariantId, setActiveVariantId] = useState<string>(variants[0]?.id ?? 'default');
  const activeVariant: ToolRenderFixtureVariant =
    variants.find((variant) => variant.id === activeVariantId) ?? variants[0];

  const derived = useMemo(() => deriveFixtureProps(activeVariant, mode), [activeVariant, mode]);

  const targetBodyKind: FixtureBodyKind = bodyKindForMode(mode);

  const inspectorResult = {
    content: coerceInspectorContent(activeVariant.content),
    error: derived.pluginError,
    state: derived.pluginState,
  };

  const bodyContent = (() => {
    switch (targetBodyKind) {
      case 'streaming': {
        if (Streaming) {
          return (
            <RenderBoundary label={'Streaming'}>
              <Streaming
                apiName={api.apiName}
                args={derived.args}
                identifier={api.identifier}
                messageId={messageId}
                toolCallId={toolCallId}
              />
            </RenderBoundary>
          );
        }
        // No dedicated Streaming slot — fall back to Render shown in streaming state.
        if (Render) {
          return (
            <RenderBoundary label={'Render'}>
              <Render
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
          );
        }
        return <Missing kind={'streaming'} />;
      }
      case 'placeholder': {
        return Placeholder ? (
          <RenderBoundary label={'Placeholder'}>
            <Placeholder apiName={api.apiName} args={derived.args} identifier={api.identifier} />
          </RenderBoundary>
        ) : (
          <Missing kind={'placeholder'} />
        );
      }
      case 'intervention': {
        return Intervention ? (
          <RenderBoundary label={'Intervention'}>
            <Intervention
              apiName={api.apiName}
              args={derived.args}
              identifier={api.identifier}
              interactionMode={'approval'}
              messageId={messageId}
            />
          </RenderBoundary>
        ) : (
          <Missing kind={'intervention'} />
        );
      }
      default: {
        return Render ? (
          <RenderBoundary label={'Render'}>
            <Render
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
          <Missing kind={'render'} />
        );
      }
    }
  })();

  return (
    <Flexbox className={styles.card} id={toApiAnchor(api.apiName)}>
      <Flexbox className={styles.cardHeader}>
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Text fontSize={18} weight={600}>
            {api.apiName}
          </Text>
          <Tag>{api.identifier}</Tag>
          {variants.length > 1 && (
            <Segmented
              size={'small'}
              value={activeVariant.id}
              options={variants.map((variant) => ({
                label: variant.label,
                value: variant.id,
              }))}
              onChange={(value) => setActiveVariantId(value as string)}
            />
          )}
        </Flexbox>
        {(api.description || activeVariant.description) && (
          <Text fontSize={13} type={'secondary'}>
            {activeVariant.description ?? api.description}
          </Text>
        )}
      </Flexbox>

      <Flexbox className={styles.cardBody} gap={16}>
        <Flexbox gap={8}>
          <Flexbox horizontal className={styles.sectionLabel}>
            <Text fontSize={12} type={'secondary'} weight={600}>
              Inspector
            </Text>
          </Flexbox>
          <div className={styles.previewShell}>
            {Inspector ? (
              <RenderBoundary label={'Inspector'}>
                <Inspector
                  apiName={api.apiName}
                  args={derived.args}
                  identifier={api.identifier}
                  isArgumentsStreaming={derived.isArgumentsStreaming}
                  isLoading={derived.isLoading}
                  partialArgs={derived.partialArgs}
                  pluginState={derived.pluginState}
                  result={inspectorResult}
                />
              </RenderBoundary>
            ) : (
              <Missing kind={'inspector'} />
            )}
          </div>
        </Flexbox>

        <Flexbox gap={8}>
          <Flexbox horizontal className={styles.sectionLabel}>
            <Text fontSize={12} type={'secondary'} weight={600}>
              Body
            </Text>
            <Tag>{targetBodyKind}</Tag>
          </Flexbox>
          <div className={styles.previewShell}>{bodyContent}</div>
        </Flexbox>

        <details>
          <summary className={styles.fixtureSummary}>Fixture payload</summary>
          <pre className={styles.code}>
            {JSON.stringify(
              {
                args: derived.args,
                content: derived.content,
                isArgumentsStreaming: derived.isArgumentsStreaming,
                isLoading: derived.isLoading,
                partialArgs: derived.partialArgs,
                pluginError: derived.pluginError,
                pluginState: derived.pluginState,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </Flexbox>
    </Flexbox>
  );
};

export default ToolPreview;
