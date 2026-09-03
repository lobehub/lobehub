'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useAcceptanceScope } from './AcceptanceScope';
import { acceptanceCheckPath } from './routes';
import { useAcceptanceBundle } from './useAcceptanceBundle';

const AcceptanceEnterFocus = () => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  if (embedded || !data || data.checks.length === 0) return null;

  return (
    <Button
      icon={<Icon icon={ChevronRight} />}
      size={'small'}
      style={{ alignSelf: 'flex-start' }}
      type={'text'}
      onClick={() =>
        navigate(acceptanceCheckPath(acceptanceId, data.checks[0]!.id), { replace: true })
      }
    >
      {t('acceptance.focus.enter')}
    </Button>
  );
};

export default AcceptanceEnterFocus;
