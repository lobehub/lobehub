import { type RecentItem } from '@/server/routers/lambda/recent';
import { type FileListItem } from '@/types/files';
import { type RecentTopic } from '@/types/topic';

export interface RecentState {
  allRecentsDrawerOpen: boolean;
  isRecentPagesInit: boolean;
  isRecentResourcesInit: boolean;
  isRecentsInit: boolean;
  isRecentTopicsInit: boolean;
  recentPages: any[];
  recentResources: FileListItem[];
  recents: RecentItem[];
  recentTopics: RecentTopic[];
}

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  isRecentPagesInit: false,
  isRecentResourcesInit: false,
  isRecentTopicsInit: false,
  isRecentsInit: false,
  recentPages: [],
  recentResources: [],
  recentTopics: [],
  recents: [],
};
