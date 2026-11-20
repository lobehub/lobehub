import { toast } from '@lobehub/ui';
import i18next from 'i18next';

export const openArtboardFullscreen = async (_artboardId: string): Promise<void> => {
  toast.info(
    i18next.t('artboard.share.notShared', {
      defaultValue: 'This artboard isn’t shared publicly',
      ns: 'project',
    }),
  );
};
