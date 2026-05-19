/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import ModelDetailPanel from './ModelDetailPanel';

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    actionText: 'actionText',
    container: 'container',
    originalPriceText: 'originalPriceText',
    priceValue: 'priceValue',
    row: 'row',
    titleText: 'titleText',
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Accordion: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AccordionItem: ({
    action,
    children,
    title,
  }: {
    action?: ReactNode;
    children?: ReactNode;
    title?: ReactNode;
  }) => (
    <section>
      <div>{title}</div>
      <div>{action}</div>
      <div>{children}</div>
    </section>
  ),
  Flexbox: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  Icon: () => <span />,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children, title }: { children: ReactNode; title?: ReactNode }) => (
    <span>
      {title}
      {children}
    </span>
  ),
}));

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: () => [],
}));

const globalState = {
  status: {
    modelDetailPanelExpandedKeys: ['pricing'],
  },
  updateModelDetailPanelExpandedKeys: vi.fn(),
};

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: typeof globalState) => unknown) => selector(globalState),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    modelDetailPanelExpandedKeys: (state: typeof globalState) =>
      state.status.modelDetailPanelExpandedKeys,
  },
}));

const translations: Record<string, string> = {
  'ModelSwitchPanel.detail.context': 'Context Length',
  'ModelSwitchPanel.detail.pricing': 'Pricing',
  'ModelSwitchPanel.detail.pricing.credits.input': 'Input {{amount}} credits/M tokens',
  'ModelSwitchPanel.detail.pricing.credits.output': 'Output {{amount}} credits/M tokens',
  'ModelSwitchPanel.detail.pricing.credits.perImage': '~ {{amount}} credits / image',
  'ModelSwitchPanel.detail.pricing.credits.perVideo': '~ {{amount}} credits / video',
  'ModelSwitchPanel.detail.pricing.credits.image': 'credits/img',
  'ModelSwitchPanel.detail.pricing.credits.millionTokens': 'credits/M tokens',
  'ModelSwitchPanel.detail.pricing.group.image': 'Image',
  'ModelSwitchPanel.detail.pricing.group.text': 'Text',
  'ModelSwitchPanel.detail.pricing.input': 'Input ${{amount}}/M',
  'ModelSwitchPanel.detail.pricing.output': 'Output ${{amount}}/M',
  'ModelSwitchPanel.detail.pricing.perImage': '~ ${{amount}} / image',
  'ModelSwitchPanel.detail.pricing.perVideo': '~ ${{amount}} / video',
  'ModelSwitchPanel.detail.pricing.unit.imageGeneration': 'Image Generation',
  'ModelSwitchPanel.detail.pricing.unit.textInput': 'Input',
  'ModelSwitchPanel.detail.pricing.unit.textOutput': 'Output',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const template = translations[key] ?? options?.defaultValue ?? key;

      return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name) => options?.[name] ?? '');
    },
  }),
}));

const textPricing = {
  currency: 'USD',
  units: [
    { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
  ],
};

const imagePricing = {
  approximatePricePerImage: 0.04,
  approximatePricePerVideo: 0.8,
  currency: 'USD',
  units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
};

const createEnabledList = (
  provider: string,
  pricing: Record<string, unknown>,
): EnabledProviderWithModels[] => [
  {
    children: [
      {
        abilities: {},
        contextWindowTokens: 1_000_000,
        displayName: 'Test Model',
        id: 'test-model',
        pricing,
        type: 'chat',
      } as any,
    ],
    id: provider,
    name: provider,
    source: 'builtin',
  },
];

describe('ModelDetailPanel pricing', () => {
  it('renders branding provider token pricing in credits', () => {
    const { container } = render(
      <ModelDetailPanel
        enabledList={createEnabledList('lobehub', textPricing)}
        model="test-model"
        provider="lobehub"
      />,
    );

    expect(screen.getByText('5M credits/M tokens')).toBeInTheDocument();
    expect(screen.getByText('25M credits/M tokens')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('$5.00');
  });

  it('keeps dollar pricing for non-branding providers', () => {
    const { container } = render(
      <ModelDetailPanel
        enabledList={createEnabledList('openai', textPricing)}
        model="test-model"
        provider="openai"
      />,
    );

    expect(container).toHaveTextContent('$5.00/M tokens');
    expect(container).toHaveTextContent('$25.00/M tokens');
    expect(container).not.toHaveTextContent('credits/M tokens');
  });

  it('renders branding provider image and video pricing in credits', () => {
    const imageResult = render(
      <ModelDetailPanel
        enabledList={createEnabledList('lobehub', imagePricing)}
        model="test-model"
        pricingMode="image"
        provider="lobehub"
      />,
    );

    expect(imageResult.container).toHaveTextContent('~ 40.0K credits / image');
    expect(imageResult.container).toHaveTextContent('40.0K credits/img');
    expect(imageResult.container).not.toHaveTextContent('$0.04');

    imageResult.unmount();

    const videoResult = render(
      <ModelDetailPanel
        enabledList={createEnabledList('lobehub', imagePricing)}
        model="test-model"
        pricingMode="video"
        provider="lobehub"
      />,
    );

    expect(videoResult.container).toHaveTextContent('~ 800.0K credits / video');
    expect(videoResult.container).not.toHaveTextContent('$0.80');
  });
});
