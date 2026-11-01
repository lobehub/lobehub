import { type ImportPgDataStructure } from '@/types/export';

export type ConfigFileParseResult =
  { data: ImportPgDataStructure; success: true } | { error: string; success: false };

export const parseConfigFile = async (file: File): Promise<ConfigFileParseResult> => {
  const text = await file.text();

  try {
    return { data: JSON.parse(text), success: true };
  } catch (error) {
    console.error(error);
    return {
      error: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
};
