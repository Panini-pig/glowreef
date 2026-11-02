import { BUILDINGS, CONVERT_COST, DIFFICULTY, SPELLS, SPELL_ORDER } from './config.ts';
import {
  convertBuilding,
  defenseOf,
  isValidSpellTarget,
  issueSend,
  releaseSpell,
  startBrew,
  upgradeBuilding,
} from './world.ts';
import type { Building, Faction, SpellId, World } from './types.ts';

export interface AIState {
  timer: number;
  rng: number;
  /** 每座塔上一次出兵的时间：同一座塔不能连着每 0.9 秒就往外倒一次兵 */
  lastSend: Record<number, number>;
}

export function createAI(seed = 1): AIState {
  return { timer: 0, rng: seed >>> 0, lastSend: {} };
}

/** 同一座塔两次出兵的最小间隔（秒）。 */
export const AI_SEND_COOLDOWN = 1.8;

/** 所有 AI 出兵（进攻/喂 Lab/解冻）都走同一套同塔冷却。 */
function canSend(ai: AIState, id: number, time: number): boolean {
  return time - (ai.lastSend[id] ?? -99) >= AI_SEND_COOLDOWN;
}

function markSend(ai: AIState, id: number, time: number): void {
  ai.lastSend[id] = time;
}

function rand(ai: AIState): number {
  // xorshift32，确定性且够用
  let x = ai.rng || 1;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;
  x >>>= 0;
  ai.rng = x;
  return (x >>> 0) / 4294967296;
}

function targetValue(b: Building, from: Building): number {
  const typeW = b.type === 'barracks' ? 1.5 : b.type === 'fort' ? 0.55 : b.type === 'lab' ? 1.2 : 1.05;
  const ownedW = b.faction === 0 ? 1.0 : 1.25;
  const levelW = 1 + b.level * 0.22;
  const toughness = 1 + (b.garrison * defenseOf(b)) / 14;
  const dist = Math.hypot(b.x - from.x, b.y - from.y);
  const distW = 1 + dist / 780;
  return (typeW * ownedW * levelW) / (toughness * distW);
}

/** 战况压力：对面棘堡越多、越高价值，AI 越有理由走法术线。 */
function spellPressure(w: World, faction: Faction): number {
  let p = 0;
  for (const b of w.buildings) {
    if (b.faction === faction) continue;
    if (b.type === 'fort' && b.garrison >= 6) p += 0.55;
    if (b.type === 'barracks' && b.level >= 2) p += 0.3;
    if (b.type === 'lab') p += 0.2;
  }
  return Math.min(1.6, p);
}

function unlocked(lab: Building): SpellId[] {
  return SPELL_ORDER.filter((id) => lab.level >= SPELLS[id].unlockLevel);
}

/** 为某个法术挑一个最值得的目标（冻棘堡、感染大据点、捕获高价值）。 */
export function bestSpellTarget(
  w: World,
  faction: Faction,
  spell: SpellId,
): Building | null {
  const targets = w.buildings.filter((b) => isValidSpellTarget(b, spell, faction));
  if (targets.length === 0) return null;
  const score = (b: Building): number => {
    const typeW =
      b.type === 'fort' ? 2.0 : b.type === 'barracks' ? 1.6 : b.type === 'lab' ? 1.45 : 0.8;
    const levelW = 1 + b.level * 0.3;
    if (spell === 'freeze') return typeW * levelW + b.garrison * 0.02;
    if (spell === 'infect') return typeW * levelW + b.garrison * 0.05;
    return typeW * levelW + b.garrison * 0.04;
  };
  return targets.slice().sort((a, b) => score(b) - score(a))[0] ?? null;
}

interface Candidate {
  score: number;
  run: () => boolean;
}

/**
 * 敌方 AI：每 N 秒做一次决策。
 *
 * M2.1 起改成"三条线动态评分，取最高"：
 *   - 经济线：紧急补兵营、升级、转化空屋
 *   - 军事线：进攻 / 抓空档
 *   - 法术线：造 Lab（全局最多 1 座）、炼制、释放、解冻
 * 每条线给出 0~5 的分数，取最高且执行成功的动作；难度只调反应/贪婪/多线，不改数值。
 */
