export interface ReadLineRangeSource {
  endLine?: number;
  limit?: number;
  loc?: [number, number];
  offset?: number;
  startLine?: number;
}

/**
 * Inspector label for the lines a read covers, e.g. `L161-L181`.
 *
 * `loc` is the builtin tools' 0-based, end-exclusive slice, so its start is
 * shifted to the 1-based line number the render's gutter shows; the end index
 * already equals the last 1-based line. `startLine` / `offset` are 1-based.
 */
export const formatReadLineRange = (source?: ReadLineRangeSource): string | undefined => {
  const start = source?.startLine ?? (source?.loc ? source.loc[0] + 1 : source?.offset);
  const end =
    source?.endLine ??
    source?.loc?.[1] ??
    (start !== undefined && source?.limit !== undefined
      ? start + Math.max(source.limit - 1, 0)
      : undefined);
  if (start !== undefined && end !== undefined) return `L${start}-L${end}`;
  if (start !== undefined) return `L${start}`;
  return undefined;
};
