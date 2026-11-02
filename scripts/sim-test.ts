/**
 * 模拟层冒烟测试（无需浏览器）：
 *   node --experimental-strip-types scripts/sim-test.ts
 *
 * 覆盖：投送=一颗光球、增援合流、越权拦截、容量、防御系数、升级、胜负、AI 对 AI。
 */
import { BUILDINGS, BREW_TIME, INFECT_DURATION, TICK_DT, effectiveDamage, levelSlots, openLevelSlots, overflowDrainRate, packetSpeed, PACKET_SPEED } from '../src/sim/config.ts';
import { buildingsInRect } from '../src/input/selection.ts';
import {
  cancelBrew,
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
import { AI_SEND_COOLDOWN, bestSpellTarget, createAI, updateAI } from '../src/sim/ai.ts';
import { runScore, runStars, scoreBreakdown, starLines } from '../src/sim/score.ts';
import type { World } from '../src/sim/types.ts';

let failed = 0;
function ok(cond: boolean, name: string, extra = ''): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

function run(w: World, seconds: number): void {
  const steps = Math.round(seconds / TICK_DT);
  for (let i = 0; i < steps; i++) tick(w, TICK_DT);
}

console.log('1) 投送 = 一颗光球，数量 = 全部驻军');
{
  const w = createWorld('normal', 0);
  const src = w.buildings.find((b) => b.id === 0)!;
  src.garrison = 12;
  const dst = w.buildings.find((b) => b.id === 4)!;
  const okSend = issueSend(w, 0, 4, 1);
  ok(okSend, '投送成功');
  ok(w.packets.length === 1, '只产生一颗光球', `packets=${w.packets.length}`);
  ok(w.packets[0].count === 12, '球上的数字 = 全部驻军', `count=${w.packets[0].count}`);
  ok(src.garrison === 0, '源头清零', `garrison=${src.garrison}`);
  run(w, 6);
  ok(dst.faction === 1, '抵达后占领', `faction=${dst.faction}`);
}

console.log('2) 增援：己方 → 己方 合流');
{
  const w = createWorld('normal', 0);
  const src = w.buildings.find((b) => b.id === 0)!;
  const home = w.buildings.find((b) => b.id === 1)!;
  src.garrison = 8;
  home.garrison = 0;
  ok(issueSend(w, 0, 1, 1), '允许对己方建筑投送');
  ok(w.packets[0].count === 8, '球上数量正确', `count=${w.packets[0].count}`);
  run(w, 5);
  ok(home.faction === 1, '归属不变');
  ok(home.garrison > 5, '驻军合流增加', `garrison=${home.garrison.toFixed(1)}`);
}

console.log('3) 越权：不能指挥非己方建筑');
{
  const w = createWorld('normal', 0);
  w.buildings.find((b) => b.id === 0)!.garrison = 20;
  ok(issueSend(w, 0, 4, 2) === false, '敌方不能指挥玩家的建筑');
  ok(upgradeBuilding(w, 0, 2) === false, '敌方不能升级玩家的建筑');
  ok(convertBuilding(w, 1, 'barracks', 2) === false, '敌方不能转化玩家的建筑');
  // 建筑易主后，原阵营也不能再指挥它
  w.buildings.find((b) => b.id === 0)!.faction = 2;
  ok(issueSend(w, 0, 4, 1) === false, '建筑易主后原阵营无法再指挥');
}

console.log('4) 容量上限');
{
  const w = createWorld('normal', 0);
  const b = w.buildings[0];
  b.garrison = b.capacity;
  run(w, 2);
  ok(b.garrison <= b.capacity + 1e-6, '不超过容量', `${b.garrison}/${b.capacity}`);
}

console.log('5) 防御系数：打堡垒更亏');
{
  const mk = (targetId: number) => {
    const w = createWorld('normal', 0);
    const src = w.buildings.find((b) => b.id === 0)!;
    src.garrison = 40;
    issueSend(w, 0, targetId, 1);
    run(w, 8);
    return w.buildings.find((b) => b.id === targetId)!;
  };
  const fort = mk(7);
  const barracks = mk(6);
  ok(barracks.faction === 1 && fort.faction === 1, '同样 40 兵力都能打下来');
  ok(
    fort.garrison < barracks.garrison * 0.5,
    '但打堡垒"亏兵"：剩余驻军远少于打兵营',
    `fort=${fort.garrison.toFixed(1)} barracks=${barracks.garrison.toFixed(1)}`,
  );
}

console.log('6) 升级扣费与等级');
{
  const w = createWorld('normal', 0);
  const b = w.buildings[0];
  b.garrison = 20;
  const lv = b.level;
  ok(upgradeBuilding(w, 0, 1), '升级成功');
  ok(b.level === lv + 1, '等级 +1');
  ok(b.garrison < 20, '扣除驻军');
  ok(b.production > 0.45, '产能提升', `${b.production}`);
}

console.log('7) 胜负判定');
{
  const w = createWorld('normal', 0);
  for (const b of w.buildings) b.faction = 1;
  run(w, 0.1);
  ok(w.phase === 'won', '点亮全图（含中立）→ 胜利', `phase=${w.phase}`);

  const w2 = createWorld('normal', 0);
  for (const b of w2.buildings) b.faction = 2;
  run(w2, 0.1);
  ok(w2.phase === 'lost', '失去全部据点 → 失败', `phase=${w2.phase}`);
}

console.log('8) AI 对 AI：整局能否自然结束');
{
  const w = createWorld('normal', 0);
  const a1 = createAI(11);
  const a2 = createAI(22);
  let steps = 0;
  while (w.phase === 'playing' && steps < 30 * 380) {
    tick(w, TICK_DT);
    updateAI(w, a1, TICK_DT, 1);
    updateAI(w, a2, TICK_DT, 2);
    steps += 1;
  }
  ok(w.phase !== 'playing', '对局自然结束', `phase=${w.phase} time=${w.time.toFixed(0)}s`);
  ok(w.time > 5, '不是秒结束', `time=${w.time.toFixed(0)}s`);
}

console.log('9) 容量与成本：5 的倍数 + 阶梯升级');
{
  const caps = BUILDINGS.barracks.map((b) => b.capacity);
  ok(caps.every((c) => c % 5 === 0), '孕育巢容量都是 5 的倍数', caps.join('/'));
  ok(caps.join('/') === '10/20/30/40/50', '孕育巢容量 10→50', caps.join('/'));
  const fill = BUILDINGS.barracks.map((b) => b.capacity / b.production);
  ok(fill.every((t) => Math.abs(t - fill[0]) < 0.5), '满仓时间各等级一致', fill.map((t) => t.toFixed(1)).join('/'));
  const costs = BUILDINGS.barracks.slice(1).map((b) => b.cost);
  ok(costs.join('/') === '5/10/20/30', '升级成本 5/10/20/30', costs.join('/'));
}

console.log('10) 防御是整数，只对敌方生效');
{
  ok(effectiveDamage(5, 2) === 2, '5 兵打防御 2 → 掉 2 滴', `got ${effectiveDamage(5, 2)}`);
  ok(effectiveDamage(8, 3) === 2, '8 兵打防御 3 → 掉 2 滴', `got ${effectiveDamage(8, 3)}`);
  ok(effectiveDamage(7, 1) === 7, '防御 1 = 来多少扣多少', `got ${effectiveDamage(7, 1)}`);
  ok(BUILDINGS.fort.map((f) => f.defense).join('/') === '2/2/3/3/4', '棘堡防御 2/2/3/3/4');
  ok(BUILDINGS.barracks.every((b) => b.defense === 1), '其它建筑防御恒为 1');
}

console.log('11) 溢出：友方可以超容量，之后缓慢流失');
{
  const w = createWorld('normal', 0);
  const tank = w.buildings.find((b) => b.id === 0)!; // 容量 10
  const feeder = w.buildings.find((b) => b.id === 1)!; // 同阵营
  tank.garrison = tank.capacity;
  feeder.faction = 1;
  feeder.garrison = 15;
  issueSend(w, feeder.id, tank.id, 1, 'all');
  run(w, 3);
  ok(tank.garrison > tank.capacity, '友方投送可以溢出', `${tank.garrison.toFixed(1)} / ${tank.capacity}`);
  const before = tank.garrison;
  run(w, 2);
  ok(tank.garrison < before, '溢出会持续流失', `${before.toFixed(1)} → ${tank.garrison.toFixed(1)}`);
  ok(overflowDrainRate(3) === 1, '溢出 ≤5 时 1/秒');
  ok(Math.abs(overflowDrainRate(15) - 1.4) < 1e-9, '溢出 15 时 1.4/秒', `${overflowDrainRate(15)}`);
  ok(overflowDrainRate(999) === 2, '流失速度上限 2/秒', `${overflowDrainRate(999)}`);
  run(w, 30);
  ok(tank.garrison <= tank.capacity + 0.2, '最终回落到容量附近', `${tank.garrison.toFixed(1)}`);
}

console.log('12) 吞噬后保留类型与等级');
{
  const w = createWorld('normal', 0);
  const fort = w.buildings.find((b) => b.id === 7)!; // 中立棘堡 Lv.1
  const lv = fort.level;
  fort.garrison = 2;
  w.buildings.find((b) => b.id === 0)!.garrison = 30;
  issueSend(w, 0, 7, 1, 'all');
  run(w, 6);
  ok(fort.faction === 1, '棘堡被占领');
  ok(fort.type === 'fort', '类型仍然是棘堡', fort.type);
  ok(fort.level === lv, '等级没有变化', `lv=${fort.level}`);
}

console.log('13) 中立棘堡开火：双方路过都打');
{
  const mk = (faction: 1 | 2, x: number, y: number, count: number) => ({
    id: 9000 + faction,
    faction,
    count,
    fromId: -1,
    toId: -1,
    sx: x, sy: y, tx: x, ty: y, x, y, px: x, py: y,
    t: 0, prevT: 0, speed: 0, arc: 0, dead: false,
  });

  // 中立棘堡：分别放一颗蓝球 / 一颗红球，各自都该被打
  const hitBy = (faction: 1 | 2) => {
    const w = createWorld('normal', 0);
    const fort = w.buildings.find((b) => b.id === 7)!;
    w.packets.push(mk(faction, fort.x + 40, fort.y, 10) as never);
    run(w, 4);
    const p = w.packets.find((x) => x.faction === faction);
    return p ? p.count : 0;
  };
  ok(hitBy(1) < 10, '中立棘堡打蓝方的兵', `剩余 ${hitBy(1)}`);
  ok(hitBy(2) < 10, '中立棘堡也打红方的兵', `剩余 ${hitBy(2)}`);

  // 有主之地不打自己人
  const w2 = createWorld('normal', 0);
  const blueFort = w2.buildings.find((b) => b.id === 7)!;
  blueFort.faction = 1;
  w2.packets.push(mk(1, blueFort.x + 40, blueFort.y, 10) as never);
  run(w2, 4);
  const own = w2.packets.find((p) => p.faction === 1);
  ok(Boolean(own) && own!.count === 10, '己方棘堡不打自己的兵', `count=${own?.count}`);
}

console.log('14) 出兵速度：空屋/孕育巢 中等，棘堡慢');
{
  ok(packetSpeed('barracks') === PACKET_SPEED, '孕育巢 = 基准速度');
  ok(packetSpeed('house') === PACKET_SPEED, '空屋 = 基准速度');
  ok(Math.abs(packetSpeed('fort') - PACKET_SPEED * 0.62) < 0.01, '棘堡 ≈ 0.62 倍', `${packetSpeed('fort')}`);

  const w = createWorld('normal', 0);
  const fort = w.buildings.find((b) => b.id === 7)!;
  fort.faction = 1;
  fort.garrison = 10;
  issueSend(w, fort.id, 4, 1, 'half');
  const p = w.packets[0];
  ok(p && Math.abs(p.speed - packetSpeed('fort')) < 0.01, '实际弹速按出发建筑计算', `${p?.speed}`);
}

console.log('15) AI 同一座塔出兵冷却');
{
  ok(AI_SEND_COOLDOWN === 1.8, '冷却常量为 1.8s', `${AI_SEND_COOLDOWN}`);

  const w = createWorld('normal', 0);
  const a1 = createAI(3);
  const a2 = createAI(9);
  const sendTimes: Record<string, number[]> = {};
  let last = 0;
  for (let i = 0; i < 30 * 60; i++) {
    tick(w, TICK_DT);
    updateAI(w, a1, TICK_DT, 1);
    updateAI(w, a2, TICK_DT, 2);
    for (const e of w.events) {
      if (e.type !== 'spawn') continue;
      // 用出兵坐标找回是哪座塔
      const src = w.buildings.find(
        (b) => Math.abs(b.x - e.x) < 1 && Math.abs(b.y - e.y) < 1,
      );
      if (!src) continue;
      const k = `${e.faction}-${src.id}`;
      (sendTimes[k] ??= []).push(w.time);
    }
    w.events.length = 0;
    last = w.time;
  }
  let violations = 0;
  let minGap = Infinity;
  for (const times of Object.values(sendTimes)) {
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      minGap = Math.min(minGap, gap);
      if (gap < AI_SEND_COOLDOWN - 0.15) violations += 1;
    }
  }
  ok(violations === 0, '没有同一座塔连发', `最小间隔 ${minGap.toFixed(2)}s`);
  void last;
}

