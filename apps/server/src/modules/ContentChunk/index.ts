import { type NewChunkItem, type NewUnstructuredChunkItem } from '@/database/schemas';
import { knowledgeEnv } from '@/envs/knowledge';
import { chunkContentInWorker } from '@/server/services/fileParse';
import { isSharedLimitFailure } from '@/server/services/fileParse/failure';

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
  private chunkingRules: Record<string, ChunkingService[]>;

  constructor() {
    this.chunkingRules = ChunkingRuleParser.parse(knowledgeEnv.FILE_TYPE_CHUNKING_RULES || '');
  }

  private getChunkingServices(fileType: string): ChunkingService[] {
    const ext = fileType.split('/').pop()?.toLowerCase() || '';
    return this.chunkingRules[ext] || ['default'];
  }

  async chunkContent(params: ChunkContentParams): Promise<ChunkResult> {
    const services = this.getChunkingServices(params.fileType);

    for (const service of services) {
      try {
        switch (service) {
          case 'doc2x': {
            // Future implementation
            break;
          }

          default: {
            return await this.chunkByDefault(params.filename, params.content);
          }
        }
      } catch (error) {
        // A limit every service meets on the same bytes (input size, xlsx ZIP structure) would
        // refuse the next one too. One service's own failure leaves the next one its turn.
        if (isSharedLimitFailure(error)) throw error;
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
    // Parsing and splitting run on the shared worker; this thread keeps the routing and the
    // result mapping (and, in ChunkService, every database write).
    const res = await chunkContentInWorker(filename, content);

    const documents = res.map((item, index) => ({
      id: item.id,
      index,
      metadata: item.metadata,
      text: item.pageContent,
      type: 'DocumentChunk',
    }));

    return { chunks: documents };
  };
}
