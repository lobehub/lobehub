'use client';

import { Avatar, Flexbox, Icon, Modal } from '@lobehub/ui';
import { McpIcon } from '@lobehub/ui/icons';
import { memo, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MCPTag from '@/components/Plugins/MCPTag';
import PluginTag from '@/components/Plugins/PluginTag';
import McpDetail from '@/features/MCP/MCPDetail';
import McpDetailLoading from '@/features/MCP/MCPDetail/Loading';
import NavItem from '@/features/NavPanel/components/NavItem';
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
  isSelected?: boolean;
  onSelect?: () => void;
  runtimeType?: string;
  title: string;
  type: LobeToolType;
}

const McpSkillItem = memo<McpSkillItemProps>(
  ({ identifier, title, avatar, type, runtimeType, author, isSelected, onSelect }) => {
    const { t } = useTranslation('plugin');
    const isMCP = runtimeType === 'mcp';
    const isCustomPlugin = type === 'customPlugin';
    const isCommunityMCP = isMCP && !isCustomPlugin;
    const [detailOpen, setDetailOpen] = useState(false);

    const plugin = useToolStore(pluginSelectors.getToolManifestById(identifier));

    if (onSelect) {
      return (
        <NavItem
          active={isSelected}
          title={title}
          icon={() =>
            avatar && avatar !== 'MCP_AVATAR' ? (
              <Avatar avatar={avatar} shape="square" size={18} />
            ) : (
              <Icon icon={McpIcon} size={18} />
            )
          }
          onClick={onSelect}
        />
      );
    }

    return (
      <>
        <Flexbox
          horizontal
          align="center"
          className={styles.container}
          gap={8}
          justify="space-between"
          style={{
            ...(isSelected ? { background: 'var(--ant-color-primary-bg)', borderRadius: 6 } : {}),
            ...(onSelect ? { cursor: 'pointer' } : {}),
          }}
          onClick={onSelect}
        >
          <Flexbox horizontal align="center" gap={8} style={{ flex: 1, overflow: 'hidden' }}>
            <div className={styles.icon}>
              {avatar && avatar !== 'MCP_AVATAR' ? (
                <Avatar avatar={avatar} shape={'square'} size={16} />
              ) : (
                <Icon icon={McpIcon} size={16} />
              )}
            </div>
            <span
              className={styles.title}
              onClick={onSelect ? undefined : () => setDetailOpen(true)}
            >
              {title}
            </span>
          </Flexbox>
          {!onSelect && (
            <Flexbox horizontal align="center" gap={4}>
              {isCustomPlugin ? (
                <MCPTag showText={false} />
              ) : (
                <PluginTag author={author} isMCP={isMCP} type={type} />
              )}
              <Actions identifier={identifier} isMCP={isMCP} type={type} />
            </Flexbox>
          )}
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
