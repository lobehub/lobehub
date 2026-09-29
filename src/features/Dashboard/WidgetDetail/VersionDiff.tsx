'use client';

import { CodeDiff, Flexbox } from '@lobehub/ui';
import { Select, Text } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import type { DashboardWidgetVersionItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { defaultDiffPair } from '../WidgetPreview/previewWidget';

const RUNTIME_LANGUAGE: Record<string, string> = {
  bash: 'bash',
  node: 'javascript',
  python: 'python',
};

/** A diff reads as a change to the code, not to a missing trailing newline. */
const withTrailingNewline = (value: string) =>
  value === '' || value.endsWith('\n') ? value : `${value}\n`;

/**
 * Show every line. Widget scripts are short, and the collapsed-context
 * separator of the diff renderer is a hardcoded English label ("N unmodified
 * lines") that cannot be localized.
 */
const DIFF_OPTIONS = { expandUnchanged: true };

/** The declarative half of a version: everything besides the script. */
const contractOf = (version: DashboardWidgetVersionItem) =>
  JSON.stringify(
    {
      manifest: version.manifest ?? null,
      outputType: version.outputType,
      runtime: version.runtime,
      view: version.view ?? null,
    },
    null,
    2,
  );

interface ScriptDiffProps {
  base?: DashboardWidgetVersionItem;
  target: DashboardWidgetVersionItem;
}

/** Script and contract changes from `base` to `target`; the whole script when there is no base. */
export const ScriptDiff = memo<ScriptDiffProps>(({ base, target }) => {
  const { t } = useTranslation('dashboard');
  const language = RUNTIME_LANGUAGE[target.runtime] ?? 'plaintext';
  const baseContract = base ? contractOf(base) : undefined;
  const targetContract = contractOf(target);
  const sameScript = base?.script === target.script;

  return (
    <Flexbox data-version-diff gap={12}>
      {sameScript ? (
        <Text fontSize={12} type={'secondary'}>
          {t('portal.diff.identical')}
        </Text>
      ) : (
        <CodeDiff
          diffOptions={DIFF_OPTIONS}
          language={language}
          newContent={withTrailingNewline(target.script)}
          oldContent={withTrailingNewline(base?.script ?? '')}
          showHeader={false}
          viewMode={'unified'}
        />
      )}
      {base && baseContract !== targetContract && (
        <Flexbox gap={6}>
          <Text fontSize={12} weight={500}>
            {t('portal.diff.manifest')}
          </Text>
          <CodeDiff
            diffOptions={DIFF_OPTIONS}
            language={'json'}
            newContent={withTrailingNewline(targetContract)}
            oldContent={withTrailingNewline(baseContract!)}
            showHeader={false}
            viewMode={'unified'}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

ScriptDiff.displayName = 'DashboardScriptDiff';

interface VersionDiffProps {
  /** Version to review first; defaults to the newest. */
  targetVersionId?: string;
  widgetId: string;
}

/** Pick any two versions of a widget and compare their scripts and contracts. */
const VersionDiff = memo<VersionDiffProps>(({ widgetId, targetVersionId }) => {
  const { t } = useTranslation('dashboard');
  const useFetchWidgetVersions = useDashboardStore((s) => s.useFetchWidgetVersions);
  const { data, error, isLoading, mutate } = useFetchWidgetVersions(widgetId);
  const versions = useDashboardStore(dashboardSelectors.widgetVersions(widgetId));
  const [picked, setPicked] = useState<{ baseId?: string; targetId?: string }>({});

  const fallback = defaultDiffPair(versions, targetVersionId);
  const targetId = picked.targetId ?? fallback.targetId;
  const baseId = picked.baseId ?? fallback.baseId;
  const target = versions.find((version) => version.id === targetId);
  const base = versions.find((version) => version.id === baseId);

  const options = versions.map((version) => ({
    label: `v${version.version} · ${t(`version.status.${version.status}`)}`,
    value: version.id,
  }));

  return (
    <AsyncBoundary
      data={data}
      error={error}
      isEmpty={data?.length === 0}
      isLoading={isLoading}
      empty={
        <Text fontSize={12} type={'secondary'}>
          {t('version.empty')}
        </Text>
      }
      onRetry={() => void mutate()}
    >
      {versions.length < 2 || !target ? (
        <Flexbox gap={8}>
          <Text fontSize={12} type={'secondary'}>
            {t('portal.diff.single')}
          </Text>
          {target && <ScriptDiff target={target} />}
        </Flexbox>
      ) : (
        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <Text fontSize={12} type={'secondary'}>
              {t('portal.diff.base')}
            </Text>
            <Select
              options={options}
              size={'small'}
              value={baseId}
              onChange={(value) => setPicked({ baseId: String(value), targetId })}
            />
            <Text fontSize={12} type={'secondary'}>
              {t('portal.diff.target')}
            </Text>
            <Select
              options={options}
              size={'small'}
              value={targetId}
              onChange={(value) => setPicked({ baseId, targetId: String(value) })}
            />
          </Flexbox>
          <ScriptDiff base={base} target={target} />
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

VersionDiff.displayName = 'DashboardVersionDiff';

export default VersionDiff;
