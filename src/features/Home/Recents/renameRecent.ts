import { getProjectionStoreState } from '@/projection';
import type { RecentItem } from '@/server/routers/lambda/recent';
import { documentService } from '@/services/document';
import { taskService } from '@/services/task';
import { topicService } from '@/services/topic';

export const persistRecentRename = async (
  item: RecentItem,
  title: string,
  scope: string,
): Promise<void> => {
  switch (item.type) {
    case 'document': {
      await documentService.updateDocument({ id: item.id, title });
      return;
    }
    case 'task': {
      await taskService.update(item.id, { name: title });
      getProjectionStoreState().updateTaskProjectionName(scope, item.id, title);
      return;
    }
    case 'topic': {
      await topicService.updateTopic(item.id, { title });
      getProjectionStoreState().updateTopicProjectionTitle(scope, item.id, title);
    }
  }
};
