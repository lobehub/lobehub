import { readFile } from 'node:fs/promises';

import { type LobeChatDatabase } from '@lobechat/database';
import type { DocumentPage, FileDocument } from '@lobechat/file-loaders';
import type { ModelRuntime } from '@lobechat/model-runtime';
import debug from 'debug';
import type { EnabledAiModel } from 'model-bank';
import sharp from 'sharp';

import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

const log = debug('lobe-chat:service:document-ocr');

const MAX_IMAGE_WIDTH = 2048;
const MAX_PDF_OCR_PAGES = 20;
const OCR_MODEL_PREFERENCES = ['qianfan-singlepicocr', 'qianfan-multipicocr', 'qianfan-qi-vl'];
const IMAGE_EXTENSIONS = new Set([
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'tif',
  'tiff',
  'webp',
]);

const OCR_PROMPT = [
  '你是一个 OCR 转写器。',
  '请严格提取图片中的可见文字，按自然阅读顺序输出纯文本。',
  '不要总结，不要解释，不要补充不存在的内容，不要输出 Markdown 代码块。',
  '如果是表格，请按从左到右、从上到下转成纯文本。',
  '如果完全没有可识别文字，返回空字符串。',
].join('\n');

export type OcrFallbackReason = 'image' | 'pdf-low-text';

interface ExtractOcrFileDocumentParams {
  content?: Uint8Array;
  filename: string;
  filePath?: string;
  fileType: string;
  reason: OcrFallbackReason;
}

interface OcrRuntimeSelection {
  model: string;
  provider: string;
  runtime: ModelRuntime;
}

const getFileExtension = (filename: string) => filename.split('.').pop()?.toLowerCase() || '';

const stripPageTags = (content: string) =>
  content.replaceAll(/<page[^>]*>([\S\s]*?)<\/page>/g, '$1').trim();

export const hasMeaningfulText = (text?: string | null, minLength = 20) => {
  if (!text) return false;

  return text.replaceAll(/\s+/g, '').length >= minLength;
};

export const isImageFileForOcr = (fileType: string | undefined, filename: string) => {
  if (fileType?.startsWith('image/')) return true;

  return IMAGE_EXTENSIONS.has(getFileExtension(filename));
};

export const isPdfFileForOcr = (fileType: string | undefined, filename: string) => {
  if (fileType === 'application/pdf') return true;

  return getFileExtension(filename) === 'pdf';
};

export const shouldUsePdfDocumentOcrFallback = (fileDocument: {
  content?: string | null;
  pages?: Array<{ pageContent?: string | null }> | null;
}) => {
  const content = stripPageTags(fileDocument.content || '');

  if (hasMeaningfulText(content)) return false;

  const pages = fileDocument.pages || [];

  if (pages.length === 0) return true;

  return pages.every((page) => !hasMeaningfulText(page.pageContent));
};

export const shouldUsePdfChunkOcrFallback = (chunks: Array<{ text?: string | null }>) => {
  if (chunks.length === 0) return true;

  return chunks.every((chunk) => !hasMeaningfulText(chunk.text));
};

export class DocumentOcrService {
  private db: LobeChatDatabase;
  private runtimePromise?: Promise<OcrRuntimeSelection>;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async extractFileDocument(params: ExtractOcrFileDocumentParams): Promise<FileDocument> {
    const source = params.filePath || params.filename;
    const buffer = await this.resolveBuffer(params);
    const runtime = await this.getRuntime();
    const now = new Date();
    const isPdf = isPdfFileForOcr(params.fileType, params.filename);

    log(
      'Starting OCR fallback for %s with %s/%s',
      params.filename,
      runtime.provider,
      runtime.model,
    );

    const { pages, truncatedPageCount } = isPdf
      ? await this.extractPdfPages(buffer, runtime)
      : { pages: [await this.extractImagePage(buffer, 1, runtime)], truncatedPageCount: 0 };

    const meaningfulPages = pages.filter((page) => hasMeaningfulText(page.pageContent, 1));
    const content = isPdf
      ? this.buildPdfContent(meaningfulPages)
      : meaningfulPages
          .map((page) => page.pageContent)
          .join('\n\n')
          .trim();

    if (!hasMeaningfulText(content, 1)) {
      throw new Error('OCR fallback did not extract any text from this file');
    }

    const totalCharCount = meaningfulPages.reduce((sum, page) => sum + page.charCount, 0);
    const totalLineCount = meaningfulPages.reduce((sum, page) => sum + page.lineCount, 0);

    return {
      content,
      createdTime: now,
      fileType: params.fileType,
      filename: params.filename,
      metadata: {
        ocr: {
          fallback: true,
          model: runtime.model,
          pageCount: meaningfulPages.length,
          provider: runtime.provider,
          reason: params.reason,
          ...(truncatedPageCount > 0 ? { truncatedPageCount } : {}),
        },
      },
      modifiedTime: now,
      pages: meaningfulPages,
      source,
      totalCharCount,
      totalLineCount,
    };
  }

  private buildPdfContent = (pages: DocumentPage[]) =>
    pages
      .map((page, index) => {
        const pageNumber = page.metadata?.pageNumber || index + 1;

        return `<page pageNumber="${pageNumber}">
${page.pageContent}
</page>`;
      })
      .join('\n\n');

  private extractImagePage = async (
    buffer: Buffer,
    pageNumber: number,
    runtime: OcrRuntimeSelection,
  ): Promise<DocumentPage> => {
    const imageDataUri = await this.normalizeImageBufferToDataUri(buffer);
    return this.ocrImageDataUri(imageDataUri, pageNumber, runtime);
  };

