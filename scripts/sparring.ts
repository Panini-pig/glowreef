/**
 * 难度陪练：用"脚本玩家"（不经过浏览器）对阵三档 AI，量一下难度曲线是否合理。
 *   node --experimental-strip-types scripts/sparring.ts
 *
 * 脚本玩家的策略刻意做得很朴素（会升级、会转化、会挑最弱目标半投），
 * 它代表"会玩但不会微操"的水平；能赢几局，说明这档难度对人是有希望的。
 */
import { convertBuilding, createWorld, issueSend, tick, upgradeBuilding } from '../src/sim/world.ts';
import { createAI, updateAI } from '../src/sim/ai.ts';
import type { World } from '../src/sim/types.ts';

function playerTick(w: World): void {
  const mine = w.buildings.filter((b) => b.faction === 1);
  const barracks = mine.filter((b) => b.type === 'barracks');
  const houses = mine.filter((b) => b.type === 'house');

  // 1) 升级最大的兵营
  if (barracks.length) {
    const best = barracks.reduce((a, b) => (a.garrison > b.garrison ? a : b));
    if (best.garrison >= 16) upgradeBuilding(w, best.id, 1);
  }

  // 2) 空屋转兵营（最多 3 座）
  if (houses.length && barracks.length < 3) {
    const h = houses.find((x) => x.garrison >= 7);
    if (h) convertBuilding(w, h.id, 'barracks', 1);
  }

  // 3) 全体半投最弱目标
  const total = barracks.reduce((s, b) => s + b.garrison, 0);
  if (total < 8) return;
  const targets = w.buildings.filter((b) => b.faction !== 1);
  if (!targets.length) return;
  const t = targets.reduce((a, b) => (a.garrison * a.defense <= b.garrison * b.defense ? a : b));
  if (total / 2 >= (t.garrison * t.defense + 1) * 1.25) {
    for (const b of barracks) if (b.garrison >= 2) issueSend(w, b.id, t.id, 1, 'half');
  }
}

const seeds = 6;
for (const diff of ['easy', 'normal', 'hard'] as const) {
  let wins = 0;
  const times: number[] = [];
  for (let s = 1; s <= seeds; s++) {
    const w = createWorld(diff, 0);
    const ai = createAI(s * 31);
    let steps = 0;
    while (w.phase === 'playing' && steps < 30 * 380) {
      tick(w, 1 / 30);
      updateAI(w, ai, 1 / 30, 2);
      if (steps % 15 === 0) playerTick(w);
      steps += 1;
    }
    if (w.phase === 'won') wins += 1;
    times.push(w.time);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(
    `${diff.padEnd(6)} 脚本玩家 ${wins}/${seeds} 胜   平均 ${avg.toFixed(0)}s   [${times
      .map((t) => t.toFixed(0))
      .join('/')}]`,
  );
}
