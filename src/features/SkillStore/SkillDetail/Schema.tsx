'use client';

import { type SkillItem } from '@lobechat/types';
import { Flexbox, Segmented, Skeleton, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '@/app/[variants]/(main)/community/features/Title';
import ContentViewer from '@/features/AgentSkillDetail/ContentViewer';
import FileTree from '@/features/AgentSkillDetail/FileTree';
import { DetailProvider } from '@/features/MCPPluginDetail/DetailProvider';
import Tools from '@/features/MCPPluginDetail/Schema/Tools';
import { ModeType } from '@/features/MCPPluginDetail/Schema/types';

import { useDetailContext } from './DetailContext';

const styles = createStaticStyles(({ css }) => ({
  divider: css`
    flex-shrink: 0;
    width: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  left: css`
    overflow-y: auto;
    flex-shrink: 0;
    width: 240px;
    padding: 8px;
  `,
  right: css`
    container-type: size;
    overflow: auto;
    flex: 1;
  `,
}));

const Schema = memo(() => {
  const { t } = useTranslation('discover');
  const { t: ts } = useTranslation('setting');
  const { tools, toolsLoading, skillContent } = useDetailContext();
  const [activeKey, setActiveKey] = useState<string[]>([]);
  const [mode, setMode] = useState<ModeType>(ModeType.Docs);
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  const toolsCount = tools.length;

  const skillDetail = useMemo(
    () => (skillContent ? ({ content: skillContent, name: '' } as SkillItem) : undefined),
    [skillContent],
  );

  if (toolsLoading) {
    return (
      <Flexbox gap={16}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </Flexbox>
    );
  }

  return (
    <DetailProvider config={{ tools, toolsCount }}>
      {toolsCount > 0 && (
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
      )}
      {skillContent && (
        <Flexbox gap={8}>
          <Flexbox
            horizontal
            style={{
              border: `1px solid ${cssVar.colorBorderSecondary}`,
              borderRadius: 8,
              height: 400,
              overflow: 'hidden',
            }}
          >
            <div className={styles.left}>
              <FileTree
                resourceTree={[]}
                selectedFile={selectedFile}
                onSelectFile={setSelectedFile}
              />
            </div>
            <div className={styles.divider} />
            <div className={styles.right} key={selectedFile}>
              <ContentViewer
                contentMap={{}}
                selectedFile={selectedFile}
                skillDetail={skillDetail}
              />
            </div>
          </Flexbox>
        </Flexbox>
      )}
    </DetailProvider>
  );
});

export default Schema;
