'use client';

import { copyToClipboard, Flexbox, Text } from '@lobehub/ui';
import { Button, toast, useModalContext } from '@lobehub/ui/base-ui';
import { Input } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  url: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
  `,
}));

export interface InviteLinkModalContentProps {
  inviteUrl: string;
}

export const InviteLinkModalContent: FC<InviteLinkModalContentProps> = ({ inviteUrl }) => {
  const { t } = useTranslation('aico');
  const { close } = useModalContext();

  const handleCopy = async () => {
    await copyToClipboard(inviteUrl);
    toast.success(t('org.invite.linkCopied'));
  };

  return (
    <Flexbox gap={16} paddingBlock={8} paddingInline={4} width={'100%'}>
      <Text type="secondary">{t('org.invite.shareLink')}</Text>
      <Flexbox gap={8} width={'100%'}>
        <Input
          readOnly
          className={styles.url}
          value={inviteUrl}
          onFocus={(event) => event.target.select()}
        />
        <Flexbox horizontal gap={8} justify={'flex-end'} width={'100%'}>
          <Button type="default" onClick={() => close()}>
            {t('org.invite.linkClose')}
          </Button>
          <Button type="primary" onClick={handleCopy}>
            {t('org.invite.copyLink')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
