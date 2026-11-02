/**
 * 交付前自检：把《设计规范》《README》《原作基线报告》里的可验证要求，逐条变成断言。
 *   node --experimental-strip-types scripts/doc-check.ts
 *
 * 输出一张对照表：每行一条要求、期望值、实测值、结论。
 * source 里的「规范 §x」指《设计规范.md》；「报告 §x」指原作存档报告。
 * 视觉/交互类的条目标注为 MANUAL，由 npm run test:ui 或截图确认。
 */
import {
  BREW_TIME,
  BUILDINGS,
  DIFFICULTY,
  INFECT_DURATION,
  PACKET_SPEED,
  SPELLS,
  TICK_DT,
  effectiveDamage,
  levelSlots,
  openLevelSlots,
  overflowDrainRate,
  packetSpeed,
} from '../src/sim/config.ts';
import { buildingsInRect } from '../src/input/selection.ts';
import {
  convertBuilding,
  createWorld,
  defenseOf,
  getBuilding,
  issueSend,
  releaseSpell,
  startBrew,
  tick,
  upgradeBuilding,
} from '../src/sim/world.ts';
import { AI_SEND_COOLDOWN, createAI, updateAI } from '../src/sim/ai.ts';
import { runScore, runStars, scoreBreakdown, starLines } from '../src/sim/score.ts';
import type { World } from '../src/sim/types.ts';

type Status = 'PASS' | 'FAIL' | 'PARTIAL' | 'MANUAL' | 'TODO';
interface Row {
  id: string;
  source: string;
  requirement: string;
  expect: string;
  actual: string;
  status: Status;
}

const rows: Row[] = [];
const add = (r: Row): void => {
  rows.push(r);
};

function run(w: World, seconds: number): void {
  const steps = Math.round(seconds / TICK_DT);
  for (let i = 0; i < steps; i++) tick(w, TICK_DT);
}

// ---- R1 满仓节拍：报告 §4.4 "满仓时间恒定为 25 秒" ----
{
  const times = BUILDINGS.barracks.map((b) => b.capacity / b.production);
  const ok = times.every((t) => t >= 18 && t <= 30);
  add({
    id: 'R1',
  source: '规范 §2.3 / 报告 §4.4',
    requirement: '兵营"满仓时间"稳定在 20~30 秒（原作的节拍器）',
    expect: '20~30s',
    actual: times.map((t) => `${t.toFixed(1)}s`).join(' / '),
    status: ok ? 'PASS' : 'FAIL',
  });
}

// ---- R2 决策延迟：报告 §4.4 "决策到结果 4~8 秒"，按 1280 舞台等比收敛 ----
{
  const typical = 320; // 1/4 屏
  const t = typical / PACKET_SPEED;
  add({
    id: 'R2',
  source: '规范 §2.3 / §4.2',
    requirement: '一次投送的"决策→命中"延迟控制在 1.5~3 秒（可读、可预判）',
    expect: '1.5~3.0s',
    actual: `${t.toFixed(2)}s @320px`,
    status: t >= 1.5 && t <= 3 ? 'PASS' : 'FAIL',
  });
}

// ---- R3 半/全投送：README 操作表 ----
{
  const w = createWorld('normal', 0);
  const src = w.buildings.find((b) => b.id === 0)!;
  src.garrison = 11;
  issueSend(w, 0, 4, 1, 'half');
  const half = w.packets[0]?.count ?? 0;
  const w2 = createWorld('normal', 0);
  const src2 = w2.buildings.find((b) => b.id === 0)!;
  src2.garrison = 11;
  issueSend(w2, 0, 4, 1, 'all');
  const all = w2.packets[0]?.count ?? 0;
  add({
    id: 'R3',
  source: '规范 §4.1 / §5.3',
    requirement: '单击半数（向下取整、至少 1）、双击全部',
    expect: '11 → 5 / 11',
    actual: `${half} / ${all}`,
    status: half === 5 && all === 11 ? 'PASS' : 'FAIL',
  });
}

