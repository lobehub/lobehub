import { customAlphabet } from 'nanoid/non-secure';

/**
 * Generate a market identifier (8-character lowercase alphanumeric string)
 * Format: [a-z0-9]{8}
 * @returns A unique 8-character market identifier
 */
export const generateMarketIdentifier = () => {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const generate = customAlphabet(alphabet, 8);
  return generate();
};

/**
 * Generate a default changelog based on current timestamp
 * @returns A timestamp-based changelog string
 */
export const generateDefaultChangelog = () => {
  const now = new Date();
  const formattedDate = now.toISOString().split('T')[0];
  return `Release ${formattedDate}`;
};
