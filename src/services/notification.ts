import { lambdaClient } from '@/libs/trpc/client';

class NotificationService {
  list = (
    params: {
      category?: string;
      cursor?: string;
      limit?: number;
      unreadOnly?: boolean;
    } = {},
  ) => {
    return lambdaClient.notification.list.query(params);
  };

  getUnreadCount = (): Promise<number> => {
    return lambdaClient.notification.unreadCount.query();
  };

  markAsRead = (ids: string[]) => {
    return lambdaClient.notification.markAsRead.mutate({ ids });
  };

  markAllAsRead = () => {
    return lambdaClient.notification.markAllAsRead.mutate();
  };

  archive = (id: string) => {
    return lambdaClient.notification.archive.mutate({ id });
  };

  archiveAll = () => {
    return lambdaClient.notification.archiveAll.mutate();
  };
}

export const notificationService = new NotificationService();
