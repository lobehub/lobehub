'use client';

import ProfileSkeleton from './Profile';
import type { SettingsTabSkeleton } from './types';

/** `/settings/security` redirects to `/settings/profile`. */
const SecuritySkeleton: SettingsTabSkeleton = { Body: ProfileSkeleton.Body };

export default SecuritySkeleton;
