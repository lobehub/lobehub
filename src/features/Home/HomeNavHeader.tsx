import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import RailToggle from './RailToggle';

// Floats over the dashboard instead of pushing it down: the controls live in
// the page's top corners, where the content never reaches.
const styles = createStaticStyles(({ css }) => ({
  header: css`
    position: absolute;
    z-index: 10;
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

  return (
    <NavHeader
      className={styles.header}
      right={
        isLogin && isStatusInit ? (
          <RailToggle railVisible={showHomeRail} onToggle={toggleHomeRail} />
        ) : undefined
      }
    />
  );
});

export default HomeNavHeader;
