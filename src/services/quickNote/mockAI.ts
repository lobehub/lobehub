const TAG_RULES: [RegExp, string][] = [
  [/截图/, '截图'],
  [/bug|失败|不对|吞掉/i, 'Bug'],
  [/大疆|dji|pocket/i, 'DJI'],
  [/游戏|game|hd-2d/i, '游戏'],
  [/灵感|idea|有点意思/i, '灵感'],
  [/口语|表达/, '表达'],
  [/调研|对比|research/i, 'Research'],
];

export const mockGenerateTags = (content: string): string[] => {
  const tags = TAG_RULES.filter(([pattern]) => pattern.test(content)).map(([, tag]) => tag);
  if (tags.length === 0) tags.push('随想');
  return tags.slice(0, 2);
};

export const mockGenerateAnnotation = (content: string): string => {
  const line =
    content
      .split('\n')
      .find((item) => item.trim())
      ?.trim() ?? '';
  const snippet = line.length > 24 ? `${line.slice(0, 24)}…` : line;

  return [
    `这条随手记围绕「${snippet}」展开。`,
    '',
    '概述：记录了一个值得后续跟进的想法，信息还比较碎片，适合稍后补全上下文再整理。',
    '',
    '可能的后续线索：',
    '- 补充相关背景与截图说明',
    '- 关联到已有的 Collection 或任务',
    '- 需要时从这里发起一次更深入的调研',
  ].join('\n');
};
