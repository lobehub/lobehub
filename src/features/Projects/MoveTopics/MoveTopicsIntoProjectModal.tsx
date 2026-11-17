import { Button, Checkbox, createModal, Flexbox, Input, Text, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Avatar from '@/components/Avatar';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useClientDataSWR } from '@/libs/swr';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

import {
  groupCheckState,
  groupMovableTopics,
  toggleGroup,
  toggleTopic,
} from './movableTopicGroups';
import { RunProgress, RunResult } from './RunStatus';
import { useAssociateTopicsRun } from './useAssociateTopicsRun';

const movableTopicsKey = (projectId: string) => ['project-movable-topics', projectId] as const;

function MoveTopicsIntoProjectContent({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const request = useClientDataSWR(movableTopicsKey(projectId), () =>
    projectWorkingDirectoryService.listMovableTopics({ projectId }).then((res) => res.data),
  );
  const groups = useMemo(
    () => groupMovableTopics(request.data ?? [], keyword),
    [request.data, keyword],
  );
  const { progress, result, run, running } = useAssociateTopicsRun();

  if (progress) return <RunProgress progress={progress} />;
  if (result)
    return (
      <Flexbox>
        <RunResult result={result} />
        <Flexbox horizontal justify="flex-end">
          <Button type="primary" onClick={close}>
            {t('moveTopics.close')}
          </Button>
        </Flexbox>
      </Flexbox>
    );

  return (
    <Flexbox gap={12}>
      <Text type="secondary">{t('moveTopics.intoProjectDesc')}</Text>
      <Input
        allowClear
        aria-label={t('moveTopics.search')}
        placeholder={t('moveTopics.search')}
        prefix={<SearchIcon size={14} />}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />
      {request.error ? (
        <AsyncError error={request.error} onRetry={() => request.mutate()} />
      ) : !request.data ? (
        <SkeletonList rows={6} />
      ) : groups.length === 0 ? (
        <Flexbox align="center" paddingBlock={24}>
          <Text type="secondary">{keyword ? t('moveTopics.noMatch') : t('moveTopics.empty')}</Text>
        </Flexbox>
      ) : (
        <Flexbox gap={12} style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {groups.map((group) => {
            const state = groupCheckState(group, selected);
            return (
              <Flexbox gap={2} key={group.agentId}>
                <Checkbox
                  checked={state === 'all'}
                  indeterminate={state === 'some'}
                  onChange={() => setSelected((prev) => toggleGroup(group, prev))}
                >
                  <Flexbox horizontal align="center" gap={8}>
                    <Avatar
                      avatar={group.agentAvatar ?? undefined}
                      background={group.agentBackgroundColor ?? undefined}
                      size={20}
                      title={group.agentTitle ?? undefined}
                    />
                    <Text weight={500}>{group.agentTitle || t('moveTopics.untitledAgent')}</Text>
                    <Text fontSize={12} type="secondary">
                      {t('moveTopics.groupCount', { count: group.topics.length })}
                    </Text>
                  </Flexbox>
                </Checkbox>
                <Flexbox gap={2} paddingInline={'28px 0'}>
                  {group.topics.map((topic) => (
                    <Checkbox
                      checked={selected.has(topic.id)}
                      key={topic.id}
                      onChange={() => setSelected((prev) => toggleTopic(topic.id, prev))}
                    >
                      <Text ellipsis>{topic.title || t('moveTopics.untitledTopic')}</Text>
                    </Checkbox>
                  ))}
                </Flexbox>
              </Flexbox>
            );
          })}
        </Flexbox>
      )}
      <Flexbox horizontal align="center" gap={8} justify="flex-end">
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={selected.size === 0}
          loading={running}
          type="primary"
          onClick={async () => {
            await run(projectId, [...selected]);
            await request.mutate();
          }}
        >
          {t('moveTopics.submit', { count: selected.size })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

export const openMoveTopicsIntoProjectModal = (projectId: string) =>
  createModal({
    content: <MoveTopicsIntoProjectContent projectId={projectId} />,
    footer: null,
    title: t('moveTopics.intoProjectTitle', { ns: 'project' }),
    width: 'min(90%, 520px)',
  });
