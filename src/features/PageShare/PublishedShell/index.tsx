'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import type { SharedDocumentData } from '@lobechat/types';
import { Button } from '@lobehub/ui';
import { TRPCClientError } from '@trpc/client';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { type FC, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { trackLoginOrSignupClicked } from '@/features/User/UserLoginOrSignup/trackLoginOrSignupClicked';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import GuestErrorView from './GuestErrorView';

dayjs.extend(relativeTime);

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
  `,
  container: css`
    display: flex;
    flex-direction: column;

    width: 100%;
    min-height: 100vh;

    background: ${isDarkMode ? token.colorBgContainer : '#ffffff'};
  `,
  footer: css`
    padding-block: 14px 22px;
    padding-inline: 0;
    border-block-start: 1px solid ${token.colorBorderSecondary};

    font-size: 11px;
    color: ${token.colorTextTertiary};
    text-align: center;
  `,
  logoBar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 12px;
    padding-inline: 28px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  meta: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  marketingBanner: css`
    display: flex;
    gap: 14px;
    align-items: center;
    justify-content: center;

    padding-block: 8px;
    padding-inline: 16px;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    font-size: 12.5px;
    color: ${token.colorText};

    background: ${isDarkMode ? token.colorFillTertiary : '#f6f8fa'};
  `,
  readerColumn: css`
    max-width: 720px;
    margin-block: 0;
    margin-inline: auto;
    padding-block: 40px 64px;
    padding-inline: 32px;
  `,
}));

interface PublishedShellProps {
  children: ReactNode;
  data?: SharedDocumentData;
  error?: unknown;
}

const PublishedShell: FC<PublishedShellProps> = ({ children, data, error }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('pageShare');
  const isSignedIn = useUserStore(authSelectors.isLogin);

  const trpcError = error instanceof TRPCClientError ? error : null;
  const errorCode = trpcError?.data?.code;

  const handleSignIn = (event: React.MouseEvent) => {
    event.preventDefault();
    const callbackUrl = `${window.location.pathname}${window.location.search}`;
    const target = `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    void trackLoginOrSignupClicked({ spm: 'pageShare.banner.signin.click' }).finally(() => {
      window.location.href = target;
    });
  };

  const handleSignUp = (event: React.MouseEvent) => {
    event.preventDefault();
    void trackLoginOrSignupClicked({ spm: 'pageShare.banner.signup.click' }).finally(() => {
      window.location.href = '/signup';
    });
  };

  const showMarketingBanner = !isSignedIn && errorCode !== 'NOT_FOUND' && errorCode !== 'FORBIDDEN';

  const ownerName = data?.ownerMeta.displayName ?? 'A user';
  const updatedRelative = data ? dayjs(data.document.updatedAt).fromNow() : '';

  return (
    <div className={styles.container}>
      {showMarketingBanner && (
        <div className={styles.marketingBanner}>
          <span
            dangerouslySetInnerHTML={{
              __html: t('banner.copy', { appName: BRANDING_NAME }),
            }}
          />
          <Button size="small" onClick={handleSignIn}>
            {t('banner.signIn')}
          </Button>
          <Button size="small" type="primary" onClick={handleSignUp}>
            {t('banner.signUp')}
          </Button>
        </div>
      )}

      <div className={styles.logoBar}>
        <ProductLogo type="combine" />
        {data && (
          <span className={styles.meta}>
            {t('shell.sharedBy', { name: ownerName })} ·{' '}
            {t('shell.updatedAt', { relative: updatedRelative })}
          </span>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.readerColumn}>
          {error ? <GuestErrorView error={error} /> : children}
        </div>
      </div>

      <div className={styles.footer}>{t('shell.footer', { appName: BRANDING_NAME })}</div>
    </div>
  );
};

export default PublishedShell;
