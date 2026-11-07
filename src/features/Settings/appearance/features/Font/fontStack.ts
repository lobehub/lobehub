export const MAX_FALLBACK_FONTS = 3;

export const parseFontStack = (value?: string): string[] => {
  if (!value) return [];
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const raw of value.split(',')) {
    const font = raw.trim();
    if (!font || seen.has(font)) continue;
    seen.add(font);
    stack.push(font);
  }
  return stack;
};

export const joinFontStack = (stack: string[]): string => stack.join(', ');