  private extractPdfPages = async (
    buffer: Buffer,
    runtime: OcrRuntimeSelection,
  ): Promise<{ pages: DocumentPage[]; truncatedPageCount: number }> => {
    const { createCanvas } = await import('@napi-rs/canvas');

    await this.ensurePdfPolyfills();

    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages, MAX_PDF_OCR_PAGES);
    const pages: DocumentPage[] = [];

    try {
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);

        try {
          const viewport = page.getViewport({ scale: 2 });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext('2d');

          await page.render({
            canvasContext: context as any,
            viewport,
          } as any).promise;

          const imageDataUri = canvas.toDataURL('image/png');
          pages.push(await this.ocrImageDataUri(imageDataUri, pageNumber, runtime));
        } finally {
          page.cleanup();
        }
      }
    } finally {
      await pdf.destroy();
    }

    return {
      pages,
      truncatedPageCount: Math.max(pdf.numPages - pageCount, 0),
    };
  };

  private async ensurePdfPolyfills() {
    if (typeof globalThis.DOMMatrix !== 'undefined') return;

    const canvas = await import('@napi-rs/canvas');

    globalThis.DOMMatrix = canvas.DOMMatrix as any;
    globalThis.DOMPoint = canvas.DOMPoint as any;
    globalThis.DOMRect = canvas.DOMRect as any;
    globalThis.Path2D = canvas.Path2D as any;
  }

  private getRuntime = async (): Promise<OcrRuntimeSelection> => {
    if (!this.runtimePromise) {
      this.runtimePromise = this.resolveRuntime();
    }

    return this.runtimePromise;
  };

  private normalizeImageBufferToDataUri = async (buffer: Buffer) => {
    const normalizedBuffer = await sharp(buffer)
      .rotate()
      .resize({ fit: 'inside', width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .png()
      .toBuffer();

    return `data:image/png;base64,${normalizedBuffer.toString('base64')}`;
  };

  private normalizeOcrText = (text: string) =>
    text
      .trim()
      .replaceAll(/^```(?:text|markdown)?\s*/g, '')
      .replaceAll(/\s*```$/g, '')
      .replaceAll('\0', '')
      .trim();

  private ocrImageDataUri = async (
    imageDataUri: string,
    pageNumber: number,
    runtime: OcrRuntimeSelection,
  ): Promise<DocumentPage> => {
    let finalText = '';

    const response = await runtime.runtime.chat(
      {
        max_tokens: 4096,
        messages: [
          {
            content: [
              { text: OCR_PROMPT, type: 'text' },
              { image_url: { detail: 'high', url: imageDataUri }, type: 'image_url' },
            ],
            role: 'user',
          },
        ],
        model: runtime.model,
        stream: false,
        temperature: 0,
      },
      {
        callback: {
          onFinal: (data) => {
            finalText = data.text || '';
          },
        },
        metadata: { feature: 'knowledge-ocr' },
        user: this.userId,
      },
    );

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(responseText || `OCR request failed with status ${response.status}`);
    }

    const pageContent = this.normalizeOcrText(finalText);

    return {
      charCount: pageContent.length,
      lineCount: pageContent ? pageContent.split('\n').length : 0,
      metadata: {
        ocr: true,
        pageNumber,
      },
      pageContent,
    };
  };

  private resolveBuffer = async ({
    content,
    filePath,
  }: ExtractOcrFileDocumentParams): Promise<Buffer> => {
    if (content) return Buffer.from(content);

    if (filePath) return await readFile(filePath);

    throw new Error('OCR fallback requires either file content or a local file path');
  };

  private resolveRuntime = async (): Promise<OcrRuntimeSelection> => {
    const { aiProvider } = await getServerGlobalConfig();
    const aiInfraRepos = new AiInfraRepos(this.db, this.userId, aiProvider as Record<string, any>);
    const runtimeState = await aiInfraRepos.getAiProviderRuntimeState(
      KeyVaultsGateKeeper.getUserKeyVaults,
    );
    const candidates = this.selectOcrCandidates(runtimeState.enabledAiModels);

    if (candidates.length === 0) {
      throw new Error(
        'No enabled vision model is available for OCR fallback. Please enable a vision model first.',
      );
    }

    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        const runtime = await initModelRuntimeFromDB(this.db, this.userId, candidate.providerId);

        return {
          model: candidate.id,
          provider: candidate.providerId,
          runtime,
        };
      } catch (error) {
        lastError = error;
        console.warn(
          `[document-ocr] Failed to initialize OCR runtime ${candidate.providerId}/${candidate.id}:`,
          error,
        );
      }
    }

    throw new Error(
      lastError instanceof Error
        ? lastError.message
        : 'Unable to initialize OCR runtime with the enabled vision models',
    );
  };

  private selectOcrCandidates = (models: EnabledAiModel[]) => {
    const visionModels = models.filter((model) => model.type === 'chat' && model.abilities?.vision);
    const prioritized = [
      ...OCR_MODEL_PREFERENCES.flatMap((modelId) =>
        visionModels.filter((model) => model.id === modelId),
      ),
      ...visionModels.filter((model) => !OCR_MODEL_PREFERENCES.includes(model.id)),
    ];

    const seen = new Set<string>();

    return prioritized.filter((model) => {
      const key = `${model.providerId}:${model.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
}
