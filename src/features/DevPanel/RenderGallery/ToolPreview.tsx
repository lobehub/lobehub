'use client';

import { Flexbox, Segmented, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { useMemo, useState } from 'react';

import {
  bodyKindForMode,
  deriveFixtureProps,
  type LifecycleMode,
  type ToolRenderFixtureVariant,
} from './lifecycleMode';
import { ToolBodySlot, ToolInspectorSlot } from './toolSurfaces';
import type { ApiEntry } from './useDevtoolsEntries';
import { toApiAnchor } from './useDevtoolsEntries';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    scroll-margin-block-start: 16px;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 20px;

    background: ${cssVar.colorBgContainer};
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

interface ToolPreviewProps {
  api: ApiEntry;
  mode: LifecycleMode;
}

const ToolPreview = ({ api, mode }: ToolPreviewProps) => {
  const messageId = `devtools-${api.identifier}-${api.apiName}`;
  const toolCallId = `${messageId}-tool`;

  const variants = api.fixture.variants;
  const [activeVariantId, setActiveVariantId] = useState<string>(variants[0]?.id ?? 'default');
  const activeVariant: ToolRenderFixtureVariant =
    variants.find((variant) => variant.id === activeVariantId) ?? variants[0];

  const derived = useMemo(() => deriveFixtureProps(activeVariant, mode), [activeVariant, mode]);

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
            <ToolInspectorSlot
              api={api}
              derived={derived}
              toolCallId={toolCallId}
              variant={activeVariant}
            />
          </div>
        </Flexbox>

        <Flexbox gap={8}>
          <Flexbox horizontal className={styles.sectionLabel}>
            <Text fontSize={12} type={'secondary'} weight={600}>
              Body
            </Text>
            <Tag>{bodyKindForMode(mode)}</Tag>
          </Flexbox>
          <div className={styles.previewShell}>
            <ToolBodySlot
              api={api}
              derived={derived}
              messageId={messageId}
              mode={mode}
              toolCallId={toolCallId}
            />
          </div>
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
