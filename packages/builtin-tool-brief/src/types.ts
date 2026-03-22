export const BriefApiName = {
  /** Create a brief to report progress, results, or request decisions */
  createBrief: 'createBrief',

  /** Pause execution and request user review */
  requestCheckpoint: 'requestCheckpoint',
} as const;

export type BriefApiNameType = (typeof BriefApiName)[keyof typeof BriefApiName];
