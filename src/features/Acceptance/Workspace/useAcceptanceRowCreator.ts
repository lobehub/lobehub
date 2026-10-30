import { useTopicCreator } from '@/features/TopicCreatorAvatar';

/**
 * The creator whose avatar should lead an acceptance row, or undefined for the
 * bare status glyph. Resolves only to a member of the active workspace, so
 * personal mode keeps the glyph, like the topic list.
 */
export const useAcceptanceRowCreator = (userId: string | undefined, showCreator?: boolean) => {
  const creatorUserId = showCreator ? userId : undefined;
  const creator = useTopicCreator(creatorUserId);

  return creator ? creatorUserId : undefined;
};
