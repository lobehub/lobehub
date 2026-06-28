'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { ActionIcon } from '@lobehub/ui';
import { ChevronUp } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';

import ApprovalCard from './ApprovalCard';
import { styles } from './styles';
import { useGlobalPendingApprovals } from './useGlobalPendingApprovals';

const SPRING = { damping: 30, stiffness: 320, type: 'spring' } as const;

// Push below the desktop title bar; the web build has no title bar.
const TOP_OFFSET = isDesktop ? TITLE_BAR_HEIGHT + 8 : 16;

/**
 * GlobalApprovalNotification
 *
 * A "dynamic island" that drops in from the top center whenever a locally-driven
 * agent run in a non-active conversation is waiting for human approval. It lets
 * the user approve / reject inline — or jump to the conversation — without
 * leaving the current page. Renders nothing while idle.
 */
const GlobalApprovalNotification = memo(() => {
  const { t } = useTranslation('chat');
  const groups = useGlobalPendingApprovals();
  const [collapsed, setCollapsed] = useState(false);

  // Auto-expand whenever a fresh batch of approvals arrives after being idle.
  const prevCount = useRef(0);
  useEffect(() => {
    if (groups.length > prevCount.current) setCollapsed(false);
    prevCount.current = groups.length;
  }, [groups.length]);

  const hasApprovals = groups.length > 0;
  // Only ONE card is actionable at a time: the reused `ApprovalActions`
  // registers window-level Enter/1/2 shortcuts, so mounting a card per group
  // would let a single Enter submit every pending approval at once. Extra
  // approvals queue behind a count and surface as each one resolves.
  const top = groups[0];
  const extraCount = groups.length - 1;

  return (
    <div className={styles.wrapper} style={{ '--global-approval-top': `${TOP_OFFSET}px` } as any}>
      <AnimatePresence mode="popLayout">
        {hasApprovals &&
          (collapsed ? (
            <m.div
              layout
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className={styles.pill}
              exit={{ opacity: 0, scale: 0.9, y: -16 }}
              initial={{ opacity: 0, scale: 0.9, y: -16 }}
              key="pill"
              transition={SPRING}
              onClick={() => setCollapsed(false)}
            >
              <span className={styles.pillDot} />
              {t('globalApproval.pendingCount', { count: groups.length })}
            </m.div>
          ) : (
            <m.div
              layout
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className={styles.stack}
              exit={{ opacity: 0, scale: 0.96, y: -16 }}
              initial={{ opacity: 0, scale: 0.96, y: -16 }}
              key="stack"
              transition={SPRING}
            >
              <m.div layout style={{ alignSelf: 'flex-end', pointerEvents: 'auto' }}>
                <ActionIcon
                  icon={ChevronUp}
                  size="small"
                  title={t('globalApproval.collapse')}
                  onClick={() => setCollapsed(true)}
                />
              </m.div>
              <AnimatePresence mode="popLayout">
                {top && (
                  <m.div
                    layout
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: -16 }}
                    initial={{ opacity: 0, scale: 0.96, y: -16 }}
                    key={top.key}
                    style={{ pointerEvents: 'auto', width: '100%' }}
                    transition={SPRING}
                  >
                    <ApprovalCard group={top} />
                  </m.div>
                )}
              </AnimatePresence>
              {extraCount > 0 && (
                <div className={styles.moreHint}>
                  {t('globalApproval.moreCount', { count: extraCount })}
                </div>
              )}
            </m.div>
          ))}
      </AnimatePresence>
    </div>
  );
});

GlobalApprovalNotification.displayName = 'GlobalApprovalNotification';

export default GlobalApprovalNotification;
