'use client';

import { mountImperative } from '@/components/ImperativeMount';

import CustomConnectorModal from '.';

export const openConnectorEditModal = (connectorId: string) =>
  mountImperative(({ close, open }) => (
    <CustomConnectorModal
      connectorId={connectorId}
      open={open}
      onClose={close}
      onEditSuccess={close}
    />
  ));
