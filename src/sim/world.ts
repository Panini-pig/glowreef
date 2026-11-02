import {
  BUILDINGS,
  BREW_TIME,
  CONVERT_COST,
  INFECT_DPS,
  INFECT_DURATION,
  MATCH_TIME,
  PACKET_MIN,
  SPELLS,
  SPELL_TRAVEL,
  packetSpeed,
  effectiveDamage,
  overflowDrainRate,
  power,
} from './config.ts';
import { LEVELS } from './level.ts';
import type {
  Building,
  Difficulty,
  Faction,
  Packet,
  SimEvent,
  SpellId,
  SpellShot,
  World,
} from './types.ts';

let uid = 0;
function nextId(): number {
  uid += 1;
  return uid;
}

function resolveStats(b: Building): void {
  const table = BUILDINGS[b.type];
  const row = table[Math.min(b.level, table.length - 1)];
  b.production = row.production;
  b.capacity = row.capacity;
  b.defense = row.defense;
  b.fireRate = row.fireRate;
  b.range = row.range;
  b.damage = row.damage;
}

export function createWorld(diff: Difficulty, levelIndex: number): World {
  const level = LEVELS[Math.max(0, Math.min(levelIndex, LEVELS.length - 1))];
  const buildings: Building[] = level.specs.map((spec) => {
    const b: Building = {
      ...spec,
      production: 0,
      capacity: 0,
      defense: 1,
      fireRate: 0,
      range: 0,
      damage: 0,
      fireCd: 0,
      hitFlash: 0,
      captureFlash: 0,
      upgradePulse: 0,
      spawnPulse: 0,
      frozen: 0,
      infectT: 0,
      brew: null,
      brewT: 0,
      potion: null,
    };
    resolveStats(b);
    return b;
  });

  return {
    time: 0,
    buildings,
    packets: [],
    spells: [],
    events: [],
    nextPacketId: 1,
    nextSpellId: 1,
    phase: 'playing',
    diff,
    stats: { sent: 0, captured: 0, lost: 0, upgraded: 0, peak: 0, upgradeSpent: 0, casts: 0 },
    levelId: level.id,
  };
}

export function getBuilding(w: World, id: number): Building | undefined {
  return w.buildings.find((b) => b.id === id);
}

export function isEnemy(a: Faction, b: Faction): boolean {
  return a !== b;
}

/** 感染中的棘堡失去防御加成（按 1 算），所以攻城公式不会除零。 */
export function defenseOf(b: Building): number {
  return b.infectT > 0 ? 1 : b.defense;
}

/** 冻结 = 完全停机；感染只停产能/开火，仍可出兵/升级。 */
export function isFrozen(b: Building): boolean {
  return b.frozen > 0;
}

export function isInfected(b: Building): boolean {
  return b.infectT > 0;
}

/** Lab 能不能炼制：没被冻/感染、没在炼、没有药水、等级解锁、驻军够。 */
export function canStartBrew(b: Building, spell: SpellId): boolean {
  if (b.type !== 'lab') return false;
  if (b.frozen > 0 || b.infectT > 0) return false;
  if (b.brew || b.potion) return false;
  const def = SPELLS[spell];
  return b.level >= def.unlockLevel && b.garrison >= def.cost;
}

/** 某方总战力（用于拔河条 / 判定）。 */
export function factionPower(w: World, f: Faction): number {
  let sum = 0;
  for (const b of w.buildings) {
    if (b.faction === f) sum += power(b.garrison, defenseOf(b));
  }
  // 在途兵力也算一半，避免"兵在天上时条子抖动"
  for (const p of w.packets) {
    if (p.faction === f && !p.dead) sum += p.count * 0.5;
  }
  return sum;
}

export function sendFrame(w: World, faction: Faction): Building[] {
  return w.buildings.filter((b) => b.faction === faction);
}

function pushEvent(w: World, e: SimEvent): void {
  w.events.push(e);
}

/**
 * 投送：一次点击 = 一颗光球，球上的数字就是派出的数量。
 *
 * - `half`：单击，派出 floor(garrison/2)，至少 1 只（会留下家底）
 * - `all` ：双击，派出全部驻军
 *
 * Lab 不出兵：它是弹药库，驻军只能用来炼药/被抢。
 * 冻结中的建筑也不能出兵。
 * actor 必须与 from.faction 一致——否则建筑一旦易主，旧指令还能继续指挥它。
 */
export type SendMode = 'half' | 'all';

