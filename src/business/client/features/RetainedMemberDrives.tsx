'use client';

import { memo } from 'react';

/**
 * The personal drives a workspace keeps for members who left, shown to an
 * owner or admin under the members' usage in the drive usage card.
 *
 * Nothing in the open-source build: keeping a departed member's drive for a
 * retention window, and deleting or moving it, is a hosted-service policy.
 * Downstream builds override this module through their own `@/business/...`
 * mapping.
 */
const RetainedMemberDrives = memo(() => null);

RetainedMemberDrives.displayName = 'RetainedMemberDrives';

export default RetainedMemberDrives;
