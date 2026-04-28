import { Avatar, Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { getPlatformIcon } from '@/routes/(main)/agent/channel/const';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    min-height: 128px;
  `,
  title: css`
    overflow: hidden;

    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  channelCount: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  channelIcon: css`
    flex-shrink: 0;
  `,
}));

const AgentSummary = memo(() => {
  const { t } = useTranslation(['chat', 'discover']);
  const navigate = useNavigate();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const meta = useAgentStore(agentSelectors.currentAgentMeta);
  const { data: providers = [] } = useAgentStore((s) => s.useFetchBotProviders(activeAgentId));
  const { data: platforms = [] } = useAgentStore((s) => s.useFetchPlatformDefinitions());
  const title = meta.title || t('untitledAgent');

  const enabledChannels = useMemo(() => providers.filter((item) => item.enabled), [providers]);

  const channelIcons = useMemo(() => {
    const platformNameById = new Map(platforms.map((item) => [item.id, item.name]));
    const iconKeys = Array.from(
      new Set(
        enabledChannels.map((item) => {
          const name = platformNameById.get(item.platform) || item.platform;
          return name;
        }),
      ),
    );

    return iconKeys
      .map((key) => ({ Icon: getPlatformIcon(key), key }))
      .filter((item): item is { Icon: NonNullable<typeof item.Icon>; key: string } => !!item.Icon)
      .slice(0, 3);
  }, [enabledChannels, platforms]);

  return (
    <Flexbox
      className={styles.header}
      data-testid="workspace-summary"
      gap={8}
      padding={16}
      width={'100%'}
    >
      <Flexbox gap={12}>
        <Avatar avatar={meta.avatar} background={meta.backgroundColor} shape={'square'} size={44} />
        <Flexbox gap={4} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={6}>
            <strong className={styles.title}>{title}</strong>
            {channelIcons.map(({ Icon, key }) => (
              <Icon className={styles.channelIcon} key={key} size={14} />
            ))}
            {enabledChannels.length > channelIcons.length && (
              <span className={styles.channelCount}>
                +{enabledChannels.length - channelIcons.length}
              </span>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Button
        block
        shape={'round'}
        size={'small'}
        style={{ color: cssVar.colorTextTertiary, width: 'fit-content' }}
        variant={'filled'}
        onClick={() => activeAgentId && navigate(`/agent/${activeAgentId}/profile`)}
      >
        {t('user.editProfile', { ns: 'discover' })}
      </Button>
    </Flexbox>
  );
});

AgentSummary.displayName = 'AgentSummary';

export default AgentSummary;
