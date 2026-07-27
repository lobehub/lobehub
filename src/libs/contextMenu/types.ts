import type { SFSymbol } from '@lobechat/electron-client-ipc';
import type { ContextMenuItem, showContextMenu as showWebContextMenu } from '@lobehub/ui';

type NativeMenuIcon = {
  sfSymbol?: SFSymbol;
};

type WithSfSymbol<T> = T extends null
  ? null
  : T extends { children: (infer Item)[] }
    ? Omit<T, 'children'> & NativeMenuIcon & { children: WithSfSymbol<Item>[] }
    : T extends { children?: (infer Item)[] }
      ? Omit<T, 'children'> & NativeMenuIcon & { children?: WithSfSymbol<Item>[] }
      : T & NativeMenuIcon;

export type NativeContextMenuItem = WithSfSymbol<ContextMenuItem>;

export type ShowContextMenuOptions = NonNullable<Parameters<typeof showWebContextMenu>[1]>;
