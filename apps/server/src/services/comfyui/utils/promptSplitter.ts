import {
  extractStyleAdjectives,
  getAllStyleKeywords,
  getCompoundStyles,
  normalizeStyleTerm,
} from '@/server/services/comfyui/config/promptToolConst';

/**
 * FLUX dual-CLIP prompt intelligent splitter
 * Separates a single prompt into different inputs for T5-XXL and CLIP-L
 */
export function splitPromptForDualCLIP(prompt: string): {
  // Style keywords for CLIP-L to understand visual concepts
  clipLPrompt: string;
  // Full description for T5-XXL to understand semantics
  t5xxlPrompt: string;
} {
  if (!prompt) {
    return { clipLPrompt: '', t5xxlPrompt: '' };
  }

  // Get all style configurations
  const styleKeywords = getAllStyleKeywords();
  const compoundStyles = getCompoundStyles();

  // Separate style keywords
  const lowerPrompt = prompt.toLowerCase();
  const words = prompt.split(/[\s,]+/);
  const lowerWords = lowerPrompt.split(/[\s,]+/);
  const stylePhrases: string[] = []; // Changed to store complete phrases
  const contentWords: string[] = [];
  const processedIndices = new Set<number>();

  // 1. First check compound styles (highest priority)
  for (const compound of compoundStyles) {
    const compoundLower = compound.toLowerCase();
    const index = lowerPrompt.indexOf(compoundLower);
    if (index !== -1) {
      // Found compound style, extract corresponding original phrase
      const beforeWords = prompt
        .slice(0, Math.max(0, index))
        .split(/[\s,]+/)
        .filter(Boolean).length;
      const compoundWordCount = compound.split(/\s+/).length;
      const phraseWords: string[] = [];
      for (let i = beforeWords; i < beforeWords + compoundWordCount; i++) {
        if (words[i]) {
          phraseWords.push(words[i]);
          processedIndices.add(i);
        }
      }
      if (phraseWords.length > 0) {
        const phrase = phraseWords.join(' ');
        stylePhrases.push(phrase);
      }
    }
  }

  // 2. Check individual style keywords and synonyms
  for (let i = 0; i < words.length; i++) {
    if (processedIndices.has(i)) continue; // Skip already processed words

    const word = words[i];
    const lowerWord = lowerWords[i];
    let isStyleWord = false;

    // 2.1 First check synonyms and normalize
    const normalizedWord = normalizeStyleTerm(lowerWord);

    // 2.2 Check if it's a style keyword
    for (const keyword of styleKeywords) {
      const keywordWords = keyword.toLowerCase().split(/\s+/);

      if (keywordWords.length === 1) {
        // Single word matching (including normalized words)
        if (lowerWord === keywordWords[0] || normalizedWord === keywordWords[0]) {
          stylePhrases.push(word);
          processedIndices.add(i);
          isStyleWord = true;
          break;
        }
      } else if (keywordWords.length > 1 && i + keywordWords.length <= words.length) {
        // Multi-word phrase matching
        const sequence = lowerWords.slice(i, i + keywordWords.length).join(' ');
        if (sequence === keyword.toLowerCase()) {
          const phraseWords: string[] = [];
          for (let j = 0; j < keywordWords.length; j++) {
            phraseWords.push(words[i + j]);
            processedIndices.add(i + j);
          }
          stylePhrases.push(phraseWords.join(' '));
          i += keywordWords.length - 1; // Skip matched words
          isStyleWord = true;
          break;
        }
      }
    }

    // 2.3 If not a keyword, check if it's a style adjective
    if (!isStyleWord && !processedIndices.has(i)) {
      const adjectives = extractStyleAdjectives([word]);
      if (adjectives.length > 0) {
        stylePhrases.push(word);
        processedIndices.add(i);
        isStyleWord = true;
      }
    }

    // 2.4 Record non-style words
    if (!isStyleWord && !processedIndices.has(i)) {
      contentWords.push(word);
    }
  }

  // Build result
  if (stylePhrases.length > 0) {
    // Phrase-level deduplication, maintaining integrity of multi-word phrases
    const uniquePhrases = [...new Set(stylePhrases)];
    return {
      // CLIP-L focuses on style and visual concepts
      clipLPrompt: uniquePhrases.join(' '),
      // T5-XXL receives complete context to understand semantic relationships
      t5xxlPrompt: prompt,
    };
  }

  // Fallback when no style words: same prompt (ensures compatibility)
  return {
    clipLPrompt: prompt,
    t5xxlPrompt: prompt,
  };
}
