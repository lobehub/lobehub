'use client';

import { mountImperative } from '@/components/ImperativeMount';

import CustomConnectorModal from '.';

export const openConnectorEditDrawer = (connectorId: string) =>
  mountImperative(({ close, open }) => (
    <CustomConnectorModal
      connectorId={connectorId}
      open={open}
      onClose={close}
      onEditSuccess={close}
    />
  ));
