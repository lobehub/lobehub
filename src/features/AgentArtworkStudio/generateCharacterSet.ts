import type { AgentArtworkComposition, AgentArtworkPromptInput } from '@lobechat/prompts';

interface GenerateCharacterArtworkInput extends AgentArtworkPromptInput {
  persist?: boolean;
}

interface GenerateCharacterSetOptions {
  composition?: AgentArtworkComposition;
  currentAvatarUrl?: string | null;
  generate: (input: GenerateCharacterArtworkInput) => Promise<string | undefined>;
  input: AgentArtworkPromptInput;
}

export const generateCharacterSet = async ({
  composition,
  currentAvatarUrl,
  generate,
  input,
}: GenerateCharacterSetOptions) => {
  let avatarUrl = currentAvatarUrl || undefined;

  if (!composition || composition === 'avatar') {
    const generatedAvatarUrl = await generate({ ...input, composition: 'avatar' });
    if (generatedAvatarUrl) avatarUrl = generatedAvatarUrl;
  }

  if (!composition || composition === 'fullBody') {
    const fullBodyUrl = await generate({
      ...input,
      composition: 'fullBody',
      persist: false,
      referenceImageUrl: avatarUrl || input.referenceImageUrl,
      styleReferenceImageUrls: avatarUrl ? undefined : input.styleReferenceImageUrls,
    });

    return { avatarUrl, fullBodyUrl };
  }

  return { avatarUrl, fullBodyUrl: undefined };
};
