import { lambdaClient } from '@/libs/trpc/client';
import { globalHelpers } from '@/store/global/helpers';
import { type PluginQueryParams } from '@/types/discover';

class ToolService {
  getOldPluginList = async (params: PluginQueryParams): Promise<any> => {
    const locale = globalHelpers.getCurrentLanguage();

    return lambdaClient.market.getPluginList.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 20,
    });
  };
}

export const toolService = new ToolService();
