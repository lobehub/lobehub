// Fixture: the same dependency as a static top-level import.
import { TopicSummaryService } from './TopicSummaryService';

export const summarizeTopic = async (topicId: string) => new TopicSummaryService().run(topicId);