console.log('16) 框选命中与等级槽位（纯函数）');
{
  const list = [
    { id: 1, faction: 1 as const, x: 100, y: 100 },
    { id: 2, faction: 1 as const, x: 200, y: 100 },
    { id: 3, faction: 2 as const, x: 100, y: 100 },
    { id: 4, faction: 1 as const, x: 300, y: 300 },
  ];
  const inside = buildingsInRect(list, { x: 0, y: 0, w: 150, h: 150 }, 1);
  ok(inside.join(',') === '1', '框内只选己方建筑（不选同坐标的敌方）', inside.join(','));
  ok(!inside.includes(2), '中心点在框外的己方建筑不选');
  ok(buildingsInRect(list, { x: 100.5, y: 94, w: 0, h: 0 }, 1).includes(1), '边界 0.6px 容差内仍选中');
  ok(!buildingsInRect(list, { x: 100.7, y: 94, w: 0, h: 0 }, 1).includes(1), '边界 0.6px 容差外不选');
  ok(levelSlots('house') === 1, '空屋只有 1 个等级槽', String(levelSlots('house')));
  ok(
    levelSlots('barracks') === 5 && levelSlots('fort') === 5,
    '孕育巢 / 棘堡有 5 个等级槽',
    `${levelSlots('barracks')}/${levelSlots('fort')}`,
  );
  ok(openLevelSlots(0) === 1 && openLevelSlots(4) === 5, 'Lv.1→1 朵，Lv.5→5 朵');
}

