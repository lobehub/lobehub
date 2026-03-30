export interface BotPlatformInfo {
  platformName: string;
  supportsMarkdown: boolean;
}

/**
 * Format bot platform context into a system-level instruction.
 *
 * Always tells the AI which platform it's running on so it can adapt its behavior.
 * When the platform does not support Markdown, instructs the AI to use plain text only.
 */
export const formatBotPlatformContext = ({
  platformName,
  supportsMarkdown,
}: BotPlatformInfo): string => {
  const lines = [
    `<bot_platform_context platform="${platformName}">`,
    `You are currently responding on the **${platformName}** platform.`,
    `Adapt your responses to this platform's conventions and capabilities.`,
    '',
    '- Do NOT reference UI elements from other environments (e.g. "check the sidebar", "click the button above").',
    '- Keep responses concise — IM platforms have character limits and small viewports.',
  ];

  if (!supportsMarkdown) {
    lines.push(
      '',
      'This platform does NOT support Markdown rendering.',
      'You MUST NOT use any Markdown formatting in your response, including:',
      '- **bold**, *italic*, ~~strikethrough~~',
      '- `inline code` or ```code blocks```',
      '- # Headings',
      '- [links](url)',
      '- Tables, blockquotes, or HTML tags',
      '',
      'Use plain text only. Use line breaks, indentation, dashes, and numbering to structure your response for readability.',
    );
  }

  lines.push('</bot_platform_context>');

  return lines.join('\n');
};
