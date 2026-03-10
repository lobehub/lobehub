/**
 * Next.js wrapper module — SPA implementation
 *
 * Provides unified interfaces that map to react-router-dom / vanilla React
 * so that consumer code does not need framework-specific imports.
 */

// Navigation exports
export * from './navigation';

// Component exports
export { default as dynamic } from './dynamic';
export { default as Image } from './Image';
export { default as Link } from './Link';
