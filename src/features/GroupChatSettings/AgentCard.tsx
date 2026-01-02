'use client';

import { Avatar, Flexbox, Icon, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { Switch } from 'antd';
import { createStaticStyles, cssVar, cx, useThemeMode } from 'antd-style';
import { Bot, Loader2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import { type LobeAgentSession } from '@/types/session';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;

    overflow: hidden;

    height: 100%;
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};

    transition: border-color 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  containerDark: css`
    border: 1px solid ${cssVar.colorBorder};
  `,
  containerLight: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
  `,
  desc: css`
    overflow: hidden;

    height: 3em;
    margin-block-end: 0 !important;

    line-height: 1.5;
    color: ${cssVar.colorTextDescription};
  `,
  title: css`
    line-height: 1.3;
  `,
}));

interface AgentCardProps {
  agent: LobeAgentSession;
  inGroup: boolean;
  isHost?: boolean;
  loading?: boolean;
  onAction: (agentId: string, action: 'add' | 'remove') => void;
  operationLoading?: boolean;
}

const AgentCard = memo<AgentCardProps>(
  ({ agent, inGroup, isHost, loading, onAction, operationLoading }) => {
    const { t } = useTranslation('setting');
    const { isDarkMode } = useThemeMode();

    if (loading) {
      return (
        <Flexbox
          className={cx(
            styles.container,
            isDarkMode ? styles.containerDark : styles.containerLight,
          )}
          gap={24}
          padding={16}
        >
          <Skeleton active />
        </Flexbox>
      );
    }

    const agentId = agent.config?.id;
    const title = agent.meta?.title || t('settingGroupMembers.defaultAgent');
    const description = agent.meta?.description || '';
    const avatar = agent.meta?.avatar || DEFAULT_AVATAR;
    const avatarBackground = agent.meta?.backgroundColor;

    if (!agentId) return null;

    const handleAction = (checked: boolean) => {
      onAction(agentId, checked ? 'add' : 'remove');
    };

    return (
      <Flexbox
        className={cx(styles.container, isDarkMode ? styles.containerDark : styles.containerLight)}
        gap={24}
      >
        <Flexbox gap={12} padding={16} width={'100%'}>
          <Flexbox gap={12} width={'100%'}>
            <Flexbox align={'center'} horizontal justify={'space-between'}>
              <Flexbox align={'center'} flex={1} gap={8} horizontal style={{ minWidth: 0 }}>
                <Avatar
                  avatar={avatar}
                  background={avatarBackground}
                  shape={'square'}
                  size={24}
                  style={{ flexShrink: 0 }}
                />
                <Text
                  className={styles.title}
                  ellipsis
                  style={{ fontSize: 16, fontWeight: 'bold', minWidth: 0 }}
                >
                  {title}
                </Text>
                {isHost && (
                  <Tooltip title={t('settingGroupMembers.groupHost')}>
                    <Icon icon={Bot} size="small" style={{ color: '#1890ff' }} />
                  </Tooltip>
                )}
              </Flexbox>
            </Flexbox>
            <Text
              className={styles.desc}
              ellipsis={{
                rows: 2,
              }}
            >
              {description || t('settingGroupMembers.noDescription')}
            </Text>
          </Flexbox>
          <Flexbox align="center" horizontal justify={'space-between'} width={'100%'}>
            <Icon icon={Loader2} size="small" spin style={{ opacity: operationLoading ? 1 : 0 }} />
            <Tooltip
              title={
                inGroup
                  ? t('settingGroupMembers.removeFromGroup')
                  : t('settingGroupMembers.addToGroup')
              }
            >
              <Switch
                checked={inGroup}
                disabled={operationLoading}
                onChange={handleAction}
                size="small"
              />
            </Tooltip>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

export default AgentCard;
