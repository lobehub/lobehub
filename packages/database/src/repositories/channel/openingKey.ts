/** Request key prefix of the acknowledgement a job posted before its run. */
export const OPENING_REQUEST_KEY_PREFIX = 'opening:';

/** Request key of the acknowledgement a job posted before its run. */
export const openingRequestKey = (jobId: string) => `${OPENING_REQUEST_KEY_PREFIX}${jobId}`;
