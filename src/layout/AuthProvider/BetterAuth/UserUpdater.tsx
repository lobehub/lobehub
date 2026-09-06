'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo, type PropsWithChildren, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_PREFERENCE } from '@/const/user';
import { useSession } from '@/libs/better-auth/auth-client';
import { useAppPainted } from '@/spa/atoms/app';
import { removeStaticLoadingScreen } from '@/spa/loadingScreen';
import { useUserStore } from '@/store/user';
import { readUserDisplaySnapshot } from '@/store/user/displaySnapshot';
import { type LobeUser } from '@/types/user';

/**
 * Sync Better-Auth session state to Zustand store
 */
const UserUpdater = memo(({ children }: PropsWithChildren) => {
  const { data: session, isPending, isRefetching, error, refetch } = useSession();
  const { t } = useTranslation(['auth', 'common']);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  const appPainted = useAppPainted();
  const status = error?.status;
  const retryable = !!error && (!status || status >= 500 || status === 408 || status === 429);
  const failed = !!error && status !== 401 && (!retryable || retryAttempt >= 3);
  const showRecovery =
    status !== 401 &&
    (failed || (recoveryVisible && (!!error || isPending || isRefetching || !appPainted)));

  useLayoutEffect(() => {
    if (showRecovery) {
      setRecoveryVisible(true);
      /** Reveal recovery without claiming the application underneath has painted. */
      removeStaticLoadingScreen();
    } else {
      setRecoveryVisible(false);
    }
  }, [showRecovery]);

  const betterAuthUser = session?.user;

  /** A failed session check is not evidence of sign-out. Retry transient failures. */
  useEffect(() => {
    if (isPending || isRefetching) return;
    if (!error) {
      setRetryAttempt(0);
      return;
    }
    if (!retryable || retryAttempt >= 3) return;

    const delay = 1000 * 2 ** retryAttempt;
    const timer = setTimeout(() => {
      setRetryAttempt((attempt) => attempt + 1);
      void refetch();
    }, delay);
    return () => clearTimeout(timer);
  }, [error, isPending, isRefetching, refetch, retryable, retryAttempt]);

  // Sync user data from Better-Auth session to Zustand store.
  // Better-Auth refetches the session on tab focus (visibilitychange), which
  // gives us a new `betterAuthUser` reference each time even when the
  // underlying user is unchanged. We must merge into the existing user rather
  // than replace it — fields like `interests`, `firstName`, `latestName` are
  // populated by `useInitUserState` (one-shot SWR) and would otherwise be
  // wiped on every focus, breaking downstream selectors (e.g. the daily-brief
  // recommendation SWR key resets to empty interests and refetches). .
  //
  // Guard the merge by user id: if the session switches to a different
  // account (e.g. another tab signed in as a different user, focus refetch
  // returns the new session here without an intermediate signed-out state),
  // drop the previous user's profile fields so they don't leak across
  // accounts. `useInitUserState` is `useOnlyFetchOnceSWR` with a constant
  // key, so it won't re-fetch profile data for the new user on its own.
  useLayoutEffect(() => {
    if (isPending || isRefetching || (error && error.status !== 401)) return;

    if (betterAuthUser && !error) {
      useUserStore.setState((state) => {
        const baseUser = state.user?.id === betterAuthUser.id ? state.user : undefined;
        /** Restore display-only data after the session has identified its owner. */
        const snapshot = baseUser ? undefined : readUserDisplaySnapshot(betterAuthUser.id);
        return {
          isLoaded: true,
          isSignedIn: true,
          preference: baseUser ? state.preference : (snapshot?.preference ?? DEFAULT_PREFERENCE),
          user: {
            ...baseUser,
            // Preserve avatar from settings, don't override with auth provider value
            avatar: baseUser?.avatar ?? snapshot?.avatar ?? '',
            email: betterAuthUser.email,
            fullName: betterAuthUser.name,
            id: betterAuthUser.id,
            username: betterAuthUser.username,
          } as LobeUser,
        };
      });
      return;
    }

    // Clear user data when session becomes unavailable
    useUserStore.setState({
      isLoaded: true,
      isSignedIn: false,
      preference: DEFAULT_PREFERENCE,
      user: undefined,
    });
  }, [betterAuthUser, error, isPending, isRefetching]);

  /** Keep auth unresolved on transport failures; show recovery instead of a guest page. */
  return (
    <>
      <div inert={showRecovery} style={{ display: 'contents' }}>
        {children}
      </div>
      {showRecovery && (
        <Flexbox
          align="center"
          gap={16}
          justify="center"
          style={{
            background: cssVar.colorBgLayout,
            inset: 0,
            padding: 24,
            position: 'fixed',
            zIndex: 100000,
          }}
        >
          <Alert
            showIcon
            description={t('auth:session.checkFailed.description')}
            title={t('auth:session.checkFailed.title')}
            type="error"
          />
          <Button
            loading={isPending || isRefetching || (!failed && recoveryVisible)}
            onClick={() => {
              setRetryAttempt(0);
              void refetch();
            }}
          >
            {t('common:retry')}
          </Button>
        </Flexbox>
      )}
    </>
  );
});

export default UserUpdater;
