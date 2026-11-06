import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ClipboardList } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MarkdownElementProps } from '../type';
import { useTaskCardScope } from './context';
import { type ParsedTaskContent, parseTaskContent } from './parseTaskContent';

const styles = stylex.create({
  divider: {
    inlineSize: '100%',
    blockSize: '1px',
    backgroundColor: cssVar.colorSplit,
    backgroundImage: 'none',
  },
  fallback: {
    overflow: 'auto',
    paddingBlock: '12px',
    paddingInline: '14px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'pre-wrap',
  },
  fieldKey: { flex: 'none', minInlineSize: '64px', color: cssVar.colorTextTertiary },
  fieldRow: { fontSize: '13px', lineHeight: 1.6 },
  fieldValue: { color: cssVar.colorTextSecondary, wordBreak: 'break-word' },
  headerIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '32px',
    blockSize: '32px',
    color: cssVar.colorTextSecondary,
  },
  identifier: {
    flex: 'none',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  instruction: {
    fontSize: '13px',
    lineHeight: 1.7,
    color: cssVar.colorText,
    whiteSpace: 'pre-wrap',
  },
  rawItem: { whiteSpace: 'pre-wrap' },
  rawList: {
    margin: 0,
    padding: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
    listStyle: 'none',
  },
  section: { fontSize: '12px', color: cssVar.colorTextTertiary },
  sectionSummary: {
    cursor: 'pointer',
    paddingBlock: '4px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
  },
});

const FieldRow = memo<{ label: string; value?: string }>(({ label, value }) => {
  if (!value) return null;
  return (
    <Flexbox horizontal {...stylex.props(styles.fieldRow)} gap={8}>
      <span {...stylex.props(styles.fieldKey)}>{label}</span>
      <span {...stylex.props(styles.fieldValue)}>{value}</span>
    </Flexbox>
  );
});

const RawSection = memo<{ items: string[]; label: string }>(({ items, label }) => {
  if (!items || items.length === 0) return null;
  return (
    <details {...stylex.props(styles.section)}>
      <summary {...stylex.props(styles.sectionSummary)}>
        {label} ({items.length})
      </summary>
      <ul {...stylex.props(styles.rawList)}>
        {items.map((line, idx) => (
          <li {...stylex.props(styles.rawItem)} key={idx}>
            {line}
          </li>
        ))}
      </ul>
    </details>
  );
});

interface TaskRenderProps extends MarkdownElementProps {
  raw?: string;
}

const Render = memo<TaskRenderProps>(({ children }) => {
  const enabled = useTaskCardScope();
  const text = typeof children === 'string' ? children : String(children ?? '');
  const parsed = useMemo<ParsedTaskContent>(() => parseTaskContent(text), [text]);
  const { t } = useTranslation('chat');

  if (!enabled) {
    return <pre {...stylex.props(styles.fallback)}>{text}</pre>;
  }

  const titleText = parsed.name || parsed.identifier || '';

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={12}>
        <span {...stylex.props(styles.headerIcon)}>
          <ClipboardList size={16} />
        </span>
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            {parsed.identifier && (
              <span {...stylex.props(styles.identifier)}>{parsed.identifier}</span>
            )}
            <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
              {titleText}
            </Text>
          </Flexbox>
        </Flexbox>
      </Flexbox>

      {parsed.instruction && (
        <>
          <div {...stylex.props(styles.divider)} />
          <Flexbox gap={4}>
            <Text fontSize={12} type={'secondary'}>
              {t('taskCard.field.instruction')}
            </Text>
            <div {...stylex.props(styles.instruction)}>{parsed.instruction}</div>
          </Flexbox>
        </>
      )}

      {(parsed.description || parsed.dependencies || parsed.review) && (
        <Flexbox gap={4}>
          <FieldRow label={t('taskCard.field.description')} value={parsed.description} />
          <FieldRow label={t('taskCard.field.dependencies')} value={parsed.dependencies} />
          <FieldRow label={t('taskCard.field.review')} value={parsed.review} />
        </Flexbox>
      )}

      {(parsed.subtasks?.length ||
        parsed.activities?.length ||
        parsed.workspace?.length ||
        parsed.reviewRubrics?.length) && (
        <Flexbox gap={4}>
          <RawSection items={parsed.subtasks ?? []} label={t('taskCard.field.subtasks')} />
          <RawSection items={parsed.activities ?? []} label={t('taskCard.field.activities')} />
          <RawSection items={parsed.workspace ?? []} label={t('taskCard.field.workspace')} />
          <RawSection
            items={parsed.reviewRubrics ?? []}
            label={t('taskCard.field.reviewRubrics')}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

Render.displayName = 'TaskRender';

export default Render;
