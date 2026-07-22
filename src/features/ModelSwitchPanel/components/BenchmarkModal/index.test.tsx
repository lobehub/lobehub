/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ModelRating } from 'model-bank';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import BenchmarkModalContent from './index';

vi.mock('antd-style', () => ({
  createStaticStyles: () =>
    new Proxy({}, { get: (_target, prop: string) => prop }) as Record<string, string>,
  cssVar: new Proxy({}, { get: (_target, token) => `var(--${String(token)})` }),
}));

// recharts needs a measured container — stub the chart with its data flattened to text nodes
vi.mock('@lobehub/charts', () => ({
  RadarChart: ({ data }: { data: Record<string, unknown>[] }) => (
    <svg data-testid={'radar-chart'}>
      {data.map((row, i) => (
        <g key={i}>
          {Object.values(row).map((value, j) => (
            <text key={j}>{String(value)}</text>
          ))}
        </g>
      ))}
    </svg>
  ),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode }) => {
    const {
      horizontal: _h,
      align: _a,
      justify: _j,
      gap: _g,
      paddingBlock: _p,
      ...rest
    } = props as any;

    return <div {...rest}>{children}</div>;
  },
  Icon: () => <span />,
  Tooltip: ({ children, title }: { children: ReactNode; title?: ReactNode }) => (
    <span>
      <span data-testid={'tooltip'}>{title}</span>
      {children}
    </span>
  ),
}));

interface MockMenuItem {
  key: string;
  label: ReactNode;
  onClick: () => void;
}

