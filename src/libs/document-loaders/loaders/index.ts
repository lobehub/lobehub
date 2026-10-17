import { convertIpynbToMarkdown, scrubIpynbFallbackText } from '@lobechat/file-loaders';

import { getChunkingLoaderType } from '../loaderType';
import { type DocumentChunk } from '../types';
import { CodeLoader } from './code';
import { CsVLoader } from './csv';
import { DocxLoader } from './docx';
import { EPubLoader } from './epub';
import { ExcelLoader } from './excel';
import { LatexLoader } from './latex';
import { MarkdownLoader } from './markdown';
import { PdfLoader } from './pdf';
import { PPTXLoader } from './pptx';
import { TextLoader } from './txt';

class DocumentLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentLoaderError';
  }
}

export class ChunkingLoader {
  partitionContent = async (filename: string, content: Uint8Array): Promise<DocumentChunk[]> => {
    try {
      const fileBlob = new Blob([Buffer.from(content)]);
      const txt = this.uint8ArrayToString(content);

      const type = getChunkingLoaderType(filename ?? '');

      switch (type) {
        case 'code': {
          const ext = filename.split('.').pop();
          return await CodeLoader(txt, ext!);
        }

        case 'ppt': {
          return await PPTXLoader(fileBlob);
        }

        case 'latex': {
          return await LatexLoader(txt);
        }

        case 'pdf': {
          return await PdfLoader(fileBlob);
        }

        case 'markdown': {
          return await MarkdownLoader(txt);
        }

        case 'doc': {
          return await DocxLoader(fileBlob);
        }

        case 'excel': {
          return await ExcelLoader(fileBlob);
        }

        case 'text': {
          return await TextLoader(txt);
        }

        case 'csv': {
          return await CsVLoader(fileBlob);
        }

        case 'epub': {
          return await EPubLoader(content);
        }

        case 'ipynb': {
          // Notebook JSON → markdown so chunks carry semantic text instead
          // of base64 payloads; non-nbformat-v4 files fall back to raw text.
          const markdown = convertIpynbToMarkdown(txt);
          return markdown === null
            ? await TextLoader(scrubIpynbFallbackText(txt))
            : await MarkdownLoader(markdown);
        }

        default: {
          throw new Error(
            `Unsupported file type [${type}], please check your file is supported, or create report issue here: https://github.com/lobehub/lobe-chat/discussions/3550`,
          );
        }
      }
    } catch (e) {
      throw new DocumentLoaderError((e as Error).message);
    }
  };

  private uint8ArrayToString(uint8Array: Uint8Array) {
    const decoder = new TextDecoder();
    return decoder.decode(uint8Array);
  }
}
