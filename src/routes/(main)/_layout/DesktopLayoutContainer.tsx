import { Flexbox } from '@lobehub/ui';
import { type FC, type PropsWithChildren } from 'react';
import { useMemo, useRef } from 'react';

import { isDesktop } from '@/const/version';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { getDarwinMajorVersion, isMacOSWithLargeWindowBorders } from '@/utils/platform';

import { LayoutContainerContext } from './DesktopLayoutContainer/LayoutContainerContext';
import { styles } from './DesktopLayoutContainer/style';

const DesktopLayoutContainer: FC<PropsWithChildren> = ({ children }) => {
  const innerContainerRef = useRef<HTMLDivElement>(null);
  const [expand] = useGlobalStore((s) => [systemStatusSelectors.showLeftPanel(s)]);

  const outerCssVariables = useMemo<Record<string, string>>(
    () => ({
      '--container-padding-left': expand ? '0px' : '4px',
      '--container-padding-top': isDesktop ? '0px' : '4px',
    }),
    [expand],
  );

  const innerCssVariables = useMemo<Record<string, string>>(() => {
    const darwinMajorVersion = getDarwinMajorVersion();
    const borderRadius = darwinMajorVersion >= 25 || isMacOSWithLargeWindowBorders()
      ? '12px'
      : '10px';

    return {
      '--container-border-radius': borderRadius,
    };
  }, []);

  return (
    <Flexbox
      className={styles.outerContainer}
      height={'100%'}
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
