/**
 * Image component wrapper for Next.js Image.
 * This module provides a unified interface that can be easily replaced
 * with a generic <img> or custom image component in the future.
 */

// Re-export the Image component

// Re-export types
export type { ImageProps, StaticImageData } from 'next/image';
export { default } from 'next/image';
