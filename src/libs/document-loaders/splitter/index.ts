import { type DocumentChunk } from '../types';
import {
  DEFAULT_SEPARATORS,
  getSeparatorsForLanguage,
  LATEX_SEPARATORS,
  MARKDOWN_SEPARATORS,
  type SupportedLanguage,
} from './separators';

export { SUPPORTED_LANGUAGES, type SupportedLanguage } from './separators';

interface SplitterConfig {
  chunkOverlap: number;
  chunkSize: number;
  maxChunks?: number;
}

interface ChunkBudget {
  count: number;
  max?: number;
}

export class DocumentChunkLimitError extends Error {
  constructor(maxChunks: number) {
    super(`Document chunk count exceeds maximum allowed limit of ${maxChunks}`);
    this.name = 'DocumentChunkLimitError';
  }
}

const appendChunk = (chunks: string[], chunk: string, budget: ChunkBudget) => {
  if (!chunk) return;
  if (budget.max !== undefined && budget.count >= budget.max) {
    throw new DocumentChunkLimitError(budget.max);
  }

  chunks.push(chunk);
  budget.count += 1;
};

function* splitBySeparator(text: string, separator: string): Generator<string> {
  if (!separator) {
    yield* text;
    return;
  }

  let start = 0;
  let index = text.indexOf(separator, start);
  while (index !== -1) {
    yield text.slice(start, index);
    start = index + separator.length;
    index = text.indexOf(separator, start);
  }
  yield text.slice(start);
}

/**
 * Splits text into overlapping chunks using a recursive separator strategy.
 * Replicates LangChain's RecursiveCharacterTextSplitter algorithm.
 */
function splitTextWithSeparators(
  text: string,
  separators: string[],
  config: SplitterConfig,
  budget: ChunkBudget,
): string[] {
  const { chunkSize, chunkOverlap } = config;

  // Find the appropriate separator
  let separator = separators.at(-1)!;
  let newSeparators: string[] | undefined;

  for (let i = 0; i < separators.length; i++) {
    const sep = separators[i];
    if (sep === '') {
      separator = '';
      break;
    }
    if (text.includes(sep)) {
      separator = sep;
      newSeparators = separators.slice(i + 1);
      break;
    }
  }

  const finalChunks: string[] = [];
  const currentChunk: string[] = [];
  let total = 0;

  const flushCurrentChunk = () => {
    appendChunk(finalChunks, currentChunk.join(separator), budget);
  };

  // Split and merge incrementally so hostile inputs cannot allocate the complete
  // split/chunk arrays before the configured chunk budget is enforced.
  for (const s of splitBySeparator(text, separator)) {
    if (s.length < chunkSize) {
      const separatorLength = currentChunk.length > 0 ? separator.length : 0;
      if (total + s.length + separatorLength > chunkSize && currentChunk.length > 0) {
        flushCurrentChunk();

        while (
          total > chunkOverlap ||
          (total + s.length + separator.length > chunkSize && total > 0)
        ) {
          if (currentChunk.length === 0) break;
          const removed = currentChunk.shift()!;
          total -= removed.length + (currentChunk.length > 0 ? separator.length : 0);
        }
      }

      currentChunk.push(s);
      total += s.length + (currentChunk.length > 1 ? separator.length : 0);
    } else {
      if (currentChunk.length > 0) {
        flushCurrentChunk();
        currentChunk.length = 0;
        total = 0;
      }
      // If this piece is still too large and we have more separators, recurse
      if (newSeparators && newSeparators.length > 0) {
        const subChunks = splitTextWithSeparators(s, newSeparators, config, budget);
        for (const chunk of subChunks) finalChunks.push(chunk);
      } else {
        appendChunk(finalChunks, s, budget);
      }
    }
  }

  if (currentChunk.length > 0) {
    flushCurrentChunk();
  }

  return finalChunks;
}

/**
 * Create document chunks from text using given separators.
 */
function createDocuments(
  text: string,
  separators: string[],
  config: SplitterConfig,
  baseMetadata?: Record<string, any>,
): DocumentChunk[] {
  const chunks = splitTextWithSeparators(text, separators, config, {
    count: 0,
    max: config.maxChunks,
  });

  // Track search position to handle duplicate chunks correctly
  let searchFrom = 0;

  return chunks.map((chunk) => {
    const index = text.indexOf(chunk, searchFrom);
    let loc = { from: 1, to: 1 };

    if (index !== -1) {
      const beforeChunk = text.slice(0, index);
      const from = beforeChunk.split('\n').length;
      const chunkLines = chunk.split('\n').length;
      loc = { from, to: from + chunkLines - 1 };
      // Advance search position past this match (but allow overlap)
      searchFrom = index + 1;
    }

    return {
      metadata: {
        ...baseMetadata,
        loc: { lines: loc },
      },
      pageContent: chunk,
    };
  });
}

// --- Public API ---

export function splitText(text: string, config: SplitterConfig): DocumentChunk[] {
  return createDocuments(text, DEFAULT_SEPARATORS, config);
}

export function splitMarkdown(text: string, config: SplitterConfig): DocumentChunk[] {
  return createDocuments(text, MARKDOWN_SEPARATORS, config);
}

export function splitLatex(text: string, config: SplitterConfig): DocumentChunk[] {
  return createDocuments(text, LATEX_SEPARATORS, config);
}

export function splitPdf(text: string, config: SplitterConfig): DocumentChunk[] {
  const budget = { count: 0, max: config.maxChunks };
  const pages: string[] = text
    ? text.split(/\f/).filter((page: string) => page.trim().length > 0)
    : [];
  return pages.flatMap((pageContent: string, index: number) => {
    const stringChunks = splitTextWithSeparators(pageContent, DEFAULT_SEPARATORS, config, budget);
    return stringChunks.map((chunkContent: string) => ({
      metadata: {
        loc: { pageNumber: index + 1 },
      },
      pageContent: chunkContent.trim(),
    }));
  });
}

export function splitCode(
  text: string,
  language: SupportedLanguage,
  config: SplitterConfig,
): DocumentChunk[] {
  const separators = getSeparatorsForLanguage(language);
  return createDocuments(text, separators, config);
}
