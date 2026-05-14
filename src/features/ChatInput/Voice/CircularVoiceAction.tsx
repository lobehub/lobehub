'use client';

import { type ChatMessageError } from '@lobechat/types';
import { Alert, Button, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Action from '../ActionBar/components/Action';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};
  `,
  button: css`
    border-radius: 50%;
  `,
  recording: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${cssVar.colorError};
  `,
}));

interface CircularVoiceActionProps {
  active?: boolean;
  desc: string;
  disabled?: boolean;
  error?: ChatMessageError;
  formattedTime?: string;
  handleCloseError?: () => void;
  handleRetry?: () => void;
  icon: LucideIcon;
  isLoading?: boolean;
  isRecording?: boolean;
  onClick: () => void;
  time?: number;
}

const CircularVoiceAction = memo<CircularVoiceActionProps>(
  ({
    active,
    desc,
    disabled,
    error,
    formattedTime,
    handleCloseError,
    handleRetry,
    icon,
    isLoading,
    isRecording,
    onClick,
    time = 0,
  }) => {
    const { t } = useTranslation('chat');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const hasDropdown = isRecording || isLoading || !!error;

    return (
      <Action
        active={active || isRecording}
        className={cx(styles.button, (active || isRecording) && styles.active)}
        disabled={disabled}
        icon={icon}
        size={{ blockSize: 32, size: 18 }}
        title={dropdownOpen ? undefined : desc}
        variant={'borderless'}
        dropdown={
          hasDropdown
            ? {
                menu: {
                  // @ts-expect-error waiting for antd to fix this
                  activeKey: 'time',
                  items: [
                    {
                      key: 'title',
                      label: (
                        <Flexbox>
                          <div style={{ fontWeight: 'bolder' }}>{desc}</div>
                        </Flexbox>
                      ),
                    },
                    {
                      key: 'time',
                      label: (
                        <Flexbox horizontal align={'center'} gap={8}>
                          <div className={styles.recording} />
                          {time > 0
                            ? formattedTime
                            : t(isRecording ? 'stt.loading' : 'stt.prettifying')}
                        </Flexbox>
                      ),
                    },
                  ],
                },
                onOpenChange: setDropdownOpen,
                open: dropdownOpen || !!error || !!isRecording || !!isLoading,
                placement: 'top',
                popupRender: error
                  ? () => (
                      <Alert
                        closable
                        style={{ alignItems: 'center' }}
                        title={error.message}
                        type="error"
                        action={
                          handleRetry && (
                            <Button size={'small'} type={'primary'} onClick={handleRetry}>
                              {t('retry', { ns: 'common' })}
                            </Button>
                          )
                        }
                        extra={
                          error.body && (
                            <Highlighter
                              actionIconSize={'small'}
                              language={'json'}
                              variant={'borderless'}
                            >
                              {JSON.stringify(error.body, null, 2)}
                            </Highlighter>
                          )
                        }
                        onClose={handleCloseError}
                      />
                    )
                  : undefined,
                trigger: 'click',
              }
            : undefined
        }
        onClick={onClick}
      />
    );
  },
);

CircularVoiceAction.displayName = 'CircularVoiceAction';

export default CircularVoiceAction;
