import { Flexbox } from '@lobehub/ui';
import { type FC, type PropsWithChildren } from 'react';
import { useMemo, useRef } from 'react';

import { useIsDark } from '@/hooks/useIsDark';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { getInnerCssVariables, getOuterCssVariables } from './cssVariables';
import { LayoutContainerContext } from './LayoutContainerContext';
import { styles } from './style';

const DesktopLayoutContainer: FC<PropsWithChildren> = ({ children }) => {
  const innerContainerRef = useRef<HTMLDivElement>(null);
  const isDarkMode = useIsDark();
  const [expand] = useGlobalStore((s) => [systemStatusSelectors.showLeftPanel(s)]);

  const outerCssVariables = useMemo(() => getOuterCssVariables({ expand }), [expand]);

  const innerCssVariables = useMemo(
    () => getInnerCssVariables({ isDark: isDarkMode }),
    [isDarkMode],
  );

  return (
    <Flexbox
      className={styles.outerContainer}
      height={'100%'}
      padding={8}
      style={outerCssVariables}
      width={'100%'}
    >
      <Flexbox
        className={styles.innerContainer}
        height={'100%'}
        ref={innerContainerRef}
        style={innerCssVariables}
        width={'100%'}
      >
        <LayoutContainerContext value={innerContainerRef}>{children}</LayoutContainerContext>
      </Flexbox>
    </Flexbox>
  );
};
export default DesktopLayoutContainer;
