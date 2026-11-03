export const historySummaryPrompt = (historySummary: string) => `<chat_history_summary>
<docstring>Users may have lots of chat messages, here is the summary of the history:</docstring>
<summary>${historySummary}</summary>
</chat_history_summary>
`;

/**
 * Lobe Chat will inject some system instructions here
 */
export const BuiltinSystemRolePrompts = ({
  welcome,
  plugins,
  historySummary,
}: {
  historySummary?: string;
  plugins?: string;
  welcome?: string;
}) => {
  return [welcome, plugins, historySummary ? historySummaryPrompt(historySummary) : '']
    .filter(Boolean)
    .join('\n\n');
};
