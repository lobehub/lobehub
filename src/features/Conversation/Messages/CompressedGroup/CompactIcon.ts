import { createLucideIcon } from 'lucide-react';

/**
 * Compressed-context mark: two opposite corner brackets around two lines of
 * text, after Codex's compaction row. Lucide has no equivalent
 * (`ScanText` draws four corners and three lines).
 */
export const CompactIcon = createLucideIcon('compact', [
  ['path', { d: 'M5 5v12a2 2 0 0 0 2 2h4', key: 'left' }],
  ['path', { d: 'M13 5h4a2 2 0 0 1 2 2v12', key: 'right' }],
  ['path', { d: 'M9 11h6', key: 'long' }],
  ['path', { d: 'M9 14.5h3.5', key: 'short' }],
]);
