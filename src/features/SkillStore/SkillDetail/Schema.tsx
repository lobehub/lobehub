'use client';

import { Flexbox, Segmented, Tag } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '@/app/[variants]/(main)/community/features/Title';
import { DetailProvider } from '@/features/MCPPluginDetail/DetailProvider';
import Tools from '@/features/MCPPluginDetail/Schema/Tools';
import { ModeType } from '@/features/MCPPluginDetail/Schema/types';

import { useDetailContext } from './DetailContext';

const Schema = memo(() => {
  const { t } = useTranslation('discover');
  const { tools } = useDetailContext();
  const [activeKey, setActiveKey] = useState<string[]>([]);
  const [mode, setMode] = useState<ModeType>(ModeType.Docs);
  const toolsCount = tools.length;

  return (
    <DetailProvider config={{ tools, toolsCount }}>
      <Flexbox gap={8}>
        <Flexbox align="center" gap={12} horizontal justify="space-between">
          <Title level={3} tag={<Tag>{toolsCount}</Tag>}>
            {t('mcp.details.schema.tools.title')}
          </Title>
          <Segmented
            onChange={(v) => setMode(v as ModeType)}
            options={[
              { label: t('mcp.details.schema.mode.docs'), value: ModeType.Docs },
              { label: 'JSON', value: ModeType.JSON },
            ]}
            shape="round"
            value={mode}
            variant="outlined"
          />
        </Flexbox>
        <p style={{ marginBottom: 24 }}>{t('mcp.details.schema.tools.desc')}</p>
        <Tools activeKey={activeKey} mode={mode} setActiveKey={setActiveKey} />
      </Flexbox>
    </DetailProvider>
  );
});

export default Schema;
