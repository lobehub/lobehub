import { type FileListItem } from '@/types/files';
import { type RecentTopic } from '@/types/topic';

export interface RecentState {
  isRecentPagesInit: boolean;
  isRecentResourcesInit: boolean;
  isRecentTopicsInit: boolean;
  recentPages: any[];
  recentResources: FileListItem[];
  recentTopics: RecentTopic[];
}

export const initialRecentState: RecentState = {
  isRecentPagesInit: false,
  isRecentResourcesInit: false,
  isRecentTopicsInit: false,
  recentPages: [],
  recentResources: [],
  recentTopics: [],
};
