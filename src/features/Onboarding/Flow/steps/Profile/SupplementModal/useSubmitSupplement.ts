import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useCallback, useState } from 'react';

import { onboardingAnalysisService } from '@/services/onboardingAnalysis';

export const useSubmitSupplement = (onSubmitted: () => void) => {
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      setSubmitting(true);
      onSubmitted();

      try {
        await onboardingAnalysisService.submitSupplement(trimmed);
      } catch {
        toast.error(t('flow.steps.profile.supplementModal.submitError', { ns: 'onboarding' }));
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmitted],
  );

  return { submit, submitting };
};
