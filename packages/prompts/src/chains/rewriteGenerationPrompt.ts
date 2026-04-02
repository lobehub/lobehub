import type { ChatStreamPayload } from '@lobechat/types';

interface RewriteGenerationPromptParams {
  locale: string;
  mode: 'image' | 'video' | 'text';
  prompt: string;
}

const IMAGE_REWRITE_SYSTEM_PROMPT = (locale: string) => `You are an expert image prompt engineer.

Rewrite the user prompt into a production-ready image-generation prompt while preserving intent.

Use this structure (keep it concise):
1) Main subject & scene
2) Visual style / medium / quality
3) Composition & viewpoint
4) Lighting & atmosphere
5) Technical details (lens, depth of field, resolution, etc. when useful)

Rules:
- Keep important entities, quantities, and constraints unchanged.
- Add concrete visual details and physically plausible lighting.
- Avoid verbosity and avoid contradictory details.
- Output language must be ${locale}.
- Output ONLY the final rewritten prompt (single paragraph, no markdown).`;

const VIDEO_REWRITE_SYSTEM_PROMPT = (locale: string) => `You are an expert video prompt engineer.

Rewrite the user prompt into a production-ready video-generation prompt while preserving intent.

Include these dimensions when relevant:
1) Subject, scene, and action
2) Shot framing and camera movement (pan/tilt/dolly/handheld/static)
3) Temporal progression (start -> middle -> end)
4) Lighting, mood, and color style
5) Motion characteristics (speed, rhythm, realism) and quality constraints

Rules:
- Keep important entities, quantities, and constraints unchanged.
- Prioritize temporal clarity and camera language.
- Avoid impossible or contradictory motion/physics descriptions.
- Output language must be ${locale}.
- Output ONLY the final rewritten prompt (single paragraph, no markdown).`;

const TEXT_REWRITE_SYSTEM_PROMPT = (
  locale: string,
) => `You are an expert prompt engineer for text-rendering and writing-oriented generation tasks.

Rewrite the user prompt into a clear, structured prompt for text-heavy generation scenarios (e.g. page writing assistant, UI copy, poster text, or text-rendering description).

Focus on:
1) Core intent and target output type
2) Content requirements (tone, style, audience, language)
3) Structural constraints (sections, length, formatting)
4) If the prompt involves visible rendered text in images/UI, explicitly include exact text content in double quotes

Rules:
- Keep key entities, numbers, and constraints unchanged.
- If user provided literal text content, preserve the original language of that text.
- Make requirements explicit and executable, avoid vague wording.
- Output language must be ${locale}.
- Output ONLY the final rewritten prompt (single paragraph, no markdown).`;

const getSystemPromptByMode = (mode: RewriteGenerationPromptParams['mode'], locale: string) => {
  switch (mode) {
    case 'image': {
      return IMAGE_REWRITE_SYSTEM_PROMPT(locale);
    }
    case 'video': {
      return VIDEO_REWRITE_SYSTEM_PROMPT(locale);
    }
    case 'text': {
      return TEXT_REWRITE_SYSTEM_PROMPT(locale);
    }
    default: {
      return IMAGE_REWRITE_SYSTEM_PROMPT(locale);
    }
  }
};

export const chainRewriteGenerationPrompt = ({
  mode,
  prompt,
  locale,
}: RewriteGenerationPromptParams): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: getSystemPromptByMode(mode, locale),
      role: 'system',
    },
    {
      content: prompt,
      role: 'user',
    },
  ],
});
