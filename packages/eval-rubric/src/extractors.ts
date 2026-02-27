import type { AnswerExtractor } from '@lobechat/types';

/**
 * Extract answer from raw agent output using the configured extractor
 */
export const extract = (output: string, extractor: AnswerExtractor): string => {
  switch (extractor.type) {
    case 'regex': {
      const match = new RegExp(extractor.pattern).exec(output);
      if (!match) return output;
      const group = extractor.group ?? 1;
      return match[group] ?? match[0];
    }

    case 'delimiter': {
      const parts = output.split(extractor.delimiter);
      if (parts.length < 2) return output;
      const segment =
        extractor.position === 'first' ? parts[1] : parts[parts.length - 1];
      return segment.trim();
    }

    case 'last-line': {
      const lines = output.split('\n').filter((l) => l.trim());
      if (lines.length === 0) return output;
      const last = lines[lines.length - 1];
      return extractor.trim !== false ? last.trim() : last;
    }

    case 'choice-index': {
      const labels = extractor.labels ?? ['A', 'B', 'C', 'D'];
      // Default pattern: match a standalone choice label (word boundary)
      const pattern = extractor.pattern ?? `\\b([${labels.join('')}])\\b`;
      // Try all matches and pick the last one (most likely the actual answer)
      const regex = new RegExp(pattern, 'gi');
      let lastMatch: RegExpExecArray | null = null;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(output)) !== null) {
        lastMatch = m;
      }
      if (!lastMatch) return output;
      const letter = (lastMatch[1] ?? lastMatch[0]).toUpperCase();
      const idx = labels.indexOf(letter);
      return idx >= 0 ? String(idx) : output;
    }
  }
};