console.log('17) Lab：空屋转化、容量、不产兵');
{
  const w = createWorld('normal', 0);
  const h = getBuilding(w, 1)!;
  h.garrison = 40;
  ok(convertBuilding(w, 1, 'lab', 1), '空屋 → Lab 转化成功');
  const lab = getBuilding(w, 1)!;
  ok(lab.type === 'lab' && lab.level === 0, '类型 / 等级正确', `${lab.type} Lv${lab.level + 1}`);
  ok(lab.capacity === 40 && lab.production === 0, '容量 40、不产兵', `${lab.capacity} / ${lab.production}`);
  ok(Math.abs(lab.garrison - 30) < 1e-6, '转化只扣 10 驻军', `${lab.garrison}`);
  ok(convertBuilding(w, 0, 'lab', 1) === false, '兵营不能转 Lab');
}

console.log('18) 炼制：15 秒、驻军锁定、跌破成本中断、炼成扣兵');
{
  const w = createWorld('normal', 0);
  const h = getBuilding(w, 1)!;
  h.garrison = 40;
  convertBuilding(w, 1, 'lab', 1);
  const lab = getBuilding(w, 1)!;
  lab.garrison = 25;
  ok(startBrew(w, lab.id, 'freeze', 1), '驻军 25 开始炼冻结');
  ok(lab.brew === 'freeze' && lab.brewT === 0, '进入炼制状态');
  ok(issueSend(w, lab.id, 7, 1) === false, 'Lab 不能出兵');
  run(w, BREW_TIME - 0.2);
  ok(lab.potion === null && lab.brew === 'freeze', '15 秒前尚未炼成');
  lab.garrison = 20;
  run(w, 0.2);
  ok(lab.brew === null && lab.potion === null, '驻军跌破成本 → 中断清零');
  lab.garrison = 25;
  ok(startBrew(w, lab.id, 'freeze', 1), '可以重新开始炼制');
  run(w, BREW_TIME + 0.2);
  ok(lab.potion === 'freeze', '15 秒后炼成冻结');
  ok(Math.abs(lab.garrison) < 1e-6, '炼成时扣 25 驻军', `${lab.garrison}`);
  ok(cancelBrew(w, lab.id, 1) === false, '已炼成的药水不能取消');
}

