export type SiteDetection = { at: Date; state: 'seen' } | { state: 'waiting' };

export const getSiteDetection = (lastSeenAt: Date | string | null | undefined): SiteDetection =>
  lastSeenAt ? { at: new Date(lastSeenAt), state: 'seen' } : { state: 'waiting' };
