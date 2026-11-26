import { Component, type ComponentType, type ReactNode } from 'react';

import type { FilePlan } from '../plan/planFile';

type CaseRender = (combo: Record<string, boolean | string>) => ReactNode;
export type CaseModules = Record<
  string,
  { cases: Record<string, CaseRender>; error?: string; unpaired?: Record<string, () => ReactNode> }
>;

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

const CaseView = ({
  combo,
  error,
  render,
}: {
  combo: Record<string, boolean | string>;
  error?: string;
  render?: CaseRender;
}) =>
  error ? (
    <div data-synthetic-error={error} />
  ) : render ? (
    render(combo)
  ) : (
    <div data-synthetic-error="CASE_RENDER_MISSING" />
  );

export const SECTION_WIDTH = 360;

export const INNER_BASELINE = ':where([data-synthetic-inner]){width:fit-content}';

const Section = ({ caseKey, children }: { caseKey: string; children: ReactNode }) => (
  <section
    data-case={caseKey}
    style={{ boxSizing: 'border-box', padding: 8, position: 'relative', width: SECTION_WIDTH }}
  >
    <Boundary>{children}</Boundary>
  </section>
);

const UnpairedView = ({ modules, selection }: { modules: CaseModules; selection: string }) => {
  const file = selection.slice(0, selection.indexOf('|unpaired:'));
  const render = modules[file]?.unpaired?.[selection];
  return (
    <Section caseKey={`${selection}|0`}>
      {modules[file]?.error ? (
        <div data-synthetic-error={modules[file].error} />
      ) : render ? (
        render()
      ) : (
        <div data-synthetic-error="CASE_RENDER_MISSING" />
      )}
    </Section>
  );
};

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
    <style>{INNER_BASELINE}</style>
    {selection && 'caseKey' in selection && selection.caseKey.includes('|unpaired:') ? (
      <UnpairedView modules={modules} selection={selection.caseKey} />
    ) : (
      plan.flatMap((file) =>
        file.cases.flatMap((entry) =>
          entry.combos.map((combo, index) => {
            if (!isSelected(selection, entry.key, index)) return null;
            const key = `${entry.key}|${index}`;
            return (
              <Section caseKey={key} key={key}>
                <CaseView
                  combo={combo}
                  error={modules[file.file]?.error}
                  render={modules[file.file]?.cases[entry.key]}
                />
              </Section>
            );
          }),
        ),
      )
    )}
  </main>
);

export const readSelection = (search: string, hash = ''): CaseSelection | undefined => {
  const params = new URLSearchParams(search);
  const caseKeys = new URLSearchParams(hash.replace(/^#/, '')).get('cases') ?? params.get('cases');
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
    <CaseList
      modules={modules}
      plan={plan}
      selection={readSelection(location.search, location.hash)}
    />
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
