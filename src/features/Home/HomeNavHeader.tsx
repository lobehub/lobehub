import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { useHomeUsageWidgetActive } from '@/business/client/features/HomeUsageWidget';
import NavHeader from '@/features/NavHeader';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import CustomizeButton from './CustomizeButton';
import RailToggle from './RailToggle';
import { canHostRail } from './railVisibility';

// Floats over the dashboard instead of pushing it down: the controls live in
// the page's top corners, where the content never reaches.
const styles = createStaticStyles(({ css }) => ({
  header: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 0;
    inset-inline: 0;
  `,
}));

const HomeNavHeader = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const [showHomeRail, toggleHomeRail, isStatusInit] = useGlobalStore((s) => [
    systemStatusSelectors.showHomeRail(s),
    s.toggleHomeRail,
    systemStatusSelectors.isStatusInit(s),
  ]);
  const hiddenWidgets = useGlobalStore(systemStatusSelectors.hiddenHomeWidgets);
  const usageActive = useHomeUsageWidgetActive();

  return (
    <NavHeader
      className={styles.header}
      right={
        isLogin && isStatusInit ? (
          <Flexbox horizontal align={'center'} gap={4}>
            <CustomizeButton />
            {canHostRail(hiddenWidgets, usageActive) && (
              <RailToggle railVisible={showHomeRail} onToggle={toggleHomeRail} />
            )}
          </Flexbox>
        ) : undefined
      }
    />
  );
});

export default HomeNavHeader;