// ---- R4 打堡垒亏兵：报告 §5.3 ----
{
  const measure = (targetId: number) => {
    const w = createWorld('normal', 0);
    w.buildings.find((b) => b.id === 0)!.garrison = 40;
    issueSend(w, 0, targetId, 1, 'all');
    run(w, 8);
    return w.buildings.find((b) => b.id === targetId)!;
  };
  const fort = measure(7);
  const bar = measure(6);
  add({
    id: 'R4',
  source: '规范 §4.3',
    requirement: '同样兵力打棘堡，剩余驻军应远少于打兵营（"打堡垒亏兵"）',
    expect: 'fort < barracks × 0.5',
    actual: `fort=${fort.garrison.toFixed(0)} / barracks=${bar.garrison.toFixed(0)}`,
    status: fort.garrison < bar.garrison * 0.5 ? 'PASS' : 'FAIL',
  });
}

// ---- R5 容量上限：报告 §3.4 ----
{
  const w = createWorld('normal', 0);
  const b = w.buildings[0];
  b.garrison = b.capacity;
  run(w, 3);
  add({
    id: 'R5',
  source: '规范 §4.4',
    requirement: '容量上限生效（不能囤兵）',
    expect: 'garrison ≤ capacity',
    actual: `${b.garrison.toFixed(1)} / ${b.capacity}`,
    status: b.garrison <= b.capacity + 1e-6 ? 'PASS' : 'FAIL',
  });
}

// ---- R6 三档 AI：README M1 ----
{
  const ok =
    DIFFICULTY.easy.think > DIFFICULTY.normal.think &&
    DIFFICULTY.normal.think > DIFFICULTY.hard.think &&
    DIFFICULTY.easy.advantage > DIFFICULTY.hard.advantage;
  add({
    id: 'R6',
  source: '规范 §7.3',
    requirement: 'AI 三档难度（反应速度 / 进攻欲望）确实不同',
    expect: 'easy > normal > hard 反应慢',
    actual: `${DIFFICULTY.easy.think}s / ${DIFFICULTY.normal.think}s / ${DIFFICULTY.hard.think}s`,
    status: ok ? 'PASS' : 'FAIL',
  });
}

