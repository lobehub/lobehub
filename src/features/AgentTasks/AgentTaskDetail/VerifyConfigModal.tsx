'use client';

import type { RequiredEvidenceSpec, TaskVerifyConfig, VerifierType } from '@lobechat/types';
import { verifierTypes, verifyEvidenceTypes } from '@lobechat/types';
import { Block, Button, Flexbox, Input, InputNumber, Select, Text } from '@lobehub/ui';
import { createModal, type ModalInstance, Switch, useModalContext } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { Plus } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCriteria, useRubrics } from '@/features/Verify/hooks';
import { verifyService } from '@/services/verify';
import { useTaskStore } from '@/store/task';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

interface VerifyConfigContentProps {
  initial?: TaskVerifyConfig;
  taskId: string;
}

const labelStyle = { marginBottom: 4 } as const;

/** Inline "new criterion" mini-form, toggled by the ＋ affordance. */
const CreateCriterionInline = memo<{
  onCreated: (id: string) => void;
  refresh: () => Promise<unknown>;
}>(({ onCreated, refresh }) => {
  const { t: tChat } = useTranslation('chat');
  const [title, setTitle] = useState('');
  const [verifierType, setVerifierType] = useState<VerifierType>('llm');
  const [requiredEvidence, setRequiredEvidence] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleCreate = useCallback(async () => {
    const name = title.trim();
    if (!name || loading) return;
    setLoading(true);
    try {
      const evidence: RequiredEvidenceSpec[] = requiredEvidence.map((type) => ({
        type: type as RequiredEvidenceSpec['type'],
      }));
      const created = await verifyService.createCriterion({
        title: name,
        verifierConfig: evidence.length > 0 ? { requiredEvidence: evidence } : undefined,
        verifierType,
      });
      await refresh();
      onCreated(created.id);
      setTitle('');
      setRequiredEvidence([]);
    } finally {
      setLoading(false);
    }
  }, [title, verifierType, requiredEvidence, loading, onCreated, refresh]);

  return (
    <Flexbox gap={8} style={{ marginTop: 8 }}>
      <Input
        placeholder={tChat('verifyConfig.createCriterionTitle')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onPressEnter={handleCreate}
      />
      <Flexbox horizontal gap={8}>
        <Select
          style={{ width: 120 }}
          value={verifierType}
          options={verifierTypes.map((type) => ({
            label: tChat(`verifyConfig.verifierType.${type}` as const),
            value: type,
          }))}
          onChange={(v) => setVerifierType(v as VerifierType)}
        />
        <Select
          mode={'multiple'}
          options={verifyEvidenceTypes.map((type) => ({ label: type, value: type }))}
          placeholder={tChat('verifyConfig.requiredEvidence')}
          style={{ flex: 1 }}
          value={requiredEvidence}
          onChange={setRequiredEvidence}
        />
        <Button disabled={!title.trim()} loading={loading} onClick={handleCreate}>
          {tChat('verifyConfig.create')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

CreateCriterionInline.displayName = 'CreateCriterionInline';

/** Inline "new rubric" mini-form, toggled by the ＋ affordance. */
const CreateRubricInline = memo<{
  criterionIds: string[];
  onCreated: (id: string) => void;
  refresh: () => Promise<unknown>;
}>(({ criterionIds, onCreated, refresh }) => {
  const { t: tChat } = useTranslation('chat');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = useCallback(async () => {
    const name = title.trim();
    if (!name || loading) return;
    setLoading(true);
    try {
      const created = await verifyService.createRubric({ title: name });
      if (criterionIds.length > 0) {
        await verifyService.setRubricCriteria(
          created.id,
          criterionIds.map((criterionId) => ({ criterionId })),
        );
      }
      await refresh();
      onCreated(created.id);
      setTitle('');
    } finally {
      setLoading(false);
    }
  }, [title, loading, criterionIds, onCreated, refresh]);

  return (
    <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
      <Input
        placeholder={tChat('verifyConfig.createRubricTitle')}
        style={{ flex: 1 }}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onPressEnter={handleCreate}
      />
      <Button disabled={!title.trim()} loading={loading} onClick={handleCreate}>
        {tChat('verifyConfig.create')}
      </Button>
    </Flexbox>
  );
});

CreateRubricInline.displayName = 'CreateRubricInline';

const VerifyConfigContent = memo<VerifyConfigContentProps>(({ taskId, initial }) => {
  const { t: tChat } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const { close } = useModalContext();

  const { data: rubrics, mutate: mutateRubrics } = useRubrics();
  const { data: criteria, mutate: mutateCriteria } = useCriteria();

  const [enabled, setEnabled] = useState(initial?.enabled !== false);
  const [verifierAgentId, setVerifierAgentId] = useState<string | undefined>(
    initial?.verifierAgentId,
  );
  const [verifyRubricId, setVerifyRubricId] = useState<string | undefined>(initial?.verifyRubricId);
  const [verifyCriteriaIds, setVerifyCriteriaIds] = useState<string[]>(
    initial?.verifyCriteriaIds ?? [],
  );
  const [maxIterations, setMaxIterations] = useState<number | undefined>(initial?.maxIterations);
  const [saving, setSaving] = useState(false);
  const [showCreateCriterion, setShowCreateCriterion] = useState(false);
  const [showCreateRubric, setShowCreateRubric] = useState(false);

  const agentMeta = useAgentDisplayMeta(verifierAgentId);

  const rubricOptions = useMemo(
    () => (rubrics ?? []).map((r) => ({ label: r.title, value: r.id })),
    [rubrics],
  );
  const criteriaOptions = useMemo(
    () => (criteria ?? []).map((c) => ({ label: c.title, value: c.id })),
    [criteria],
  );

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await useTaskStore.getState().updateVerifyConfig(taskId, {
        enabled,
        maxIterations: maxIterations ?? null,
        verifierAgentId: verifierAgentId ?? null,
        verifyCriteriaIds: verifyCriteriaIds.length > 0 ? verifyCriteriaIds : null,
        verifyRubricId: verifyRubricId ?? null,
      });
      close();
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    taskId,
    enabled,
    maxIterations,
    verifierAgentId,
    verifyCriteriaIds,
    verifyRubricId,
    close,
  ]);

  return (
    <Flexbox gap={16}>
      {/* enable */}
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text weight={500}>{tChat('verifyConfig.enable')}</Text>
        <Switch checked={enabled} onChange={setEnabled} />
      </Flexbox>

      {/* review agent */}
      <Flexbox>
        <Text style={labelStyle} type={'secondary'}>
          {tChat('verifyConfig.reviewAgent')}
        </Text>
        <AssigneeAgentSelector
          currentAgentId={verifierAgentId}
          onChange={(id) => setVerifierAgentId(id)}
        >
          <Block
            clickable
            horizontal
            align={'center'}
            gap={8}
            paddingBlock={6}
            paddingInline={11}
            style={{ minHeight: 36 }}
            variant={'outlined'}
          >
            {verifierAgentId ? (
              <>
                <AssigneeAvatar agentId={verifierAgentId} size={20} />
                <Text weight={500}>{agentMeta?.title}</Text>
              </>
            ) : (
              <Text type={'secondary'}>{tChat('verifyConfig.reviewAgentPlaceholder')}</Text>
            )}
          </Block>
        </AssigneeAgentSelector>
      </Flexbox>

      {/* rubric */}
      <Flexbox>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} style={labelStyle}>
          <Text type={'secondary'}>{tChat('verifyConfig.rubric')}</Text>
          <Button
            icon={Plus}
            size={'small'}
            type={'text'}
            onClick={() => setShowCreateRubric((v) => !v)}
          >
            {tChat('verifyConfig.createRubric')}
          </Button>
        </Flexbox>
        <Select
          allowClear
          options={rubricOptions}
          placeholder={tChat('verifyConfig.rubricPlaceholder')}
          value={verifyRubricId}
          onChange={(v) => setVerifyRubricId(v ?? undefined)}
        />
        {showCreateRubric ? (
          <CreateRubricInline
            criterionIds={verifyCriteriaIds}
            refresh={mutateRubrics}
            onCreated={(id) => {
              setVerifyRubricId(id);
              setShowCreateRubric(false);
            }}
          />
        ) : null}
      </Flexbox>

      {/* ad-hoc criteria */}
      <Flexbox>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} style={labelStyle}>
          <Text type={'secondary'}>{tChat('verifyConfig.criteria')}</Text>
          <Button
            icon={Plus}
            size={'small'}
            type={'text'}
            onClick={() => setShowCreateCriterion((v) => !v)}
          >
            {tChat('verifyConfig.createCriterion')}
          </Button>
        </Flexbox>
        <Select
          allowClear
          mode={'multiple'}
          options={criteriaOptions}
          placeholder={tChat('verifyConfig.criteriaPlaceholder')}
          value={verifyCriteriaIds}
          onChange={(v) => setVerifyCriteriaIds(v ?? [])}
        />
        {showCreateCriterion ? (
          <CreateCriterionInline
            refresh={mutateCriteria}
            onCreated={(id) => {
              setVerifyCriteriaIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
              setShowCreateCriterion(false);
            }}
          />
        ) : null}
      </Flexbox>

      {/* max iterations */}
      <Flexbox>
        <Text style={labelStyle} type={'secondary'}>
          {tChat('verifyConfig.maxIterations')}
        </Text>
        <InputNumber
          max={10}
          min={1}
          style={{ width: 160 }}
          value={maxIterations}
          onChange={(v) => setMaxIterations(typeof v === 'number' ? v : undefined)}
        />
      </Flexbox>

      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={saving} onClick={close}>
          {tCommon('cancel')}
        </Button>
        <Button loading={saving} type={'primary'} onClick={handleSave}>
          {tChat('verifyConfig.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

VerifyConfigContent.displayName = 'VerifyConfigContent';

/**
 * Delivery-acceptance config editor for a task. Lets the user attach a verify
 * plan (rubric + ad-hoc criteria), pick a review agent, and tune the repair
 * iteration cap. Mirrors the imperative `createModal` pattern.
 */
export const openVerifyConfigModal = (options: {
  initial?: TaskVerifyConfig;
  taskId: string;
}): ModalInstance =>
  createModal({
    content: <VerifyConfigContent initial={options.initial} taskId={options.taskId} />,
    footer: null,
    maskClosable: true,
    styles: { header: { borderBottom: 'none' } },
    title: t('verifyConfig.modalTitle', { ns: 'chat' }),
    width: 'min(90vw, 520px)',
  });
