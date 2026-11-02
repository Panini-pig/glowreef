import type { BuildingType, Difficulty, LevelStats, SpellId } from './types.ts';

/** 逻辑帧率：联机时服务器也用这个 tick。 */
export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

/** 世界尺寸（渲染按比例缩放）。 */
export const WORLD_W = 1280;
export const WORLD_H = 720;

/** 投送：一次点击 = 一颗光球，球上直接写数字。PACKET_MIN 是最小可投送数量。 */
export const PACKET_MIN = 1;

/** 幼体飞行速度（px/s）。
 *  基准取 110：跨 1/4 屏约 2.9 秒——比之前更慢，肉眼能完整看清一颗球的轨迹。
 *  实际速度还要乘上出发建筑的系数（见 PACKET_SPEED_BY_TYPE）。 */
export const PACKET_SPEED = 110;

/** 各建筑的出兵速度系数：空屋 / 孕育巢 正常，棘堡拖着甲慢一档。 */
export const PACKET_SPEED_BY_TYPE = {
  house: 1,
  barracks: 1,
  fort: 0.62,
  lab: 1,
} as const;

export function packetSpeed(type: BuildingType): number {
  return PACKET_SPEED * (PACKET_SPEED_BY_TYPE[type] ?? 1);
}

/** 一局时长上限（秒）：到点按总战力判胜负。 */
export const MATCH_TIME = 360;

/**
 * 溢出流失（外来投送超过容量后）。
 * 规则（按当前溢出量实时计算）：
 *   溢出 ≤5        → 1.0 / 秒
 *   每多溢出 5 个   → +0.2 / 秒
 *   上限           → 2.0 / 秒
 */
export const OVERFLOW_BASE = 1;
export const OVERFLOW_STEP = 0.2;
export const OVERFLOW_STEP_SIZE = 5;
export const OVERFLOW_MAX = 2;

export function overflowDrainRate(overflow: number): number {
  if (overflow <= 0) return 0;
  const steps = Math.max(0, Math.ceil((overflow - OVERFLOW_STEP_SIZE) / OVERFLOW_STEP_SIZE));
  return Math.min(OVERFLOW_MAX, OVERFLOW_BASE + steps * OVERFLOW_STEP);
}

export type BuildingTable = Record<BuildingType, LevelStats[]>;

/**
 * 建筑数值表（全部 5 级，容量都是 5 的倍数）。
 *
 * - 孕育巢：产能 0.45/0.9/1.35/1.8/2.25，容量 10/20/30/40/50（满仓 22 秒恒定）
 * - 棘堡：不产兵，防御 2/2/3/3/4（整数，只对敌方生效），容量 20/25/30/35/40
 * - 空屋：中立过渡态，容量 10
 *
 * `cost` 表示"升到该等级需要的驻军"：1→2 是 5，2→3 是 10，3→4 是 20，4→5 是 30。
 */
export const BUILDINGS: BuildingTable = {
  house: [
    { production: 0.35, capacity: 10, defense: 1, fireRate: 0, range: 0, damage: 0, cost: 0 },
  ],
  barracks: [
    { production: 0.45, capacity: 10, defense: 1, fireRate: 0, range: 0, damage: 0, cost: 5 },
    { production: 0.9, capacity: 20, defense: 1, fireRate: 0, range: 0, damage: 0, cost: 5 },
    { production: 1.35, capacity: 30, defense: 1, fireRate: 0, range: 0, damage: 0, cost: 10 },
    { production: 1.8, capacity: 40, defense: 1, fireRate: 0, range: 0, damage: 0, cost: 20 },
    { production: 2.25, capacity: 50, defense: 1, fireRate: 0, range: 0, damage: 0, cost: 30 },
  ],
  fort: [
    { production: 0, capacity: 20, defense: 2, fireRate: 0.7, range: 210, damage: 1, cost: 10 },
    { production: 0, capacity: 25, defense: 2, fireRate: 0.9, range: 225, damage: 1.5, cost: 5 },
    { production: 0, capacity: 30, defense: 3, fireRate: 1.1, range: 240, damage: 2, cost: 10 },
    { production: 0, capacity: 35, defense: 3, fireRate: 1.3, range: 250, damage: 2.5, cost: 20 },
    { production: 0, capacity: 40, defense: 4, fireRate: 1.5, range: 260, damage: 3, cost: 30 },
  ],
  /**
   * Lab（实验室）：不产兵，靠玩家把驻军喂进来当"弹药"。
   * 3 级只解锁法术，不提升产能；容量逐级提高，给炼制留缓冲。
   * 升级成本 15 / 20（转化成本见 CONVERT_COST.lab = 10）。
   */
  lab: [
    { production: 0, capacity: 40, defense: 1, fireRate: 0, range: 0, damage: 0, cost: 10 },
    { production: 0, capacity: 60, defense: 1, fireRate: 0, range: 0, damage: 0, cost: 15 },
    { production: 0, capacity: 80, defense: 1, fireRate: 0, range: 0, damage: 0, cost: 20 },
  ],
};

