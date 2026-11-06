import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import Body from './Body';
import ThreadBody from './ThreadBody';

const styles = stylex.create({
  container: { overflow: 'hidden', flex: '1', minHeight: '0' },
  subheader: {
    flexShrink: 0,
    height: '40px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

const TopicCommentsSidebar = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.currentView);
  const [goBack, openTopicComments] = useChatStore((s) => [s.goBack, s.openTopicComments]);

  if (view?.type === PortalViewType.TopicComments && !view.messageId) {
    return <Body />;
  }

  if (
    view?.type !== PortalViewType.TopicComments &&
    view?.type !== PortalViewType.TopicCommentThread
  )
    return null;

  const isThread = view.type === PortalViewType.TopicCommentThread;

  return (
    <Flexbox className={stylex.props(styles.container).className}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.subheader).className}
        gap={4}
      >
        <ActionIcon
          icon={ArrowLeft}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          onClick={isThread ? goBack : () => openTopicComments(view.topicId)}
        />
        <Text fontSize={13} weight={500}>
          {t(isThread ? 'topicComment.thread' : 'topicComment.messageComments')}
        </Text>
      </Flexbox>
      {isThread ? <ThreadBody /> : <Body />}
    </Flexbox>
  );
});

TopicCommentsSidebar.displayName = 'TopicCommentsSidebar';

export default TopicCommentsSidebar;
