'use client';

import { Flexbox, Modal } from '@lobehub/ui';
import { memo, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PluginTag from '@/components/Plugins/PluginTag';
import McpDetail from '@/features/MCP/MCPDetail';
import McpDetailLoading from '@/features/MCP/MCPDetail/Loading';
import PluginDetailModal from '@/features/PluginDetailModal';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { type LobeToolType } from '@/types/tool/tool';

import Actions from './Actions';
import { styles } from './style';

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
    const { t } = useTranslation('plugin');
    const isMCP = runtimeType === 'mcp';
    const isCustomPlugin = type === 'customPlugin';
    const isCommunityMCP = isMCP && !isCustomPlugin;
    const [detailOpen, setDetailOpen] = useState(false);

    const plugin = useToolStore(pluginSelectors.getToolManifestById(identifier));

    return (
      <>
        <Flexbox
          horizontal
          align="center"
          className={styles.container}
          gap={16}
          justify="space-between"
        >
          <Flexbox horizontal align="center" gap={16} style={{ flex: 1, overflow: 'hidden' }}>
            <Flexbox
              horizontal
              align="center"
              gap={16}
              style={{ cursor: 'pointer' }}
              onClick={() => setDetailOpen(true)}
            >
              <div className={styles.icon}>
                <PluginAvatar avatar={avatar} size={32} />
              </div>
              <span className={styles.title}>{title}</span>
            </Flexbox>
            <PluginTag author={author} isMCP={isMCP} type={type} />
          </Flexbox>
          <Actions identifier={identifier} isMCP={isMCP} type={type} />
        </Flexbox>
        {isCommunityMCP && (
          <Modal
            destroyOnHidden
            footer={null}
            open={detailOpen}
            title={t('dev.title.skillDetails')}
            width={800}
            onCancel={() => setDetailOpen(false)}
          >
            <Suspense fallback={<McpDetailLoading />}>
              <McpDetail noSettings identifier={identifier} />
            </Suspense>
          </Modal>
        )}
        {isCustomPlugin && (
          <PluginDetailModal
            id={identifier}
            open={detailOpen}
            schema={plugin?.settings}
            tab="info"
            onClose={() => setDetailOpen(false)}
          />
        )}
      </>
    );
  },
);

McpSkillItem.displayName = 'McpSkillItem';

export default McpSkillItem;
