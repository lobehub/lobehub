'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { PushResourceContent, type PushResourceModalProps } from './PushResourceContent';

export type { PushResourceFile, PushResourceModalProps } from './PushResourceContent';

// The modal can open from pages that have not loaded the `messenger`
// namespace yet, so the title must resolve through a component (which
// re-renders when the namespace arrives) instead of a one-shot `t()` call.
const ModalTitle = ({ platformName }: { platformName: string }) => {
  const { t } = useTranslation('messenger');
  return <>{t('messenger.push.send', { platform: platformName })}</>;
};

export const openPushResourceModal = (props: PushResourceModalProps) =>
  createModal({
    content: <PushResourceContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: <ModalTitle platformName={props.platformName} />,
    width: 480,
  });
