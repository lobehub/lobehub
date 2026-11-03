/**
 * React Router wrapper module for SPA routing.
 *
 * This module provides unified interfaces for React Router APIs,
 * with a Next.js-like API surface for easier migration.
 *
 * Usage:
 * - import { useRouter, usePathname, useSearchParams } from '@/libs/router';
 * - import Link from '@/libs/router/Link';
 *
 * @see RFC 147
 */

// Navigation exports
export * from './navigation';

// Component exports
export { default as Link } from './Link';