export const MAX_LEVEL = {
  house: 0,
  barracks: BUILDINGS.barracks.length - 1,
  fort: BUILDINGS.fort.length - 1,
  lab: BUILDINGS.lab.length - 1,
};

/**
 * 等级槽位数：空屋 1，孕育巢 / 棘堡 5。
 * 视觉上的“花苞槽位”和这里必须一致，否则会出现“5 级却只有 4 朵花”。
 */
export function levelSlots(type: BuildingType): number {
  return BUILDINGS[type].length;
}

/** 当前等级亮起的槽位数：Lv.1 → 1，Lv.5 → 5。 */
export function openLevelSlots(level: number): number {
  return Math.max(0, level) + 1;
}

/** 转化成本（从空屋变成兵营/堡垒/实验室）。 */
export const CONVERT_COST = {
  barracks: 5,
  fort: 10,
  lab: 10,
} as const;

/** 法术定义。cost = 炼制成功时从 Lab 扣掉的驻军；charge = 炼制时长（秒）。 */
export interface SpellDef {
  id: SpellId;
  name: string;
  cost: number;
  charge: number;
  /** 解锁所需 Lab 等级（0 基）：0 = Lv.1，1 = Lv.2，2 = Lv.3 */
  unlockLevel: number;
  /** 一句话说明，给悬停卡/提示用 */
  brief: string;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  freeze: {
    id: 'freeze',
    name: '冻结',
    cost: 25,
    charge: 15,
    unlockLevel: 0,
    brief: '冰封目标；冰层 = 冻结瞬间驻军，靠派兵 1:1 撞开',
  },
  infect: {
    id: 'infect',
    name: '感染',
    cost: 30,
    charge: 15,
    unlockLevel: 1,
    brief: '30 秒持续掉兵 1.5/s，停产能/停火，防御按 1',
  },
  capture: {
    id: 'capture',
    name: '捕获',
    cost: 50,
    charge: 15,
    unlockLevel: 2,
    brief: '直接把非己方建筑翻成自己的，驻军归 0',
  },
};

/** 固定顺序：法术槽、UI、AI 都按这个顺序。 */
export const SPELL_ORDER: SpellId[] = ['freeze', 'infect', 'capture'];

/** 炼制统一 15 秒；被打断进度清零。 */
export const BREW_TIME = 15;

/** 法术弹道飞行时间（秒）：可见、不可拦截。 */
export const SPELL_TRAVEL = 0.8;

/** 感染持续时间与掉兵速度。 */
export const INFECT_DURATION = 30;
export const INFECT_DPS = 1.5;

/** 计分：占领 ×10 + 升级花费 ×0.5 + 峰值驻军 + 时间奖励（省钱/扩张都算分）。 */
export const SCORE_CAPTURE = 10;
export const SCORE_UPGRADE = 0.5;
export const SCORE_TIME_PER_SEC = 2;
/** 二星线 = 三星线 × 0.7 */
export const STAR2_RATIO = 0.7;

/** 冻结/感染中的建筑不能出兵、升级、转化、炼药。 */
export const STATUS_BLOCK_LABEL = {
  frozen: '冻结',
  infected: '感染',
} as const;

export interface DifficultyConfig {
  /** AI 两次决策之间的间隔（秒）。 */
  think: number;
  /** 出兵所需兵力优势倍率（越大越保守）。 */
  advantage: number;
  /** 升级欲望 0..1。 */
  greed: number;
  /** 多线同时进攻的最大数量。 */
  lanes: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  easy: { think: 1.45, advantage: 2.0, greed: 0.25, lanes: 1 },
  normal: { think: 1.2, advantage: 1.7, greed: 0.5, lanes: 2 },
  hard: { think: 0.85, advantage: 1.45, greed: 0.8, lanes: 2 },
};

/**
 * 战斗结算：伤害 = floor(兵力 / 防御)。
 * 防御是整数：防御 2 表示"两个兵换掉一滴"；非棘堡的防御恒为 1，
 * 也就是"来多少扣多少"。只有敌方投送才吃防御，友方增援原样加。
 */
export function effectiveDamage(count: number, defense: number): number {
  return Math.floor(count / Math.max(1, defense));
}

/** 战力表征：驻军 × 防御，用于底部拔河条与 AI 判断。 */
export function power(garrison: number, defense: number): number {
  const p = garrison * defense;
  return Number.isFinite(p) ? p : 0;
}
