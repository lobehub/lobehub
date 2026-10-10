import { defineReplica } from '@/libs/replica';
import type { ImageGenerationTopic } from '@/types/generation';

/**
 * The image generation topics list is a single entry per cache scope. The
 * server returns every topic the caller may see (`getAllGenerationTopics('image')`),
 * so there is no server-side filter or pagination to keep apart — the only
 * partition is the identity scope (`${userId}:${workspaceId}`), which the
 * replica owns.
 */
export const GENERATION_TOPICS_KEY = 'image';

/**
 * Image generation topics of the active scope. Read through
 * `generationTopicSelectors.generationTopics`; the persisted copy keeps the
 * sidebar and the routed topic panel populated instead of flashing a skeleton
 * on the first frame after a reload.
 */
export const generationTopicsResource = defineReplica<
  Record<string, never>,
  ImageGenerationTopic[]
>({
  key: () => GENERATION_TOPICS_KEY,
  name: 'imageGenerationTopics',
  storage: 'indexedDB',
  version: 1,
});
