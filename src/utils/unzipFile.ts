import { unzip } from 'fflate';

/**
 * Determines the MIME type based on file extension
 */
const getFileType = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';

  const mimeTypes: Record<string, string> = {
    // Images
    bmp: 'image/bmp',

    // Code files
    c: 'text/x-c',

    cpp: 'text/x-c++',

    cs: 'text/x-csharp',

    css: 'text/css',

    // Documents
    csv: 'text/csv',

    doc: 'application/msword',

    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

    gif: 'image/gif',

    go: 'text/x-go',

    html: 'text/html',

    java: 'text/x-java',

    jpeg: 'image/jpeg',

    jpg: 'image/jpeg',

    js: 'text/javascript',

    json: 'application/json',

    jsx: 'text/javascript',

    md: 'text/markdown',

    pdf: 'application/pdf',

    php: 'application/x-httpd-php',

    png: 'image/png',

    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    py: 'text/x-python',
    rb: 'text/x-ruby',
    rs: 'text/x-rust',
    rtf: 'application/rtf',
    sh: 'application/x-sh',
    svg: 'image/svg+xml',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    txt: 'text/plain',
    webp: 'image/webp',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xml: 'application/xml',
  };

  return mimeTypes[extension] || 'application/octet-stream';
};

/**
 * Extracts files from a ZIP archive
 * @param zipFile - The ZIP file to extract
 * @returns Promise that resolves to an array of extracted Files
 */
export const unzipFile = async (zipFile: File): Promise<File[]> => {
  return new Promise((resolve, reject) => {
    zipFile
      .arrayBuffer()
      .then((arrayBuffer) => {
        const uint8Array = new Uint8Array(arrayBuffer);

        unzip(uint8Array, (error, unzipped) => {
          if (error) {
            reject(error);
            return;
          }

          const extractedFiles: File[] = [];

          for (const [path, data] of Object.entries(unzipped)) {
            // Skip directories and hidden files
            if (path.endsWith('/') || path.includes('__MACOSX') || path.startsWith('.')) {
              continue;
            }

            // Get the filename from the path
            const fileName = path.split('/').pop() || path;

            // Create a File object from the extracted data
            const blob = new Blob([new Uint8Array(data)], {
              type: getFileType(fileName),
            });
            const file = new File([blob], fileName, {
              type: getFileType(fileName),
            });

            extractedFiles.push(file);
          }

          resolve(extractedFiles);
        });
      })
      .catch(() => {
        reject(new Error('Failed to read ZIP file'));
      });
  });
};
