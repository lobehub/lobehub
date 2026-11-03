import { readFile } from 'node:fs/promises';

import { resolveDataPaths } from './config';
import type { ClerkUser, CSVUserRow } from './types';

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (values[index] ?? '').trim();
    });
    return record;
  });
}

export async function loadCSVData(path = resolveDataPaths().clerkCsvPath): Promise<CSVUserRow[]> {
  const csv = await readFile(path, 'utf8');
  const jsonData = parseCsv(csv);
  return jsonData as CSVUserRow[];
}

export async function loadClerkUsersFromFile(
  path = resolveDataPaths().clerkUsersPath,
): Promise<ClerkUser[]> {
  try {
    const file = await readFile(path, 'utf8');
    const parsed = JSON.parse(file) as ClerkUser[];

    if (!Array.isArray(parsed)) {
      throw new Error('Parsed Clerk users is not an array');
    }

    return parsed;
  } catch (error) {
    const hint = `
Failed to read Clerk users from ${path}.
请先运行: tsx scripts/clerk-to-betterauth/export-clerk-users-with-api.ts ${path}
    `.trim();
    throw new Error(`${(error as Error).message}\n${hint}`);
  }
}
