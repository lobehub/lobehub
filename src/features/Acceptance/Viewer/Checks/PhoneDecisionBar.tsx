import { Button, DropdownMenu, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Ban, Check, Ellipsis, MessageSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  bar: {
    position: 'sticky',
    zIndex: 2,
    insetBlockEnd: 0,
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginBlockStart: 'auto',
    marginBlockEnd: '-16px',
    marginInline: '-16px',
    paddingBlock: '8px',
    paddingInline: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
  },
  more: {
    flex: 'none',
    minWidth: '44px',
    minHeight: '44px',
  },
  action: {
    flex: '1',
    minHeight: '44px',
  },
});

interface PhoneDecisionBarProps {
  accepting: boolean;
  ignoring: boolean;
  onAccept: (event: { stopPropagation: () => void }) => void;
  onComment?: () => void;
  onIgnore: (event: { stopPropagation: () => void }) => void;
  onReject: () => void;
  reviewPending: boolean;
}

const PhoneDecisionBar = memo<PhoneDecisionBarProps>(
  ({ accepting, ignoring, onAccept, onComment, onIgnore, onReject, reviewPending }) => {
    const { t } = useTranslation('verify');
    const busy = reviewPending || accepting || ignoring;

    return (
      <div data-phone-decision-bar {...stylex.props(styles.bar)}>
        <DropdownMenu
          placement={'topLeft'}
          items={[
            {
              disabled: busy,
              icon: <Icon icon={Ban} />,
              key: 'ignore',
              label: t('acceptance.review.ignore'),
              onClick: () => onIgnore({ stopPropagation: () => {} }),
            },
            ...(onComment
              ? [
                  {
                    icon: <Icon icon={MessageSquare} />,
                    key: 'comment',
                    label: t('acceptance.comments.evidenceModalTitle'),
                    onClick: onComment,
                  },
                ]
              : []),
          ]}
        >
          <Button
            aria-label={t('acceptance.review.more')}
            className={stylex.props(styles.more).className}
            icon={<Icon icon={Ellipsis} />}
            loading={ignoring}
          />
        </DropdownMenu>
        <Button
          className={stylex.props(styles.action).className}
          disabled={busy}
          onClick={onReject}
        >
          {t('acceptance.review.reject')}
        </Button>
        <Button
          className={stylex.props(styles.action).className}
          disabled={reviewPending && !accepting}
          icon={<Icon icon={Check} />}
          loading={accepting}
          type={'primary'}
          onClick={onAccept}
        >
          {t('acceptance.review.accept')}
        </Button>
      </div>
    );
  },
);

PhoneDecisionBar.displayName = 'AcceptancePhoneDecisionBar';

export default PhoneDecisionBar;
