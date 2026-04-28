'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { useParams } from 'react-router-dom';

import ToolPreview from './ToolPreview';
import { useDevtoolsEntries } from './useDevtoolsEntries';

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
}));

const DevtoolsToolPage = () => {
  const { toolsetMap } = useDevtoolsEntries();
  const { identifier } = useParams<{ identifier: string }>();
  const toolset = identifier ? toolsetMap.get(identifier) : undefined;

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

      {toolset.apis.map((api) => (
        <ToolPreview api={api} key={`${api.identifier}:${api.apiName}`} />
      ))}
    </Flexbox>
  );
};

export default DevtoolsToolPage;
