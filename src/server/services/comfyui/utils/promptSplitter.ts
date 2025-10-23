import {
  extractStyleAdjectives,
  getAllStyleKeywords,
  getCompoundStyles,
  normalizeStyleTerm,
} from '@/server/services/comfyui/config/promptToolConst';

/**
 * FLUX 双CLIP提示词智能分割工具
 * 将单一prompt分离为T5-XXL和CLIP-L的不同输入
 */
export function splitPromptForDualCLIP(prompt: string): {
  // 风格关键词，给CLIP-L理解视觉概念
  clipLPrompt: string;
  // 完整描述，给T5-XXL理解语义
  t5xxlPrompt: string;
} {
  if (!prompt) {
    return { clipLPrompt: '', t5xxlPrompt: '' };
  }

  // 获取所有风格配置
  const styleKeywords = getAllStyleKeywords();
  const compoundStyles = getCompoundStyles();

  // 分离风格关键词
  const lowerPrompt = prompt.toLowerCase();
  const words = prompt.split(/[\s,]+/);
  const lowerWords = lowerPrompt.split(/[\s,]+/);
  const stylePhrases: string[] = []; // 改为存储完整短语
  const contentWords: string[] = [];
  const processedIndices = new Set<number>();

  // 1. 首先检查组合风格（优先级最高）
  for (const compound of compoundStyles) {
    const compoundLower = compound.toLowerCase();
    const index = lowerPrompt.indexOf(compoundLower);
    if (index !== -1) {
      // 找到组合风格，提取对应的原始短语
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

  // 2. 检查单个风格关键词和同义词
  for (let i = 0; i < words.length; i++) {
    if (processedIndices.has(i)) continue; // 跳过已处理的词

    const word = words[i];
    const lowerWord = lowerWords[i];
    let isStyleWord = false;

    // 2.1 先检查同义词并标准化
    const normalizedWord = normalizeStyleTerm(lowerWord);

    // 2.2 检查是否是风格关键词
    for (const keyword of styleKeywords) {
      const keywordWords = keyword.toLowerCase().split(/\s+/);

      if (keywordWords.length === 1) {
        // 单词匹配（包括标准化后的词）
        if (lowerWord === keywordWords[0] || normalizedWord === keywordWords[0]) {
          stylePhrases.push(word);
          processedIndices.add(i);
          isStyleWord = true;
          break;
        }
      } else if (keywordWords.length > 1 && i + keywordWords.length <= words.length) {
        // 多词短语匹配
        const sequence = lowerWords.slice(i, i + keywordWords.length).join(' ');
        if (sequence === keyword.toLowerCase()) {
          const phraseWords: string[] = [];
          for (let j = 0; j < keywordWords.length; j++) {
            phraseWords.push(words[i + j]);
            processedIndices.add(i + j);
          }
          stylePhrases.push(phraseWords.join(' '));
          i += keywordWords.length - 1; // 跳过已匹配的词
          isStyleWord = true;
          break;
        }
      }
    }

    // 2.3 如果不是关键词，检查是否是风格形容词
    if (!isStyleWord && !processedIndices.has(i)) {
      const adjectives = extractStyleAdjectives([word]);
      if (adjectives.length > 0) {
        stylePhrases.push(word);
        processedIndices.add(i);
        isStyleWord = true;
      }
    }

    // 2.4 记录非风格词
    if (!isStyleWord && !processedIndices.has(i)) {
      contentWords.push(word);
    }
  }

  // 构建结果
  if (stylePhrases.length > 0) {
    // 短语级别去重，保持多词短语的完整性
    const uniquePhrases = [...new Set(stylePhrases)];
    return {
      // CLIP-L专注风格和视觉概念
      clipLPrompt: uniquePhrases.join(' '),
      // T5-XXL接收完整context以理解语义关系
      t5xxlPrompt: prompt,
    };
  }

  // 无风格词时的fallback：相同prompt（保证兼容性）
  return {
    clipLPrompt: prompt,
    t5xxlPrompt: prompt,
  };
}
