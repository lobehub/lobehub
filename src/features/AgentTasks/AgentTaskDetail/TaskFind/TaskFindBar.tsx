'use client';

import { ActionIcon, cssVar as lobeCssVar, Flexbox, Icon, Input } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveFindKey } from './findKeys';
import { TASK_FIND_HIGHLIGHT } from './useTaskFind';

// `::highlight()` is a document-level pseudo-element, so it cannot be a scoped
// rule. React hoists and dedupes this sheet by its `href`. It sets the text
// color with the fill so matches stay readable whatever color the text has.
const HIGHLIGHT_SHEET = `
::highlight(${TASK_FIND_HIGHLIGHT.all}) { background-color: ${lobeCssVar.colorWarningBgHover}; color: ${lobeCssVar.colorText}; }
::highlight(${TASK_FIND_HIGHLIGHT.active}) { background-color: ${lobeCssVar.colorWarningBorder}; color: ${lobeCssVar.colorText}; }
`;

const styles = stylex.create({
  bar: {
    backgroundColor: cssVar.colorBgElevated,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: cssVar.boxShadowSecondary,
    insetBlockStart: 8,
    insetInlineEnd: 16,
    padding: 6,
    position: 'absolute',
    width: 'min(360px, calc(100% - 32px))',
    zIndex: 10,
  },
  position: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
});

interface TaskFindBarProps {
  activeIndex: number;
  count: number;
  /** Bumped by every Mod+F / header click, so a repeat press re-selects the keyword. */
  focusRequest: number;
  onChange: (value: string) => void;
  onClose: () => void;
  onStep: (delta: 1 | -1) => void;
  /** The debounced keyword: the count only reads "no results" once it has settled. */
  settledKeyword: string;
  value: string;
}

const TaskFindBar = memo<TaskFindBarProps>(
  ({ activeIndex, count, focusRequest, onChange, onClose, onStep, settledKeyword, value }) => {
    const { t } = useTranslation('chat');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => clearTimeout(timer);
    }, [focusRequest]);

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      const action = resolveFindKey(event.key, event.shiftKey);
      if (!action) return;
      if (action === 'close') onClose();
      else onStep(action === 'next' ? 1 : -1);

      event.preventDefault();
      event.stopPropagation();
    };

    const showPosition = !!settledKeyword && settledKeyword === value.trim();

    return (
      <div {...stylex.props(styles.bar)} data-testid={'task-find-bar'} role={'search'}>
        <style href={'lobe-task-find-highlight'} precedence={'default'}>
          {HIGHLIGHT_SHEET}
        </style>
        <Input
          aria-label={t('taskDetail.find.placeholder')}
          placeholder={t('taskDetail.find.placeholder')}
          prefix={<Icon icon={SearchIcon} size={13} />}
          ref={inputRef}
          size={'small'}
          value={value}
          variant={'borderless'}
          suffix={
            <Flexbox horizontal align={'center'} gap={2}>
              {showPosition && (
                <span aria-live={'polite'} {...stylex.props(styles.position)}>
                  {count > 0
                    ? t('taskDetail.find.position', { current: activeIndex + 1, total: count })
                    : t('taskDetail.find.empty')}
                </span>
              )}
              <ActionIcon
                disabled={count === 0}
                icon={ChevronUpIcon}
                size={'small'}
                title={t('taskDetail.find.prev')}
                onClick={() => onStep(-1)}
              />
              <ActionIcon
                disabled={count === 0}
                icon={ChevronDownIcon}
                size={'small'}
                title={t('taskDetail.find.next')}
                onClick={() => onStep(1)}
              />
              <ActionIcon
                icon={XIcon}
                size={'small'}
                title={t('taskDetail.find.close')}
                onClick={onClose}
              />
            </Flexbox>
          }
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    );
  },
);

TaskFindBar.displayName = 'TaskFindBar';

export default TaskFindBar;
