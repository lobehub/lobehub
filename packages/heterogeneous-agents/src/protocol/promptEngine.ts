import { lobeHubCliGuide } from './lobeHubCliGuide';
import type { AgentContentBlock, AgentImageBlock } from './types';

export interface HeterogeneousPromptEngineInput {
  imageList?: HeterogeneousPromptImage[];
  /**
   * Whether this prompt opens a fresh agent session rather than continuing one
   * the CLI resumes natively. Dispatch sites derive it from their own resume
   * state (`!resumeSessionId`) — the engine cannot see it.
   *
   * Session-scoped context (the `lh` guide) is attached only when true: these
   * blocks are prepended to a USER message, so on a resumed session every
   * earlier turn's copy is still in the CLI's transcript. Re-sending it each
   * turn would stack duplicates for the whole life of the conversation.
   */
  isNewSession?: boolean;
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

/**
 * Teach the agent that the LobeHub platform is reachable from its own shell.
 * Session-scoped: see `isNewSession`.
 */
const lobeHubCliProvider: HeterogeneousPromptContextProvider = {
  getContext: ({ isNewSession }) => (isNewSession ? lobeHubCliGuide : undefined),
  name: 'LobeHubCliProvider',
};

const defaultContextProviders = [lobeHubCliProvider, topicReferenceGuidanceProvider];

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
