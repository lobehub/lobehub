import type { ReactNode } from 'react';

/**
 * Whether the home usage widget exists for this deployment/viewer. Gates the
 * customize-panel switch and the rail-visibility math, so an unavailable
 * widget never leaves a dead toggle or an empty rail behind.
 */
export const useHomeUsageWidgetActive = (): boolean => false;

/**
 * The usage widget's content, rendered as the last card of Home's rail.
 * `enabled` is false while the widget is switched off or its column is not on
 * the page, so implementations can skip fetching; returning `undefined`
 * renders no card at all.
 */
export const useHomeUsageWidget = (_enabled: boolean): ReactNode | undefined => undefined;
