export const CODEX_COMMAND_OUTPUT_MAX_LENGTH = 25_000;

export const truncateCodexCommandOutput = (content: string) => {
  if (!content || content.length <= CODEX_COMMAND_OUTPUT_MAX_LENGTH) {
    return {
      output: content,
      truncated: false,
    };
  }

  let cutoff = CODEX_COMMAND_OUTPUT_MAX_LENGTH;
  const lastCharCode = content.charCodeAt(cutoff - 1);
  if (lastCharCode >= 0xd8_00 && lastCharCode <= 0xdb_ff) cutoff -= 1;

  const omittedCharacters = content.length - cutoff;
  const notice = `\n\n[Output truncated: ${omittedCharacters} characters omitted. Original length: ${content.length} characters]`;

  return {
    omittedCharacters,
    originalLength: content.length,
    output: content.slice(0, cutoff) + notice,
    truncated: true,
  };
};
