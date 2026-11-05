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
import {
  ActionIcon,
  Button,
  // oxlint-disable-next-line stylex-migration/no-emotion-styles -- the editor's content DOM gets no className
  createStaticStyles,
  cx,
  Flexbox,
  Icon,
  Input,
  InputNumber,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CriterionList,
  CriterionRequiredChip,
  CriterionRow,
  openCriterionEditModal,
} from '@/features/Acceptance/CriterionList';

import type { CreateGoalParams, GoalCriterionDraft } from '../../types';

const styles = stylex.create({
  criterionRow: {
    borderBlockStartColor: {
      'default': null,
      ':is(html[data-theme="dark"] *):not(:first-child)': cssVar.colorBorder,
    },
  },
  header: {
    position: 'sticky',
    zIndex: 2,
    // Chrome measures sticky against the scroller's CONTENT box, so top: 0
    // would pin 8px below where the header actually rests (the root cancels
    // that padding) and shove it down. -8px makes the pinned and resting
    // positions identical — the title simply never moves.
    insetBlockStart: '-8px',
    paddingBlockStart: '8px',
    paddingBlockEnd: '4px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  instructionEditor: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  list: {
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  // Cancels the intervention scroller's own top padding. It has to sit on the
  // card root, not on the sticky header: a sticky box is clamped to its
  // containing block, so pulling the header alone just gets clamped back and
  // leaves that strip for content to scroll through.
  root: {
    marginBlockStart: '-8px',
  },
  section: {
    paddingBlock: '8px',
  },
  sectionDivided: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  sectionHeader: {
    cursor: 'pointer',
    userSelect: 'none',
  },
  sectionLabel: {
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  seq: {
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
  },
  titleInput: {
    paddingBlock: '2px',
    paddingInline: 0,
    fontSize: '15px',
    fontWeight: 600,
  },
});

const fallback = createStaticStyles(({ css }) => ({
  instructionEditor: css`
    &,
    & * {
      font-size: 13px;
      line-height: 1.65;
    }
  `,
}));

interface SectionProps {
  children: React.ReactNode;
  divided?: boolean;
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
const Section = memo<SectionProps>(({ children, divided, extra, label, onToggle, open }) => (
  <Flexbox
    className={stylex.props(styles.section, divided && styles.sectionDivided).className}
    gap={7}
  >
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.sectionHeader).className}
      gap={6}
      onClick={onToggle}
    >
      <Icon
        color={cssVar.colorTextQuaternary}
        icon={ChevronRight}
        size={13}
        style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
      />
      <Text className={stylex.props(styles.sectionLabel).className}>{label}</Text>
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
      <Flexbox className={stylex.props(styles.root).className}>
        <Flexbox className={stylex.props(styles.header).className}>
          <Input
            className={stylex.props(styles.titleInput).className}
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
          <Flexbox
            className={cx(
              stylex.props(styles.instructionEditor).className,
              fallback.instructionEditor,
            )}
          >
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
          divided
          label={t('builtins.lobe-task.goal.criteria')}
          open={openSections.criteria}
          extra={
            <Text as={'span'} className={stylex.props(styles.seq).className}>
              {args.criteria.length}
            </Text>
          }
          onToggle={() => toggleSection('criteria')}
        >
          <Flexbox gap={7}>
            <CriterionList className={stylex.props(styles.list).className}>
              {/* Rows are read-only on purpose. A focusable input sitting in a
                dense list is one stray click away from silently rewriting a
                criterion; edits belong in the modal, where they are deliberate
                and cancellable. */}
              {args.criteria.map((criterion, index) => (
                <CriterionRow
                  className={stylex.props(styles.criterionRow).className}
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
          divided
          label={t('builtins.lobe-task.goal.sectionBudget')}
          open={openSections.budget}
          onToggle={() => toggleSection('budget')}
        >
          <Flexbox horizontal gap={24}>
            <Flexbox gap={4}>
              <Text className={stylex.props(styles.seq).className}>
                {t('builtins.lobe-task.goal.roundBudget')}
              </Text>
              <InputNumber
                min={2}
                size={'small'}
                style={{ width: 120 }}
                suffix={t('builtins.lobe-task.goal.roundsUnit')}
                value={args.maxIterations ?? null}
                variant={'filled'}
                onChange={(value) => patch({ maxIterations: value })}
              />
            </Flexbox>
            <Flexbox gap={4}>
              <Text className={stylex.props(styles.seq).className}>
                {t('builtins.lobe-task.goal.costBudget')}
              </Text>
              <InputNumber
                min={0}
                placeholder={t('builtins.lobe-task.goal.uncapped')}
                prefix={'$'}
                size={'small'}
                style={{ width: 120 }}
                value={args.maxTotalCost ?? null}
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
