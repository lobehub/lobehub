'use client';

import { Flexbox, Segmented, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { LIFECYCLE_MODE_LABEL, LIFECYCLE_MODES, type LifecycleMode } from './lifecycleMode';
import ToolPreview from './ToolPreview';
import { useDevtoolsEntries } from './useDevtoolsEntries';

const STORAGE_KEY = 'devtools-render-gallery:lifecycle-mode';

const isLifecycleMode = (value: string | null): value is LifecycleMode =>
  !!value && (LIFECYCLE_MODES as string[]).includes(value);

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    gap: 24px;
    max-width: 1200px;
    padding: 28px;
  `,
  empty: css`
    flex: 1;
    gap: 6px;
    align-items: center;
    justify-content: center;

    color: ${cssVar.colorTextTertiary};
  `,
  header: css`
    gap: 8px;
    padding-block-end: 4px;
  `,
  modeBar: css`
    position: sticky;
    z-index: 2;
    inset-block-start: 0;

    gap: 12px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 14px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
}));

const DevtoolsToolPage = () => {
  const { toolsetMap } = useDevtoolsEntries();
  const { identifier } = useParams<{ identifier: string }>();
  const toolset = identifier ? toolsetMap.get(identifier) : undefined;

  const [mode, setMode] = useState<LifecycleMode>('success');

  // Hydrate from localStorage so the choice survives navigation between toolsets.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLifecycleMode(stored)) setMode(stored);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  if (!toolset) {
    return (
      <Flexbox className={styles.empty}>
        <Text fontSize={14} weight={500}>
          Unknown toolset
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {identifier}
        </Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.body}>
      <Flexbox className={styles.header}>
        <Flexbox horizontal align={'center'} gap={10} wrap={'wrap'}>
          <Text fontSize={22} weight={700}>
            {toolset.toolsetName}
          </Text>
          <Tag>{toolset.identifier}</Tag>
          <Text fontSize={12} type={'secondary'}>
            {toolset.apis.length} API{toolset.apis.length === 1 ? '' : 's'}
          </Text>
        </Flexbox>
        {toolset.toolsetDescription && (
          <Text fontSize={13} type={'secondary'}>
            {toolset.toolsetDescription}
          </Text>
        )}
      </Flexbox>

      <Flexbox horizontal className={styles.modeBar}>
        <Text fontSize={12} type={'secondary'} weight={600}>
          Lifecycle
        </Text>
        <Segmented
          size={'small'}
          value={mode}
          options={LIFECYCLE_MODES.map((value) => ({
            label: LIFECYCLE_MODE_LABEL[value],
            value,
          }))}
          onChange={(value) => setMode(value as LifecycleMode)}
        />
      </Flexbox>

      {toolset.apis.map((api) => (
        <ToolPreview api={api} key={`${api.identifier}:${api.apiName}`} mode={mode} />
      ))}
    </Flexbox>
  );
};

export default DevtoolsToolPage;
