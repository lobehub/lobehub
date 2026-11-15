'use client';

import { Button, Icon } from '@lobehub/ui';
import { ArrowLeft, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

import QuietState from './QuietState';
import { acceptanceListPath, useAcceptanceRouteBase } from './routes';

const BackToAcceptances = () => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const routeBase = useAcceptanceRouteBase();
  const workspaceSlug = useActiveWorkspaceSlug();

  return (
    <Button
      icon={<Icon icon={ArrowLeft} />}
      onClick={() =>
        navigate(buildWorkspaceAwarePath(acceptanceListPath(routeBase), workspaceSlug))
      }
    >
      {t('acceptance.notFound.back')}
    </Button>
  );
};

const AcceptanceNotFound = ({ embedded }: { embedded: boolean }) => {
  const { t } = useTranslation('verify');

  return (
    <QuietState
      action={embedded ? undefined : <BackToAcceptances />}
      description={t('acceptance.notFound.description')}
      icon={Lock}
      title={t('acceptance.notFound.title')}
    />
  );
};

export default AcceptanceNotFound;
