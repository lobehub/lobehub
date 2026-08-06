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
import { ActionIcon, Block, Flexbox, Icon, Input, Text, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateGoalParams, GoalCriterionDraft } from '../../types';

const styles = createStaticStyles(({ css }) => ({
  criterion: css`
    padding-block: 3px;
    padding-inline: 10px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  criterionHead: css`
    cursor: pointer;
  `,
  header: css`
    position: sticky;
    z-index: 2;

    /* The intervention scroller carries 8px top padding; pinning at 0 would
      leave that strip uncovered for content to bleed through. Pin above it and
      pay the offset back as padding, so the title holds its resting position
      while the sticky box still covers the strip. */
    inset-block-start: -8px;

    padding-block: 8px 6px;

    background: ${cssVar.colorBgContainer};
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
    overflow: hidden;
    padding: 0;
  `,
  criterionTitle: css`
    padding-block: 4px;
    padding-inline: 0;
    font-size: 13px;
  `,
  optional: css`
    flex: none;

    padding-block: 2px;
    padding-inline: 7px;
    border-radius: 6px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  required: css`
    flex: none;

    padding-block: 2px;
    padding-inline: 7px;
    border-radius: 6px;

    font-size: 11px;
    color: ${cssVar.colorInfo};

    background: ${cssVar.colorInfoBg};
  `,
  section: css`
    padding-block: 10px;

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
    // The judge prompt is reference material, not the decision itself — every
    // criterion starts folded to a single title row.
    const [expandedCriteria, setExpandedCriteria] = useState<Set<number>>(() => new Set());

    const patch = (value: Partial<CreateGoalParams>) => onArgsChange?.({ ...args, ...value });
    const updateCriterion = (index: number, value: Partial<GoalCriterionDraft>) =>
      patch({
        criteria: args.criteria.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...value } : item,
        ),
      });
    const toggleSection = (key: keyof typeof openSections) =>
      setOpenSections((previous) => ({ ...previous, [key]: !previous[key] }));
    const toggleCriterion = (index: number) =>
      setExpandedCriteria((previous) => {
        const next = new Set(previous);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });

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
      <Flexbox>
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
            <Block className={styles.list} variant={'outlined'}>
              {args.criteria.map((criterion, index) => {
                const expanded = expandedCriteria.has(index);

                return (
                  <Flexbox className={styles.criterion} gap={6} key={index}>
                    <Flexbox
                      horizontal
                      align={'center'}
                      className={styles.criterionHead}
                      gap={8}
                      onClick={() => toggleCriterion(index)}
                    >
                      <Icon
                        color={cssVar.colorTextQuaternary}
                        icon={ChevronRight}
                        size={13}
                        style={{
                          flex: 'none',
                          transform: expanded ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.2s',
                        }}
                      />
                      <Text as={'span'} className={styles.seq}>
                        C{index + 1}
                      </Text>
                      <Input
                        className={styles.criterionTitle}
                        style={{ flex: 1 }}
                        value={criterion.title}
                        variant={'borderless'}
                        onChange={(event) => updateCriterion(index, { title: event.target.value })}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <Button
                        className={(criterion.required ?? true) ? styles.required : styles.optional}
                        size={'small'}
                        type={'text'}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateCriterion(index, { required: !(criterion.required ?? true) });
                        }}
                      >
                        {(criterion.required ?? true)
                          ? t('builtins.lobe-task.goal.required')
                          : t('builtins.lobe-task.goal.optional')}
                      </Button>
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
                    </Flexbox>
                    {expanded &&
                      (criterion.verifierType === 'program' ? (
                        <TextArea
                          autoSize={{ maxRows: 4, minRows: 1 }}
                          placeholder={t('builtins.lobe-task.goal.script')}
                          value={String(criterion.verifierConfig?.command ?? '')}
                          onChange={(event) =>
                            updateCriterion(index, {
                              verifierConfig: {
                                ...criterion.verifierConfig,
                                command: event.target.value,
                              },
                            })
                          }
                        />
                      ) : (
                        <TextArea
                          autoSize={{ maxRows: 4, minRows: 1 }}
                          placeholder={t('builtins.lobe-task.goal.instruction')}
                          value={criterion.instruction ?? ''}
                          onChange={(event) =>
                            updateCriterion(index, { instruction: event.target.value })
                          }
                        />
                      ))}
                  </Flexbox>
                );
              })}
            </Block>
            <Flexbox horizontal>
              <Button
                icon={<Icon icon={Plus} />}
                size={'small'}
                type={'text'}
                onClick={() =>
                  patch({
                    criteria: [
                      ...args.criteria,
                      { onFail: 'auto_repair', required: false, title: '', verifierType: 'agent' },
                    ],
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
