'use client';

import { Button, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useAcceptanceScope } from '../AcceptanceScope';
import { acceptanceCheckPath, useAcceptanceRouteBase } from '../routes';
import { checksForTurn } from '../turnChecks';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { readAcceptanceTurn } from '../useAcceptanceTurn';

const styles = stylex.create({
  button: { display: { 'default': null, '@media (width <= 767px)': 'none' } },
});

const AcceptanceEnterFocus = () => {
  const { t } = useTranslation('verify');
  const navigate = useWorkspaceAwareNavigate();
  const [params] = useSearchParams();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const routeBase = useAcceptanceRouteBase();
  const { data } = useAcceptanceBundle(acceptanceId);
  const checks = data ? checksForTurn(data, readAcceptanceTurn(params)) : [];
  if (embedded || !data || checks.length === 0) return null;

  return (
    <Button
      className={stylex.props(styles.button).className}
      icon={<Icon icon={ChevronRight} size={14} />}
      size={'small'}
      style={{ alignSelf: 'center' }}
      type={'text'}
      onClick={() =>
        navigate(
          acceptanceCheckPath(acceptanceId, checks[0]!.id, routeBase) +
            (params.size ? `?${params}` : ''),
          { replace: true },
        )
      }
    >
      {t('acceptance.focus.enter')}
    </Button>
  );
};

export default AcceptanceEnterFocus;