console.log('19) 冻结：冰层 = 冻结瞬间驻军，派兵 1:1 解冻、解冻兵不进驻');
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
  ok(releaseSpell(w, lab.id, 7, 1), '释放冻结');
  run(w, 1);
  ok(fort.frozen > 0, '命中后进入冻结', `${fort.frozen}`);
  ok(Math.abs(fort.frozen - 9) < 0.001, '冰层 = 冻结瞬间驻军', `${fort.frozen}`);
  ok(issueSend(w, 7, 0, 2) === false, '冻结中不能出兵');
  ok(upgradeBuilding(w, 7, 2) === false, '冻结中不能升级');

  const h2 = getBuilding(w, 2)!;
  h2.faction = 2;
  h2.garrison = 20;
  ok(issueSend(w, 2, 7, 2, 'all'), '可以从另一座建筑派兵解冻');
  run(w, 6);
  ok(fort.frozen === 0, '解冻完成');
  ok(fort.garrison <= 9.01, '解冻兵不进驻', `${fort.garrison}`);
}

console.log('20) 感染：30 秒、掉兵 1.5/s、停火、防御按 1、仍可出兵');
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
  ok(releaseSpell(w, lab.id, 7, 1), '释放感染');
  run(w, 1);
  ok(fort.infectT > 0, '感染生效', `${fort.infectT}`);
  ok(Math.abs(fort.infectT - (INFECT_DURATION - 1)) < 1.2, '持续约 30 秒', `${fort.infectT}`);
  ok(defenseOf(fort) === 1, '感染时防御按 1（原 2）');
  const before = fort.garrison;
  run(w, 2);
  ok(fort.garrison < before - 2.5, '每秒掉 1.5 兵', `${before.toFixed(1)}→${fort.garrison.toFixed(1)}`);

  // 感染中的棘堡不开火
  const mk = (faction: 1 | 2, x: number, y: number, count: number) => ({
    id: 9900 + faction, faction, count, fromId: -1, toId: -1,
    sx: x, sy: y, tx: x, ty: y, x, y, px: x, py: y,
    t: 0, prevT: 0, speed: 0, arc: 0, dead: false,
  });
  w.packets.push(mk(1, fort.x + 40, fort.y, 10) as never);
  run(w, 2);
  const p = w.packets.find((x) => x.faction === 1);
  ok(Boolean(p) && p!.count === 10, '感染中的棘堡不开火', `count=${p?.count}`);

  fort.garrison = 20;
  ok(issueSend(w, 7, 0, 2, 'half'), '感染中仍可出兵');
}

