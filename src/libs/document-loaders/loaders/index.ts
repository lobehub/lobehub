import { SUPPORT_TEXT_LIST } from '../file';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../splitter';
import { type DocumentChunk, type FileLoaderType } from '../types';
import { CodeLoader } from './code';
import { CsVLoader } from './csv';
import { DocxLoader } from './docx';
import { EPubLoader } from './epub';
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

      const type = this.getType(filename?.toLowerCase());

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

        case 'text': {
          return await TextLoader(txt);
        }

        case 'csv': {
          return await CsVLoader(fileBlob);
        }

        case 'epub': {
          return await EPubLoader(content);
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

  private getType = (filename: string): FileLoaderType | undefined => {
    if (filename.endsWith('pptx')) {
      return 'ppt';
    }

    if (filename.endsWith('docx') || filename.endsWith('doc')) {
      return 'doc';
    }

    if (filename.endsWith('pdf')) {
      return 'pdf';
    }

    if (filename.endsWith('tex')) {
      return 'latex';
    }

    if (filename.endsWith('md') || filename.endsWith('mdx')) {
      return 'markdown';
    }

    if (filename.endsWith('csv')) {
      return 'csv';
    }

    if (filename.endsWith('epub')) {
      return 'epub';
    }

    const ext = filename.split('.').pop();

    if (ext && SUPPORTED_LANGUAGES.includes(ext as SupportedLanguage)) {
      return 'code';
    }

    if (ext && SUPPORT_TEXT_LIST.includes(ext)) return 'text';
  };

  private uint8ArrayToString(uint8Array: Uint8Array) {
    const decoder = new TextDecoder();
    return decoder.decode(uint8Array);
  }
}
