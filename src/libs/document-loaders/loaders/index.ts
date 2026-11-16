import {
  convertIpynbToMarkdown,
  isFileParseBudgetError,
  scrubIpynbFallbackText,
} from '@lobechat/file-loaders';

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
      // Both copy the whole file: built on first use, so a binary format does not also pay for
      // a text decode of itself (a 64MiB xlsx decoded as text is a ~100MB string of nothing).
      const blob = () => new Blob([Buffer.from(content)]);
      const text = () => this.uint8ArrayToString(content);

      const type = getChunkingLoaderType(filename ?? '');

      switch (type) {
        case 'code': {
          const ext = filename.split('.').pop();
          return await CodeLoader(text(), ext!);
        }

        case 'ppt': {
          return await PPTXLoader(blob());
        }

        case 'latex': {
          return await LatexLoader(text());
        }

        case 'pdf': {
          return await PdfLoader(blob());
        }

        case 'markdown': {
          return await MarkdownLoader(text());
        }

        case 'doc': {
          return await DocxLoader(blob());
        }

        case 'excel': {
          return await ExcelLoader(blob());
        }

        case 'text': {
          return await TextLoader(text());
        }

        case 'csv': {
          return await CsVLoader(blob());
        }

        case 'epub': {
          return await EPubLoader(content);
        }

        case 'ipynb': {
          // Notebook JSON → markdown so chunks carry semantic text instead
          // of base64 payloads; non-nbformat-v4 files fall back to raw text.
          const source = text();
          const markdown = convertIpynbToMarkdown(source);
          return markdown === null
            ? await TextLoader(scrubIpynbFallbackText(source))
            : await MarkdownLoader(markdown);
        }

        default: {
          throw new Error(
            `Unsupported file type [${type}], please check your file is supported, or create report issue here: https://github.com/lobehub/lobehub/discussions/3550`,
          );
        }
      }
    } catch (e) {
      // A structural refusal is a deliberate "too large", not a loader failure: keep its type so
      // callers can tell the user, and so it is not retried as if the file were merely broken.
      if (isFileParseBudgetError(e)) throw e;
      throw new DocumentLoaderError((e as Error).message);
    }
  };

  private uint8ArrayToString(uint8Array: Uint8Array) {
    const decoder = new TextDecoder();
    return decoder.decode(uint8Array);
  }
}
