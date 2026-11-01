import {
  parse,
  partitionAssistantGroupBlocks,
  splitAssistantGroupFinalAnswer,
} from '@lobechat/conversation-flow';
import type { UIChatMessage } from '@lobechat/types';

/** Match the conversation's selected branches, exporting authored answers only. */
export const sharedTopicText = (messages: UIChatMessage[]): string => {
  const sections: string[] = [];
  const append = (role: string, content?: string) => {
    if (content?.trim()) sections.push(`## ${role}\n\n${content}`);
  };

  const collect = (items: UIChatMessage[]) => {
    for (const message of items) {
      if (message.columns) collect(message.columns.flat());
      else if (message.members) collect(message.members);
      else if (message.compressedMessages) collect(parse(message.compressedMessages).flatList);
      else if (message.role === 'user') append('User', message.content);
      else if (message.role === 'assistantGroup') {
        const blocks = message.taskCompletions?.length ? message.taskCompletions : message.children;
        // Never fall back to pre-tool narration when a run has no final answer.
        const lastToolIndex = blocks?.findLastIndex((block) => !!block.tools?.length) ?? -1;
        const { segments } = partitionAssistantGroupBlocks(blocks?.slice(lastToolIndex + 1) ?? [], {
          isGenerating: false,
        });
        const { finalSegments } = splitAssistantGroupFinalAnswer(segments);
        const content = finalSegments
          .filter(
            (segment) =>
              segment.kind === 'answer' && !segment.block.error && !segment.block.tools?.length,
          )
          .map((segment) => (segment.kind === 'answer' ? segment.block.content : ''))
          .filter(Boolean)
          .join('\n\n');
        append('Assistant', content);
      } else if (
        (message.role === 'assistant' || message.role === 'supervisor') &&
        !message.tools?.length &&
        !message.error &&
        message.metadata?.scope !== 'sub_agent'
      )
        append('Assistant', message.content);
    }
  };
  collect(parse(messages).flatList);

  return sections.join('\n\n');
};
