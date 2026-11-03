/**
 * Detect if text contains Chinese characters
 * @param text - The text to check
 * @returns true if text contains Chinese characters, false otherwise
 */
export const containsChinese = (text: string): boolean => {
  // Enhanced regex to cover more Chinese character ranges:
  // \u4e00-\u9fa5: CJK Unified Ideographs (basic)
  // \u3400-\u4dbf: CJK Unified Ideographs Extension A
  // \uf900-\ufaff: CJK Compatibility Ideographs
  return /[\u3400-\u4DBF\u4E00-\u9FA5\uF900-\uFAFF]/.test(text);
};
