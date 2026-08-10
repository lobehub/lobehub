import { BRANDING_NAME } from '@lobechat/business-const';
import { Center, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { cx } from 'antd-style';
import { type FC, type PropsWithChildren } from 'react';
import { useLocation } from 'react-router';

import { ProductLogo } from '@/components/Branding';
import { useIsDark } from '@/hooks/useIsDark';

import AuthFooterLinks from './AuthFooterLinks';
import AuthLangButton from './AuthLangButton';
import AuthThemeButton from './AuthThemeButton';
import { styles } from './style';

const isLegalDocumentPath = (pathname: string) =>
  pathname === '/terms' ||
  pathname === '/privacy' ||
  pathname.startsWith('/terms/') ||
  pathname.startsWith('/privacy/');

const AuthContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();
  const { pathname } = useLocation();
  const isDocumentPage = isLegalDocumentPath(pathname);

  return (
    <Flexbox className={styles.outerContainer} height={'100%'} padding={8} width={'100%'}>
      <Flexbox
        className={cx(isDarkMode ? styles.innerContainerDark : styles.innerContainerLight)}
        height={'100%'}
        width={'100%'}
      >
        <Flexbox horizontal align={'center'} flex={'none'} padding={16} width={'100%'}>
          <a aria-label={BRANDING_NAME} href={'/'} style={{ display: 'inline-flex' }}>
            <ProductLogo size={40} />
          </a>
        </Flexbox>
        {isDocumentPage ? (
          <Flexbox flex={1} padding={16} style={{ minHeight: 0, overflow: 'auto' }} width={'100%'}>
            {children}
          </Flexbox>
        ) : (
          // Keep locale/theme footer visible: tall signup forms must scroll inside
          // this pane instead of Center height=100% + overflow:hidden clipping.
          <Flexbox flex={1} style={{ minHeight: 0, overflow: 'auto' }} width={'100%'}>
            <Center
              padding={16}
              style={{ boxSizing: 'border-box', minHeight: '100%' }}
              width={'100%'}
            >
              {children}
            </Center>
          </Flexbox>
        )}
        <Flexbox
          horizontal
          align={'center'}
          flex={'none'}
          justify={'space-between'}
          padding={16}
          width={'100%'}
        >
          <Flexbox horizontal align={'center'}>
            <AuthLangButton size={18} />
            <Divider className={styles.divider} orientation={'vertical'} />
            <AuthThemeButton size={18} />
          </Flexbox>
          <AuthFooterLinks />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export default AuthContainer;
