'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import {
  ReactCodeblockPlugin,
  ReactCodePlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CriterionList,
  CriterionRequiredChip,
  CriterionRow,
  openCriterionEditModal,
} from '@/features/Verify/CriterionList';

import type { CreateGoalParams, GoalCriterionDraft } from '../../types';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    position: sticky;
    z-index: 2;

    /* Chrome measures sticky against the scroller's CONTENT box, so top: 0
      would pin 8px below where the header actually rests (the root cancels
      that padding) and shove it down. -8px makes the pinned and resting
      positions identical — the title simply never moves. */
    inset-block-start: -8px;

    padding-block: 8px 4px;

    background: ${cssVar.colorBgElevated};
  `,
  instructionEditor: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};

    /* The editor defaults to a document-reading 16px; inside a confirmation
      card the instruction is one field among several, so it matches the
      criteria rows rather than dwarfing them. */
    &,
    & * {
      font-size: 13px;
      line-height: 1.65;
    }
  `,
  list: css`
    background: transparent;

    /* The secondary border is too faint to read on the dark elevated surface
      the intervention card sits on. */
    html[data-theme='dark'] & > * + * {
      border-block-start-color: ${cssVar.colorBorder};
    }
  `,
  /**
   * Cancels the intervention scroller's own top padding. It has to sit on the
   * card root, not on the sticky header: a sticky box is clamped to its
   * containing block, so pulling the header alone just gets clamped back and
   * leaves that strip for content to scroll through.
   */
  root: css`
    margin-block-start: -8px;
  `,
  section: css`
    padding-block: 8px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  sectionHeader: css`
    cursor: pointer;
    user-select: none;
  `,
  sectionLabel: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  seq: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  titleInput: css`
    padding-block: 2px;
    padding-inline: 0;
    font-size: 15px;
    font-weight: 600;
  `,
}));

interface SectionProps {
  children: React.ReactNode;
  extra?: React.ReactNode;
  label: string;
  onToggle: () => void;
  open: boolean;
}

/**
 * One collapsible module. The plan card is three distinct decisions (what to
 * do, how to judge it, how much to spend) — each gets a header the user can
 * fold away, instead of three flat blocks bleeding into each other.
 */
const Section = memo<SectionProps>(({ children, extra, label, onToggle, open }) => (
  <Flexbox className={styles.section} gap={7}>
    <Flexbox
      horizontal
      align={'center'}
      className={styles.sectionHeader}
      gap={6}
      onClick={onToggle}
    >
      <Icon
        color={cssVar.colorTextQuaternary}
        icon={ChevronRight}
        size={13}
        style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
      />
      <Text className={styles.sectionLabel}>{label}</Text>
      {extra}
    </Flexbox>
    {open && children}
  </Flexbox>
));

Section.displayName = 'CreateGoalSection';

const CreateGoalIntervention = memo<BuiltinInterventionProps<CreateGoalParams>>(
  ({ args, onArgsChange, registerBeforeApprove }) => {
    const { t } = useTranslation('plugin');
    const editor = useEditor();
    const [openSections, setOpenSections] = useState({
      budget: true,
      criteria: true,
      instruction: true,
    });
    const patch = (value: Partial<CreateGoalParams>) => onArgsChange?.({ ...args, ...value });
    const openEditModal = (index: number) =>
      openCriterionEditModal({
        criterion: args.criteria[index],
        onSubmit: (value) => updateCriterion(index, value),
      });
    const updateCriterion = (index: number, value: Partial<GoalCriterionDraft>) =>
      patch({
        criteria: args.criteria.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...value } : item,
        ),
      });
    const toggleSection = (key: keyof typeof openSections) =>
      setOpenSections((previous) => ({ ...previous, [key]: !previous[key] }));
    // The instruction lives in the rich editor; args carry its persisted
    // draft. The editor mounts once from the persisted value (a changing
    // `content` prop would reset it mid-edit), while edits flow back through
    // a debounced onArgsChange — the same DB-backed draft path every other
    // field uses, so a refresh loses at most the debounce window. The
    // before-approve flush closes even that window.
    const [initialInstruction] = useState(args.instruction);
    const persistTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

    const saveInstruction = useCallback(async () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      if (!editor) return;
      const markdown = String(editor.getDocument('markdown') ?? '');
      await onArgsChange?.({ ...args, instruction: markdown });
    }, [editor, onArgsChange, args]);
    const saveInstructionRef = useRef(saveInstruction);
    saveInstructionRef.current = saveInstruction;

    const handleInstructionChange = useCallback(() => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => void saveInstructionRef.current(), 800);
    }, []);

    useEffect(
      () => registerBeforeApprove?.('createGoal', () => saveInstructionRef.current()),
      [registerBeforeApprove],
    );

    return (
      <Flexbox className={styles.root}>
        <Flexbox className={styles.header}>
          <Input
            className={styles.titleInput}
            value={args.name}
            variant={'borderless'}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </Flexbox>

        <Section
          label={t('builtins.lobe-task.goal.sectionInstruction')}
          open={openSections.instruction}
          onToggle={() => toggleSection('instruction')}
        >
          <Flexbox className={styles.instructionEditor}>
            <Editor
              content={initialInstruction}
              editor={editor}
              type={'markdown'}
              plugins={[
                ReactCodePlugin,
                ReactCodeblockPlugin,
                ReactHRPlugin,
                ReactLinkPlugin,
                ReactListPlugin,
                ReactTablePlugin,
              ]}
              onTextChange={handleInstructionChange}
            />
          </Flexbox>
        </Section>

        <Section
          label={t('builtins.lobe-task.goal.criteria')}
          open={openSections.criteria}
          extra={
            <Text as={'span'} className={styles.seq}>
              {args.criteria.length}
            </Text>
          }
          onToggle={() => toggleSection('criteria')}
        >
          <Flexbox gap={7}>
            <CriterionList className={styles.list}>
              {/* Rows are read-only on purpose. A focusable input sitting in a
                dense list is one stray click away from silently rewriting a
                criterion; edits belong in the modal, where they are deliberate
                and cancellable. */}
              {args.criteria.map((criterion, index) => (
                <CriterionRow
                  key={index}
                  seq={index + 1}
                  title={criterion.title}
                  actions={
                    <>
                      <ActionIcon
                        icon={Pencil}
                        size={'small'}
                        title={t('builtins.lobe-task.goal.editCriterion')}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditModal(index);
                        }}
                      />
                      <ActionIcon
                        icon={Trash2}
                        size={'small'}
                        onClick={(event) => {
                          event.stopPropagation();
                          patch({
                            criteria: args.criteria.filter((_, itemIndex) => itemIndex !== index),
                          });
                        }}
                      />
                    </>
                  }
                  onOpen={() => openEditModal(index)}
                >
                  <CriterionRequiredChip
                    required={criterion.required ?? true}
                    onToggle={() =>
                      updateCriterion(index, { required: !(criterion.required ?? true) })
                    }
                  />
                </CriterionRow>
              ))}
            </CriterionList>
            <Flexbox horizontal>
              <Button
                icon={<Icon icon={Plus} />}
                size={'small'}
                type={'text'}
                onClick={() =>
                  openCriterionEditModal({
                    criterion: {
                      onFail: 'auto_repair',
                      required: true,
                      title: '',
                      verifierType: 'agent',
                    },
                    isNew: true,
                    onSubmit: (value) => patch({ criteria: [...args.criteria, value] }),
                  })
                }
              >
                {t('builtins.lobe-task.goal.addCriterion')}
              </Button>
            </Flexbox>
          </Flexbox>
        </Section>

        <Section
          label={t('builtins.lobe-task.goal.sectionBudget')}
          open={openSections.budget}
          onToggle={() => toggleSection('budget')}
        >
          <Flexbox horizontal gap={24}>
            <Flexbox gap={4}>
              <Text className={styles.seq}>{t('builtins.lobe-task.goal.roundBudget')}</Text>
              <InputNumber
                min={2}
                size={'small'}
                style={{ width: 120 }}
                suffix={t('builtins.lobe-task.goal.roundsUnit')}
                value={args.maxIterations ?? undefined}
                variant={'filled'}
                onChange={(value) => patch({ maxIterations: value })}
              />
            </Flexbox>
            <Flexbox gap={4}>
              <Text className={styles.seq}>{t('builtins.lobe-task.goal.costBudget')}</Text>
              <InputNumber
                min={0}
                placeholder={t('builtins.lobe-task.goal.uncapped')}
                prefix={'$'}
                size={'small'}
                style={{ width: 120 }}
                value={args.maxTotalCost ?? undefined}
                variant={'filled'}
                onChange={(value) => patch({ maxTotalCost: value })}
              />
            </Flexbox>
          </Flexbox>
        </Section>
      </Flexbox>
    );
  },
);

CreateGoalIntervention.displayName = 'CreateGoalIntervention';

export default CreateGoalIntervention;
