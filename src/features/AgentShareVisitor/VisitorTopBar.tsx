'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

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

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 3px;
    }
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
 * The visitor page has its own layout without the main navigation rail, so
 * this bar lets visitors get back to their own LobeHub:
 * both the logo and the avatar go home, or to sign-in when there is no
 * session yet.
 */
const VisitorTopBar = memo<VisitorTopBarProps>(({ slugOrId }) => {
  const { t } = useTranslation('agent');
  const isSignedIn = useUserStore(authSelectors.isLogin);
  const homePath = isSignedIn ? '/' : buildAgentShareSignInUrl(slugOrId ?? '');

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.root}
      gap={8}
      justify={'space-between'}
      width={'100%'}
    >
      <Link
        aria-label={t('share.visitor.topBar.home')}
        className={styles.brand}
        reloadDocument={!isSignedIn}
        to={homePath}
      >
        <ProductLogo size={22} />
      </Link>
      <Link
        className={styles.brand}
        reloadDocument={!isSignedIn}
        to={homePath}
        aria-label={
          isSignedIn ? t('share.visitor.topBar.home') : t('share.visitor.access.signInCta')
        }
      >
        <UserAvatar size={26} />
      </Link>
    </Flexbox>
  );
});

VisitorTopBar.displayName = 'ShareVisitorTopBar';

export default VisitorTopBar;
