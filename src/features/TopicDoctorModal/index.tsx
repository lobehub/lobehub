'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import TopicDoctorContent, { type TopicDoctorContentProps } from './Content';

export const openTopicDoctorModal = (props: TopicDoctorContentProps): ModalInstance =>
  createModal({
    content: <TopicDoctorContent {...props} />,
    footer: null,
    maskClosable: true,
    title: t('doctor.title', { ns: 'topic' }),
    width: 'min(90vw, 480px)',
  });
