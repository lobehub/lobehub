'use client';

import { memo } from 'react';

/**
 * What can be done about a drive that is over its quota and refusing writes,
 * shown under the over-quota notice in the drive usage card.
 *
 * Nothing in the open-source build: a quota and paying for usage past it are
 * a hosted-service policy. Downstream builds override this module through
 * their own `@/business/...` mapping.
 */
const SandboxStorageOverQuotaAction = memo(() => null);

SandboxStorageOverQuotaAction.displayName = 'SandboxStorageOverQuotaAction';

export default SandboxStorageOverQuotaAction;
