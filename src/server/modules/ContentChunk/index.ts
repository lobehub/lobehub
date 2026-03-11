import { type NewChunkItem, type NewUnstructuredChunkItem } from '@/database/schemas';
import { knowledgeEnv } from '@/envs/knowledge';
import { ChunkingLoader } from '@/libs/langchain';

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
  private langchainClient: ChunkingLoader;
  private chunkingRules: Record<string, ChunkingService[]>;

  constructor() {
    this.langchainClient = new ChunkingLoader();
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
            return await this.chunkByLangChain(params.filename, params.content);
          }
        }
      } catch (error) {
        // If this is the last service, throw the error
        if (service === services.at(-1)) throw error;
        // Otherwise continue to next service
        console.error(`Chunking failed with service ${service}:`, error);
      }
    }

    // Fallback to langchain if no service succeeded
    return await this.chunkByLangChain(params.filename, params.content);
  }

  private canUseUnstructured(): boolean {
    return !!(knowledgeEnv.UNSTRUCTURED_API_KEY && knowledgeEnv.UNSTRUCTURED_SERVER_URL);
  }

  private chunkByLangChain = async (
    filename: string,
    content: Uint8Array,
  ): Promise<ChunkResult> => {
    const res = await this.langchainClient.partitionContent(filename, content);

    const documents = res.map((item, index) => ({
      id: item.id,
      index,
      metadata: item.metadata,
      text: item.pageContent,
      type: 'LangChainElement',
    }));

    return { chunks: documents };
  };
}
