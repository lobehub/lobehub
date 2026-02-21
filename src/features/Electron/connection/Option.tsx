import { CheckCircleFilled } from '@ant-design/icons';
import { type StorageModeEnum } from '@lobechat/electron-client-ipc';
import { Center, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ComponentType, type ReactNode } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  checked: css`
    position: relative;
    border: 1px solid ${cssVar.colorPrimary};
  `,
  description: css`
    margin-block-start: 4px; /* Adjust spacing */
    font-size: 13px; /* Slightly larger description */
    color: ${cssVar.colorTextSecondary};
  `,
  iconWrapper: css`
    margin-block-start: 2px;
    padding: 0;
    color: ${cssVar.colorTextSecondary};

    svg {
      display: block;
      font-size: 24px; /* Increased icon size */
      stroke-width: 2; /* Ensure lucide icons look bolder */
    }
  `,
  label: css`
    font-size: 16px;
    font-weight: 600; /* Bolder label */
    color: ${cssVar.colorText};
  `,
  optionCard: css`
    cursor: pointer;

    width: 100%;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary}; /* Use secondary border */
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorText};

    background-color: ${cssVar.colorBgContainer};

    transition: all 0.2s ${cssVar.motionEaseInOut};

    :hover {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  optionInner: css`
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;
  `,
}));

export interface OptionProps {
  children?: ReactNode;
  description: string;
  icon: ComponentType<any>;
  isSelected: boolean;
  label: string;
  onClick: (value: StorageModeEnum) => void;
  value: StorageModeEnum; // For self-hosted input
}

export const Option = ({
  description,
  icon: PrefixIcon,
  label,
  value,
  isSelected,
  onClick,
  children,
}: OptionProps) => {
  return (
    <Flexbox
      className={cx(styles.optionCard, isSelected && styles.checked)}
      direction="vertical"
      key={value}
      onClick={() => onClick(value)}
    >
      <div className={styles.optionInner}>
        <Flexbox horizontal gap={16}>
          <Center className={styles.iconWrapper}>
            <PrefixIcon />
          </Center>
          <Flexbox gap={8}>
            <div className={styles.label}>{label}</div>
            <div className={styles.description}>{description}</div>
          </Flexbox>
        </Flexbox>
        {isSelected && <CheckCircleFilled style={{ fontSize: 16 }} />}
      </div>
      {children}
    </Flexbox>
  );
};
