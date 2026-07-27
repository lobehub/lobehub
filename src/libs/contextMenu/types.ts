import type { SFSymbol } from '@lobechat/electron-client-ipc';
import type { ContextMenuItem, showContextMenu as showWebContextMenu } from '@lobehub/ui';
import type { ItemType } from 'antd/es/menu/interface';

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

type AssertTrue<_T extends true> = never;

export type AssertContextMenuItemArrayAssignable = AssertTrue<
  ContextMenuItem[] extends NativeContextMenuItem[] ? true : false
>;

export type AssertAntdItemTypeArrayAssignable = AssertTrue<
  ItemType[] extends NativeContextMenuItem[] ? true : false
>;
