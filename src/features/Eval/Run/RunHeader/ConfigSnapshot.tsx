'use client';

import type { EvalRunAgentSnapshot } from '@lobechat/types';
import { Flexbox, Highlighter, Markdown } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  label: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  systemRole: css`
    overflow: auto;

    max-height: 300px;
    padding: 12px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  toggle: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    width: fit-content;
    padding: 0;
    border: none;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      border-radius: ${cssVar.borderRadiusSM};
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
}));

const Field = ({ children, label }: { children: ReactNode; label: ReactNode }) => (
  <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
    <span className={styles.label}>{label}</span>
    {children}
  </Flexbox>
);

const Json = ({ value }: { value: unknown }) => (
  <Highlighter
    language="json"
    style={{ fontSize: 12, maxHeight: 300, overflow: 'auto' }}
    variant="filled"
  >
    {JSON.stringify(value, null, 2)}
  </Highlighter>
);

/** The agent config frozen when the run was created — collapsed by default. */
const ConfigSnapshot = ({ snapshot }: { snapshot?: EvalRunAgentSnapshot }) => {
  const { t } = useTranslation('eval');
  const [open, setOpen] = useState(false);
  if (!snapshot) return null;

  const hasContent =
    !!snapshot.systemRole ||
    !!snapshot.plugins?.length ||
    !!snapshot.chatConfig ||
    !!snapshot.params;
  if (!hasContent) return null;

  return (
    <Flexbox gap={12}>
      <button aria-expanded={open} className={styles.toggle} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t('run.detail.configSnapshot')}
      </button>
      {open && (
        <Flexbox className={styles.body} gap={16}>
          {snapshot.systemRole && (
            <Field label="System Role">
              <div className={styles.systemRole}>
                <Markdown variant="chat">{snapshot.systemRole}</Markdown>
              </div>
            </Field>
          )}
          {!!snapshot.plugins?.length && (
            <Field label="Plugins">
              <Flexbox horizontal gap={4} wrap="wrap">
                {snapshot.plugins.map((plugin) => (
                  <Tag key={plugin}>{plugin}</Tag>
                ))}
              </Flexbox>
            </Field>
          )}
          {(snapshot.chatConfig || snapshot.params) && (
            <Flexbox horizontal gap={12} wrap="wrap">
              {snapshot.chatConfig && (
                <Field label="Chat Config">
                  <Json value={snapshot.chatConfig} />
                </Field>
              )}
              {snapshot.params && (
                <Field label="Params">
                  <Json value={snapshot.params} />
                </Field>
              )}
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default ConfigSnapshot;
