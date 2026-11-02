/**
 * 模拟层类型定义。
 *
 * 设计约束（为了后面接联机）：
 *  - 这里不出现任何 DOM / Canvas 引用；
 *  - 所有状态都是可序列化的纯数据（JSON 友好）；
 *  - 浮点只用于"进度/时间"，兵力与归属用整数/枚举。
 */

export type Faction = 0 | 1 | 2; // 0 = 中立，1 = 玩家（青），2 = 敌方（玫红）

export type BuildingType = 'house' | 'barracks' | 'fort' | 'lab';

export type SpellId = 'freeze' | 'infect' | 'capture';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface LevelStats {
  production: number; // 只/秒
  capacity: number; // 驻军上限
  defense: number; // 防御系数：来犯兵力 / defense 才是有效伤害
  fireRate: number; // 每秒开火次数（堡垒）
  range: number; // 射程（px）
  damage: number; // 单发伤害（只）
  cost: number; // 达到该等级需要的幼体
}

export interface BuildingSpec {
  id: number;
  type: BuildingType;
  faction: Faction;
  x: number;
  y: number;
  level: number;
  garrison: number;
}

export interface Building extends BuildingSpec {
  production: number;
  capacity: number;
  defense: number;
  fireRate: number;
  range: number;
  damage: number;
  fireCd: number;
  hitFlash: number;
  captureFlash: number;
  upgradePulse: number;
  spawnPulse: number;
  /** 冻结：>0 = 剩余冰层，必须靠友方投送按 1:1 撞开 */
  frozen: number;
  /** 感染：剩余秒数；>0 时停产能/停火/防御按 1 */
  infectT: number;
  /** 正在炼制的法术；null = 没在炼 */
  brew: SpellId | null;
  /** 炼制已进行的秒数 */
  brewT: number;
  /** 已炼成、等待释放的药水；null = 没有 */
  potion: SpellId | null;
}

export interface Packet {
  id: number;
  faction: Faction;
  count: number;
  fromId: number;
  toId: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  x: number;
  y: number;
  px: number;
  py: number;
  t: number; // 0..1 飞行进度
  prevT: number; // 上一 tick 的进度（渲染插值用）
  speed: number;
  arc: number; // 弧线弯曲量，正负决定上下弯
  dead: boolean;
}

/** 法术弹道：可见、不可拦截；命中后结算对应法术。 */
export interface SpellShot {
  id: number;
  spell: SpellId;
  faction: Faction;
  fromId: number;
  toId: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  x: number;
  y: number;
  px: number;
  py: number;
  t: number;
  prevT: number;
  arc: number;
  dead: boolean;
}

export type SimEventType =
  | 'spawn'
  | 'hit'
  | 'capture'
  | 'shot'
  | 'upgrade'
  | 'convert'
  | 'wither'
  | 'freeze'
  | 'thaw'
  | 'infect'
  | 'cure'
  | 'brew'
  | 'potion'
  | 'interrupt'
  | 'cast'
  | 'spellhit'
  | 'win'
  | 'lose';

export interface SimEvent {
  type: SimEventType;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  faction: Faction;
  amount?: number;
  spell?: SpellId;
}

export interface RunStats {
  sent: number;
  captured: number;
  lost: number;
  upgraded: number;
  peak: number;
  /** 升级花掉的驻军总和（计分用；转化不计） */
  upgradeSpent: number;
  /** 成功释放的法术次数 */
  casts: number;
}

export interface World {
  time: number;
  buildings: Building[];
  packets: Packet[];
  spells: SpellShot[];
  events: SimEvent[];
  nextPacketId: number;
  nextSpellId: number;
  phase: 'playing' | 'won' | 'lost';
  diff: Difficulty;
  stats: RunStats;
  levelId: number;
}
