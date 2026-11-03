import { Button, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { imageUrl } from '@/const/url';
import DefaultFooter from '@/features/Setting/Footer';
import { useIsDark } from '@/hooks/useIsDark';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { sx } from '@/styles/sx';

const styles = stylex.create({
  footer: {
    minHeight: '320px',
    paddingBlockStart: '32px',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center bottom',
    backgroundSize: '512px auto',
  },
});

const Footer = memo(() => {
  const { t } = useTranslation('discover');
  const isDarkMode = useIsDark();
  const { isAuthenticated, signIn } = useMarketAuth();
  const [loading, setLoading] = useState(false);
  const handleSignIn = useCallback(async () => {
    setLoading(true);
    try {
      await signIn();
    } catch {
      // User cancelled or error occurred
    }
    setLoading(false);
  }, [signIn]);

  if (isAuthenticated) return <DefaultFooter />;

  return (
    <Flexbox
      align={'center'}
      flex={'none'}
      gap={4}
      {...sx(styles.footer, undefined, {
        // The image URL is resolved at runtime (CDN base), so it cannot live in stylex.create.
        backgroundBlendMode: isDarkMode ? 'screen' : 'multiply',
        backgroundImage: `url(${imageUrl(isDarkMode ? 'community_footer_dark.webp' : 'community_footer_light.webp')})`,
      })}
    >
      <Text strong align={'center'} as={'h2'} fontSize={22}>
        {t('footer.title')}
      </Text>
      <Text align={'center'} fontSize={16} type={'secondary'}>
        {t('footer.desc')}
      </Text>
      <Button
        loading={loading}
        type={'primary'}
        style={{
          marginTop: 16,
        }}
        onClick={handleSignIn}
      >
        {t('user.login')}
      </Button>
    </Flexbox>
  );
});

export default Footer;
