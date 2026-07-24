import { SUPPORT_TEXT_LIST } from '../file';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../splitter';
import { type DocumentChunk, type FileLoaderType } from '../types';
import { CodeLoader } from './code';
import { assertWithinLoaderLimit, MAX_DOCUMENT_CHUNKS, MAX_DOCUMENT_INPUT_BYTES } from './config';
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
      assertWithinLoaderLimit(content.byteLength, MAX_DOCUMENT_INPUT_BYTES, 'Document input size');

      const type = this.getType(filename?.toLowerCase());
      let documents: DocumentChunk[];

      switch (type) {
        case 'code': {
          const ext = filename.split('.').pop();
          documents = await CodeLoader(this.uint8ArrayToString(content), ext!);
          break;
        }

        case 'ppt': {
          documents = await PPTXLoader(this.toBlob(content));
          break;
        }

        case 'latex': {
          documents = await LatexLoader(this.uint8ArrayToString(content));
          break;
        }

        case 'pdf': {
          documents = await PdfLoader(this.toBlob(content));
          break;
        }

        case 'markdown': {
          documents = await MarkdownLoader(this.uint8ArrayToString(content));
          break;
        }

        case 'doc': {
          documents = await DocxLoader(this.toBlob(content));
          break;
        }

        case 'text': {
          documents = await TextLoader(this.uint8ArrayToString(content));
          break;
        }

        case 'csv': {
          documents = await CsVLoader(this.toBlob(content));
          break;
        }

        case 'epub': {
          documents = await EPubLoader(content);
          break;
        }

        default: {
          throw new Error(
            `Unsupported file type [${type}], please check your file is supported, or create report issue here: https://github.com/lobehub/lobe-chat/discussions/3550`,
          );
        }
      }

      assertWithinLoaderLimit(documents.length, MAX_DOCUMENT_CHUNKS, 'Document chunk count');

      return documents;
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

  private toBlob(content: Uint8Array) {
    return new Blob([content]);
  }
}