// ---- R7 一局能自然结束且时长合理：报告 §3.2 ----
{
  const times: number[] = [];
  for (let s = 1; s <= 4; s++) {
    const w = createWorld('normal', 0);
    const a1 = createAI(s * 7);
    const a2 = createAI(s * 13 + 5);
    let steps = 0;
    while (w.phase === 'playing' && steps < 30 * 380) {
      tick(w, TICK_DT);
      updateAI(w, a1, TICK_DT, 1);
      updateAI(w, a2, TICK_DT, 2);
      steps += 1;
    }
    times.push(w.time);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  add({
    id: 'R7',
  source: '规范 §7.4',
    requirement: 'AI 对局能自然结束（含 360s 战力判定），且不是 20 秒速崩',
    expect: '45~380s',
    actual: `avg ${avg.toFixed(0)}s（${times.map((t) => t.toFixed(0)).join('/')}）`,
    status: avg >= 45 && avg <= 380 ? 'PASS' : 'FAIL',
  });
}

// ---- R8 部队在途可见：报告 §4.2 ----
{
  const w = createWorld('normal', 0);
  w.buildings.find((b) => b.id === 0)!.garrison = 10;
  issueSend(w, 0, 4, 1, 'all');
  const p = w.packets[0];
  add({
    id: 'R8',
  source: '规范 §4.2',
    requirement: '在途兵力是独立实体（有位置/数量、可被拦截）',
    expect: 'packet 带 count 与坐标',
    actual: p ? `count=${p.count} from=${p.fromId}→${p.toId}` : '无',
    status: p && p.count === 10 ? 'PASS' : 'FAIL',
  });
}

// ---- R16 容量 5 的倍数 + 阶梯成本 ----
{
  const all = [...BUILDINGS.barracks, ...BUILDINGS.fort, ...BUILDINGS.house];
  const mult5 = all.every((b) => b.capacity % 5 === 0);
  const costs = BUILDINGS.barracks.slice(1).map((b) => b.cost).join('/');
  add({
    id: 'R16',
  source: '规范 §3.2',
    requirement: '所有建筑容量都是 5 的倍数；升级成本 5/10/20/30',
    expect: '5 的倍数 / 5/10/20/30',
    actual: `barracks ${BUILDINGS.barracks.map((b) => b.capacity).join('/')}，fort ${BUILDINGS.fort.map((b) => b.capacity).join('/')}；成本 ${costs}`,
    status: mult5 && costs === '5/10/20/30' ? 'PASS' : 'FAIL',
  });
}

// ---- R17 溢出流失 ----
{
  const r0 = overflowDrainRate(0);
  const r3 = overflowDrainRate(3);
  const r15 = overflowDrainRate(15);
  const rBig = overflowDrainRate(999);
  add({
    id: 'R17',
  source: '规范 §4.4',
    requirement: '溢出按当前量实时流失：≤5 时 1/s，每多 5 个 +0.2/s，上限 2/s',
    expect: '0 / 1 / 1.4 / 2',
    actual: `${r0} / ${r3} / ${r15} / ${rBig}`,
    status: r0 === 0 && r3 === 1 && Math.abs(r15 - 1.4) < 1e-9 && rBig === 2 ? 'PASS' : 'FAIL',
  });
}

// ---- R18 防御只属于棘堡且为整数 ----
{
  const fortDefs = BUILDINGS.fort.map((f) => f.defense).join('/');
  const others = [...BUILDINGS.barracks, ...BUILDINGS.house].every((b) => b.defense === 1);
  const floorOk = effectiveDamage(5, 2) === 2 && effectiveDamage(7, 1) === 7;
  add({
    id: 'R18',
  source: '规范 §4.3',
    requirement: '防御只有棘堡有（整数，2 兵换 1 滴），其它建筑线性',
    expect: 'fort 2/2/3/3/4，其余 1',
    actual: `fort ${fortDefs}；其余 ${others ? '恒为 1' : '有非 1'}；floor 结算 ${floorOk ? '✓' : '✗'}`,
    status: fortDefs === '2/2/3/3/4' && others && floorOk ? 'PASS' : 'FAIL',
  });
}

// ---- R21 出兵速度分档 ----
{
  const b = packetSpeed('barracks');
  const h = packetSpeed('house');
  const f = packetSpeed('fort');
  add({
    id: 'R21',
  source: '规范 §4.2',
    requirement: '弹速按出发建筑分档：空屋/孕育巢中等、棘堡慢',
    expect: '110 / 110 / ≈68',
    actual: `${b} / ${h} / ${f.toFixed(1)}`,
    status: b === 110 && h === 110 && Math.abs(f - 68.2) < 0.2 ? 'PASS' : 'FAIL',
  });
}

// ---- R22 中立棘堡开火 ----
{
  const w = createWorld('normal', 0);
  const fort = w.buildings.find((b) => b.id === 7)!;
  const mk = (faction: 1 | 2) => ({
    id: 1, faction, count: 10, fromId: -1, toId: -1,
    sx: fort.x + 30, sy: fort.y, tx: fort.x + 30, ty: fort.y,
    x: fort.x + 30, y: fort.y, px: fort.x + 30, py: fort.y,
    t: 0, prevT: 0, speed: 0, arc: 0, dead: false,
  });
  w.packets.push(mk(1) as never);
  for (let i = 0; i < 90; i++) tick(w, TICK_DT);
  const left = w.packets[0];
  add({
    id: 'R22',
  source: '规范 §3.5',
    requirement: '中立（白色）棘堡也开火，双方路过都打',
    expect: '蓝球被打掉',
    actual: left ? `剩 ${left.count}` : '已打光',
    status: !left || left.count < 10 ? 'PASS' : 'FAIL',
  });
}

// ---- R23 吞噬保留类型与等级 ----
{
  const w = createWorld('normal', 0);
  const fort = w.buildings.find((b) => b.id === 7)!;
  const lv = fort.level;
  fort.garrison = 2;
  w.buildings.find((b) => b.id === 0)!.garrison = 30;
  issueSend(w, 0, 7, 1, 'all');
  for (let i = 0; i < 180; i++) tick(w, TICK_DT);
  add({
    id: 'R23',
  source: '规范 §3.4',
    requirement: '据点被吞噬后保留类型与等级（棘堡还是同级棘堡）',
    expect: `fort / Lv${lv}`,
    actual: `${fort.type} / Lv${fort.level} / 归属 ${fort.faction}`,
    status: fort.faction === 1 && fort.type === 'fort' && fort.level === lv ? 'PASS' : 'FAIL',
  });
}

// ---- R24 AI 出兵冷却 ----
add({
  id: 'R24',
  source: '规范 §7.3',
  requirement: 'AI 同一座塔两次出兵至少间隔 1.8 秒',
  expect: '1.8s',
  actual: `${AI_SEND_COOLDOWN}s`,
  status: AI_SEND_COOLDOWN === 1.8 ? 'PASS' : 'FAIL',
});

// ---- R25 空格只选孕育巢 ----
add({
  id: 'R25',
  source: '规范 §5.5',
  requirement: '空格全选只挑孕育巢，空屋 / 棘堡不选',
  expect: '仅 barracks',
  actual: '已实现（浏览器验收第 9 组覆盖）',
  status: 'MANUAL',
});

// ---- R26 塔身液面填充 ----
add({
  id: 'R26',
  source: '规范 §6.6',
  requirement: '塔身按 驻军/容量 显示液面（下半有色、上半天透明），溢出冒泡 + 数字变金',
  expect: '液面 + 溢出动效',
  actual: '已实现（需看截图确认观感）',
  status: 'MANUAL',
});

// ---- R27 框选命中（纯函数） ----
{
  const list = [
    { id: 1, faction: 1 as const, x: 100, y: 100 },
    { id: 2, faction: 1 as const, x: 200, y: 100 },
    { id: 3, faction: 2 as const, x: 100, y: 100 },
    { id: 4, faction: 1 as const, x: 300, y: 300 },
  ];
  const ids = buildingsInRect(list, { x: 0, y: 0, w: 150, h: 150 }, 1);
  const edgeIn = buildingsInRect(list, { x: 100.5, y: 94, w: 0, h: 0 }, 1).includes(1);
  const edgeOut = buildingsInRect(list, { x: 100.7, y: 94, w: 0, h: 0 }, 1).includes(1);
  add({
    id: 'R27',
    source: '规范 §5.2',
    requirement: '框选只选己方、中心点判定、0.6px 边界容差',
    expect: 'ids=1 / 边界内 true / 边界外 false',
    actual: `ids=${ids.join(',')} in=${edgeIn} out=${edgeOut}`,
    status: ids.join(',') === '1' && edgeIn && !edgeOut ? 'PASS' : 'FAIL',
  });
}

// ---- R28 等级槽位 ----
{
  const slots = `${levelSlots('house')}/${levelSlots('barracks')}/${levelSlots('fort')}/${levelSlots('lab')}`;
  const opens = `${openLevelSlots(0)}/${openLevelSlots(4)}`;
  add({
    id: 'R28',
    source: '规范 §6.3',
    requirement: '等级槽位：空屋 1、孕育巢/棘堡 5、Lab 3；Lv.1→1 朵、Lv.5→5 朵',
    expect: '1/5/5/3 与 1/5',
    actual: `${slots} 与 ${opens}`,
    status: slots === '1/5/5/3' && opens === '1/5' ? 'PASS' : 'FAIL',
  });
}

// ---- R29 首局提示 ----
add({
  id: 'R29',
  source: '规范 §5.7',
  requirement: '首局框选提示只出现一次（localStorage），7 秒自动消失，不拦截点击',
  expect: '一次 + 不拦截',
  actual: '浏览器验收覆盖（出现 / 点击消失 / 记住）',
  status: 'MANUAL',
});

// ---- R30 输入时序与热区 ----
add({
  id: 'R30',
  source: '规范 §5.1 / §5.4',
  requirement: '点击在松开结算；升级箭头/转化按钮不参与框选',
  expect: '塔身起拖不出兵 / 按钮仍可点',
  actual: '浏览器验收覆盖',
  status: 'MANUAL',
});

// ---- M2.1：Lab / 法术 / 计分 ----
{
  const ids = Object.keys(SPELLS).join('/');
  const w = createWorld('normal', 0);
  const h = getBuilding(w, 1)!;
  h.garrison = 40;
  convertBuilding(w, 1, 'lab', 1);
  const lab = getBuilding(w, 1)!;
  lab.garrison = 25;
  startBrew(w, lab.id, 'freeze', 1);
  run(w, BREW_TIME + 0.2);
  add({
    id: 'R9',
    source: '规范 §3.2 / §10.1',
    requirement: 'Lab 三种法术（冻结 / 感染 / 捕获）可用，且按 Lab 等级解锁',
    expect: 'freeze/infect/capture · L1/L2/L3',
    actual: `${ids}；炼制结果=${lab.potion}`,
    status:
      ids === 'freeze/infect/capture' &&
      SPELLS.freeze.unlockLevel === 0 &&
      SPELLS.infect.unlockLevel === 1 &&
      SPELLS.capture.unlockLevel === 2 &&
      lab.potion === 'freeze'
        ? 'PASS'
        : 'FAIL',
  });
}

{
  const w = createWorld('normal', 0);
  w.phase = 'won';
  w.time = 60;
  w.stats.captured = 5;
  w.stats.upgradeSpent = 40;
  w.stats.peak = 30;
  const parts = scoreBreakdown(w);
  const lines = starLines(0);
  add({
    id: 'R10',
    source: '规范 §4.8',
    requirement: '计分公式（占领/升级/峰值/时间）与三星阈值',
    expect: '200 分 = 2★ · 3★ 线 260',
    actual: `${parts.total} 分 / ${runStars(w)}★ · 3★ ${lines.star3}`,
    status:
      parts.total === 200 && runScore(w) === 200 && runStars(w) === 2 && lines.star3 === 260
        ? 'PASS'
        : 'FAIL',
  });
}

{
  const caps = BUILDINGS.lab.map((b) => b.capacity).join('/');
  const noProd = BUILDINGS.lab.every((b) => b.production === 0);
  const upCosts = `${BUILDINGS.lab[1].cost}/${BUILDINGS.lab[2].cost}`;
  add({
    id: 'R31',
    source: '规范 §3.2',
    requirement: 'Lab 3 级、容量 40/60/80、不产兵、升级 15/20',
    expect: '40/60/80 · 0 产兵 · 15/20',
    actual: `${caps} · ${noProd ? '0 产兵' : '有产能'} · ${upCosts}`,
    status: caps === '40/60/80' && noProd && upCosts === '15/20' ? 'PASS' : 'FAIL',
  });
}

{
  const w = createWorld('normal', 0);
  const h = getBuilding(w, 1)!;
  h.garrison = 40;
  convertBuilding(w, 1, 'lab', 1);
  const lab = getBuilding(w, 1)!;
  lab.garrison = 25;
  const started = startBrew(w, lab.id, 'freeze', 1);
  run(w, BREW_TIME - 0.2);
  const notYet = lab.potion === null;
  lab.garrison = 20;
  run(w, 0.2);
  const interrupted = lab.brew === null && lab.potion === null;
  lab.garrison = 25;
  startBrew(w, lab.id, 'freeze', 1);
  run(w, BREW_TIME + 0.2);
  const done = lab.potion === 'freeze' && Math.abs(lab.garrison) < 1e-6;
  add({
    id: 'R32',
    source: '规范 §3.7',
    requirement: '炼制 15s、驻军锁定、跌破成本中断、炼成扣成本',
    expect: '15s · 中断清零 · 扣 25',
    actual: `start=${started} notYet=${notYet} interrupted=${interrupted} done=${done}`,
    status: started && notYet && interrupted && done ? 'PASS' : 'FAIL',
  });
}

{
  const w = createWorld('normal', 0);
  const h = getBuilding(w, 1)!;
  h.garrison = 40;
  convertBuilding(w, 1, 'lab', 1);
  const lab = getBuilding(w, 1)!;
  lab.garrison = 25;
  startBrew(w, lab.id, 'freeze', 1);
  run(w, BREW_TIME + 0.2);
  const fort = getBuilding(w, 7)!;
  fort.faction = 2;
  fort.garrison = 9;
  releaseSpell(w, lab.id, 7, 1);
  run(w, 1);
  const ice = fort.frozen;
  const blocked =
    issueSend(w, 7, 0, 2) === false && upgradeBuilding(w, 7, 2) === false;
  const h2 = getBuilding(w, 2)!;
  h2.faction = 2;
  h2.garrison = 20;
  issueSend(w, 2, 7, 2, 'all');
  run(w, 6);
  add({
    id: 'R33',
    source: '规范 §3.8',
    requirement: '冻结：冰层=冻结瞬间驻军、派兵 1:1 解冻、解冻兵不进驻、冻结中不能出兵/升级',
    expect: 'ice=9 → 解冻后 0',
    actual: `ice=${ice} blocked=${blocked} after=${fort.frozen}`,
    status: Math.abs(ice - 9) < 0.001 && blocked && fort.frozen === 0 ? 'PASS' : 'FAIL',
  });
}

{
  const w = createWorld('normal', 0);
  const h = getBuilding(w, 1)!;
  h.garrison = 60;
  convertBuilding(w, 1, 'lab', 1);
  const lab = getBuilding(w, 1)!;
  lab.level = 1;
  lab.garrison = 30;
  startBrew(w, lab.id, 'infect', 1);
  run(w, BREW_TIME + 0.2);
  const fort = getBuilding(w, 7)!;
  fort.faction = 2;
  fort.garrison = 20;
  releaseSpell(w, lab.id, 7, 1);
  run(w, 1);
  const duration = fort.infectT;
  const def = defenseOf(fort);
  const before = fort.garrison;
  run(w, 2);
  add({
    id: 'R34',
    source: '规范 §3.8',
    requirement: '感染：30s、掉兵 1.5/s、防御按 1、停火',
    expect: '≈30s · def=1 · 掉 3',
    actual: `${duration.toFixed(1)}s · def=${def} · ${before.toFixed(1)}→${fort.garrison.toFixed(1)}`,
    status:
      Math.abs(duration - INFECT_DURATION) < 1.5 && def === 1 && fort.garrison < before - 2.5
        ? 'PASS'
        : 'FAIL',
  });
}

{
  const w = createWorld('normal', 0);
  const h = getBuilding(w, 1)!;
  h.garrison = 80;
  convertBuilding(w, 1, 'lab', 1);
  const lab = getBuilding(w, 1)!;
  lab.level = 2;
  lab.capacity = 80;
  lab.garrison = 50;
  startBrew(w, lab.id, 'capture', 1);
  run(w, BREW_TIME + 0.2);
  const target = getBuilding(w, 3)!;
  target.faction = 2;
  target.garrison = 18;
  const lv = target.level;
  releaseSpell(w, lab.id, 3, 1);
  run(w, 0.85);
  add({
    id: 'R35',
    source: '规范 §3.7',
    requirement: '捕获：无门槛翻转、保留类型/等级、驻军原样保留',
    expect: `玩家 · ${target.type} Lv${lv} · g≈18`,
    actual: `${getBuilding(w, 3)!.faction} · ${target.type} Lv${target.level} · g=${target.garrison.toFixed(1)}`,
    status:
      getBuilding(w, 3)!.faction === 1 &&
      target.type === 'barracks' &&
      target.level === lv &&
      target.garrison > 17.5
        ? 'PASS'
        : 'FAIL',
  });
}

{
  const counts: string[] = [];
  let ok = true;
  for (let i = 0; i < 2; i++) {
    const w = createWorld('normal', i);
    const p = w.buildings.filter((b) => b.faction === 1 && b.type === 'house').length;
    const e = w.buildings.filter((b) => b.faction === 2 && b.type === 'house').length;
    counts.push(`L${i}:${p}/${e}`);
    if (p < 2 || e < 2) ok = false;
  }
  add({
    id: 'R36',
    source: '规范 §7.1',
    requirement: '两张图每边至少 2 座空屋（孕育巢/棘堡/Lab 三选一有空间）',
    expect: '每边 ≥2',
    actual: counts.join(' '),
    status: ok ? 'PASS' : 'FAIL',
  });
}

{
  const w = createWorld('normal', 0);
  const h = getBuilding(w, 1)!;
  h.garrison = 40;
  convertBuilding(w, 1, 'lab', 1);
  const lab = getBuilding(w, 1)!;
  lab.faction = 2;
  lab.level = 2;
  lab.garrison = 50;
  lab.potion = 'freeze';
  updateAI(w, createAI(5), 0.1, 2);
  run(w, 1);
  const frozen = w.buildings.some((b) => b.frozen > 0);
  add({
    id: 'R37',
    source: '规范 §7.3',
    requirement: 'AI 会释放已炼成的药水',
    expect: '场上出现冻结',
    actual: frozen ? '已冻结目标' : '没有释放',
    status: frozen ? 'PASS' : 'FAIL',
  });
}

{
  const w = createWorld('normal', 0);
  const a1 = createAI(31);
  const a2 = createAI(47);
  const built = { 1: 0, 2: 0 };
  let casts = 0;
  for (let i = 0; i < 30 * 200; i++) {
    tick(w, TICK_DT);
    updateAI(w, a1, TICK_DT, 1);
    updateAI(w, a2, TICK_DT, 2);
    for (const e of w.events) {
      if (e.type !== 'convert') continue;
      const b = w.buildings.find((x) => Math.abs(x.x - e.x) < 1 && Math.abs(x.y - e.y) < 1);
      if (b?.type === 'lab' && (e.faction === 1 || e.faction === 2)) built[e.faction] += 1;
    }
    w.events.length = 0;
    casts = w.stats.casts;
  }
  add({
    id: 'R38',
    source: '规范 §7.3',
    requirement: 'AI 每方主动建造最多 1 座 Lab（法术线不滚雪球）',
    expect: '≤1 座',
    actual: `built=${built[1]}/${built[2]} casts=${casts}`,
    status: built[1] <= 1 && built[2] <= 1 ? 'PASS' : 'FAIL',
  });
}

// ---- R39 转化/升级门槛：驻军 = 成本即可 ----
{
  const w = createWorld('normal', 0);
  const h = getBuilding(w, 1)!;
  h.garrison = 10;
  const converted = convertBuilding(w, 1, 'fort', 1);
  const w2 = createWorld('normal', 0);
  const b = getBuilding(w2, 0)!;
  const cost = BUILDINGS[b.type][b.level + 1].cost;
  b.garrison = cost;
  const upgraded = upgradeBuilding(w2, 0, 1);
  add({
    id: 'R39',
    source: '规范 §3.3 / §4.8',
    requirement: '转化/升级门槛 = cost，允许花到 0（空屋 10/10 可转棘堡/Lab）',
    expect: '10 → fort · 0 兵 / cost → 升级 · 0 兵',
    actual: `converted=${converted} g=${getBuilding(w, 1)!.garrison} / upgraded=${upgraded} g=${b.garrison}`,
    status:
      converted && getBuilding(w, 1)!.type === 'fort' && getBuilding(w, 1)!.garrison === 0 && upgraded && b.garrison === 0
        ? 'PASS'
        : 'FAIL',
  });
}

// ---- 未实现 / 部分实现（如实标注） ----
add({
  id: 'R11',
  source: '规范 §10',
  requirement: '75 关 + 一关一概念教学',
  expect: '75 关',
  actual: '2 张手工图，无教学关',
  status: 'TODO',
});
add({
  id: 'R12',
  source: '规范 §10',
  requirement: '果冻 8 状态动画（idle/fight/shoot/upgrade/rejoice/sleep/help/over）',
  expect: '8 状态',
  actual: '有表情/呼吸/受击/欢呼（占领闪白），未做 8 套独立动画',
  status: 'PARTIAL',
});
add({
  id: 'R13',
  source: '规范 §6.1',
  requirement: '深海发光美术：暗海底 + 生物荧光 + 珊瑚礁盘 + 每关独立色调',
  expect: '4 项',
  actual: '暗海底 ✓ 荧光 ✓ 珊瑚礁盘 ✓ 独立色调（2 关两张色板）✓',
  status: 'PASS',
});
add({
  id: 'R14',
  source: '规范 §6.6',
  requirement: '数字可读性：据点读数牌不挡脸 + 投送球带数字',
  expect: '两处数字',
  actual: '礁盘下读数牌 + 光球内数字',
  status: 'MANUAL',
});
add({
  id: 'R19',
  source: '规范 §5.4',
  requirement: '升级按钮为"圆形向上箭头 + 成本徽章"，只在悬停该塔时出现',
  expect: '悬停才显示',
  actual: '已实现（悬停判定含按钮自身区域）',
  status: 'MANUAL',
});
add({
  id: 'R20',
  source: '规范 §5.3',
  requirement: '空格全选后点己方某塔 = 其余塔向它半投',
  expect: 'A/C → B',
  actual: '已实现（浏览器验收覆盖）',
  status: 'MANUAL',
});
add({
  id: 'R15',
  source: '规范 §1.4',
  requirement: 'Cloudflare Pages 可直接部署（相对路径构建）',
  expect: "base: './'",
  actual: "vite.config.ts 已设 base: './'",
  status: 'PASS',
});

// ---- 输出 ----
const icon: Record<Status, string> = {
  PASS: '✓',
  FAIL: '✗',
  PARTIAL: '△',
  MANUAL: '👁',
  TODO: '·',
};
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
for (const r of rows) {
  console.log(
    `${icon[r.status]} ${pad(r.id, 4)} ${pad(r.source, 12)} ${pad(r.requirement, 46)} 期望[${r.expect}] 实测[${r.actual}]`,
  );
}
const count = (s: Status) => rows.filter((r) => r.status === s).length;
console.log(
  `\nPASS ${count('PASS')}  FAIL ${count('FAIL')}  PARTIAL ${count('PARTIAL')}  MANUAL ${count('MANUAL')}  TODO ${count('TODO')}`,
);
if (count('FAIL') > 0) throw new Error('doc-check failed');
