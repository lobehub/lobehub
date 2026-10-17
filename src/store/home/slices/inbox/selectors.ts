import { type HomeStore } from '@/store/home/store';

import { HOME_DAILY_BRIEF_KEY, HOME_INBOX_KEY } from './projection';

/** Inbox topics; `undefined` until hydrated or fetched. */
const inboxTopics = (s: HomeStore) => s.homeInboxTopicsMap[HOME_INBOX_KEY];

/** Daily brief; `undefined` until hydrated or fetched. */
const dailyBrief = (s: HomeStore) => s.homeDailyBriefMap[HOME_DAILY_BRIEF_KEY];

export const homeInboxSelectors = {
  dailyBrief,
  inboxTopics,
};
