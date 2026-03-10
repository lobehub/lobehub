import { toast } from '@lobehub/ui';
import i18next from 'i18next';

import { localFileService } from './localFileService';

export interface DesktopExportOptions {
  content: string;
  fileName: string;
}

export interface DesktopExportResult {
  canceled: boolean;
  filePath?: string;
}

class DesktopExportService {
  async exportMarkdown(options: DesktopExportOptions): Promise<DesktopExportResult> {
    const { content, fileName } = options;

    const result = await localFileService.showSaveDialog({
      defaultPath: fileName,
      filters: [{ extensions: ['md'], name: 'Markdown' }],
      title: i18next.t('pageEditor.exportDialogTitle', { ns: 'file' }),
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    await localFileService.writeFile({
      content,
      path: result.filePath,
    });

    this.showExportSuccessToast(result.filePath);

    return { canceled: false, filePath: result.filePath };
  }

  private showExportSuccessToast(filePath: string) {
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
      title: t('pageEditor.exportSuccess', { ns: 'file' }),
    });
  }
}

export const desktopExportService = new DesktopExportService();
