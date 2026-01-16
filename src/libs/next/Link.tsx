/**
 * Link component wrapper for Next.js Link.
 * This module provides a unified interface that can be easily replaced
 * with react-router-dom Link in the future.
 *
 * @see Phase 3.2: LOBE-2989
 */

// Re-export the Link component

// Re-export the type for props
export type { LinkProps } from 'next/link';
export { default } from 'next/link';
