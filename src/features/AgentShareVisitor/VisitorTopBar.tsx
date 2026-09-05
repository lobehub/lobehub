'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ProductLogo } from '@/components/Branding';
import UserAvatar from '@/features/User/UserAvatar';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { buildAgentShareSignInUrl } from './visitorPath';

const styles = createStaticStyles(({ css }) => ({
  brand: css`
    cursor: pointer;

    display: grid;
    place-items: center;

    inline-size: 26px;
    block-size: 26px;
    border-radius: ${cssVar.borderRadius};
  `,
  root: css`
    flex: none;

    block-size: 48px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgLayout};
  `,
}));

interface VisitorTopBarProps {
  /**
   * The share the visitor is looking at, used as the sign-in return target so
   * an anonymous visitor lands back on the same link after signing in.
   */
  slugOrId?: string;
}

/**
 * Product bar of the agent-share visitor page: the logo on the left, the
 * visitor's own avatar on the right — the same frame the topic share page
 * uses, so a shared agent reads as "a LobeHub page I was linked to", not as an
 * inner pane of someone else's console.
 *
 * The visitor page lives inside the main layout but hides the nav rail (the
 * rail shows the CREATOR's workspace, which a visitor has no access to), so
 * this bar is the only way for the visitor to get back to their own LobeHub:
 * both the logo and the avatar go home, or to sign-in when there is no
 * session yet.
 */
const VisitorTopBar = memo<VisitorTopBarProps>(({ slugOrId }) => {
  const { t } = useTranslation('agent');
  const navigate = useNavigate();
  const isSignedIn = useUserStore(authSelectors.isLogin);

  const goHome = () => {
    if (isSignedIn) {
      navigate('/');
      return;
    }
    window.location.href = buildAgentShareSignInUrl(slugOrId ?? '');
  };

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.root}
      gap={8}
      justify={'space-between'}
      width={'100%'}
    >
      <div
        aria-label={t('share.visitor.topBar.home')}
        className={styles.brand}
        role={'link'}
        onClick={goHome}
      >
        <ProductLogo size={22} />
      </div>
      <UserAvatar
        clickable
        size={26}
        style={{ cursor: 'pointer' }}
        title={isSignedIn ? t('share.visitor.topBar.home') : t('share.visitor.access.signInCta')}
        onClick={goHome}
      />
    </Flexbox>
  );
});

VisitorTopBar.displayName = 'ShareVisitorTopBar';

export default VisitorTopBar;
