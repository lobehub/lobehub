'use client';

import type { AcceptanceChecklistItem } from '@lobechat/types';
import { Flexbox, Icon, Input, Text, TextArea } from '@lobehub/ui';
import {
  Button,
  createModal,
  type ModalInstance,
  Segmented,
  Select,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { Check, Plus } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRubricCriteria, useRubrics } from '../hooks';

interface AddCheckContentProps {
  existingIds: string[];
  onSubmit: (items: AcceptanceChecklistItem[]) => Promise<void>;
}

const AddCheckContent = memo<AddCheckContentProps>(({ existingIds, onSubmit }) => {
  const { t: tv } = useTranslation('verify');
  const { close } = useModalContext();
  const [mode, setMode] = useState<'manual' | 'rubric'>('manual');
  const [name, setName] = useState('');
  const [method, setMethod] = useState('');
  const [rubricId, setRubricId] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const { data: rubrics, isLoading: rubricsLoading } = useRubrics();
  const { data: criteria, isLoading: criteriaLoading } = useRubricCriteria(rubricId);
  const availableCriteria = useMemo(
    () => (criteria ?? []).filter((criterion) => !existingIds.includes(criterion.id)),
    [criteria, existingIds],
  );

  const handleSave = async () => {
    if (saving) return;
    const items =
      mode === 'manual'
        ? [{ id: crypto.randomUUID(), method: method.trim() || undefined, name: name.trim() }]
        : availableCriteria
            .filter((criterion) => selectedIds.has(criterion.id))
            .map((criterion) => ({
              id: criterion.id,
              method: criterion.description ?? undefined,
              name: criterion.title,
            }));
    if (items.length === 0 || !items[0]?.name) return;
    setSaving(true);
    try {
      await onSubmit(items);
      close();
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    mode === 'manual' ? Boolean(name.trim()) : Boolean(rubricId && selectedIds.size > 0);

  return (
    <Flexbox gap={16}>
      <Segmented
        block
        value={mode}
        options={[
          { label: tv('acceptance.checkCreate.manual'), value: 'manual' },
          { label: tv('acceptance.checkCreate.rubric'), value: 'rubric' },
        ]}
        onChange={(value) => setMode(value as 'manual' | 'rubric')}
      />
      {mode === 'manual' ? (
        <>
          <Flexbox gap={6}>
            <Text fontSize={12} type={'secondary'}>
              {tv('acceptance.tray.editModal.nameLabel')}
            </Text>
            <Input
              placeholder={tv('acceptance.tray.editModal.namePlaceholder')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Flexbox>
          <Flexbox gap={6}>
            <Text fontSize={12} type={'secondary'}>
              {tv('acceptance.tray.editModal.methodLabel')}
            </Text>
            <TextArea
              autoSize={{ maxRows: 4, minRows: 2 }}
              placeholder={tv('acceptance.tray.editModal.methodPlaceholder')}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            />
          </Flexbox>
        </>
      ) : (
        <Flexbox gap={12}>
          <Select
            loading={rubricsLoading}
            options={(rubrics ?? []).map((rubric) => ({ label: rubric.title, value: rubric.id }))}
            placeholder={tv('acceptance.checkCreate.selectRubric')}
            value={rubricId}
            onChange={(value) => {
              setRubricId(value);
              setSelectedIds(new Set());
            }}
          />
          {rubricId && (
            <Flexbox gap={4}>
              {criteriaLoading ? (
                <Text type={'secondary'}>{tv('acceptance.checkCreate.loading')}</Text>
              ) : availableCriteria.length === 0 ? (
                <Text type={'secondary'}>{tv('acceptance.checkCreate.empty')}</Text>
              ) : (
                availableCriteria.map((criterion) => {
                  const selected = selectedIds.has(criterion.id);
                  return (
                    <Button
                      key={criterion.id}
                      style={{ height: 'auto', justifyContent: 'flex-start', padding: 10 }}
                      type={selected ? 'primary' : 'default'}
                      onClick={() =>
                        setSelectedIds((previous) => {
                          const next = new Set(previous);
                          if (selected) next.delete(criterion.id);
                          else next.add(criterion.id);
                          return next;
                        })
                      }
                    >
                      <Flexbox horizontal align={'flex-start'} gap={8}>
                        <Icon icon={selected ? Check : Plus} size={14} />
                        <Flexbox align={'flex-start'} gap={2}>
                          <Text>{criterion.title}</Text>
                          {criterion.description && (
                            <Text fontSize={12} type={'secondary'}>
                              {criterion.description}
                            </Text>
                          )}
                        </Flexbox>
                      </Flexbox>
                    </Button>
                  );
                })
              )}
            </Flexbox>
          )}
        </Flexbox>
      )}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={saving} onClick={close}>
          {tv('acceptance.actions.cancel')}
        </Button>
        <Button
          disabled={!canSave || saving}
          loading={saving}
          type={'primary'}
          onClick={handleSave}
        >
          {tv('acceptance.checkCreate.add')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

AddCheckContent.displayName = 'AcceptanceAddCheckContent';

export const openAddCheckModal = (props: AddCheckContentProps): ModalInstance =>
  createModal({
    content: <AddCheckContent {...props} />,
    footer: null,
    maskClosable: true,
    title: t('acceptance.checkCreate.title', { ns: 'verify' }),
    width: 'min(90vw, 560px)',
  });
