'use client';

import { ActionIcon, Avatar, Block, Flexbox, Popover, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronsUpDownIcon } from 'lucide-react';
import { memo, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import SkeletonList, { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';
import List from '@/routes/(main)/home/_layout/Body/Agent/List';
import { AgentModalProvider } from '@/routes/(main)/home/_layout/Body/Agent/ModalProvider';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ cssVar, css }) => ({
  trigger: css`
    &[data-popup-open] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

const AgentSelect = memo(() => {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useNavigate();

  const [isLoading, isInbox, title, avatar, backgroundColor] = useAgentStore((s) => [
    agentSelectors.isAgentConfigLoading(s),
    builtinAgentSelectors.isInboxAgent(s),
    agentSelectors.currentAgentTitle(s),
    agentSelectors.currentAgentAvatar(s),
    agentSelectors.currentAgentBackgroundColor(s),
  ]);

  const displayTitle = isInbox
    ? title || 'Lobe AI'
    : title || t('defaultSession', { ns: 'common' });

  const popoverContent = useMemo(
    () => (
      <Suspense fallback={<SkeletonList rows={6} />}>
        <AgentModalProvider>
          <Flexbox gap={4} padding={8} style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            <List onMoreClick={() => navigate('/')} />
          </Flexbox>
        </AgentModalProvider>
      </Suspense>
    ),
    [navigate],
  );

  if (isLoading) return <SkeletonItem height={40} padding={0} />;

  return (
    <Popover
      classNames={{ trigger: styles.trigger }}
      content={popoverContent}
      nativeButton={false}
      placement="bottomLeft"
      styles={{ content: { padding: 0, width: 240 } }}
      trigger="click"
    >
      <Block
        clickable
        horizontal
        align={'center'}
        gap={8}
        padding={4}
        style={{ marginInlineStart: -4, width: 'fit-content' }}
        variant={'borderless'}
      >
        <Avatar
          avatar={isInbox ? avatar || DEFAULT_INBOX_AVATAR : avatar || DEFAULT_AVATAR}
          background={backgroundColor || undefined}
          shape={'square'}
          size={32}
        />
        <Text fontSize={16} weight={600}>
          {displayTitle}
        </Text>
        <ActionIcon icon={ChevronsUpDownIcon} size={{ blockSize: 24, size: 14 }} />
      </Block>
    </Popover>
  );
});

export default AgentSelect;
