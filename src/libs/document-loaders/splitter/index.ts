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
}

/**
 * Splits text into overlapping chunks using a recursive separator strategy.
 * Replicates LangChain's RecursiveCharacterTextSplitter algorithm.
 */
function splitTextWithSeparators(
  text: string,
  separators: string[],
  config: SplitterConfig,
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

  // Split the text by the chosen separator
  const splits = separator ? text.split(separator) : [...text];

  // Merge splits into chunks respecting chunkSize
  const goodSplits: string[] = [];
  const finalChunks: string[] = [];

  for (const s of splits) {
    if (s.length < chunkSize) {
      goodSplits.push(s);
    } else {
      if (goodSplits.length > 0) {
        const merged = mergeSplits(goodSplits, separator, config);
        finalChunks.push(...merged);
        goodSplits.length = 0;
      }
      // If this piece is still too large and we have more separators, recurse
      if (newSeparators && newSeparators.length > 0) {
        const subChunks = splitTextWithSeparators(s, newSeparators, config);
        finalChunks.push(...subChunks);
      } else {
        finalChunks.push(s);
      }
    }
  }

  if (goodSplits.length > 0) {
    const merged = mergeSplits(goodSplits, separator, config);
    finalChunks.push(...merged);
  }

  return finalChunks;
}

/**
 * Merge small splits into chunks respecting chunkSize and chunkOverlap.
 */
function mergeSplits(splits: string[], separator: string, config: SplitterConfig): string[] {
  const { chunkSize, chunkOverlap } = config;
  const chunks: string[] = [];
  const currentChunk: string[] = [];
  let total = 0;

  for (const s of splits) {
    const len = s.length;
    const sepLen = currentChunk.length > 0 ? separator.length : 0;

    if (total + len + sepLen > chunkSize && currentChunk.length > 0) {
      const chunk = currentChunk.join(separator);
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      // Keep overlap: drop from the start of currentChunk until we fit in overlap
      while (total > chunkOverlap || (total + len + separator.length > chunkSize && total > 0)) {
        if (currentChunk.length === 0) break;
        const removed = currentChunk.shift()!;
        total -= removed.length + (currentChunk.length > 0 ? separator.length : 0);
      }
    }

    currentChunk.push(s);
    total += len + (currentChunk.length > 1 ? separator.length : 0);
  }

  const lastChunk = currentChunk.join(separator);
  if (lastChunk.length > 0) {
    chunks.push(lastChunk);
  }

  return chunks;
}

/**
 * Calculate line location metadata for a chunk within the original text.
 */
function getLineLocation(fullText: string, chunk: string): { from: number; to: number } {
  const index = fullText.indexOf(chunk);
  if (index === -1) {
    return { from: 1, to: 1 };
  }

  const beforeChunk = fullText.slice(0, index);
  const from = beforeChunk.split('\n').length;
  const chunkLines = chunk.split('\n').length;
  const to = from + chunkLines - 1;

  return { from, to };
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
  const chunks = splitTextWithSeparators(text, separators, config);

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

export function splitCode(
  text: string,
  language: SupportedLanguage,
  config: SplitterConfig,
): DocumentChunk[] {
  const separators = getSeparatorsForLanguage(language);
  return createDocuments(text, separators, config);
}