export function updateAI(w: World, ai: AIState, dt: number, faction: Faction = 2): void {
  if (w.phase !== 'playing') return;
  const cfg = DIFFICULTY[w.diff];
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer = cfg.think * (0.75 + rand(ai) * 0.5);

  const mine = w.buildings.filter((b) => b.faction === faction);
  if (mine.length === 0) return;

  const barracks = mine.filter((b) => b.type === 'barracks');
  const houses = mine.filter((b) => b.type === 'house');
  const labs = mine.filter((b) => b.type === 'lab');
  const ownLab = labs[0];
  const targets = w.buildings.filter((b) => b.faction !== faction);
  const pressure = spellPressure(w, faction);
  /** 难度只调“反应/贪婪/多线”，法术线也按 greed 缩放：简单少走法术，凶猛更主动。 */
  const spellWeight = 0.6 + cfg.greed;
  const actions: Candidate[] = [];

  // ---------- 法术线 ----------
  // 就绪的药水优先放；目标在计划时选好，失败就落到下一条线。
  if (ownLab?.potion) {
    const target = bestSpellTarget(w, faction, ownLab.potion);
    if (target) {
      actions.push({
        score: 5,
        run: () => releaseSpell(w, ownLab.id, target.id, faction),
      });
    }
  }

  // 自己的建筑被冻住：派兵撞冰（优先救 Lab，其次救兵营）
  for (const frozen of mine.filter((b) => b.frozen > 0)) {
    const ice = Math.ceil(frozen.frozen);
    const src = barracks
      .filter((b) => Math.floor(b.garrison) >= ice + 1)
      .sort((a, b) => a.garrison - b.garrison)[0];
    if (src) {
      actions.push({
        score: frozen.type === 'lab' ? 4.2 : 3.4,
        run: () => {
          if (!canSend(ai, src.id, w.time)) return false;
          if (!issueSend(w, src.id, frozen.id, faction, 'all')) return false;
          markSend(ai, src.id, w.time);
          return true;
        },
      });
    }
  }

  // Lab 空闲：驻军不够就喂兵；够了就按当前最值钱的法术开始炼制
  if (ownLab && !ownLab.brew && !ownLab.potion && ownLab.frozen <= 0 && ownLab.infectT <= 0) {
    const unlockedNow = unlocked(ownLab);
    const need = Math.min(...unlockedNow.map((id) => SPELLS[id].cost));
    if (ownLab.garrison < need) {
      const feeder = barracks
        .filter((b) => b.garrison >= 10)
        .sort((a, b) => b.garrison - a.garrison)[0];
      if (feeder) {
        actions.push({
          score: 2.3 * spellWeight + pressure * 0.4,
          run: () => {
            if (!canSend(ai, feeder.id, w.time)) return false;
            if (!issueSend(w, feeder.id, ownLab.id, faction, 'half')) return false;
            markSend(ai, feeder.id, w.time);
            return true;
          },
        });
      }
    }

    const options = unlockedNow
      .map((spell) => {
        const target = bestSpellTarget(w, faction, spell);
        const def = SPELLS[spell];
        const affordable = ownLab.garrison >= def.cost;
        const worth =
          spell === 'freeze'
            ? target &&
              (target.type === 'fort' ? 1.4 : target.type === 'barracks' && target.garrison >= 12 ? 0.9 : 0.4)
            : spell === 'infect'
              ? target && (target.garrison >= 8 ? 1.0 : 0.2)
              : target && (target.level >= 1 || target.type === 'fort' ? 1.1 : 0.3);
        return { spell, score: worth ?? 0, target, affordable };
      })
      .filter((o) => o.target && o.affordable && o.score > 0.5)
      .sort((a, b) => b.score - a.score);

    if (options[0]) {
      const spell = options[0].spell;
      actions.push({
        score: 3.4 * spellWeight + pressure * 0.6,
        run: () => startBrew(w, ownLab.id, spell, faction),
      });
    }
  }

  // Lab 升级：解锁感染 / 捕获（只在没在炼制、没存药水时）
  if (ownLab && ownLab.level < 2 && !ownLab.brew && !ownLab.potion) {
    const table = BUILDINGS.lab;
    const cost = table[ownLab.level + 1].cost;
    if (ownLab.garrison > cost * 2 + 2) {
      actions.push({
        score: 1.9 * spellWeight + pressure * 0.3,
        run: () => upgradeBuilding(w, ownLab.id, faction),
      });
    }
  }

  // 还没有 Lab：先把一座空屋喂到 10（转化只看成本，可花到 0），再改成 Lab。
  // 空屋容量正好 10，所以喂满即可，不要求溢出。
  if (!ownLab && houses.length > 0 && barracks.length >= 2 && pressure > 0.2) {
    const h = houses.slice().sort((a, b) => b.garrison - a.garrison)[0];
    const need = CONVERT_COST.lab;
    if (h.garrison < need) {
      const feeder = barracks
        .filter((b) => b.garrison >= 10)
        .sort((a, b) => b.garrison - a.garrison)[0];
      if (feeder) {
        actions.push({
          score: 2.6 * spellWeight + pressure * 0.5,
          run: () => {
            if (!canSend(ai, feeder.id, w.time)) return false;
            if (!issueSend(w, feeder.id, h.id, faction, 'half')) return false;
            markSend(ai, feeder.id, w.time);
            return true;
          },
        });
      }
    } else {
      actions.push({
        score: 2.8 * spellWeight + pressure * 0.8,
        run: () => convertBuilding(w, h.id, 'lab', faction),
      });
    }
  }

  // ---------- 经济线 ----------
  // 紧急：一个兵营都没有时，先把最肥的空屋变成兵营
  if (barracks.length === 0 && houses.length > 0) {
    const h = houses.reduce((a, b) => (a.garrison > b.garrison ? a : b));
    if (h.garrison >= CONVERT_COST.barracks) {
      actions.push({
        score: 4.5,
        run: () => convertBuilding(w, h.id, 'barracks', faction),
      });
    }
  }

  // 升级：手里有闲钱就升产能最高的兵营
  if (barracks.length > 0 && rand(ai) < cfg.greed) {
    const best = barracks.reduce((a, b) => (a.garrison > b.garrison ? a : b));
    const table = BUILDINGS[best.type];
    if (best.level < table.length - 1) {
      const cost = table[best.level + 1].cost;
      if (best.garrison > cost * 2.2 + 2) {
        actions.push({
          score: 1.3 + cfg.greed,
          run: () => upgradeBuilding(w, best.id, faction),
        });
      }
    }
  }

  // 空屋转化：已有一条兵营线时，才对"贴脸的空屋"造堡垒；否则继续铺兵营
  // 战况需要法术时，保留最后一座空屋给 Lab，不把它转成兵营/堡垒。
  if (houses.length > 0 && rand(ai) < cfg.greed + 0.15) {
    const reserveForLab = !ownLab && pressure > 0.2 && houses.length <= 1;
    if (!reserveForLab) {
      const h = houses[0];
      const near = w.buildings
        .filter((b) => b.faction !== faction && b.faction !== 0)
        .reduce((min, e) => Math.min(min, Math.hypot(e.x - h.x, e.y - h.y)), 9999);
      const wantFort = w.diff !== 'easy' && near < 300 && barracks.length >= 2;
      const type = wantFort ? 'fort' : 'barracks';
      const need = CONVERT_COST[type];
      if (h.garrison < need) {
        // 空屋容量 10，喂满即可转化（可花到 0）
        const feeder = barracks
          .filter((b) => b.garrison >= 10)
          .sort((a, b) => b.garrison - a.garrison)[0];
        if (feeder) {
          actions.push({
            score: 1.9 + cfg.greed,
            run: () => {
              if (!canSend(ai, feeder.id, w.time)) return false;
              if (!issueSend(w, feeder.id, h.id, faction, 'half')) return false;
              markSend(ai, feeder.id, w.time);
              return true;
            },
          });
        }
      } else {
        actions.push({
          score: 1.2 + cfg.greed,
          run: () => convertBuilding(w, h.id, type, faction),
        });
      }
    }
  }

  // ---------- 军事线 ----------
  // 只用兵营出兵（堡垒不产兵，Lab 不出兵）
  const sources = barracks
    .filter((b) => b.garrison >= 4)
    .sort((a, b) => b.garrison - a.garrison);
  if (sources.length === 0) {
    finish(actions);
    return;
  }

  const scored = targets
    .map((t) => ({ t, s: targetValue(t, sources[0]) }))
    .sort((a, b) => b.s - a.s);

  let lanes = 0;
  for (const { t, s } of scored.slice(0, 5)) {
    if (lanes >= cfg.lanes) break;
    const src = sources.find(
      (source) =>
        source.garrison >= t.garrison * defenseOf(t) * cfg.advantage + 2 &&
        source.garrison >= 4 &&
        w.time - (ai.lastSend[source.id] ?? -99) >= AI_SEND_COOLDOWN,
    );
    if (!src) continue;
    actions.push({
      score: 1.4 + s * 1.6,
      run: () => {
        if (!issueSend(w, src.id, t.id, faction, 'half')) return false;
        ai.lastSend[src.id] = w.time;
        return true;
      },
    });
    lanes += 1;
  }

  // 抓空档：对手有几乎空的据点时，用最近的一处去摘
  const soft = targets
    .filter((t) => t.garrison < 4)
    .sort((a, b) => a.garrison - b.garrison)[0];
  if (soft) {
    const nearest = sources.reduce((a, b) =>
      Math.hypot(a.x - soft.x, a.y - soft.y) < Math.hypot(b.x - soft.x, b.y - soft.y) ? a : b,
    );
    if (
      nearest.garrison >= soft.garrison * defenseOf(soft) + 1 &&
      w.time - (ai.lastSend[nearest.id] ?? -99) >= AI_SEND_COOLDOWN
    ) {
      actions.push({
        score: 2.2,
        run: () => {
          if (!issueSend(w, nearest.id, soft.id, faction, 'half')) return false;
          ai.lastSend[nearest.id] = w.time;
          return true;
        },
      });
    }
  }

  finish(actions);
}

/** 取分数最高、且真的执行成功的动作。 */
function finish(actions: Candidate[]): void {
  actions.sort((a, b) => b.score - a.score);
  for (const a of actions) {
    if (a.run()) return;
  }
}