export function issueSend(
  w: World,
  fromId: number,
  toId: number,
  actor: Faction,
  mode: SendMode = 'all',
): boolean {
  if (w.phase !== 'playing') return false;
  const from = getBuilding(w, fromId);
  const to = getBuilding(w, toId);
  if (!from || !to) return false;
  if (from.faction !== actor) return false;
  if (from.id === to.id) return false;
  if (from.type === 'lab') return false;
  if (from.frozen > 0) return false;

  const stock = Math.floor(from.garrison);
  const amount = mode === 'all' ? stock : Math.max(1, Math.floor(stock / 2));
  if (stock < PACKET_MIN || amount < PACKET_MIN) return false;

  emitPacket(w, from, to, amount);
  return true;
}

function emitPacket(w: World, from: Building, to: Building, count: number): void {
  const n = Math.min(count, Math.floor(from.garrison));
  if (n <= 0) return;
  from.garrison -= n;
  from.spawnPulse = 1;

  const arc = (w.nextPacketId % 2 === 0 ? 1 : -1) * (0.08 + (w.nextPacketId % 5) * 0.012);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);

  const p: Packet = {
    id: nextId(),
    faction: from.faction,
    count: n,
    fromId: from.id,
    toId: to.id,
    sx: from.x + Math.cos(angle) * 34,
    sy: from.y - 14 + Math.sin(angle) * 34,
    tx: to.x,
    ty: to.y - 14,
    x: from.x + Math.cos(angle) * 34,
    y: from.y - 14 + Math.sin(angle) * 34,
    px: from.x + Math.cos(angle) * 34,
    py: from.y - 14 + Math.sin(angle) * 34,
    t: 0,
    prevT: 0,
    speed: packetSpeed(from.type),
    arc,
    dead: false,
  };
  w.packets.push(p);
  w.nextPacketId += 1;
  if (from.faction === 1) w.stats.sent += n;
  pushEvent(w, { type: 'spawn', x: from.x, y: from.y, faction: from.faction, amount: n });
}

/** 升级：消耗驻军，提升等级。冻结中不能升级；炼药/带药水的 Lab 不能升级。 */
export function upgradeBuilding(w: World, id: number, actor: Faction): boolean {
  if (w.phase !== 'playing') return false;
  const b = getBuilding(w, id);
  if (!b || b.faction !== actor) return false;
  if (b.frozen > 0) return false;
  if (b.type === 'lab' && (b.brew || b.potion)) return false;
  const table = BUILDINGS[b.type];
  if (b.level >= table.length - 1) return false;
  const cost = table[b.level + 1].cost;
  if (b.garrison < cost) return false;
  b.garrison -= cost;
  b.level += 1;
  resolveStats(b);
  b.upgradePulse = 1;
  if (b.faction === 1) {
    w.stats.upgraded += 1;
    w.stats.upgradeSpent += cost;
  }
  pushEvent(w, { type: 'upgrade', x: b.x, y: b.y, faction: b.faction, amount: cost });
  return true;
}

/** 转化：空屋 → 兵营 / 堡垒 / 实验室。 */
export function convertBuilding(
  w: World,
  id: number,
  target: 'barracks' | 'fort' | 'lab',
  actor: Faction,
): boolean {
  if (w.phase !== 'playing') return false;
  const b = getBuilding(w, id);
  if (!b || b.faction !== actor) return false;
  if (b.frozen > 0) return false;
  if (b.type !== 'house') return false;
  const cost = CONVERT_COST[target];
  if (b.garrison < cost) return false;
  b.garrison -= cost;
  b.type = target;
  b.level = 0;
  resolveStats(b);
  b.upgradePulse = 1;
  pushEvent(w, { type: 'convert', x: b.x, y: b.y, faction: b.faction, amount: cost });
  return true;
}

/**
 * 开始炼制：Lab 驻军必须 ≥ 成本，且整段 15 秒内不能被扣到成本以下。
 * 成本在"炼成"时才扣；中途被打断（掉兵/冻结/感染/被攻占）则进度清零。
 */
export function startBrew(w: World, labId: number, spell: SpellId, actor: Faction): boolean {
  if (w.phase !== 'playing') return false;
  const b = getBuilding(w, labId);
  if (!b || b.faction !== actor) return false;
  if (!canStartBrew(b, spell)) return false;
  b.brew = spell;
  b.brewT = 0;
  pushEvent(w, { type: 'brew', x: b.x, y: b.y, faction: b.faction, spell });
  return true;
}

/** 取消炼制：不扣兵、进度清零；已炼成的药水不能被"取消"，只能释放或被打断。 */
export function cancelBrew(w: World, labId: number, actor: Faction): boolean {
  if (w.phase !== 'playing') return false;
  const b = getBuilding(w, labId);
  if (!b || b.faction !== actor || b.type !== 'lab') return false;
  if (!b.brew) return false;
  b.brew = null;
  b.brewT = 0;
  pushEvent(w, { type: 'interrupt', x: b.x, y: b.y, faction: b.faction });
  return true;
}

