import type { A2uiStatusLabels } from '@lobehub/a2ui/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Items status labels in the reader's language, for the card hosts to hand to `@lobehub/a2ui`. */
export const useA2uiStatusLabels = (): A2uiStatusLabels => {
  const { t } = useTranslation('plugin');
  return useMemo(
    () => ({
      blocked: t('builtins.lobe-a2ui.status.blocked'),
      done: t('builtins.lobe-a2ui.status.done'),
      human: t('builtins.lobe-a2ui.status.human'),
      new: t('builtins.lobe-a2ui.status.new'),
      watch: t('builtins.lobe-a2ui.status.watch'),
      worse: t('builtins.lobe-a2ui.status.worse'),
    }),
    [t],
  );
};
