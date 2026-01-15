'use client';

import { Drawer, Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PluginTag from '@/components/Plugins/PluginTag';
import PluginDetailModal from '@/features/PluginDetailModal';
import Actions from '@/features/PluginStore/InstalledList/List/Item/Action';
import McpDetail from '@/features/PluginStore/McpList/Detail';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { type LobeToolType } from '@/types/tool/tool';

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

    width: 48px;
    height: 48px;
    border-radius: 12px;

    background: ${token.colorFillTertiary};
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

interface InstalledSkillItemProps {
  author?: string;
  avatar?: string;
  identifier: string;
  runtimeType?: string;
  title: string;
  type: LobeToolType;
}

const InstalledSkillItem = memo<InstalledSkillItemProps>(
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
          <Flexbox align="center" gap={16} horizontal style={{ flex: 1, overflow: 'hidden' }}>
            <div className={styles.icon}>
              <PluginAvatar avatar={avatar} size={32} />
            </div>
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
          <Drawer
            containerMaxWidth={'auto'}
            destroyOnHidden
            footer={null}
            height={'100vh'}
            onClose={() => setDetailOpen(false)}
            open={detailOpen}
            placement={'bottom'}
            styles={{ body: { padding: 24 } }}
            title={t('store.actions.detail')}
          >
            <McpDetail identifier={identifier} />
          </Drawer>
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

InstalledSkillItem.displayName = 'InstalledSkillItem';

export default InstalledSkillItem;