console.log('21) 捕获：无门槛翻转、保留类型/等级、驻军原样保留');
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
  ok(releaseSpell(w, lab.id, 3, 1), '释放捕获');
  run(w, 0.85);
  ok(getBuilding(w, 3)!.faction === 1, '捕获直接翻转归属');
  ok(target.level === lv && target.type === 'barracks', '保留类型与等级');
  ok(target.garrison > 17.5, '驻军原样保留（捕获瞬间）', `${target.garrison.toFixed(2)}`);
  const kept = target.garrison;
  ok(w.stats.peak >= 17.5, '保留的驻军计入峰值', `${w.stats.peak.toFixed(2)}`);
  run(w, 1);
  ok(w.stats.captured >= 1, '计入占领统计', `kept=${kept.toFixed(2)} now=${target.garrison.toFixed(2)}`);
}

console.log('22) 计分：四项公式 + 三星线');
{
  const w = createWorld('normal', 0);
  w.phase = 'won';
  w.time = 60;
  w.stats.captured = 5;
  w.stats.upgradeSpent = 40;
  w.stats.peak = 30;
  const parts = scoreBreakdown(w);
  ok(
    parts.capture === 50 && parts.upgrade === 20 && parts.peak === 30 && parts.time === 100,
    '四项分别 50 / 20 / 30 / 100',
    JSON.stringify(parts),
  );
  ok(runScore(w) === 200, '总分 200', `${runScore(w)}`);
  ok(runStars(w) === 2, '200 分 = 2★（3★ 线 260）', `${runStars(w)}`);
  w.stats.captured = 20;
  ok(runStars(w) === 3, '350 分 = 3★', `${runStars(w)}`);
  const lines = starLines(0);
  ok(lines.par === 110 && lines.star3 === 260 && lines.star2 === 182, '三星线 110s / 260 / 182');
}

