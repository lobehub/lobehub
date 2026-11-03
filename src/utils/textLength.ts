/**
 * Check if a character is CJK (Chinese, Japanese, Korean)
 */
const isCJKChar = (char: string): boolean => {
  const code = char.codePointAt(0);
  if (!code) return false;

  return (
    // CJK Unified Ideographs
    (code >= 0x4E_00 && code <= 0x9F_FF) ||
    // CJK Unified Ideographs Extension A
    (code >= 0x34_00 && code <= 0x4D_BF) ||
    // CJK Compatibility Ideographs
    (code >= 0xF9_00 && code <= 0xFA_FF) ||
    // Hiragana
    (code >= 0x30_40 && code <= 0x30_9F) ||
    // Katakana
    (code >= 0x30_A0 && code <= 0x30_FF) ||
    // Hangul Syllables
    (code >= 0xAC_00 && code <= 0xD7_AF) ||
    // Hangul Jamo
    (code >= 0x11_00 && code <= 0x11_FF) ||
    // CJK Unified Ideographs Extension B-F
    (code >= 0x2_00_00 && code <= 0x2_EB_EF)
  );
};

/**
 * Calculate weighted length of text where CJK characters count more
 * @param text - The text to measure
 * @param cjkWeight - Weight for CJK characters (default: 2)
 * @returns Weighted length
 */
export const calculateWeightedLength = (text: string, cjkWeight = 2): number => {
  let length = 0;
  for (const char of text) {
    length += isCJKChar(char) ? cjkWeight : 1;
  }
  return length;
};

/**
 * Truncate text to a maximum weighted length, handling CJK characters
 * @param text - The text to truncate
 * @param maxWeightedLength - Maximum weighted length allowed
 * @param cjkWeight - Weight for CJK characters (default: 2)
 * @returns Truncated text
 */
export const truncateByWeightedLength = (
  text: string,
  maxWeightedLength: number,
  cjkWeight = 2,
): string => {
  let currentWeight = 0;
  let result = '';

  for (const char of text) {
    const charWeight = isCJKChar(char) ? cjkWeight : 1;
    if (currentWeight + charWeight > maxWeightedLength) {
      break;
    }
    currentWeight += charWeight;
    result += char;
  }

  return result;
};
