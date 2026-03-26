export interface BotPlatformInfo {
  platformName: string;
  supportsMarkdown: boolean;
}

/**
 * Format bot platform context into a system-level instruction.
 *
 * When the platform does not support Markdown, instructs the AI to use plain text only.
 */
export const formatBotPlatformContext = ({
  platformName,
  supportsMarkdown,
}: BotPlatformInfo): string | null => {
  if (supportsMarkdown) return null;

  return [
    `<bot_platform_context platform="${platformName}">`,
    'The current IM platform does NOT support Markdown rendering.',
    'You MUST NOT use any Markdown formatting in your response, including:',
    '- **bold**, *italic*, ~~strikethrough~~',
    '- `inline code` or ```code blocks```',
    '- # Headings',
    '- [links](url)',
    '- Tables, blockquotes, or HTML tags',
    '',
    'Use plain text only. Use line breaks, indentation, dashes, and numbering to structure your response for readability.',
    '</bot_platform_context>',
  ].join('\n');
};
