import { isDesktop } from '@lobechat/const';

export interface ExportTextFileOptions {
  /** File name before the extension; an existing matching extension is kept once. */
  baseName: string;
  content: string;
  /** Extension without the dot, e.g. `html`. */
  extension: string;
  /** Save-dialog filter label, e.g. `HTML`. */
  filterName: string;
  mimeType: string;
}

/**
 * - `saved`: the desktop save dialog wrote the file and showed its own toast.
 * - `downloaded`: the browser download started; the caller confirms it.
 * - `canceled`: the user closed the desktop save dialog.
 */
export type ExportTextFileResult = 'canceled' | 'downloaded' | 'saved';

export const exportFileName = (baseName: string, extension: string) => {
  const name = baseName.trim() || 'Untitled';
  return name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`;
};

/** Save text as a local file: the desktop save dialog, or a browser download. */
export const exportTextFile = async ({
  baseName,
  content,
  extension,
  filterName,
  mimeType,
}: ExportTextFileOptions): Promise<ExportTextFileResult> => {
  const fileName = exportFileName(baseName, extension);

  if (isDesktop) {
    const { desktopExportService } = await import('@/services/electron/desktopExportService');
    const result = await desktopExportService.exportFile({
      content,
      fileName,
      filter: { extensions: [extension], name: filterName },
    });
    return result.canceled ? 'canceled' : 'saved';
  }

  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return 'downloaded';
};

/** Download an HTML page document as a self-contained `.html` file. */
export const exportHtmlDocument = (content: string, title: string | null | undefined) =>
  exportTextFile({
    baseName: title || '',
    content,
    extension: 'html',
    filterName: 'HTML',
    mimeType: 'text/html',
  });
