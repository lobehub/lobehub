import { Avatar, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';

export const PERSONAL_SCOPE = 'personal';

const styles = createStaticStyles(({ css }) => ({
  personalTag: css`
    cursor: default;
    flex: none;
    margin-block: 0;
    margin-inline: auto 0;
  `,
  scopeName: css`
    flex: 0 1 auto;
    min-width: 0;
  `,
  scopeOption: css`
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
  `,
  scopeTitle: css`
    flex: 1;
    min-width: 0;
  `,
  scopeValue: css`
    > span {
      display: flex;
      width: 100%;
      min-width: 0;
    }
  `,
}));

export const messengerScopeSelectClassNames = { value: styles.scopeValue };

interface ResolvePersonalScopeLabelParams {
  fallbackLabel: string;
  fullName?: string | null;
}

export const resolvePersonalScopeLabel = ({
  fallbackLabel,
  fullName,
}: ResolvePersonalScopeLabelParams): string => fullName?.trim() || fallbackLabel;

interface ScopeWorkspace {
  avatar?: string | null;
  id: string;
  name: string;
}

interface BuildMessengerScopeOptionsParams {
  personalAvatar?: string | null;
  personalLabel: string;
  personalTagLabel: string;
  workspaces?: ScopeWorkspace[];
}

const renderScopeOption = ({
  avatar,
  isPersonal,
  label,
  personalTagLabel,
}: {
  avatar?: string | null;
  isPersonal?: boolean;
  label: string;
  personalTagLabel?: string;
}) => (
  <Flexbox horizontal align="center" className={styles.scopeOption} gap={8}>
    <Avatar avatar={avatar || label} shape="square" size={20} />
    <Flexbox horizontal align="center" className={styles.scopeTitle} gap={6}>
      <Text ellipsis className={styles.scopeName}>
        {label}
      </Text>
    </Flexbox>
    {isPersonal && personalTagLabel && (
      <Tag className={styles.personalTag} variant="filled">
        {personalTagLabel}
      </Tag>
    )}
  </Flexbox>
);

export const buildMessengerScopeOptions = ({
  personalAvatar,
  personalLabel,
  personalTagLabel,
  workspaces = [],
}: BuildMessengerScopeOptionsParams) => [
  {
    label: renderScopeOption({
      avatar: personalAvatar,
      isPersonal: true,
      label: personalLabel,
      personalTagLabel,
    }),
    title: personalLabel,
    value: PERSONAL_SCOPE,
  },
  ...workspaces.map((workspace) => ({
    label: renderScopeOption({ avatar: workspace.avatar, label: workspace.name }),
    title: workspace.name,
    value: workspace.id,
  })),
];
