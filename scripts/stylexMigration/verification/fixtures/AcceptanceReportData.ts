const svg = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="${fill}"/></svg>`,
  )}`;

const pair = (type: 'screenshot' | 'video', fileUrl: (role: string) => string, layout?: string) =>
  (['before', 'after'] as const).map((role) => ({
    description: `${role} capture`,
    fileName: null,
    fileUrl: fileUrl(role),
    id: `${type}-${role}`,
    metadata: { comparison: { id: type, label: `${type} ${role}`, layout, role } },
    type,
  }));

const evidenceFor = (variant: string) => {
  const layout = variant.startsWith('vertical') ? 'vertical' : undefined;
  return [
    ...pair('screenshot', (role) => svg(role === 'before' ? '#d33' : '#3a3'), layout),
    ...pair('video', () => 'data:video/mp4;base64,AAAA', layout),
  ];
};

const variant = () => new URL(location.href).searchParams.get('variant') ?? '';

export const useVerifyReportBundle = () => ({
  data: {
    isOwner: false,
    report: null,
    results: [
      {
        checkItemId: 'comparison',
        evidence: evidenceFor(variant()),
        id: 'comparison-result',
        metadata: null,
        required: true,
        status: 'passed',
        suggestion: null,
        title: 'Before and after',
        toulmin: null,
        verdict: 'passed',
      },
    ],
    run: {
      context: null,
      goal: null,
      id: 'fixture-run',
      metadata: null,
      plan: null,
      scenario: 'web',
      status: 'completed',
      title: 'Comparison fixture',
    },
  },
  error: undefined,
  isLoading: false,
  mutate: async () => {},
});

export const useTextFileLoader = () => ({ error: null, fileData: null, loading: false });

export const TerminalEvidenceCard = () => {
  throw new Error('UNMOUNTED_SIBLING_RENDERED_IN_STYLE_FIXTURE');
};
