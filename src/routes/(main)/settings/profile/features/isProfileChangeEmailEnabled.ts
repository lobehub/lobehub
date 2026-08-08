import { isCustomBranding } from '@/const/version';

/**
 * Whether Settings → Profile may expose the change-email entry point.
 * Hidden for Aico/Panachat custom branding for now; kept for upstream LobeHub.
 */
export const isProfileChangeEmailEnabled = (): boolean => !isCustomBranding;
