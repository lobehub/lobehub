import type { AskUserQuestionLabels } from '@lobechat/shared-tool-ui/ask-user';
import { useTranslation } from 'react-i18next';

/**
 * The AskUserQuestion form's strings, or `undefined` until they can be shown.
 *
 * They live in the `tool` namespace, which the conversation loads early but a
 * task or goal page may be the first to ask for; rendering before it arrives
 * shows raw keys, so the form waits the moment it takes to load.
 */
export const useAskUserLabels = (overrides: {
  /** An empty string drops the skip button: the question has no "not now". */
  skip?: string;
  submit?: string;
  supplementPlaceholder?: string;
}): AskUserQuestionLabels | undefined => {
  const { t, ready } = useTranslation('tool');
  if (ready === false) return undefined;

  return {
    addNote: t('askUserQuestion.note.add'),
    customPlaceholder: t('askUserQuestion.customOption.placeholder'),
    next: (title: string) => t('askUserQuestion.next', { title }),
    noteLabel: t('askUserQuestion.note.label'),
    progress: (answered: number, total: number) =>
      t('askUserQuestion.progress', { answered, total }),
    recommendedTag: t('askUserQuestion.recommendedTag'),
    skip: overrides.skip ?? t('askUserQuestion.skip'),
    submit: overrides.submit ?? t('askUserQuestion.submit'),
    removeNote: t('askUserQuestion.note.remove'),
    sendNoteOnly: t('askUserQuestion.note.sendOnly'),
    supplementPlaceholder:
      overrides.supplementPlaceholder ?? t('askUserQuestion.supplement.placeholder'),
    timeExpired: '',
    timeExpiredNoAnswer: '',
    timeRemaining: () => '',
  };
};
