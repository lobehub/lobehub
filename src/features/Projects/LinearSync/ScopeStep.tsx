'use client';

import type { LinearIssueStateType } from '@lobechat/types';
import { LINEAR_ISSUE_STATE_TYPES } from '@lobechat/types';
import { Flexbox, Select, Text } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { linearKeys } from '@/features/Integrations/Linear/swrKeys';
import { linearService } from '@/services/linear';

import StateIcon from './StateIcon';
import type { LinearImportFilter } from './types';
import { linearSyncErrorMessage } from './utils';

const ALL_PROJECTS = '__all__';

interface ScopeStepProps {
  connectionId: string;
  onChange: (patch: Partial<LinearImportFilter>) => void;
  value: LinearImportFilter;
}

/** Step 1: which Linear issues to look at — a team, optionally one Linear project, and states. */
const ScopeStep = memo<ScopeStepProps>(({ connectionId, onChange, value }) => {
  const { t } = useTranslation('integration');

  const teams = useSWR(linearKeys.teams(connectionId), () => linearService.listTeams(connectionId));
  const projects = useSWR(
    value.teamId ? linearKeys.projects(connectionId, value.teamId) : null,
    () => linearService.listProjects(connectionId, value.teamId!),
  );

  const form = useForm();

  const stateOptions = LINEAR_ISSUE_STATE_TYPES.map((type) => ({
    label: (
      <Flexbox horizontal align={'center'} gap={6}>
        <StateIcon decorative name={t(`linear.sync.state.${type}`)} type={type} />
        {t(`linear.sync.state.${type}`)}
      </Flexbox>
    ),
    title: t(`linear.sync.state.${type}`),
    value: type,
  }));

  // A failed read belongs under the field it fills, not at the foot of the form.
  const fieldError = (error: unknown) =>
    error ? (
      <Text fontSize={12} type={'danger'}>
        {linearSyncErrorMessage(error, t)}
      </Text>
    ) : null;

  return (
    <Form form={form} gap={0} layout={'vertical'}>
      <Form.Field label={t('linear.sync.filter.team')}>
        <Flexbox gap={4}>
          <Select
            aria-label={t('linear.sync.filter.team')}
            loading={teams.isLoading}
            placeholder={t('linear.sync.filter.teamPlaceholder')}
            value={value.teamId}
            variant={'filled'}
            options={(teams.data ?? []).map((team) => ({
              label: `${team.name} (${team.key})`,
              value: team.id,
            }))}
            onChange={(teamId) => {
              const team = teams.data?.find((item) => item.id === teamId);
              onChange({
                linearProjectId: null,
                linearProjectName: null,
                teamId: team?.id ?? null,
                teamName: team?.name ?? null,
              });
            }}
          />
          {fieldError(teams.error)}
        </Flexbox>
      </Form.Field>
      <Form.Field
        desc={t('linear.sync.filter.projectHint')}
        label={t('linear.sync.filter.project')}
      >
        <Flexbox gap={4}>
          <Select
            aria-label={t('linear.sync.filter.project')}
            disabled={!value.teamId}
            loading={projects.isLoading}
            value={value.linearProjectId ?? ALL_PROJECTS}
            variant={'filled'}
            options={[
              { label: t('linear.sync.filter.allProjects'), value: ALL_PROJECTS },
              ...(projects.data ?? []).map((project) => ({
                label: project.name,
                value: project.id,
              })),
            ]}
            onChange={(projectId) => {
              const project = projects.data?.find((item) => item.id === projectId);
              onChange({
                linearProjectId: project?.id ?? null,
                linearProjectName: project?.name ?? null,
              });
            }}
          />
          {fieldError(projects.error)}
        </Flexbox>
      </Form.Field>
      <Form.Field
        desc={t('linear.sync.filter.statesHint')}
        label={t('linear.sync.filter.states')}
        style={{ marginBottom: 0 }}
      >
        <Select
          aria-label={t('linear.sync.filter.states')}
          mode={'multiple'}
          options={stateOptions}
          value={value.stateTypes}
          variant={'filled'}
          onChange={(types) => {
            const next = (Array.isArray(types) ? types : []) as LinearIssueStateType[];
            // At least one state, or nothing could ever match.
            if (next.length > 0) onChange({ stateTypes: next });
          }}
        />
      </Form.Field>
    </Form>
  );
});

ScopeStep.displayName = 'LinearImportScopeStep';

export default ScopeStep;
