/**
 * Next.js wrapper module
 *
 * This module provides unified interfaces for Next.js-specific APIs,
 * making it easier to migrate from Next.js to other frameworks (e.g., Vite + React Router).
 *
 * Usage:
 * - import { useRouter, usePathname } from '@/libs/next/navigation';
 * - import Link from '@/libs/next/Link';
 * - import dynamic from '@/libs/next/dynamic';
 * - import Image from '@/libs/next/Image';
 *
 * @see RFC 147
 */

// Navigation exports
export * from './navigation';

// Component exports (re-export as named for convenience)
export { default as dynamic } from './dynamic';
export { default as Image } from './Image';
export { default as Link } from './Link';
