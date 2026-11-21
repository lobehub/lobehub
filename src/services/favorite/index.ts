import type { AddFavoriteParams, FavoriteItem, FavoriteType } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class FavoriteService {
  add = (params: AddFavoriteParams): Promise<FavoriteItem> =>
    lambdaClient.favorite.add.mutate(params);

  list = (): Promise<FavoriteItem[]> => lambdaClient.favorite.list.query();

  remove = async (id: string): Promise<void> => {
    await lambdaClient.favorite.remove.mutate({ id });
  };

  removeByTarget = async (type: FavoriteType, targetId: string): Promise<void> => {
    await lambdaClient.favorite.removeByTarget.mutate({ targetId, type });
  };

  reorder = async (ids: string[]): Promise<void> => {
    await lambdaClient.favorite.reorder.mutate({ ids });
  };

  update = async (
    id: string,
    value: Partial<Pick<FavoriteItem, 'icon' | 'path' | 'title'>>,
  ): Promise<void> => {
    await lambdaClient.favorite.update.mutate({ id, value });
  };
}

export const favoriteService = new FavoriteService();
