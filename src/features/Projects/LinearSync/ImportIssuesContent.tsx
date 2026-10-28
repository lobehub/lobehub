'use client';

import { Button, Flexbox, Icon, Text, toast, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { ChevronLeftIcon, InfoIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { linearKeys } from '@/features/Integrations/Linear/swrKeys';
import { linearService } from '@/services/linear';

import IssueList from './IssueList';
import RunStep from './RunStep';
import ScopeStep from './ScopeStep';
import {
  initialImportFilter,
  type LinearImportFilter,
  type LinearIssueImportModalOptions,
} from './types';
import { jobsShownInDialog, useLinearSyncJobs } from './useLinearSyncJobs';
import { isActiveLinearSyncJob, linearSyncErrorMessage } from './utils';

type Step = 'scope' | 'issues' | 'run';

/**
 * Import Linear issues into the project in three steps: pick the scope (team,
 * Linear project, states), pick issues — or save the scope as a rule and sync
 * all of it — then watch the sync. The sync runs in the background, so the
 * dialog can be closed while it works. Linear is only read.
 */
const ImportIssuesContent = memo<LinearIssueImportModalOptions>(
  ({ connection, onSynced, projectId }) => {
    const { t } = useTranslation('integration');
    const { close } = useModalContext();
    const [step, setStep] = useState<Step>('scope');
    const [filter, setFilter] = useState<LinearImportFilter>(initialImportFilter);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [starting, setStarting] = useState<'import' | 'rule' | null>(null);
    const [jobId, setJobId] = useState<string>();
    // Shown as the running title until the job loads, so a single import never reads as a rule sync.
    const [startedIssueCount, setStartedIssueCount] = useState<number>();
    // A rule saved by a start that then failed; retrying runs it instead of saving another.
    const [savedRuleId, setSavedRuleId] = useState<string>();
    // Without the project list, "All projects" may be a mistake; wait for it.
    const { error: projectsError, isLoading: projectsLoading } = useSWR(
      filter.teamId ? linearKeys.projects(connection.id, filter.teamId) : null,
    );
    const jobs = useLinearSyncJobs(projectId);
    const job = jobId ? jobs.data?.find((item) => item.id === jobId) : undefined;
    const running = !!jobId && (!job || isActiveLinearSyncJob(job));

    // While this dialog shows the job, the background notifier stays quiet.
    useEffect(() => {
      if (!jobId) return;
      jobsShownInDialog.add(jobId);
      return () => {
        jobsShownInDialog.delete(jobId);
      };
    }, [jobId]);

    const updateFilter = (patch: Partial<LinearImportFilter>) => {
      setFilter((current) => ({ ...current, ...patch }));
      setSavedRuleId(undefined);
      // The list changes with the scope; a hidden selection would import blind.
      setSelected(new Set());
    };

    const changeSelection = (ids: string[], checked: boolean) =>
      setSelected((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return next;
      });

    const start = async (kind: 'import' | 'rule', action: () => Promise<{ id: string }>) => {
      setStarting(kind);
      try {
        const { id } = await action();
        setStartedIssueCount(kind === 'import' ? selected.size : undefined);
        setJobId(id);
        setStep('run');
        await jobs.mutate();
        onSynced?.();
      } catch (error) {
        toast.error(linearSyncErrorMessage(error, t));
      } finally {
        setStarting(null);
      }
    };

    const importSelected = () =>
      start('import', () =>
        linearService.startImport({
          connectionId: connection.id,
          issueIds: [...selected],
          projectId,
        }),
      );

    const syncAll = () =>
      start('rule', async () => {
        let ruleId = savedRuleId;
        if (!ruleId) {
          const rule = await linearService.createSyncRule({
            connectionId: connection.id,
            linearProjectId: filter.linearProjectId,
            linearProjectName: filter.linearProjectName,
            projectId,
            stateTypes: filter.stateTypes,
            teamId: filter.teamId!,
            teamName: filter.teamName!,
          });
          ruleId = rule.id;
          setSavedRuleId(rule.id);
        }
        return linearService.startRuleSync(ruleId);
      });

    const leaveRunning = () => {
      toast.info(t('linear.sync.job.continuesInBackground'));
      close();
    };

    const scopeLabel = [
      filter.teamName,
      filter.linearProjectName ?? t('linear.sync.filter.allProjects'),
      t('linear.sync.filter.statesSummary', { count: filter.stateTypes.length }),
    ].join(' · ');

    const footer = (() => {
      if (step === 'scope') {
        return (
          <Button
            disabled={!filter.teamId || projectsLoading || !!projectsError}
            type={'primary'}
            onClick={() => setStep('issues')}
          >
            {t('linear.sync.wizard.next')}
          </Button>
        );
      }
      if (step === 'issues') {
        return (
          <>
            <Button
              disabled={starting !== null}
              icon={<Icon icon={ChevronLeftIcon} />}
              style={{ marginInlineEnd: 'auto' }}
              type={'text'}
              onClick={() => setStep('scope')}
            >
              {t('linear.sync.wizard.back')}
            </Button>
            <Button
              disabled={starting === 'import'}
              loading={starting === 'rule'}
              title={t('linear.sync.modal.saveRuleHint')}
              onClick={syncAll}
            >
              {t('linear.sync.modal.saveRule')}
            </Button>
            <Button
              disabled={selected.size === 0 || starting === 'rule'}
              loading={starting === 'import'}
              type={'primary'}
              onClick={importSelected}
            >
              {selected.size > 0
                ? t('linear.sync.modal.importSelected', { count: selected.size })
                : t('linear.sync.modal.importNone')}
            </Button>
          </>
        );
      }
      return null;
    })();

    // The run step's buttons sit under its result, the main one as primary.
    const runActions = (() => {
      if (running) {
        return (
          <Button type={'primary'} onClick={leaveRunning}>
            {t('linear.sync.job.leave')}
          </Button>
        );
      }
      if (job?.status === 'error') {
        return (
          <>
            <Button onClick={close}>{t('linear.sync.job.close')}</Button>
            <Button type={'primary'} onClick={() => setStep('issues')}>
              {t('linear.sync.wizard.back')}
            </Button>
          </>
        );
      }
      return (
        <Button type={'primary'} onClick={close}>
          {t('linear.sync.job.close')}
        </Button>
      );
    })();

    return (
      <Flexbox gap={20}>
        {step === 'scope' ? (
          <ScopeStep connectionId={connection.id} value={filter} onChange={updateFilter} />
        ) : null}

        {step === 'issues' ? (
          <Flexbox gap={12}>
            <Text ellipsis fontSize={12} type={'secondary'}>
              {scopeLabel}
            </Text>
            <IssueList
              disabled={starting !== null}
              selected={selected}
              filter={{
                connectionId: connection.id,
                linearProjectId: filter.linearProjectId,
                stateTypes: filter.stateTypes,
                teamId: filter.teamId!,
              }}
              onSelectionChange={changeSelection}
            />
          </Flexbox>
        ) : null}

        {step === 'run' ? (
          <RunStep actions={runActions} job={job} pendingIssueCount={startedIssueCount} />
        ) : null}

        {step === 'run' ? null : (
          <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
            {step === 'scope' ? (
              <Flexbox horizontal align={'center'} flex={1} gap={6} style={{ minWidth: 0 }}>
                <Icon color={cssVar.colorTextTertiary} icon={InfoIcon} size={14} />
                <Text ellipsis fontSize={12} type={'secondary'}>
                  {t('linear.sync.modal.oneWayHint')}
                </Text>
              </Flexbox>
            ) : null}
            {footer}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

ImportIssuesContent.displayName = 'LinearImportIssuesContent';

export default ImportIssuesContent;
