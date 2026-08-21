'use client';

import { copyToClipboard, Flexbox, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    flex-shrink: 0;

    height: 48px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  logo: css`
    display: flex;
    color: inherit;
  `,
  title: css`
    min-width: 0;
  `,
}));

interface ArtifactShareChromeProps {
  title?: string | null;
}

export const ArtifactShareChrome = ({ title }: ArtifactShareChromeProps) => {
  const { t } = useTranslation('chat');
  const isLogin = useUserStore(authSelectors.isLogin);

  const handleSignIn = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const callbackUrl = `${window.location.pathname}${window.location.search}`;
    const target = `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    void trackLoginOrSignupClicked({ spm: 'share.artifact.signin.click' }).finally(() => {
      window.location.href = target;
    });
  };

  const handleShare = async () => {
    await copyToClipboard(window.location.href);
    toast.success(t('shareModal.copyLinkSuccess'));
  };

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.header}
      gap={12}
      justify={'space-between'}
    >
      <Flexbox horizontal align={'center'} flex={1} style={{ minWidth: 0 }}>
        <a
          className={styles.logo}
          href={isLogin ? '/' : '/signin'}
          onClick={isLogin ? undefined : handleSignIn}
        >
          <ProductLogo size={28} />
        </a>
      </Flexbox>
      <Flexbox flex={2} style={{ minWidth: 0 }}>
        <Text
          ellipsis
          strong
          align={'center'}
          className={styles.title}
          fontSize={14}
          style={{ margin: 0 }}
        >
          {title}
        </Text>
      </Flexbox>
      <Flexbox horizontal align={'center'} flex={1} gap={8} justify={'flex-end'}>
        <Button shape={'round'} size={'small'} onClick={handleShare}>
          {t('sharePage.artifact.share')}
        </Button>
        {!isLogin && (
          <Button
            href={'/signin'}
            shape={'round'}
            size={'small'}
            type={'primary'}
            onClick={handleSignIn}
          >
            {t('sharePage.error.unauthorized.action')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
};
