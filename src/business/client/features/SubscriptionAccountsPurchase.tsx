'use client';

import { memo } from 'react';

/**
 * An optional entry rendered above the subscription account list; empty by
 * default.
 *
 * Nothing in the open-source build. Downstream builds override this module
 * through their own `@/business/...` mapping.
 */
const SubscriptionAccountsPurchase = memo(() => null);

SubscriptionAccountsPurchase.displayName = 'SubscriptionAccountsPurchase';

export default SubscriptionAccountsPurchase;
