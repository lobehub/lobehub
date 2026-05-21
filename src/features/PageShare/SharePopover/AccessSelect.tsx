'use client';

import { Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { CheckIcon } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type AccessValue = 'private' | 'link-read' | 'link-comment' | 'link-edit';

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  caret: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  dropdown: css`
    overflow: hidden;

    margin-block-start: 6px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 6px;

    background: ${token.colorBgElevated};
    box-shadow: 0 4px 12px ${isDarkMode ? 'rgba(0,0,0,.4)' : 'rgba(0,0,0,.06)'};
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 26px;
    height: 26px;
    border-radius: 50%;

    font-size: 12px;
  `,
  iconLocked: css`
    color: ${token.colorTextTertiary};
    background: ${token.colorFillSecondary};
  `,
  iconLink: css`
    color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
  `,
  iconComment: css`
    color: #9a6700;
    background: #fff8c5;
  `,
  iconEdit: css`
    color: #cf222e;
    background: #ffe9e2;
  `,
  opt: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 9px;
    padding-inline: 12px;

    font-size: 13px;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  optDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    &:hover {
      background: transparent;
    }
  `,
  optText: css`
    flex: 1;
  `,
  optTitle: css`
    font-weight: 500;
    color: ${token.colorText};
  `,
  optSub: css`
    margin-block-start: 1px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  optSoon: css`
    margin-block-start: 1px;
    font-size: 11px;
    color: ${token.colorWarning};
  `,
  select: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 6px;

    font-size: 13px;

    background: ${token.colorBgContainer};
  `,
  selectText: css`
    flex: 1;
  `,
}));

interface AccessSelectProps {
  onChange: (value: AccessValue) => void | Promise<void>;
  value: AccessValue;
}

const AccessSelect: FC<AccessSelectProps> = ({ value, onChange }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('pageShare');
  const [open, setOpen] = useState(false);

  const renderIcon = (key: AccessValue) => {
    if (key === 'private') return <span className={cx(styles.icon, styles.iconLocked)}>🔒</span>;
    if (key === 'link-comment')
      return <span className={cx(styles.icon, styles.iconComment)}>💬</span>;
    if (key === 'link-edit') return <span className={cx(styles.icon, styles.iconEdit)}>✏️</span>;
    return <span className={cx(styles.icon, styles.iconLink)}>🔗</span>;
  };

  const titleFor = (key: AccessValue) => {
    if (key === 'private') return t('popover.options.private.title');
    if (key === 'link-comment') return t('popover.options.linkComment.title');
    if (key === 'link-edit') return t('popover.options.linkEdit.title');
    return t('popover.options.linkRead.title');
  };

  const subFor = (key: AccessValue) => {
    if (key === 'private') return t('popover.options.private.sub');
    if (key === 'link-read') return t('popover.options.linkRead.sub');
    return null;
  };

  const handlePick = async (next: AccessValue, disabled = false) => {
    if (disabled) return;
    setOpen(false);
    if (next === value) return;
    await onChange(next);
  };

  return (
    <div>
      <div className={styles.select} onClick={() => setOpen((v) => !v)}>
        {renderIcon(value)}
        <Flexbox className={styles.selectText} gap={2}>
          <span className={styles.optTitle}>{titleFor(value)}</span>
          {subFor(value) && <span className={styles.optSub}>{subFor(value)}</span>}
        </Flexbox>
        <span className={styles.caret}>▾</span>
      </div>

      {open && (
        <div className={styles.dropdown}>
          {(
            [
              { key: 'private', disabled: false },
              { key: 'link-read', disabled: false },
              { key: 'link-comment', disabled: true },
              { key: 'link-edit', disabled: true },
            ] as { disabled: boolean; key: AccessValue }[]
          ).map(({ key, disabled }) => (
            <div
              className={cx(styles.opt, disabled && styles.optDisabled)}
              key={key}
              onClick={() => handlePick(key, disabled)}
            >
              {renderIcon(key)}
              <Flexbox className={styles.optText} gap={2}>
                <span className={styles.optTitle}>{titleFor(key)}</span>
                {disabled ? (
                  <span className={styles.optSoon}>{t('popover.options.comingSoon')}</span>
                ) : (
                  subFor(key) && <span className={styles.optSub}>{subFor(key)}</span>
                )}
              </Flexbox>
              {key === value && <CheckIcon color={'#1a7f37'} size={14} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AccessSelect;
