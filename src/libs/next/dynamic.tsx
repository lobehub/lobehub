/**
 * Dynamic import wrapper for Next.js dynamic.
 * This module provides a unified interface that can be easily replaced
 * with React.lazy + Suspense in the future.
 *
 * @see Phase 3.3
 */

// Re-export the dynamic function

// Re-export types
export type { DynamicOptions, Loader, LoaderComponent } from 'next/dynamic';
export { default } from 'next/dynamic';