console.log('23) AI 会释放药水，且主动建造最多 1 座 Lab');
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
  const ai = createAI(5);
  updateAI(w, ai, 0.1, 2);
  run(w, 1);
  ok(w.buildings.some((b) => b.frozen > 0), 'AI 会释放已炼成的药水');
  ok(bestSpellTarget(w, 2, 'freeze') !== null, 'AI 能找到冻结目标');

  const w2 = createWorld('normal', 0);
  const a1 = createAI(31);
  const a2 = createAI(47);
  const built = { 1: 0, 2: 0 };
  for (let i = 0; i < 30 * 200; i++) {
    tick(w2, TICK_DT);
    updateAI(w2, a1, TICK_DT, 1);
    updateAI(w2, a2, TICK_DT, 2);
    for (const e of w2.events) {
      if (e.type !== 'convert') continue;
      const b = w2.buildings.find((x) => Math.abs(x.x - e.x) < 1 && Math.abs(x.y - e.y) < 1);
      if (b?.type === 'lab' && (e.faction === 1 || e.faction === 2)) built[e.faction] += 1;
    }
    w2.events.length = 0;
  }
  ok(built[1] <= 1 && built[2] <= 1, '每方主动建造最多 1 座 Lab', `built=${built[1]}/${built[2]}`);
}

console.log('24) 转化/升级门槛：驻军 = 成本即可，允许花到 0');
{
  const w = createWorld('normal', 0);
  const h = getBuilding(w, 1)!;
  h.garrison = 10;
  ok(convertBuilding(w, 1, 'fort', 1), '10/10 空屋可转棘堡');
  ok(getBuilding(w, 1)!.type === 'fort', '类型变成棘堡');
  ok(getBuilding(w, 1)!.garrison === 0, '转完驻军为 0', `${getBuilding(w, 1)!.garrison}`);

  const w2 = createWorld('normal', 0);
  const labHouse = getBuilding(w2, 9)!;
  labHouse.garrison = 10;
  ok(convertBuilding(w2, 9, 'lab', 1), '10/10 空屋可转实验室');
  ok(getBuilding(w2, 9)!.garrison === 0, 'Lab 转完驻军为 0');

  const w3 = createWorld('normal', 0);
  const b = getBuilding(w3, 0)!;
  const cost = BUILDINGS[b.type][b.level + 1].cost;
  b.garrison = cost;
  ok(upgradeBuilding(w3, 0, 1), '驻军 = 成本可升级');
  ok(b.garrison === 0, '升级后驻军为 0', `${b.garrison}`);
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
if (failed > 0) throw new Error(`${failed} sim test(s) failed`);
