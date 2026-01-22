'use client';

import { Block, Flexbox, Modal } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PluginTag from '@/components/Plugins/PluginTag';
import McpDetail from '@/features/MCP/MCPDetail';
import PluginDetailModal from '@/features/PluginDetailModal';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { type LobeToolType } from '@/types/tool/tool';

import Actions from './Actions';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    padding-block: 12px;
    padding-inline: 0;
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
  `,
  title: css`
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
    color: ${token.colorText};

    &:hover {
      color: ${token.colorPrimary};
    }
  `,
}));

interface McpSkillItemProps {
  author?: string;
  avatar?: string;
  identifier: string;
  runtimeType?: string;
  title: string;
  type: LobeToolType;
}

const McpSkillItem = memo<McpSkillItemProps>(
  ({ identifier, title, avatar, type, runtimeType, author }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('plugin');
    const isMCP = runtimeType === 'mcp';
    const isCustomPlugin = type === 'customPlugin';
    const isCommunityMCP = isMCP && !isCustomPlugin;
    const [detailOpen, setDetailOpen] = useState(false);

    const plugin = useToolStore(pluginSelectors.getToolManifestById(identifier));

    return (
      <>
        <Flexbox
          align="center"
          className={styles.container}
          gap={16}
          horizontal
          justify="space-between"
        >
          <Flexbox align="center" gap={12} horizontal style={{ flex: 1, overflow: 'hidden' }}>
            <Block className={styles.icon} variant={'outlined'}>
              <PluginAvatar avatar={avatar} size={32} />
            </Block>
            <Flexbox align="center" gap={8} horizontal style={{ overflow: 'hidden' }}>
              <span className={styles.title} onClick={() => setDetailOpen(true)}>
                {title}
              </span>
              <PluginTag author={author} isMCP={isMCP} type={type} />
            </Flexbox>
          </Flexbox>
          <Actions identifier={identifier} isMCP={isMCP} type={type} />
        </Flexbox>
        {isCommunityMCP && (
          <Modal
            destroyOnHidden
            footer={null}
            onCancel={() => setDetailOpen(false)}
            open={detailOpen}
            title={t('dev.title.skillDetails')}
            width={800}
          >
            <McpDetail identifier={identifier} noSettings />
          </Modal>
        )}
        {isCustomPlugin && (
          <PluginDetailModal
            id={identifier}
            onClose={() => setDetailOpen(false)}
            open={detailOpen}
            schema={plugin?.settings}
            tab="info"
          />
        )}
      </>
    );
  },
);

McpSkillItem.displayName = 'McpSkillItem';

export default McpSkillItem;
