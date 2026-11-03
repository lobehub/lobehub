import { generateRandomString, symmetricEncrypt } from 'better-auth/crypto';

export async function generateBackupCodes(secret: string) {
  const key = secret;
  const backupCodes = Array.from({ length: 10 })
    .fill(null)
    .map(() => generateRandomString(10, 'a-z', '0-9', 'A-Z'))
    .map((code) => `${code.slice(0, 5)}-${code.slice(5)}`);
  const encCodes = await symmetricEncrypt({
    data: JSON.stringify(backupCodes),
    key: key,
  });
  return encCodes;
}

// Helper function to safely convert timestamp to Date
export function safeDateConversion(timestamp?: number): Date {
  if (!timestamp) return new Date();

  const date = new Date(timestamp);

  // Check if the date is valid
  if (isNaN(date.getTime())) {
    console.warn(`Invalid timestamp: ${timestamp}, falling back to current date`);
    return new Date();
  }

  // Check for unreasonable dates (before 2000 or after 2100)
  const year = date.getFullYear();
  if (year < 2000 || year > 2100) {
    console.warn(`Suspicious date year: ${year}, falling back to current date`);
    return new Date();
  }

  return date;
}
