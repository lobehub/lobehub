import { createModal } from '@lobehub/ui';
import { t } from 'i18next';

import FinalizeContent from './FinalizeContent';

export const createFinalizeModal = (artboardId: string) =>
  createModal({
    content: <FinalizeContent artboardId={artboardId} />,
    footer: null,
    title: t('artboard.finalize.title', { ns: 'project' }),
    width: 560,
  });
