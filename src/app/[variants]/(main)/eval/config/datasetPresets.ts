import type { LucideIcon } from 'lucide-react';
import { Database, Globe } from 'lucide-react';

export type PresetCategory = 'qa' | 'research' | 'tool-use' | 'memory' | 'reference' | 'custom';

export interface DatasetPreset {
  id: string;
  category: PresetCategory;
  name: string;
  description: string;
  icon: LucideIcon;

  // 格式说明
  formatDescription: string;
  requiredFields: string[];
  optionalFields: string[];

  // 示例文件
  exampleFileUrl?: string;

  // 自动推断配置
  fieldInference: {
    input: string[];
    expected: string[];
    choices: string[];
    category: string[];
    sortOrder?: string[];
  };

  // 验证规则
  validation?: {
    requireExpected?: boolean;
    requireChoices?: boolean;
    expectedFormat?: 'string' | 'string[]' | 'index';
  };
}

export const DATASET_PRESETS: Record<string, DatasetPreset> = {
  // === Deep Research / QA Category ===
  'browsecomp-zh': {
    id: 'browsecomp-zh',
    category: 'research',
    name: 'BrowseComp-ZH',
    description: 'Chinese web browsing: 289 multi-step reasoning questions',
    icon: Globe,
    formatDescription:
      'format: Topic (category/tags), Question (input), Answer (expected)',
    requiredFields: ['Question', 'Answer'],
    optionalFields: ['Topic', 'canary'],
    fieldInference: {
      input: ['Question', 'question', 'prompt'],
      expected: ['Answer', 'answer'],
      choices: [],
      category: ['Topic', 'topic', 'category'],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },

  xbench: {
    id: 'xbench',
    category: 'research',
    name: 'xbench',
    description: 'Chinese search: ~200 factual query questions',
    icon: Globe,
    formatDescription:
      'format: id (item number), prompt (input), type (metadata), answer (expected)',
    requiredFields: ['prompt', 'answer'],
    optionalFields: ['type', 'id'],
    fieldInference: {
      input: ['prompt', 'question', 'input'],
      expected: ['answer', 'response'],
      choices: [],
      category: ['type', 'category'],
      sortOrder: ['id'],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },

  // === Reference Formats (low priority) ===
  mmlu: {
    id: 'mmlu',
    category: 'reference',
    name: 'MMLU (Reference)',
    description: 'Multiple choice format (for reference only)',
    icon: Globe,
    formatDescription:
      'format: question, choices array (or A/B/C/D columns), answer (index/letter)',
    requiredFields: ['question', 'choices', 'answer'],
    optionalFields: ['subject', 'difficulty'],
    fieldInference: {
      input: ['question', 'prompt', 'query'],
      expected: ['answer', 'correct_answer', 'label'],
      choices: ['choices', 'options', 'A', 'B', 'C', 'D'],
      category: ['context', 'subject', 'category'],
    },
    validation: {
      requireExpected: true,
      requireChoices: true,
      expectedFormat: 'index',
    },
  },

  // === Custom ===
  custom: {
    id: 'custom',
    category: 'custom',
    name: 'Custom',
    description: 'Define your own field mapping',
    icon: Database,
    formatDescription:
      'Custom format - you define the mapping. Only requirement: must have an "input" field.',
    requiredFields: ['input'],
    optionalFields: ['expected', 'choices', 'category', 'metadata'],
    fieldInference: {
      input: ['input', 'question', 'prompt', 'query'],
      expected: ['expected', 'answer', 'output', 'response'],
      choices: ['choices', 'options'],
      category: ['category', 'type', 'topic', 'subject'],
    },
  },
};

export const getPresetById = (id?: string): DatasetPreset => {
  return DATASET_PRESETS[id || 'custom'] || DATASET_PRESETS.custom;
};

// 按 category 分组获取 Presets
export const getPresetsByCategory = (): Record<PresetCategory, DatasetPreset[]> => {
  const grouped: Record<string, DatasetPreset[]> = {
    research: [],
    'tool-use': [],
    memory: [],
    reference: [],
    custom: [],
  };

  Object.values(DATASET_PRESETS).forEach((preset) => {
    if (!grouped[preset.category]) {
      grouped[preset.category] = [];
    }
    grouped[preset.category].push(preset);
  });

  return grouped as Record<PresetCategory, DatasetPreset[]>;
};
