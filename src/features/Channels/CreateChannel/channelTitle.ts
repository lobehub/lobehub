const LISTED = 3;

export interface ChannelTitleFormat {
  /** Wording for members beyond the listed ones, e.g. `A, B, C and 2 more`. */
  more: (names: string, rest: number, total: number) => string;
  separator: string;
}

/** The name a Channel gets when its creator leaves it blank; it can be renamed later. */
export const defaultChannelTitle = (
  names: string[],
  format: ChannelTitleFormat,
  maxLength: number,
) => {
  const named = names.map((name) => name.trim()).filter(Boolean);
  const listed = named.slice(0, LISTED).join(format.separator);
  const title =
    named.length > LISTED ? format.more(listed, named.length - LISTED, named.length) : listed;
  // The server counts UTF-16 units; never cut a character in half.
  let result = '';
  for (const char of title) {
    if (result.length + char.length > maxLength) break;
    result += char;
  }
  return result.trim();
};
