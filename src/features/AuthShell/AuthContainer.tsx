'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Center, cx, Divider, Flexbox } from '@lobehub/ui';
import { type FC, type PropsWithChildren } from 'react';

import { ProductLogo } from '@/components/Branding';
import { useIsDark } from '@/hooks/useIsDark';

import AuthFooterLinks from './AuthFooterLinks';
import AuthLangButton from './AuthLangButton';
import AuthThemeButton from './AuthThemeButton';
import { isEmbeddedAuth } from './embedded';
import { styles } from './style';

const AuthContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();

  // Inside Lobot's sign-in window the page is the whole window: no card frame, and none of
  // the website chrome (logo, language/theme switches, footer links). Terms and privacy stay
  // reachable through the agreement checkbox.
  if (isEmbeddedAuth())
    return (
      <Flexbox className={styles.embeddedContainer} height={'100%'} padding={24} width={'100%'}>
        {/* Auto margins center short pages and let tall ones scroll from the top. */}
        <Flexbox align={'center'} style={{ marginBlock: 'auto' }} width={'100%'}>
          {children}
        </Flexbox>
      </Flexbox>
    );

  return (
    <Flexbox className={styles.outerContainer} height={'100%'} padding={8} width={'100%'}>
      <Flexbox
        className={cx(isDarkMode ? styles.innerContainerDark : styles.innerContainerLight)}
        height={'100%'}
        width={'100%'}
      >
        <Flexbox horizontal align={'center'} padding={16} width={'100%'}>
          <a aria-label={BRANDING_NAME} href={'/'} style={{ display: 'inline-flex' }}>
            <ProductLogo size={40} />
          </a>
        </Flexbox>
        <Center height={'100%'} padding={16} width={'100%'}>
          {children}
        </Center>
        <Flexbox horizontal align={'center'} justify={'space-between'} padding={16} width={'100%'}>
          <Flexbox horizontal align={'center'}>
            <AuthLangButton />
            <Divider orientation={'vertical'} style={{ height: 24, marginInline: 8 }} />
            <AuthThemeButton size={18} />
          </Flexbox>
          <AuthFooterLinks />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export default AuthContainer;
