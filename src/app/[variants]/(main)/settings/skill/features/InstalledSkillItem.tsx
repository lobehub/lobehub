'use client';

import { Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo } from 'react';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PluginTag from '@/components/Plugins/PluginTag';
import Actions from '@/features/PluginStore/InstalledList/List/Item/Action';
import { type LobeToolType } from '@/types/tool/tool';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    padding: 12px 0;
  `,
  desc: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-size: 14px;
    color: ${token.colorTextTertiary};
    text-overflow: ellipsis;
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;

    background: ${token.colorFillTertiary};
    border-radius: 12px;
  `,
  title: css`
    font-size: 15px;
    font-weight: 500;
    color: ${token.colorText};
  `,
}));

interface InstalledSkillItemProps {
  author?: string;
  avatar?: string;
  description?: string;
  identifier: string;
  runtimeType?: string;
  title: string;
  type: LobeToolType;
}

const InstalledSkillItem = memo<InstalledSkillItemProps>(
  ({ identifier, title, description, avatar, type, runtimeType, author }) => {
    const { styles } = useStyles();
    const isMCP = runtimeType === 'mcp';

    return (
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
          <Flexbox gap={4} style={{ overflow: 'hidden' }}>
            <Flexbox align="center" gap={8} horizontal>
              <span className={styles.title}>{title}</span>
              <PluginTag author={author} isMCP={isMCP} type={type} />
            </Flexbox>
            <span className={styles.desc}>{description}</span>
          </Flexbox>
        </Flexbox>
        <Actions identifier={identifier} isMCP={isMCP} type={type} />
      </Flexbox>
    );
  },
);

InstalledSkillItem.displayName = 'InstalledSkillItem';

export default InstalledSkillItem;
