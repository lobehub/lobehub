export interface FormatEditResultParams {
  filePath: string;
  linesAdded?: number;
  linesDeleted?: number;
  replacements: number;
}

export const formatEditResult = ({
  replacements,
  filePath,
  linesAdded,
  linesDeleted,
}: FormatEditResultParams): string => {
  const statsText =
    linesAdded || linesDeleted ? ` (+${linesAdded || 0} -${linesDeleted || 0})` : '';
  return `Successfully replaced ${replacements} occurrence(s) in ${filePath}${statsText}`;
};
