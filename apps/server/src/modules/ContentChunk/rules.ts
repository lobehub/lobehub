export type ChunkingService = 'unstructured' | 'doc2x' | 'default';

export const ChunkingRuleParser = {
  parse(rulesStr: string): Record<string, ChunkingService[]> {
    const rules: Record<string, ChunkingService[]> = {};

    // Split by semicolon for different file types
    const fileTypeRules = rulesStr.split(';');

    for (const rule of fileTypeRules) {
      const [fileType, services] = rule.split('=');
      if (!fileType || !services) continue;

      // Split services by comma and validate each service
      rules[fileType.toLowerCase()] = services
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is ChunkingService => ['unstructured', 'doc2x', 'default'].includes(s));
    }

    return rules;
  },
} as const;
