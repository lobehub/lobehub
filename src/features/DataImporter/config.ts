import { t } from 'i18next';

import { notification } from '@/components/AntdStaticMethods';
import { type ImportPgDataStructure } from '@/types/export';

export const parseConfigFile = async (file: File): Promise<ImportPgDataStructure | undefined> => {
  const text = await file.text();

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(error);
    notification.error({
      description: t('import.importConfigFile.description', {
        ns: 'error',
        reason: (error as any).message,
      }),
      message: t('import.importConfigFile.title', { ns: 'error' }),
    });
  }
};
