import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ChartNoAxesColumnIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { oneLineEllipsis } from '@/styles';

const Title = memo(() => {
  const { t } = useTranslation('dashboard');
  const view = useChatStore(chatPortalSelectors.dashboardWidgetView);
  const widget = useDashboardStore(dashboardSelectors.widgetDetail(view?.widgetId));

  return (
    // Hug the content so the shared `…` sits right after the title.
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <Icon color={cssVar.colorTextSecondary} icon={ChartNoAxesColumnIcon} size={16} />
      <Text className={oneLineEllipsis} style={{ flex: '0 1 auto', fontSize: 14, minWidth: 0 }}>
        {widget?.title ?? t('portal.title')}
      </Text>
    </Flexbox>
  );
});

export default Title;
