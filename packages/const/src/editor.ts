/**
 * Editor-related constants shared across the application
 */

/**
 * Debounce time for editor auto-save in milliseconds (1000ms)
 * Balances between data safety and network efficiency
 * - Too short (< 500ms): excessive network requests
 * - Too long (> 2000ms): risk of data loss
 */
export const EDITOR_DEBOUNCE_TIME = 1000;

/**
 * Maximum time to wait before forcing a save (5000ms)
 * Even if user keeps typing, save after this duration
 */
export const EDITOR_MAX_WAIT = 5000;