/** 冻结/感染/被攻占都会打断炼制，并把就绪的药水一起作废。 */
function interruptBrew(w: World, b: Building): void {
  if (!b.brew && !b.potion) return;
  b.brew = null;
  b.brewT = 0;
  b.potion = null;
  pushEvent(w, { type: 'interrupt', x: b.x, y: b.y, faction: b.faction });
}

/**
 * 释放药水：Lab 必须已有 potion，目标必须是非己方建筑。
 * 释放只消耗药水；炼成时成本已经扣过，不会二次扣兵。
 */
export function releaseSpell(
  w: World,
  labId: number,
  targetId: number,
  actor: Faction,
): boolean {
  if (w.phase !== 'playing') return false;
  const b = getBuilding(w, labId);
  const target = getBuilding(w, targetId);
  if (!b || !target) return false;
  if (b.faction !== actor || b.type !== 'lab') return false;
  if (!b.potion) return false;
  if (b.frozen > 0 || b.infectT > 0) return false;
  if (target.faction === actor) return false;
  if (b.potion === 'freeze' && target.frozen > 0) return false;
  if (b.potion === 'infect' && target.infectT > 0) return false;

  const spell = b.potion;
  b.potion = null;
  if (b.faction === 1) w.stats.casts += 1;

  const angle = Math.atan2(target.y - b.y, target.x - b.x);
  const shot: SpellShot = {
    id: w.nextSpellId++,
    spell,
    faction: b.faction,
    fromId: b.id,
    toId: target.id,
    sx: b.x + Math.cos(angle) * 30,
    sy: b.y - 12 + Math.sin(angle) * 30,
    tx: target.x,
    ty: target.y - 14,
    x: b.x + Math.cos(angle) * 30,
    y: b.y - 12 + Math.sin(angle) * 30,
    px: b.x + Math.cos(angle) * 30,
    py: b.y - 12 + Math.sin(angle) * 30,
    t: 0,
    prevT: 0,
    arc: (w.nextSpellId % 2 === 0 ? 1 : -1) * 0.12,
    dead: false,
  };
  w.spells.push(shot);
  pushEvent(w, { type: 'cast', x: b.x, y: b.y, faction: b.faction, spell });
  return true;
}

function capture(w: World, b: Building, faction: Faction, leftover: number): void {
  const previous = b.faction;
  interruptBrew(w, b);
  b.frozen = 0;
  b.infectT = 0;
  b.faction = faction;
  b.garrison = Math.max(0, leftover);
  b.captureFlash = 1;
  if (faction === 1) {
    w.stats.captured += 1;
    // 捕获保留驻军时，峰值也要立刻算进去（否则最后一击直接结算会漏掉）
    if (b.garrison > w.stats.peak) w.stats.peak = b.garrison;
  } else if (previous === 1) {
    w.stats.lost += 1;
  }
  pushEvent(w, { type: 'capture', x: b.x, y: b.y, faction, amount: Math.round(b.garrison) });
}

function resolveArrival(w: World, p: Packet): void {
  const target = getBuilding(w, p.toId);
  p.dead = true;
  if (!target) return;
  if (target.faction === p.faction) {
    // 己方投送撞冻结层：1 兵 = 1 冰，撞开即停；解冻兵不进驻。
    if (target.frozen > 0) {
      target.frozen = Math.max(0, target.frozen - p.count);
      pushEvent(w, {
        type: target.frozen > 0 ? 'hit' : 'thaw',
        x: target.x,
        y: target.y,
        faction: p.faction,
        amount: p.count,
      });
      return;
    }
    // 友方增援"来多少加多少"，允许超过容量（超出部分由 tick 里的溢出流失处理）
    target.garrison += p.count;
    pushEvent(w, { type: 'hit', x: target.x, y: target.y, faction: p.faction, amount: p.count });
    return;
  }

  const dmg = effectiveDamage(p.count, defenseOf(target));
  target.hitFlash = 1;
  pushEvent(w, {
    type: 'hit',
    x: target.x,
    y: target.y,
    faction: p.faction,
    amount: Math.round(dmg * 10) / 10,
  });

  if (dmg >= target.garrison) {
    const leftover = Math.floor(dmg - target.garrison);
    capture(w, target, p.faction, leftover);
  } else {
    target.garrison = Math.max(0, target.garrison - dmg);
    if (target.garrison < 0.05) target.garrison = 0;
  }
}

