'use client';

/**
 * Advanced (developer) settings mirrored under
 * `/:workspaceSlug/settings/advanced`. User-scoped preferences; the page
 * renders its own header (it is not a compact-header tab on the personal
 * surface either), so it is re-exported as is.
 */
export { default } from '@/features/Settings/advanced';
