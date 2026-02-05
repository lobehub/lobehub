import { BRANDING_NAME } from '@lobechat/business-const';
import { Avatar, Block, Collapse, Flexbox, Grid, Text } from '@lobehub/ui';
import { ChatList } from '@lobehub/ui/chat';
import { createStaticStyles, useTheme } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_USER_AVATAR_URL } from '@/const/meta';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import Title from '../../../../../features/Title';
import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    desc: css`
      flex: 1;
      margin: 0 !important;
      color: ${cssVar.colorTextSecondary};
    `,
    title: css`
      margin: 0 !important;
      font-size: 14px !important;
      font-weight: 500 !important;
    `,
  };
});

const MemberCard = memo(
  ({
    agent,
    currentVersion,
  }: {
    agent: any;
    currentVersion: any;
  }) => {
    return (
      <Block
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          cursor: 'default',
          overflow: 'hidden',
        }}
      >
        <Flexbox gap={12} padding={16}>
          {/* Avatar and Basic Info */}
          <Flexbox horizontal align={'flex-start'} gap={12}>
            <Avatar
              avatar={currentVersion.avatar || agent.name?.[0]}
              shape={'square'}
              size={40}
              style={{ flex: 'none' }}
            />
            <Flexbox
              flex={1}
              gap={4}
              style={{
                overflow: 'hidden',
              }}
            >
              <Text ellipsis as={'h3'} className={styles.title}>
                {currentVersion.name || agent.name}
              </Text>
            </Flexbox>
          </Flexbox>

          {/* Description */}
          {currentVersion.description && currentVersion.description !== 'No description provided' && (
            <Text
              as={'p'}
              className={styles.desc}
              ellipsis={{
                rows: 2,
              }}
            >
              {currentVersion.description}
            </Text>
          )}
        </Flexbox>
      </Block>
    );
  },
);

MemberCard.displayName = 'MemberCard';

const Overview = memo(() => {
  const [userAvatar, username] = useUserStore((s) => [
    userProfileSelectors.userAvatar(s),
    userProfileSelectors.username(s),
  ]);

  const isSignedIn = useUserStore(authSelectors.isLogin);
  const { t } = useTranslation('discover');
  const theme = useTheme();
  const {
    examples = [],
    description,
    summary,
    avatar,
    title,
    backgroundColor,
    config,
    memberAgents = [],
  } = useDetailContext();

  const data: any = [
    {
      content: config?.openingMessage,
      role: 'assistant',
    },
    ...examples,
  ].map((item, index) => {
    let meta = {
      avatar,
      backgroundColor: backgroundColor || 'transparent',
      title,
    };
    if (item.role === 'user') {
      meta = {
        avatar: isSignedIn && !!userAvatar ? userAvatar : DEFAULT_USER_AVATAR_URL,
        backgroundColor: 'transparent',
        title: isSignedIn && !!username ? username : BRANDING_NAME,
      };
    }

    return {
      extra: {},
      id: index,
      ...item,
      meta,
    };
  });

  // Sort: supervisors first, then by displayOrder
  const sortedMembers = [...(memberAgents || [])].sort((a: any, b: any) => {
    const aRole = a.role || a.agent?.role;
    const bRole = b.role || b.agent?.role;
    if (aRole === 'supervisor' && bRole !== 'supervisor') return -1;
    if (aRole !== 'supervisor' && bRole === 'supervisor') return 1;
    const aOrder = a.displayOrder || a.agent?.displayOrder || 0;
    const bOrder = b.displayOrder || b.agent?.displayOrder || 0;
    return aOrder - bOrder;
  });

  return (
    <Flexbox gap={16}>
      <Collapse
        defaultActiveKey={['summary']}
        expandIconPlacement={'end'}
        variant={'outlined'}
        items={[
          {
            children: summary || description,
            key: 'summary',
            label: t('groupAgents.details.summary.title', { defaultValue: 'Summary' }),
          },
        ]}
      />

      {/* Members Section */}
      {memberAgents.length > 0 && (
        <>
          <Title>
            {t('groupAgents.details.members.title', { defaultValue: 'Member Agents' })} (
            {memberAgents.length})
          </Title>
          <Grid rows={4} width={'100%'}>
            {sortedMembers.map((member: any, index) => {
              // Support both flat structure and nested structure
              const agent = member.agent || member;
              const currentVersion = member.currentVersion || member;
              return (
                <MemberCard
                  agent={agent}
                  currentVersion={currentVersion}
                  key={agent.identifier || index}
                />
              );
            })}
          </Grid>
        </>
      )}

      {data.length > 0 && config?.openingMessage && (
        <>
          <Title>
            {t('groupAgents.details.overview.example', { defaultValue: 'Conversation Example' })}
          </Title>
          <Block
            variant={'outlined'}
            style={{
              background: theme.colorBgContainerSecondary,
            }}
          >
            <ChatList
              data={data}
              style={{ width: '100%' }}
              renderMessages={{
                default: ({ id, editableContent }) => <div id={id}>{editableContent}</div>,
              }}
            />
          </Block>
        </>
      )}
    </Flexbox>
  );
});

export default Overview;
