'use client';

import { Flexbox, Segmented } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DetailProvider } from '@/features/MCPPluginDetail/DetailProvider';
import Tools from '@/features/MCPPluginDetail/Schema/Tools';
import { ModeType } from '@/features/MCPPluginDetail/Schema/types';

import { useDetailContext } from './DetailContext';

const Schema = memo(() => {
  const { t } = useTranslation('discover');
  const { tools } = useDetailContext();
  const [activeKey, setActiveKey] = useState<string[]>([]);
  const [mode, setMode] = useState<ModeType>(ModeType.Docs);

  return (
    <DetailProvider config={{ tools, toolsCount: tools.length }}>
      <Flexbox gap={8}>
        <Flexbox align="center" gap={12} horizontal justify="space-between">
          <div>{t('mcp.details.schema.tools.desc')}</div>

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
        <Tools activeKey={activeKey} mode={mode} setActiveKey={setActiveKey} />
      </Flexbox>
    </DetailProvider>
  );
});

export default Schema;
