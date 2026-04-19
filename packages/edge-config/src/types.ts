import type { BusinessEdgeConfigData } from '@lobechat/business-config/server';

/**
 * Billboard 单条 item 的可本地化字段。
 * cover / linkUrl / 顺序 / 时间窗口不翻译。
 */
export interface BillboardItemLocaleFields {
  description?: string;
  linkLabel?: string;
  title?: string;
}

/**
 * Billboard 轮播项（Home sidebar 左下角运营卡片的单条内容）
 */
export interface BillboardItem {
  cover?: string | null;
  description: string;
  /**
   * 每个 locale 的覆盖文案。缺失时回退到默认字段（title / description / linkLabel）。
   * key 采用 LobeHub locale code（如 `zh-CN`、`en-US`、`ja-JP`）。
   */
  i18n?: Record<string, BillboardItemLocaleFields>;
  id: number;
  linkLabel?: string | null;
  linkUrl?: string | null;
  title: string;
}

/**
 * Billboard 级别的可本地化字段（当前仅 title）。
 */
export interface BillboardLocaleFields {
  title?: string;
}

/**
 * Billboard set（一组 items 在前端轮播）。
 * 在 Sprint-style 模型下，每个 env 最多 1 个 set；
 * 实际展示还受 startAt / endAt 时间窗口约束。
 */
export interface BillboardSet {
  /** ISO timestamp — 时间窗口结束，到点后 LobeHub 不再展示 */
  endAt: string;
  /**
   * 按 locale 覆盖 billboard 级别的文案（当前仅 title，用于 ? 菜单）。
   */
  i18n?: Record<string, BillboardLocaleFields>;
  id: number;
  items: BillboardItem[];
  /** 唯一标识符 */
  slug: string;
  /** ISO timestamp — 时间窗口开始，未到时 LobeHub 不展示 */
  startAt: string;
  /** 用于 ? 菜单展示 */
  title: string;
}

/**
 * Edge Config 中存放的 Billboard 纯内容。Sprint-style 每个 env 只有 1 条或 null。
 */
export type BillboardSnapshot = BillboardSet | null;

/**
 * EdgeConfig complete configuration type
 */
export interface EdgeConfigData extends BusinessEdgeConfigData {
  /**
   * Assistant blacklist
   */
  assistant_blacklist?: string[];
  /**
   * Assistant whitelist
   */
  assistant_whitelist?: string[];

  /**
   * Billboard snapshot. 每个 Vercel 部署读自己 store 里的 `billboards` key——
   * dev 部署指向 dev store，prod 部署指向 prod store，LobeHub 侧无感知。
   */
  billboards?: BillboardSnapshot;

  /**
   * Feature flags configuration
   */
  feature_flags?: Record<string, boolean | string[]>;
}

export type EdgeConfigKeys = keyof EdgeConfigData;
