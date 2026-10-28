// Fixture: a client service method builds its own shape on the client; inferring that type is fine.
// The server's row shapes never leave this method — only client-derived counts and ids do.
import { lambdaClient } from '@/libs/trpc/client';

class HomeSummaryService {
  getSummary = async (limit: number) => {
    const [topics, files] = await Promise.all([
      lambdaClient.topic.recentTopics.query({ limit }),
      lambdaClient.file.recentFiles.query({ limit }),
    ]);

    return {
      hasRecent: topics.length + files.length > 0,
      recentIds: [...topics.map((topic) => topic.id), ...files.map((file) => file.id)],
      total: topics.length + files.length,
    };
  };
}

export const homeSummaryService = new HomeSummaryService();

export type HomeSummary = Awaited<ReturnType<typeof homeSummaryService.getSummary>>;

export const isEmptyHome = (summary: HomeSummary) => !summary.hasRecent;
