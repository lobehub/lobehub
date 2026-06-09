import { toast } from '@lobehub/ui';
import i18next from 'i18next';

import { localFileService } from './localFileService';

export interface DesktopExportOptions {
  content: string;
  dialogTitle?: string;
  fileName: string;
  successTitle?: string;
}

export interface DesktopExportResult {
  canceled: boolean;
  filePath?: string;
}

class DesktopExportService {
  async exportMarkdown(options: DesktopExportOptions): Promise<DesktopExportResult> {
    const { content, dialogTitle, fileName, successTitle } = options;

    const result = await localFileService.showSaveDialog({
      defaultPath: fileName,
      filters: [{ extensions: ['md'], name: 'Markdown' }],
      title: dialogTitle || i18next.t('pageEditor.exportDialogTitle', { ns: 'file' }),
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    await localFileService.writeFile({
      content,
      path: result.filePath,
    });

    this.showExportSuccessToast(result.filePath, successTitle);

    return { canceled: false, filePath: result.filePath };
  }

  private showExportSuccessToast(filePath: string, successTitle?: string) {
    const t = i18next.t.bind(i18next);

    toast.success({
      actions: [
        {
          label: t('pageEditor.exportActions.showInFolder', { ns: 'file' }),
          onClick: () => localFileService.openFileFolder(filePath),
          variant: 'text',
        },
        {
          label: t('pageEditor.exportActions.openFile', { ns: 'file' }),
          onClick: () => localFileService.openLocalFile({ path: filePath }),
          variant: 'primary',
        },
      ],
      title: successTitle || t('pageEditor.exportSuccess', { ns: 'file' }),
    });
  }
}

export const desktopExportService = new DesktopExportService();
