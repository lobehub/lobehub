'use client';

import { Button, Icon } from '@lobehub/ui';
import { ArrowLeftRightIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError, { type AsyncErrorProps } from '@/components/AsyncError';

import { type ScopeProbe, useOtherScopeRecovery } from './useLocateInOtherScope';
import { useWorkspaceAwareNavigate } from './useWorkspaceAwareNavigate';

export interface OtherScopeAsyncErrorProps extends AsyncErrorProps {
  /** Shown while the other scopes are probed, so the page never goes blank. */
  pendingFallback: ReactNode;
  /** Re-read the resource through a client pinned to another scope; reject when not visible. */
  probe: ScopeProbe;
  /** Stable identity of the resource being probed, e.g. `goal:<id>`. */
  resourceKey: string;
}

/**
 * `AsyncError` for a scoped detail page. When the read 404s because the
 * resource belongs to another of the user's spaces (personal ⇄ workspace), it
 * says so and offers to switch there, instead of a bare "Failed to load".
 */
const OtherScopeAsyncError = memo<OtherScopeAsyncErrorProps>(
  ({ pendingFallback, probe, resourceKey, ...props }) => {
    const { t } = useTranslation('error');
    const navigate = useWorkspaceAwareNavigate();
    const { pending, scope, targetPath } = useOtherScopeRecovery(props.error, resourceKey, probe);

    if (pending) return pendingFallback;
    if (!scope || !targetPath) return <AsyncError {...props} />;

    const name = scope.id ? (scope.name ?? scope.slug) : t('otherScope.personal');

    return (
      <AsyncError
        {...props}
        description={t('otherScope.desc', { name })}
        title={t('otherScope.title')}
        action={
          <Button
            icon={<Icon icon={ArrowLeftRightIcon} />}
            type={'primary'}
            onClick={() => navigate(targetPath, { escape: true })}
          >
            {t('otherScope.switch', { name })}
          </Button>
        }
      />
    );
  },
);

OtherScopeAsyncError.displayName = 'OtherScopeAsyncError';

export default OtherScopeAsyncError;
