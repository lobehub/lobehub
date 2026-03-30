import type { LucideIcon } from 'lucide-react';
import { Database, Globe } from 'lucide-react';

export type PresetCategory = 'qa' | 'research' | 'tool-use' | 'memory' | 'reference' | 'custom';

export interface DatasetPreset {
  category: PresetCategory;
  description: string;
  // Example file
  exampleFileUrl?: string;
  // Auto-infer configuration
  fieldInference: {
    input: string[];
    expected: string[];
    choices: string[];
    category: string[];
    sortOrder?: string[];
  };
  // Format description
  formatDescription: string;

  icon: LucideIcon;
  id: string;
  name: string;

  optionalFields: string[];

  requiredFields: string[];

  // Validation rules
  validation?: {
    requireExpected?: boolean;
    requireChoices?: boolean;
    expectedFormat?: 'string' | 'string[]' | 'index';
  };
}

export const DATASET_PRESETS: Record<string, DatasetPreset> = {
  'browsecomp': {
    id: 'browsecomp',
    category: 'research',
    name: 'BrowseComp',
    description: 'Measuring the ability for agents to browse the web, comprises 1,266 questions.',
    icon: Globe,
    formatDescription: 'format: Topic (category/tags), Question (input), Answer (expected)',
    requiredFields: ['question', 'answer', 'problem_topic', 'canary'],
    optionalFields: ['case_id'],
    fieldInference: {
      input: ['question'],
      expected: ['answer'],
      choices: [],
      category: ['problem_topic'],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },
  // === Deep Research / QA Category ===
  'browsecomp-zh': {
    id: 'browsecomp-zh',
    category: 'research',
    name: 'BrowseComp-ZH',
    description: 'Chinese web browsing: 289 multi-step reasoning questions',
    icon: Globe,
    formatDescription: 'format: Topic (category/tags), Question (input), Answer (expected)',
    requiredFields: ['Question', 'Answer'],
    optionalFields: ['Topic', 'canary', 'case_id'],
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

  'widesearch': {
    id: 'widesearch',
    category: 'research',
    name: 'WideSearch',
    description:
      'Evaluating the capabilities of agents in broad information-seeking tasks, consisting of 200 questions.',
    icon: Globe,
    formatDescription: 'format: instance_id, query (input), evaluation (expected), language',
    requiredFields: ['instance_id', 'query', 'evaluation', 'language'],
    optionalFields: ['case_id'],
    fieldInference: {
      input: ['query'],
      expected: ['evaluation'],
      choices: [],
      category: ['language'],
      sortOrder: [],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },

  'hle-text': {
    id: 'hle-text',
    category: 'research',
    name: "Humanity's Last Exam, HLE (Text Only)",
    description:
      "Humanity's Last Exam (HLE) is a multi-modal benchmark at the frontier of human knowledge, consisting of 2150 questions.",
    icon: Globe,
    formatDescription:
      'format: id, question (input), answer (expected), answer_type, rationale, raw_subject, category',
    requiredFields: [
      'id',
      'question',
      'answer',
      'answer_type',
      'rationale',
      'raw_subject',
      'category',
    ],
    optionalFields: ['canary', 'case_id'],
    fieldInference: {
      input: ['question'],
      expected: ['answer'],
      choices: [],
      category: ['category'],
    },
  },

  'hle-verified': {
    id: 'hle-verified',
    category: 'research',
    name: "Humanity's Last Exam, HLE (Verified Answers)",
    description:
      "A subset of Humanity's Last Exam (HLE) with verified answers, designed to evaluate the ability to produce correct answers rather than just plausible ones.",
    icon: Globe,
    formatDescription:
      'format: id, question (input), answer (expected), answer_type, rationale, raw_subject, category, Verified_Classes',
    requiredFields: [
      'id',
      'question',
      'answer',
      'answer_type',
      'rationale',
      'raw_subject',
      'category',
      'Verified_Classes',
    ],
    optionalFields: ['canary', 'case_id'],
    fieldInference: {
      input: ['question'],
      expected: ['answer'],
      choices: [],
      category: ['category'],
    },
  },

  'deepsearchqa': {
    id: 'deepsearchqa',
    category: 'research',
    name: 'DeepSearchQA',
    description:
      'A 900-prompt factuality benchmark from Google DeepMind, designed to evaluate agents on difficult multi-step information-seeking tasks across 17 different fields.',
    icon: Globe,
    formatDescription: 'problem, problem_category, answer, answer_type',
    requiredFields: ['problem', 'answer', 'problem_category', 'answer_type'],
    optionalFields: ['case_id'],
    fieldInference: {
      input: ['problem'],
      expected: ['answer'],
      choices: [],
      category: ['problem_category'],
      sortOrder: [],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },

  'sealqa': {
    id: 'sealqa',
    category: 'research',
    name: 'SealQA',
    description:
      'SealQA is a new challenge benchmark for evaluating SEarch- Augmented Language models on fact-seeking questions where web search yields conflicting, noisy, or unhelpful results.',
    icon: Globe,
    formatDescription: 'format: question (input), answer (expected), topic (category)',
    requiredFields: ['question', 'answer', 'topic', 'canary'],
    optionalFields: ['case_id'],
    fieldInference: {
      input: ['question'],
      expected: ['answer'],
      choices: [],
      category: ['topic'],
    },
    validation: {
      requireExpected: true,
      expectedFormat: 'string',
    },
  },

  'xbench': {
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
  'mmlu': {
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
  'custom': {
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

// Get Presets grouped by category
export const getPresetsByCategory = (): Record<PresetCategory, DatasetPreset[]> => {
  const grouped: Record<string, DatasetPreset[]> = {
    'research': [],
    'tool-use': [],
    'memory': [],
    'reference': [],
    'custom': [],
  };

  Object.values(DATASET_PRESETS).forEach((preset) => {
    if (!grouped[preset.category]) {
      grouped[preset.category] = [];
    }
    grouped[preset.category].push(preset);
  });

  return grouped as Record<PresetCategory, DatasetPreset[]>;
};
