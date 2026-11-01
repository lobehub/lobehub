'use client';

import { Select } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { environmentService } from '@/services/environment';

interface EnvironmentSelectProps {
  disabled?: boolean;
  /** Narrow the list — to the environments this member may initialize a folder from, say. */
  filter?: (
    environment: Awaited<
      ReturnType<typeof environmentService.listEnvironments>
    >['environments'][number],
  ) => boolean;
  onChange: (environmentId: string | undefined) => void;
  /** Whose environments may be offered; a public agent cannot use a private one. */
  publishedOnly?: boolean;
  value?: string;
}

/**
 * Which code environment a folder goes with — optional, and "none" is the
 * first choice. The same list on every surface that picks a folder: what an
 * association does with it (initialize the folder on the drive, or only
 * remember it on a device) is the caller's business.
 */
const EnvironmentSelect = memo<EnvironmentSelectProps>(
  ({ disabled, filter, onChange, publishedOnly, value }) => {
    const { t } = useTranslation('device');
    const workspaceId = useActiveWorkspaceId();
    const { data, isLoading } = useSWR(['folder-environment-options', workspaceId ?? ''], () =>
      environmentService.listEnvironments(),
    );

    const environments = (data?.environments ?? []).filter(
      (environment) =>
        (!publishedOnly || !environment.workspaceId || environment.visibility === 'public') &&
        (!filter || filter(environment)),
    );

    return (
      <Select
        allowClear
        aria-label={t('workingDirectory.environment.label')}
        disabled={disabled}
        loading={isLoading}
        placeholder={t('workingDirectory.environment.none')}
        size={'small'}
        style={{ minWidth: 168 }}
        value={value}
        options={environments.map((environment) => ({
          label: environment.name,
          value: environment.id,
        }))}
        onChange={(next) => onChange((next as string | null | undefined) ?? undefined)}
      />
    );
  },
);

EnvironmentSelect.displayName = 'EnvironmentSelect';

export default EnvironmentSelect;
