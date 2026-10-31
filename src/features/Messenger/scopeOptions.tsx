import { Avatar, Flexbox, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import WorkspaceAvatar from '@/components/WorkspaceAvatar';

import scopeStyles from './scopeOptions.module.css';

export const PERSONAL_SCOPE = 'personal';

const styles = stylex.create({
  personalTag: {
    cursor: 'default',
    flex: 'none',
    marginBlock: 0,
    marginInlineStart: 'auto',
    marginInlineEnd: '0',
  },
  scopeName: { flexGrow: '0', flexShrink: '1', flexBasis: 'auto', minWidth: 0 },
  scopeOption: { flexGrow: '1', flexShrink: '1', flexBasis: 'auto', width: '100%', minWidth: 0 },
  scopeTitle: { flex: '1', minWidth: 0 },
});

export const messengerScopeSelectClassNames = { value: scopeStyles.scopeValue };

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
  <Flexbox horizontal align="center" className={stylex.props(styles.scopeOption).className} gap={8}>
    {isPersonal ? (
      <Avatar avatar={avatar || label} shape="square" size={20} />
    ) : (
      <WorkspaceAvatar avatar={avatar} name={label} size={20} />
    )}
    <Flexbox
      horizontal
      align="center"
      className={stylex.props(styles.scopeTitle).className}
      gap={6}
    >
      <Text ellipsis className={stylex.props(styles.scopeName).className}>
        {label}
      </Text>
    </Flexbox>
    {isPersonal && personalTagLabel && (
      <Tag className={stylex.props(styles.personalTag).className} variant="filled">
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
