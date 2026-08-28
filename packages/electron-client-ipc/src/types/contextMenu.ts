import type { SFSymbol } from 'sf-symbols-typescript';

declare module 'sf-symbols-typescript' {
  interface Overrides {
    SFSymbolsVersion: '3.0';
  }
}

export type { SFSymbol };

export interface NativeContextMenuItemTemplate {
  checked?: boolean;
  enabled?: boolean;
  id?: string;
  label?: string;
  sfSymbol?: SFSymbol;
  sublabel?: string;
  submenu?: NativeContextMenuItemTemplate[];
  type: 'checkbox' | 'header' | 'normal' | 'separator' | 'submenu';
}

export interface PopupContextMenuParams {
  items: NativeContextMenuItemTemplate[];
}

export interface PopupContextMenuResult {
  clickedId: string | null;
}
