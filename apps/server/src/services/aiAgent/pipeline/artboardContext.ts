import debug from 'debug';

import { ArtboardService } from '@/server/services/artboard';

import type { ProjectContextDeps } from './projectContext';

const log = debug('lobe-server:ai-agent-service');

export const buildArtboardCommentsPrompt = async (
  deps: ProjectContextDeps,
  projectId: string | undefined,
  topicId: string | undefined,
): Promise<string | undefined> => {
  if (!projectId || !topicId) return;

  try {
    const notices = await new ArtboardService(
      deps.db,
      deps.userId,
      deps.workspaceId,
    ).unreadCommentNotices(projectId, topicId);
    if (!notices.length) return;

    const lines = notices.map(
      ({ id, threads, title }) =>
        `- ${id} "${title}": ${threads} unread comment thread${threads === 1 ? '' : 's'}`,
    );
    return [
      '<artboard_comments>',
      'The user left comments on an artboard of this conversation that you have not read yet. Read them with listArtboardComments before you answer.',
      ...lines,
      '</artboard_comments>',
    ].join('\n');
  } catch (error) {
    log('execAgent: failed to read artboard comments for %s: %O', topicId, error);
    return;
  }
};
