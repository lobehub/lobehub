'use client';

import { ActionIcon } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from './AcceptanceScope';
import { openAddCheckModal } from './AddCheckModal';
import { hasVisualEvidence } from './CheckList';
import { useAcceptanceBundle } from './useAcceptanceBundle';

const PREDICT_POLL_INTERVAL_MS = 4000;
const PREDICT_POLL_ATTEMPTS = 30;

const AcceptanceCheckOwnerToolbar = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const [predicting, setPredicting] = useState(false);
  if (!data?.isOwner) return null;

  const standing = data.acceptance.config?.checklist ?? [];
  const predictableCount = data.checks.filter(
    (check) => check.result && !check.result.userDecision && hasVisualEvidence(check),
  ).length;

  const saveStanding = async (checklist: typeof standing) => {
    await verifyService.saveAcceptanceChecklist(data.subject.type, data.subject.id, checklist);
    await mutate();
    void globalMutate(verifyKeys.acceptances());
    toast.success(t('acceptance.checkCreate.saved'));
  };

  return (
    <>
      {predictableCount > 0 && (
        <ActionIcon
          icon={Sparkles}
          loading={predicting}
          size={'small'}
          title={t('acceptance.proposal.request')}
          onClick={async () => {
            setPredicting(true);
            try {
              const { queued } = await verifyService.predictReviews(data.acceptance.id);
              if (queued === 0) return;
              for (let attempt = 0; attempt < PREDICT_POLL_ATTEMPTS; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, PREDICT_POLL_INTERVAL_MS));
                const next = await mutate();
                const settled = (next?.checks ?? []).filter(
                  (check) => check.prediction || check.result?.userDecision,
                ).length;
                if (settled >= queued) break;
              }
            } finally {
              setPredicting(false);
            }
          }}
        />
      )}
      <ActionIcon
        icon={Plus}
        size={'small'}
        title={t('acceptance.checkCreate.title')}
        onClick={() =>
          openAddCheckModal({
            existingIds: standing.map((item) => item.id),
            onSubmit: (items) => saveStanding([...standing, ...items]),
          })
        }
      />
    </>
  );
};

export default AcceptanceCheckOwnerToolbar;
