import type { AgentContentBlock, AgentImageBlock } from './types';

export interface HeterogeneousPromptEngineInput {
  imageList?: HeterogeneousPromptImage[];
  prompt: string;
  systemContext?: string;
}

export interface HeterogeneousPromptImage {
  id?: string;
  url: string;
}

export interface HeterogeneousPromptContextProvider {
  getContext: (input: HeterogeneousPromptEngineInput) => string | undefined;
  name: string;
}

const topicReferenceGuidanceProvider: HeterogeneousPromptContextProvider = {
  getContext: ({ prompt }) => {
    if (!prompt.includes('<refer_topic') && !prompt.includes('\\<refer\\_topic')) return;

    return [
      '## Referenced topics',
      'The user message contains one or more `<refer_topic>` tags. When you need the conversation from a referenced topic, retrieve it with `lh topic view <topic-id>` using the `id` from the tag.',
    ].join('\n');
  },
  name: 'TopicReferenceGuidanceProvider',
};

const defaultContextProviders = [topicReferenceGuidanceProvider];

/**
 * Builds the semantic prompt shared by every heterogeneous-agent transport.
 * Providers add LobeHub context before the user message; CLI-specific wire
 * serialization remains the responsibility of `buildAgentInput`.
 */
export class HeterogeneousPromptEngine {
  constructor(
    private input: HeterogeneousPromptEngineInput,
    private contextProviders: HeterogeneousPromptContextProvider[] = defaultContextProviders,
  ) {}

  process(): AgentContentBlock[] {
    const blocks: AgentContentBlock[] = [];
    const { imageList = [], prompt, systemContext } = this.input;

    if (systemContext?.trim()) blocks.push({ text: systemContext.trim(), type: 'text' });

    for (const provider of this.contextProviders) {
      const context = provider.getContext(this.input)?.trim();
      if (context) blocks.push({ text: context, type: 'text' });
    }

    if (prompt) blocks.push({ text: prompt, type: 'text' });
    blocks.push(
      ...imageList.map(({ id, url }): AgentImageBlock => ({
        source: { id, type: 'url', url },
        type: 'image',
      })),
    );

    return blocks;
  }
}

export const buildHeterogeneousPrompt = (
  input: HeterogeneousPromptEngineInput,
): AgentContentBlock[] => new HeterogeneousPromptEngine(input).process();
