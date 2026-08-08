'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  AlertTriangleIcon,
  CheckIcon,
  EyeOffIcon,
  InfoIcon,
  type LucideIcon,
  UsersIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export type VisibilityConfirmVariant = 'makePrivate' | 'publish';

export interface VisibilityConfirmContentProps {
  variant: VisibilityConfirmVariant;
}

type Tone = 'danger' | 'info' | 'ok';

interface Item {
  emphasis?: boolean;
  icon: LucideIcon;
  key: string;
  showIrreversible?: boolean;
  tone: Tone;
}

interface VariantConfig {
  items: readonly [Item, Item, Item];
}

// 3 consequences per direction — the order matters (immediate → follow-on →
// irreversible tail), and mirrors the tone escalation across the pair. Keep
// the "loaded content can't be pulled back" bullet last in both variants so
// readers walk away with the strongest constraint fresh in mind.
//
// No hero icon pill up here on purpose — the modal's own title slot + the
// destructive vs primary button colour already carry the tone signal. An
// extra pill just left a lot of dead white space to the right of a small
// square. Each list row still carries its own tone icon.
const CONFIG: Record<VisibilityConfirmVariant, VariantConfig> = {
  makePrivate: {
    items: [
      {
        icon: EyeOffIcon,
        key: 'visibilityConfirm.makePrivate.itemAccess',
        tone: 'danger',
      },
      {
        icon: AlertTriangleIcon,
        key: 'visibilityConfirm.makePrivate.itemReferences',
        tone: 'info',
      },
      {
        emphasis: true,
        icon: InfoIcon,
        key: 'visibilityConfirm.makePrivate.itemLoaded',
        showIrreversible: true,
        tone: 'danger',
      },
    ],
  },
  publish: {
    items: [
      {
        icon: UsersIcon,
        key: 'visibilityConfirm.publish.itemVisible',
        tone: 'info',
      },
      { icon: CheckIcon, key: 'visibilityConfirm.publish.itemReversible', tone: 'ok' },
      {
        emphasis: true,
        icon: InfoIcon,
        key: 'visibilityConfirm.publish.itemLoaded',
        showIrreversible: true,
        tone: 'danger',
      },
    ],
  },
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  list: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    margin: 0;
    padding: 12px;
    border-radius: 8px;

    list-style: none;

    background: ${cssVar.colorFillQuaternary};
  `,
  row: css`
    display: flex;
    gap: 10px;
    align-items: flex-start;

    font-size: 13px;
    line-height: 1.55;
    color: ${cssVar.colorText};
  `,
  rowIcon: css`
    flex: none;
    margin-block-start: 3px;
    color: ${cssVar.colorTextTertiary};
  `,
  rowIconDanger: css`
    color: ${cssVar.colorError};
  `,
  rowIconOk: css`
    color: ${cssVar.colorSuccess};
  `,
  rowIconInfo: css`
    color: ${cssVar.colorInfo};
  `,
  emphasis: css`
    font-weight: 500;
  `,
  suffix: css`
    color: ${cssVar.colorTextTertiary};
  `,
}));

const rowIconClass = (tone: Tone) => {
  if (tone === 'danger') return styles.rowIconDanger;
  if (tone === 'ok') return styles.rowIconOk;
  return styles.rowIconInfo;
};

/**
 * `VisibilityConfirmContent`
 *
 * Shared body for the two mirrored confirm dialogs that guard workspace
 * visibility transitions:
 * - `makePrivate` — destructive, public → private
 * - `publish` — constructive, private → public (bidirectional counterpart)
 *
 * Both directions render a compact 3-item bullet card. Consequences are
 * enumerated (not paragraphs) because the user needs to *scan* three specific
 * facts — an order-of-magnitude more scannable than the earlier one-sentence
 * copy that all three variants used to reuse.
 *
 * Pass this as `content` to `confirmModal`; the modal keeps its own `title` /
 * `okText` / `cancelText` slots so callers stay resource-specific. Tone is
 * carried by the destructive vs primary button colour, so we don't need a
 * separate hero icon here.
 */
const VisibilityConfirmContent = memo<VisibilityConfirmContentProps>(({ variant }) => {
  const { t } = useTranslation('common');
  const config = CONFIG[variant];
  const irreversibleSuffix = t('visibilityConfirm.irreversible');

  return (
    <ul className={styles.list}>
      {config.items.map((item) => {
        const ItemIcon = item.icon;
        return (
          <li className={styles.row} key={item.key}>
            <span className={`${styles.rowIcon} ${rowIconClass(item.tone)}`}>
              <Icon icon={ItemIcon} size={14} />
            </span>
            <span className={item.emphasis ? styles.emphasis : undefined}>
              {t(item.key as any)}
              {item.showIrreversible && <span className={styles.suffix}>{irreversibleSuffix}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
});

VisibilityConfirmContent.displayName = 'VisibilityConfirmContent';

export default VisibilityConfirmContent;
