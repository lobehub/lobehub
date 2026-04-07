import { type LobeChatDatabase } from '@lobechat/database';

import { type NewChunkItem, type NewUnstructuredChunkItem } from '@/database/schemas';
import { knowledgeEnv } from '@/envs/knowledge';
import { ChunkingLoader } from '@/libs/document-loaders';
import {
  DocumentOcrService,
  isImageFileForOcr,
  isPdfFileForOcr,
  shouldUsePdfChunkOcrFallback,
} from '@/server/services/document/ocr';

import { type ChunkingService } from './rules';
import { ChunkingRuleParser } from './rules';

export interface ChunkContentParams {
  content: Uint8Array;
  filename: string;
  fileType: string;
  mode?: 'fast' | 'hi-res';
}

interface ChunkResult {
  chunks: NewChunkItem[];
  unstructuredChunks?: NewUnstructuredChunkItem[];
}

export class ContentChunk {
  private chunkingClient: ChunkingLoader;
  private chunkingRules: Record<string, ChunkingService[]>;
  private ocrService?: DocumentOcrService;

  constructor(db?: LobeChatDatabase, userId?: string) {
    this.chunkingClient = new ChunkingLoader();
    this.chunkingRules = ChunkingRuleParser.parse(knowledgeEnv.FILE_TYPE_CHUNKING_RULES || '');
    this.ocrService = db && userId ? new DocumentOcrService(db, userId) : undefined;
  }

  private getChunkingServices(fileType: string): ChunkingService[] {
    const ext = fileType.split('/').pop()?.toLowerCase() || '';
    return this.chunkingRules[ext] || ['default'];
  }

  async chunkContent(params: ChunkContentParams): Promise<ChunkResult> {
    if (isImageFileForOcr(params.fileType, params.filename)) {
      return await this.chunkByOcr(params, 'image');
    }

    const services = this.getChunkingServices(params.fileType);

    for (const service of services) {
      try {
        switch (service) {
          case 'doc2x': {
            // Future implementation
            break;
          }

          default: {
            const result = await this.chunkByDefault(params.filename, params.content);

            if (isPdfFileForOcr(params.fileType, params.filename)) {
              const ocrResult = await this.tryChunkByOcrForPdf(params, result);
              if (ocrResult) return ocrResult;
            }

            return result;
          }
        }
      } catch (error) {
        // If this is the last service, throw the error
        if (service === services.at(-1)) throw error;
        // Otherwise continue to next service
        console.error(`Chunking failed with service ${service}:`, error);
      }
    }

    // Fallback to default chunking if no service succeeded
    return await this.chunkByDefault(params.filename, params.content);
  }

  private canUseUnstructured(): boolean {
    return !!(knowledgeEnv.UNSTRUCTURED_API_KEY && knowledgeEnv.UNSTRUCTURED_SERVER_URL);
  }

  private chunkByDefault = async (filename: string, content: Uint8Array): Promise<ChunkResult> => {
    const res = await this.chunkingClient.partitionContent(filename, content);

    const documents = res.map((item, index) => ({
      id: item.id,
      index,
      metadata: item.metadata,
      text: item.pageContent,
      type: 'DocumentChunk',
    }));

    return { chunks: documents };
  };

  private chunkByOcr = async (
    params: ChunkContentParams,
    reason: 'image' | 'pdf-low-text',
  ): Promise<ChunkResult> => {
    if (!this.ocrService) {
      throw new Error('OCR fallback is unavailable because the chunking context is missing');
    }

    const fileDocument = await this.ocrService.extractFileDocument({
      content: params.content,
      fileType: params.fileType,
      filename: params.filename,
      reason,
    });

    const pages = fileDocument.pages || [];
    const chunks = pages
      .filter((page) => page.pageContent.trim())
      .map((page, index) => ({
        index,
        metadata: page.metadata,
        text: page.pageContent,
        type: 'DocumentChunk',
      }));

    return { chunks };
  };

  private tryChunkByOcrForPdf = async (
    params: ChunkContentParams,
    result: ChunkResult,
  ): Promise<ChunkResult | undefined> => {
    if (!shouldUsePdfChunkOcrFallback(result.chunks)) return result;
    if (!this.ocrService) return result;

    try {
      return await this.chunkByOcr(params, 'pdf-low-text');
    } catch (error) {
      console.warn(
        `PDF OCR fallback failed for ${params.filename}, keeping default chunks:`,
        error,
      );
      return result;
    }
  };
}
