'use client';

import { Icon } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { toast } from '@lobehub/ui/base-ui';
import { CircleCheck, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from './AcceptanceScope';
import AcceptanceStatusPill from './AcceptanceStatusPill';
import { getAcceptanceStatusActions } from './statusActions';
import { useAcceptanceBundle } from './useAcceptanceBundle';
import { canReviewAcceptance } from './visibility';

const AcceptanceStatusControl = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  if (!data || !canReviewAcceptance(data))
    return <AcceptanceStatusPill status={data?.acceptance.status ?? 'pending'} />;

  const changeStatus = async (status: 'accepted' | 'closed' | 'delivered') => {
    try {
      await verifyService.updateAcceptanceStatus(data.acceptance.id, status);
      await mutate();
      void globalMutate(isAcceptanceListKey);
      toast.success(t('acceptance.workspace.statusSuccess'));
    } catch {
      toast.error(t('acceptance.workspace.statusError'));
    }
  };

  const menu: DropdownItem[] = getAcceptanceStatusActions(data.acceptance.status).map((action) => {
    if (action === 'accept') {
      return {
        icon: <Icon icon={CircleCheck} />,
        key: action,
        label: t('acceptance.workspace.actions.markAccepted'),
        onClick: () => void changeStatus('accepted'),
      };
    }
    if (action === 'reopen') {
      return {
        icon: <Icon icon={RotateCcw} />,
        key: action,
        label: t('acceptance.workspace.actions.reopen'),
        onClick: () => void changeStatus('delivered'),
      };
    }
    return {
      icon: <Icon icon={X} />,
      key: action,
      label: t('acceptance.workspace.actions.markClosed'),
      onClick: () => void changeStatus('closed'),
    };
  });

  return <AcceptanceStatusPill menu={menu} status={data.acceptance.status} />;
};

export default AcceptanceStatusControl;
