'use client';

import type { DropdownItem } from '@lobehub/ui';
import { Icon, toast } from '@lobehub/ui';
import { CircleCheck, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { verifyService } from '@/services/verify';
import { useVerifyStore } from '@/store/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { getAcceptanceStatusActions } from '../statusActions';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { canReviewAcceptance } from '../visibility';
import AcceptanceStatusPill from './AcceptanceStatusPill';

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
      void useVerifyStore.getState().refreshAcceptanceLists();
      toast.success(t('acceptance.workspace.statusSuccess'));
    } catch {
      toast.error(t('acceptance.workspace.statusError'));
    }
  };

  const menu: DropdownItem[] = getAcceptanceStatusActions(
    data.acceptance.status,
    data.acceptance.subjectType,
  ).map((action) => {
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

  return (
    <AcceptanceStatusPill
      menu={menu.length > 0 ? menu : undefined}
      status={data.acceptance.status}
    />
  );
};

export default AcceptanceStatusControl;