vi.mock('@lobehub/ui/base-ui', () => ({
  createModal: vi.fn(),
  DropdownMenu: ({ children, items }: { children: ReactNode; items: MockMenuItem[] }) => (
    <div>
      {children}
      {items.map((item) => (
        <button key={item.key} type={'button'} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

// hoisted so the vi.mock factories below can reference it safely
const { translate } = vi.hoisted(() => {
  const translations: Record<string, string> = {
    'ModelSwitchPanel.detail.rating.dimension.agentic': 'Agentic',
    'ModelSwitchPanel.detail.rating.dimension.design': 'Design',
    'ModelSwitchPanel.detail.rating.dimension.intelligence': 'Intelligence',
    'ModelSwitchPanel.detail.rating.dimension.price': 'Price',
    'ModelSwitchPanel.detail.rating.dimension.speed': 'Speed',
    'ModelSwitchPanel.detail.rating.dimension.writing': 'Writing',
    'ModelSwitchPanel.detail.rating.modal.compare.add': 'Compare',
    'ModelSwitchPanel.detail.rating.modal.compare.limit': 'Compare up to {{count}} models',
    'ModelSwitchPanel.detail.rating.modal.rules.missing': 'rule missing',
    'ModelSwitchPanel.detail.rating.modal.rules.price': 'rule price',
    'ModelSwitchPanel.detail.rating.modal.rules.relative': 'rule relative',
    'ModelSwitchPanel.detail.rating.modal.rules.sources': 'rule sources',
    'ModelSwitchPanel.detail.rating.modal.rules.speed': 'rule speed',
    'ModelSwitchPanel.detail.rating.modal.rules.title': 'Scoring rules & notes',
    'ModelSwitchPanel.detail.rating.modal.table.dimension': 'Dimension',
    'ModelSwitchPanel.detail.rating.modal.table.raw': 'Raw value',
    'ModelSwitchPanel.detail.rating.modal.table.score': 'Score',
    'ModelSwitchPanel.detail.rating.modal.table.source': 'Source',
    'ModelSwitchPanel.detail.rating.modal.table.updatedAt': 'Updated',
  };

  return {
    translate: (key: string, options?: Record<string, unknown>) => {
      const template = translations[key] ?? key;

      return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? ''));
    },
  };
});

vi.mock('i18next', () => ({ t: translate }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

const score = (
  value: number,
  source: ModelRating['intelligence'] extends infer T
    ? T extends { source: infer S }
      ? S
      : never
    : never = 'artificial-analysis',
): NonNullable<ModelRating['intelligence']> => ({
  raw: value * 10,
  score: value,
  source,
  sourceUrl: 'https://example.com',
  updatedAt: '2026-07-10',
});

const fullRating = (base: number): ModelRating => ({
  agentic: score(base - 5),
  design: score(base - 10, 'design-arena'),
  intelligence: score(base),
  price: score(base - 20, 'lobehub'),
  speed: score(base - 15, 'lobehub'),
  writing: score(base - 2, 'lmarena'),
});

const ratings: Record<string, ModelRating | undefined> = {
  'model-a': fullRating(90),
  'model-b': fullRating(80),
  'model-c': fullRating(70),
  'model-d': fullRating(60),
  'model-e': { intelligence: score(50) },
  'unrated-model': undefined,
};

vi.mock('@/business/client/hooks/useBusinessModelRating', () => ({
  useBusinessModelRating:
    () =>
    ({ model }: { model?: string }) =>
      model ? ratings[model] : undefined,
}));

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: () => [
    {
      children: Object.keys(ratings).map((id) => ({
        abilities: {},
        displayName: id.toUpperCase(),
        id,
        type: 'chat',
      })),
      id: 'lobehub',
      name: 'LobeHub',
      source: 'builtin',
    },
  ],
}));

describe('BenchmarkModalContent', () => {
  it('renders the current model details with source, raw value and rules by default', () => {
    const { container } = render(
      <BenchmarkModalContent modelId={'model-a'} provider={'lobehub'} />,
    );

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('MODEL-A')).toBeInTheDocument();
    // detail table columns
    expect(screen.getByText('Raw value')).toBeInTheDocument();
    // intelligence + agentic rows both come from Artificial Analysis
    expect(screen.getAllByText('Artificial Analysis').length).toBe(2);
    expect(screen.getByText('900')).toBeInTheDocument();
    expect(screen.getAllByText('2026-07-10').length).toBeGreaterThan(0);
    // rules are collapsed behind a footer toggle by default
    expect(screen.getByText('Scoring rules & notes')).toBeInTheDocument();
    expect(screen.queryByText('rule relative')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Scoring rules & notes'));
    expect(screen.getByText('rule relative')).toBeInTheDocument();
    expect(screen.getByText('rule missing')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Scoring rules & notes'));
    expect(screen.queryByText('rule relative')).not.toBeInTheDocument();
  });

  it('marks missing dimensions with a dash in the detail table', () => {
    const { container } = render(
      <BenchmarkModalContent modelId={'model-e'} provider={'lobehub'} />,
    );

    // model-e only has intelligence — the other five dimension rows are dashed
    expect(container.querySelectorAll('.cellMissing').length).toBeGreaterThan(0);
    // radar vertex label + table row label
    expect(screen.getAllByText('Intelligence').length).toBe(2);
  });

  it('switches to a compare matrix when another model is added', () => {
    const { container } = render(
      <BenchmarkModalContent modelId={'model-a'} provider={'lobehub'} />,
    );

    fireEvent.click(screen.getByText('MODEL-B'));

    // matrix header shows both models, one polygon per series
    expect(screen.getAllByText('MODEL-B').length).toBeGreaterThan(1);
    expect(screen.getByText('Dimension')).toBeInTheDocument();
    // detail-only columns disappear in compare mode
    expect(screen.queryByText('Raw value')).not.toBeInTheDocument();
    // best-in-row highlighting: model-a wins every dimension, pill tinted with its series color
    expect(container.querySelectorAll('.bestPill').length).toBe(6);
  });

  it('caps the selection at four models', () => {
    render(<BenchmarkModalContent modelId={'model-a'} provider={'lobehub'} />);

    fireEvent.click(screen.getByText('MODEL-B'));
    fireEvent.click(screen.getByText('MODEL-C'));
    fireEvent.click(screen.getByText('MODEL-D'));

    // at the limit the picker collapses to a disabled button with a tooltip
    expect(screen.queryByRole('button', { name: 'MODEL-E' })).not.toBeInTheDocument();
    expect(screen.getByText('Compare up to 4 models')).toBeInTheDocument();
  });

  it('removes a compared model via its chip', () => {
    render(<BenchmarkModalContent modelId={'model-a'} provider={'lobehub'} />);

    fireEvent.click(screen.getByText('MODEL-B'));
    expect(screen.queryByText('Raw value')).not.toBeInTheDocument();

    const removeButtons = screen
      .getAllByRole('button')
      .filter((el) => el.classList.contains('chipRemove'));
    fireEvent.click(removeButtons[1]);

    // back to single-model detail view
    expect(screen.getByText('Raw value')).toBeInTheDocument();
  });
});
