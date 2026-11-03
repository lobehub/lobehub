// ------------------------ Time -----------------------------

export const MS = 1;

/**
 * `1000ms`
 */
export const SECOND = 1000 * MS;

/**
 * `60s`
 */
export const MINUTE = 60 * SECOND;

/**
 * `3600s`
 */
export const HOUR = 60 * MINUTE;

/**
 * `86400s`
 */
export const DAY = 24 * HOUR;

/**
 * `2592000s`
 */
export const MONTH = 30 * DAY;

/**
 * `31536000s`
 */
export const YEAR = 365 * DAY;

export const API_TEST_TIMEOUT = 10 * SECOND;

// ------------------------ Size -----------------------------

/**
 * `1024 bytes`
 */
export const KiB = 1024;

/**
 * `1024 KiB` (1,048,576 bytes)
 */
export const MiB = 1024 * KiB;

/**
 * `1024 MiB` (1,073,741,824 bytes)
 */
export const GiB = 1024 * MiB;

/**
 * `1024 GiB` (1,099,511,627,776 bytes)
 */
export const TiB = 1024 * GiB;

export const DOLLAR_PER_CREDIT = 0.003;
export const DOLLAR_PER_RMB = 0.14;
export const RMB_PER_CREDIT = DOLLAR_PER_RMB / DOLLAR_PER_CREDIT;
