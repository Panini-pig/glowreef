/**
 * 自玩（self-play）：用真实鼠标事件完整打一局，验证交互链路而不只是逻辑层。
 *   node selfplay.cjs                 # normal / 关卡 0
 *   DIFF=easy LVL=1 node selfplay.cjs
 *
 * 策略（和 sim 层的 sparring 保持一致，简单但靠谱）：
 *  1) 兵营有闲钱就升级（最大的那座，>= 下一级成本 + 6）
 *  2) 兵营不到 3 座时，把驻军 >=7 的空屋转成兵营
 *  3) 全体孕育巢对"最弱目标"半投（空格全选 → 单击目标）
 */
const { chromium } = require('playwright-core');
const path = require('path');

const URL = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const DIFF = process.env.DIFF || 'normal';
const LVL = Number(process.env.LVL || 0);
const NEXT_COST = [5, 10, 20, 30]; // 1→2 / 2→3 / 3→4 / 4→5

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const exe = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1248', 'chrome-win64', 'chrome.exe');
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));

  await page.goto(URL, { waitUntil: 'load' });
  await sleep(800);
  await page.click('#btn-play');
  await page.evaluate(([d, l]) => window.__COLONY__.newGame(d, l), [DIFF, LVL]);
  await sleep(500);

  const state = () =>
    page.evaluate(() => {
      const w = window.__COLONY__.world();
      return {
        phase: window.__COLONY__.phase(),
        time: w.time,
        me: w.buildings
          .filter((b) => b.faction === 1)
          .map((b) => ({ id: b.id, type: b.type, g: Math.floor(b.garrison), lv: b.level, x: b.x, y: b.y })),
        foes: w.buildings
          .filter((b) => b.faction !== 1)
          .map((b) => ({ id: b.id, type: b.type, f: b.faction, g: Math.floor(b.garrison), def: b.defense, x: b.x, y: b.y })),
        selected: window.__COLONY__.selected(),
        power: window.__COLONY__.power(),
      };
    });

  const toScreen = (x, y) => page.evaluate(([a, b]) => window.__COLONY__.toScreen(a, b), [x, y]);
  const clickWorld = async (x, y) => {
    const p = await toScreen(x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(140);
  };

  const log = [];
  let actions = 0;
  let exitReason = 'timeout';
  const t0 = Date.now();

  while (Date.now() - t0 < 520000) {
    const s = await state();
    if (s.phase !== 'playing') {
      exitReason = 'phase=' + s.phase;
      break;
    }
    if (Date.now() - t0 > 518000) break;
    if (s.time > 350) {
      exitReason = 'gameTimeCap';
      break;
    }

    const barracks = s.me.filter((b) => b.type === 'barracks');
    const houses = s.me.filter((b) => b.type === 'house');
    const total = barracks.reduce((sum, b) => sum + b.g, 0);

    // 1) 升级最大的兵营
    const up = barracks
      .filter((b) => b.lv < 4 && b.g >= (NEXT_COST[b.lv] ?? 99) + 6)
      .sort((a, b) => b.g - a.g)[0];
    if (up) {
      await clickWorld(up.x, up.y);
      const arrow = await page.evaluate((id) => window.__COLONY__.hot(id).arrow, up.id);
      const p = await toScreen(arrow.x + arrow.w / 2, arrow.y + arrow.h / 2);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(180);
      actions += 1;
      log.push(`t=${s.time.toFixed(0)}s 升级 #${up.id} Lv${up.lv}→${up.lv + 1}`);
      continue;
    }

    // 2) 空屋转兵营（不超过 3 座）
    const h = houses.find((x) => x.g >= 7);
    if (h && barracks.length < 3) {
      await clickWorld(h.x, h.y);
      await sleep(160);
      const chips = (await page.evaluate((id) => window.__COLONY__.hot(id), h.id)).chips;
      const c = chips[0];
      await clickWorld(c.x + c.w / 2, c.y + c.h / 2);
      actions += 1;
      log.push(`t=${s.time.toFixed(0)}s 转化空屋#${h.id} → 孕育巢`);
      continue;
    }

    // 3) 全体半投最弱目标
    if (total >= 6 && s.foes.length) {
      const t = s.foes.reduce((a, b) => (a.g * a.def <= b.g * b.def ? a : b));
      const need = t.g * t.def + 1;
      if (total / 2 >= need * 1.05) {
        await page.keyboard.press('Space');
        await sleep(150);
        if ((await state()).selected.length > 0) {
          await clickWorld(t.x, t.y);
          await sleep(300);
          actions += 1;
          log.push(`t=${s.time.toFixed(0)}s 半投 ${total} → #${t.id}(g${t.g} d${t.def})`);
          continue;
        }
      }
    }

    await sleep(300);
  }

  const end = await state();
  await page.screenshot({ path: 'shots/selfplay-end.png' });

  console.log(`\n模式 ${DIFF} / 关卡 ${LVL}`);
  console.log(`结果：${end.phase}   用时 ${end.time.toFixed(0)}s   动作 ${actions} 次   (${exitReason})`);
  console.log(`终局战力：蓝 ${Math.round(end.power.p1)} / 红 ${Math.round(end.power.p2)}`);
  console.log(`剩余据点：蓝 ${end.me.length} / 红/中立 ${end.foes.length}`);
  console.log('前 10 个动作：');
  console.log(log.slice(0, 10).join('\n'));
  console.log('控制台错误：' + (errs.length ? errs.slice(0, 3).join(' | ') : '无'));

  await browser.close();
  if (end.phase === 'playing') process.exitCode = 2;
})();
