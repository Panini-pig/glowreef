import type { BuildingSpec } from './types.ts';

export interface LevelDef {
  id: number;
  name: string;
  blurb: string;
  /** 计分用的 par 时间（秒）：快于它拿时间奖励 */
  par: number;
  /** 三星线（分数） */
  star3: number;
  specs: BuildingSpec[];
}

const B = (
  id: number,
  type: BuildingSpec['type'],
  faction: BuildingSpec['faction'],
  x: number,
  y: number,
  level: number,
  garrison: number,
): BuildingSpec => ({ id, type, faction, x, y, level, garrison });

/**
 * 关卡 A：对称双翼 + 中央高价值营 + 中央堡垒。
 * 教学意图：先抢两翼空屋，再用中路兵营滚雪球；中路堡垒是"别硬啃"的示范。
 */
const LEVEL_A: LevelDef = {
  id: 0,
  name: '裂谷之口',
  blurb: '两翼空旷，中路有一枚堡垒。先占边，再压中。',
  par: 110,
  star3: 260,
  specs: [
    B(0, 'barracks', 1, 232, 556, 1, 8),
    B(1, 'house', 1, 146, 404, 0, 2),
    B(9, 'house', 1, 330, 620, 0, 2),

    B(2, 'house', 2, 1134, 316, 0, 2),
    B(3, 'barracks', 2, 1048, 164, 1, 8),
    B(10, 'house', 2, 980, 560, 0, 2),

    B(4, 'house', 0, 430, 318, 0, 4),
    B(5, 'house', 0, 850, 402, 0, 4),

    B(6, 'barracks', 0, 640, 236, 1, 6),
    B(7, 'fort', 0, 640, 486, 1, 9),
    B(8, 'house', 0, 640, 628, 0, 3),
  ],
};

/**
 * 关卡 B：四角拉锯 + 两座堡垒 + 中央重装兵营。
 * 教学意图：多线运营；堡垒把地图切成两块，逼你绕路或用法术（Lab 在 M2）。
 */
const LEVEL_B: LevelDef = {
  id: 1,
  name: '黑潮回廊',
  blurb: '四角争锋，两座堡垒卡住腰线。别把兵力浪费在正面。',
  par: 140,
  star3: 340,
  specs: [
    B(0, 'barracks', 1, 196, 296, 1, 8),
    B(1, 'house', 1, 208, 566, 0, 3),
    B(11, 'house', 1, 300, 620, 0, 3),

    B(2, 'house', 2, 1072, 154, 0, 3),
    B(3, 'barracks', 2, 1084, 424, 1, 8),
    B(12, 'house', 2, 980, 560, 0, 3),

    B(4, 'fort', 0, 438, 486, 0, 10),
    B(5, 'fort', 0, 842, 234, 0, 10),

    B(6, 'barracks', 0, 640, 360, 2, 8),
    B(7, 'house', 0, 470, 146, 0, 4),
    B(8, 'house', 0, 812, 574, 0, 4),
    B(9, 'house', 0, 640, 618, 0, 3),
    B(10, 'house', 0, 640, 116, 0, 3),
  ],
};

export const LEVELS: LevelDef[] = [LEVEL_A, LEVEL_B];
