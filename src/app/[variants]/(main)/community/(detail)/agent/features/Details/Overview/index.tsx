import { BRANDING_NAME } from '@lobechat/business-const';
import { Block, Collapse, Flexbox } from '@lobehub/ui';
import { ChatList } from '@lobehub/ui/chat';
import { useTheme } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_USER_AVATAR_URL } from '@/const/meta';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import Title from '../../../../../features/Title';
import { useDetailContext } from '../../DetailProvider';

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
  } = useDetailContext();
  console.log('examples', examples);

  console.log('summary', summary);
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

  return (
    <Flexbox gap={16}>
      <Collapse
        defaultActiveKey={['summary']}
        expandIconPlacement={'end'}
        items={[
          {
            children: summary || description,
            key: 'summary',
            label: t('assistants.details.summary.title'),
          },
        ]}
        variant={'outlined'}
      />
      <Title>{t('assistants.details.overview.example')}</Title>
      <Block
        style={{
          background: theme.colorBgContainerSecondary,
        }}
        variant={'outlined'}
      >
        <ChatList
          data={data}
          renderMessages={{
            default: ({ id, editableContent }) => <div id={id}>{editableContent}</div>,
          }}
          style={{ width: '100%' }}
        />
      </Block>
    </Flexbox>
  );
});

export default Overview;
