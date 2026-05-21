import { lambdaClient } from '@/libs/trpc/client';

interface UpsertCrawledDocumentParams {
  content: string;
  description?: string;
  title: string;
  topicId?: string;
  url: string;
}

class WebBrowsingService {
  upsertCrawledDocument = async (params: UpsertCrawledDocumentParams) => {
    return lambdaClient.webBrowsing.upsertCrawledDocument.mutate(params);
  };
}

export const webBrowsingService = new WebBrowsingService();
