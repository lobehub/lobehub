'use client';

import ProfileSkeleton from './Profile';
import type { SettingsTabSkeleton } from './types';

/** `/settings/security` redirects to `/settings`, which opens the profile. */
const SecuritySkeleton: SettingsTabSkeleton = { Body: ProfileSkeleton.Body };

export default SecuritySkeleton;
