import type { Building, Faction } from '../sim/types.ts';

/**
 * 框选命中判定（纯函数，无 DOM / Canvas）。
 *
 * 约定：
 *  - 只看“塔的中心点”，不是碰撞体；中心点取 (x, y - 6)，和 buildingAt 的点击中心一致。
 *  - 只选指定阵营（游戏里传 1 = 玩家）；敌方 / 中立即使整个被框住也不选。
 *  - 0.6px 容差：屏幕坐标 → 世界坐标有浮点误差，正好压在框边上的塔也应该算进来。
 *
 * 放在 input/ 而不是 sim/：它服务的是玩家输入，不是权威服务器逻辑。
 */
export interface SelectRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SelectableBuilding = Pick<Building, 'id' | 'faction' | 'x' | 'y'>;

export const SELECT_CENTER_Y_OFFSET = -6;
export const SELECT_EPS = 0.6;

export function buildingsInRect(
  buildings: readonly SelectableBuilding[],
  rect: SelectRect,
  faction: Faction,
  eps = SELECT_EPS,
): number[] {
  const ids: number[] = [];
  for (const b of buildings) {
    if (b.faction !== faction) continue;
    const cx = b.x;
    const cy = b.y + SELECT_CENTER_Y_OFFSET;
    if (cx < rect.x - eps || cx > rect.x + rect.w + eps) continue;
    if (cy < rect.y - eps || cy > rect.y + rect.h + eps) continue;
    ids.push(b.id);
  }
  return ids;
}
