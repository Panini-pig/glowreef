import { WORLD_H, WORLD_W } from '../sim/config.ts';

/**
 * Canvas UI 的尺寸/排版 token。
 * 只收拢“面板类”元素（悬停卡、法术槽、状态、HUD 帮助入口）；
 * 底部长条/标题/结算等 DOM 面板先保持现状，避免一次改太多。
 */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16 } as const;
export const FONT_SIZE = { xs: 10, sm: 11, md: 12, lg: 14, xl: 20 } as const;
export const LINE_H = { xs: 14, sm: 15, md: 17, lg: 22 } as const;
export const RADIUS = { sm: 8, md: 10, lg: 12 } as const;
export const PAD = { sm: 8, md: 10, lg: 12 } as const;

export const FONT_STACK = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

export function font(weight: number | string, size: number): string {
  return `${weight} ${size}px ${FONT_STACK}`;
}

/** 悬停卡：内容自适应，136–200 宽；4 行（header + 3 行数据）约 74 高。 */
export const CARD = {
  minW: 136,
  maxW: 200,
  pad: PAD.sm,
  headerH: 14,
  rowH: 14,
  gap: 2,
  statusIcon: 9,
  statusGap: 3,
} as const;

/** 法术槽：从 66 收到 62，图标/名称/状态三行更紧。 */
export const SPELL_SLOT = {
  w: 58,
  h: 62,
  gap: SPACE.sm,
  pad: 6,
} as const;

/** 右下角 `? 操作与机制` 入口。 */
export const HELP_HINT = {
  w: 132,
  h: 26,
  margin: SPACE.lg + SPACE.sm,
  bottom: 38,
} as const;

export function helpHintRect(): { x: number; y: number; w: number; h: number } {
  return {
    x: WORLD_W - HELP_HINT.w - HELP_HINT.margin,
    y: WORLD_H - HELP_HINT.bottom - HELP_HINT.h,
    w: HELP_HINT.w,
    h: HELP_HINT.h,
  };
}
