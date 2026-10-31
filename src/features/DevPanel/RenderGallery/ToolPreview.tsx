'use client';

import { Flexbox, Tabs, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  card: {
    scrollMarginBlockStart: '16px',
    overflow: 'hidden',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  cardBody: { gap: '0' },
  cardHeader: {
    gap: '6px',
    padding: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  code: {
    overflow: 'auto',
    maxHeight: '320px',
    margin: '0',
    padding: '12px',
    fontSize: '12px',
    lineHeight: 1.55,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  fixture: { padding: '12px' },
  fixtureSummary: {
    cursor: 'pointer',
    userSelect: 'none',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  previewShell: {
    padding: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  previewSection: {
    gap: '8px',
    padding: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  sectionLabel: { gap: '8px', alignItems: 'center' },
});

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
    <Flexbox className={stylex.props(styles.card).className} id={toApiAnchor(api.apiName)}>
      <Flexbox className={stylex.props(styles.cardHeader).className}>
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Text fontSize={18} weight={600}>
            {api.apiName}
          </Text>
          <Tag>{api.identifier}</Tag>
          {variants.length > 1 && (
            <Tabs
              activeKey={activeVariant.id}
              size={'small'}
              items={variants.map((variant) => ({
                key: variant.id,
                label: variant.label,
              }))}
              onChange={(key) => setActiveVariantId(key)}
            />
          )}
        </Flexbox>
        {(api.description || activeVariant.description) && (
          <Text fontSize={13} type={'secondary'}>
            {activeVariant.description ?? api.description}
          </Text>
        )}
      </Flexbox>

      <Flexbox className={stylex.props(styles.cardBody).className}>
        <Flexbox className={stylex.props(styles.previewSection).className}>
          <Flexbox horizontal className={stylex.props(styles.sectionLabel).className}>
            <Text fontSize={12} type={'secondary'} weight={600}>
              Inspector
            </Text>
          </Flexbox>
          <div {...stylex.props(styles.previewShell)}>
            <ToolInspectorSlot
              api={api}
              derived={derived}
              toolCallId={toolCallId}
              variant={activeVariant}
            />
          </div>
        </Flexbox>

        <Flexbox className={stylex.props(styles.previewSection).className}>
          <Flexbox horizontal className={stylex.props(styles.sectionLabel).className}>
            <Text fontSize={12} type={'secondary'} weight={600}>
              Body
            </Text>
            <Tag>{bodyKindForMode(mode)}</Tag>
          </Flexbox>
          <div {...stylex.props(styles.previewShell)}>
            <ToolBodySlot
              api={api}
              derived={derived}
              messageId={messageId}
              mode={mode}
              toolCallId={toolCallId}
            />
          </div>
        </Flexbox>

        <details {...stylex.props(styles.fixture)}>
          <summary {...stylex.props(styles.fixtureSummary)}>Fixture payload</summary>
          <pre {...stylex.props(styles.code)}>
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