function bezier(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  arc: number,
  t: number,
): { x: number; y: number } {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * len * arc;
  const cy = my + (dx / len) * len * arc;
  const it = 1 - t;
  const x = it * it * sx + 2 * it * t * cx + t * t * tx;
  const y = it * it * sy + 2 * it * t * cy + t * t * ty;
  return { x, y };
}

function fireForts(w: World, dt: number): void {
  for (const fort of w.buildings) {
    if (fort.type !== 'fort') continue;
    // 冻结/感染的堡垒不开火；中立（白色）棘堡仍然谁路过打谁
    if (fort.frozen > 0 || fort.infectT > 0) continue;
    fort.fireCd -= dt;
    if (fort.fireCd > 0) continue;

    let best: Packet | null = null;
    let bestD = Infinity;
    for (const p of w.packets) {
      if (p.dead) continue;
      // 有主之地不打自己人；中立之地谁路过打谁
      if (fort.faction !== 0 && p.faction === fort.faction) continue;
      const d = Math.hypot(p.x - fort.x, p.y - fort.y);
      if (d <= fort.range && d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) {
      fort.fireCd = 0;
      continue;
    }
    fort.fireCd = 1 / Math.max(0.1, fort.fireRate);
    best.count -= fort.damage;
    pushEvent(w, {
      type: 'shot',
      x: fort.x,
      y: fort.y,
      x2: best.x,
      y2: best.y,
      faction: fort.faction,
    });
    if (best.count <= 0) {
      best.count = 0;
      best.dead = true;
      pushEvent(w, { type: 'wither', x: best.x, y: best.y, faction: best.faction });
    }
  }
}

function applySpell(w: World, shot: SpellShot): void {
  const target = getBuilding(w, shot.toId);
  if (!target || target.faction === shot.faction) return; // 目标已经易主 → 空放

  if (shot.spell === 'freeze') {
    if (target.frozen > 0) return;
    // 冰层 = 冻结瞬间驻军，至少 1；友方投送按 1:1 撞开
    target.frozen = Math.max(1, Math.round(target.garrison));
    interruptBrew(w, target);
    pushEvent(w, {
      type: 'freeze',
      x: target.x,
      y: target.y,
      faction: shot.faction,
      amount: target.frozen,
      spell: 'freeze',
    });
  } else if (shot.spell === 'infect') {
    if (target.infectT > 0) return;
    target.infectT = INFECT_DURATION;
    interruptBrew(w, target);
    pushEvent(w, {
      type: 'infect',
      x: target.x,
      y: target.y,
      faction: shot.faction,
      amount: INFECT_DURATION,
      spell: 'infect',
    });
  } else {
    // 捕获只换归属：驻军原样保留（含溢出），冻结/感染/炼制/药水由 capture 清空
    capture(w, target, shot.faction, target.garrison);
  }
  pushEvent(w, {
    type: 'spellhit',
    x: target.x,
    y: target.y,
    faction: shot.faction,
    spell: shot.spell,
  });
}

function tickSpells(w: World, dt: number): void {
  for (const s of w.spells) {
    if (s.dead) continue;
    s.prevT = s.t;
    s.t += dt / SPELL_TRAVEL;
    if (s.t >= 1) {
      s.t = 1;
      const pos = bezier(s.sx, s.sy, s.tx, s.ty, s.arc, 1);
      s.x = pos.x;
      s.y = pos.y;
      applySpell(w, s);
      s.dead = true;
    } else {
      const pos = bezier(s.sx, s.sy, s.tx, s.ty, s.arc, s.t);
      s.px = s.x;
      s.py = s.y;
      s.x = pos.x;
      s.y = pos.y;
    }
  }
  w.spells = w.spells.filter((s) => !s.dead);
}

function checkEnd(w: World): void {
  if (w.phase !== 'playing') return;
  const allMine = w.buildings.every((b) => b.faction === 1);
  const noneMine = w.buildings.every((b) => b.faction !== 1);

  // 与原作一致：要"点亮整张图"才算赢，而不是把对手赶走就结束
  if (allMine) {
    w.phase = 'won';
    pushEvent(w, { type: 'win', x: 640, y: 360, faction: 1 });
    return;
  }
  if (noneMine) {
    w.phase = 'lost';
    pushEvent(w, { type: 'lose', x: 640, y: 360, faction: 2 });
    return;
  }
  if (w.time >= MATCH_TIME) {
    const a = factionPower(w, 1);
    const b = factionPower(w, 2);
    w.phase = a >= b ? 'won' : 'lost';
    pushEvent(w, { type: 'win', x: 640, y: 360, faction: w.phase === 'won' ? 1 : 2 });
  }
}

export function tick(w: World, dt: number): void {
  if (w.phase !== 'playing') return;
  w.time += dt;

  // 1. 状态 → 生产 → 炼药（顺序固定，联机可复现）
  for (const b of w.buildings) {
    // 感染：持续掉兵，掉到 0 为止；到点自动解除
    if (b.infectT > 0) {
      b.infectT = Math.max(0, b.infectT - dt);
      b.garrison = Math.max(0, b.garrison - INFECT_DPS * dt);
      if (b.infectT === 0) {
        pushEvent(w, { type: 'cure', x: b.x, y: b.y, faction: b.faction });
      }
    }

    // 生产：冻结/感染时不产兵
    if (b.frozen <= 0 && b.infectT <= 0 && b.production > 0 && b.garrison < b.capacity) {
      b.garrison = Math.min(b.capacity, b.garrison + b.production * dt);
    }
    const overflow = b.garrison - b.capacity;
    if (overflow > 0) {
      const rate = overflowDrainRate(overflow);
      b.garrison = Math.max(b.capacity, b.garrison - rate * dt);
    }
    if (b.faction === 1 && b.garrison > w.stats.peak) w.stats.peak = b.garrison;
    b.hitFlash = Math.max(0, b.hitFlash - dt * 3.2);
    b.captureFlash = Math.max(0, b.captureFlash - dt * 1.4);
    b.upgradePulse = Math.max(0, b.upgradePulse - dt * 1.8);
    b.spawnPulse = Math.max(0, b.spawnPulse - dt * 4);

    // 炼制：被冻/感染、驻军跌破成本、或 Lab 易主都会中断
    if (b.brew) {
      const def = SPELLS[b.brew];
      if (b.frozen > 0 || b.infectT > 0 || b.garrison < def.cost) {
        interruptBrew(w, b);
      } else {
        b.brewT += dt;
        if (b.brewT >= BREW_TIME) {
          const spell = b.brew;
          b.garrison = Math.max(0, b.garrison - def.cost);
          b.potion = spell;
          b.brew = null;
          b.brewT = 0;
          pushEvent(w, {
            type: 'potion',
            x: b.x,
            y: b.y,
            faction: b.faction,
            spell,
          });
        }
      }
    }
  }

  // 2. 飞行（投送已改为"点击即一颗球"，不再有持续的出兵指令）
  for (const p of w.packets) {
    if (p.dead) continue;
    p.prevT = p.t;
    const dist = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1;
    p.t += (p.speed * dt) / dist;
    if (p.t >= 1) {
      p.t = 1;
      const pos = bezier(p.sx, p.sy, p.tx, p.ty, p.arc, 1);
      p.x = pos.x;
      p.y = pos.y;
      resolveArrival(w, p);
    } else {
      const pos = bezier(p.sx, p.sy, p.tx, p.ty, p.arc, p.t);
      p.px = p.x;
      p.py = p.y;
      p.x = pos.x;
      p.y = pos.y;
    }
  }
  w.packets = w.packets.filter((p) => !p.dead);

  // 3. 法术弹道（不可拦截）
  tickSpells(w, dt);

  // 4. 堡垒开火
  fireForts(w, dt);

  // 5. 结算
  checkEnd(w);
}

/** 渲染插值：把 30Hz 的 t 拉成 60fps 的平滑位置。 */
export function packetPos(p: Packet, alpha: number): { x: number; y: number } {
  const t = p.prevT + (p.t - p.prevT) * alpha;
  return bezier(p.sx, p.sy, p.tx, p.ty, p.arc, Math.min(1, Math.max(0, t)));
}

/** 法术弹道的渲染插值。 */
export function spellPos(s: SpellShot, alpha: number): { x: number; y: number } {
  const t = s.prevT + (s.t - s.prevT) * alpha;
  return bezier(s.sx, s.sy, s.tx, s.ty, s.arc, Math.min(1, Math.max(0, t)));
}

/** 给 UI/AI 用：某座 Lab 现在能炼哪些法术。 */
export function unlockedSpells(b: Building): SpellId[] {
  if (b.type !== 'lab') return [];
  return (Object.keys(SPELLS) as SpellId[]).filter((id) => b.level >= SPELLS[id].unlockLevel);
}

/** 给 UI/AI 用：某座建筑是不是合法的法术目标。 */
export function isValidSpellTarget(
  target: Building,
  spell: SpellId,
  actor: Faction,
): boolean {
  if (target.faction === actor) return false;
  if (spell === 'freeze' && target.frozen > 0) return false;
  if (spell === 'infect' && target.infectT > 0) return false;
  return true;
}
