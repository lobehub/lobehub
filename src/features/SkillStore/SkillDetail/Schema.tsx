'use client';

import { Flexbox, Segmented, Skeleton, Tag } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '@/app/[variants]/(main)/community/features/Title';
import { DetailProvider } from '@/features/MCPPluginDetail/DetailProvider';
import Tools from '@/features/MCPPluginDetail/Schema/Tools';
import { ModeType } from '@/features/MCPPluginDetail/Schema/types';

import { useDetailContext } from './DetailContext';

const Schema = memo(() => {
  const { t } = useTranslation('discover');
  const { tools, toolsLoading } = useDetailContext();
  const [activeKey, setActiveKey] = useState<string[]>([]);
  const [mode, setMode] = useState<ModeType>(ModeType.Docs);
  const toolsCount = tools.length;

  if (toolsLoading) {
    return (
      <Flexbox gap={16}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </Flexbox>
    );
  }

  return (
    <DetailProvider config={{ tools, toolsCount }}>
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <Title level={3} tag={<Tag>{toolsCount}</Tag>}>
            {t('mcp.details.schema.tools.title')}
          </Title>
          <Segmented
            shape="round"
            value={mode}
            variant="outlined"
            options={[
              { label: t('mcp.details.schema.mode.docs'), value: ModeType.Docs },
              { label: 'JSON', value: ModeType.JSON },
            ]}
            onChange={(v) => setMode(v as ModeType)}
          />
        </Flexbox>
        <p style={{ marginBottom: 24 }}>{t('mcp.details.schema.tools.desc')}</p>
        <Tools activeKey={activeKey} mode={mode} setActiveKey={setActiveKey} />
      </Flexbox>
    </DetailProvider>
  );
});

export default Schema;
