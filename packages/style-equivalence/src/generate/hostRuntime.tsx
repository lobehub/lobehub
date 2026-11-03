import { Component, type ComponentType, type ReactNode } from 'react';

import type { FilePlan } from '../plan/planFile';

type CaseRender = (combo: Record<string, boolean>) => ReactNode;
export type CaseModules = Record<string, { cases: Record<string, CaseRender> }>;

export type CaseSelection = { caseKey: string; combo: number } | { caseKeys: string[] };

const isSelected = (selection: CaseSelection | undefined, key: string, combo: number) =>
  !selection ||
  ('caseKeys' in selection
    ? selection.caseKeys.includes(key)
    : selection.caseKey === key && selection.combo === combo);

class Boundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render() {
    return this.state.error ? <div data-synthetic-error={this.state.error} /> : this.props.children;
  }
}

const CaseView = ({ combo, render }: { combo: Record<string, boolean>; render?: CaseRender }) =>
  render ? render(combo) : <div data-synthetic-error="CASE_RENDER_MISSING" />;

export const SECTION_WIDTH = 360;

export const CaseList = ({
  modules,
  plan,
  selection,
}: {
  modules: CaseModules;
  plan: FilePlan[];
  selection?: CaseSelection;
}) => (
  <main data-synthetic-cases="">
    {plan.flatMap((file) =>
      file.cases.flatMap((entry) =>
        entry.combos.map((combo, index) => {
          if (!isSelected(selection, entry.key, index)) return null;
          const key = `${entry.key}|${index}`;
          return (
            <section
              data-case={key}
              key={key}
              style={{
                boxSizing: 'border-box',
                padding: 8,
                position: 'relative',
                width: SECTION_WIDTH,
              }}
            >
              <Boundary>
                <CaseView combo={combo} render={modules[file.file]?.cases[entry.key]} />
              </Boundary>
            </section>
          );
        }),
      ),
    )}
  </main>
);

export const readSelection = (search: string): CaseSelection | undefined => {
  const params = new URLSearchParams(search);
  const caseKeys = params.get('cases');
  if (caseKeys) return { caseKeys: JSON.parse(caseKeys) as string[] };
  const caseKey = params.get('case');
  if (!caseKey) return undefined;
  return { caseKey, combo: Number(params.get('combo') ?? 0) };
};

export const HostApp = ({
  Host,
  modules,
  onReady,
  plan,
}: {
  Host: ComponentType<{ children: ReactNode }>;
  modules: CaseModules;
  onReady: () => void;
  plan: FilePlan[];
}) => (
  <Host>
    <CaseList modules={modules} plan={plan} selection={readSelection(location.search)} />
    <Ready onReady={onReady} />
  </Host>
);

class Ready extends Component<{ onReady: () => void }> {
  componentDidMount() {
    this.props.onReady();
  }

  render() {
    return null;
  }
}
