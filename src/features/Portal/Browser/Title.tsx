import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBrowserSidebarState } from '@/features/Conversation/WorkingSidebar/Browser/useBrowserSidebarState';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Title = memo(() => {
  const { t } = useTranslation('chat');
  const sessionId = useChatStore((s) => chatPortalSelectors.browserPortal(s)?.sessionId);
  const { title } = useBrowserSidebarState(sessionId);

  return (
    <Text ellipsis={{ tooltipWhenOverflow: true }} style={{ minWidth: 0 }}>
      {title || t('workingPanel.browser.title')}
    </Text>
  );
});

export default Title;
