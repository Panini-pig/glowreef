/**
 * 浏览器端验收：转化 → 升级 → 一颗球投送 → 增援 → 占领 → 易主清空选中 → 胜利
 * 运行前先 `npm run dev`（或 preview），然后： node acceptance.cjs
 */
const { chromium } = require('playwright-core');
const path = require('path');

const URL = process.env.GAME_URL || 'http://127.0.0.1:5173/';
let failed = 0;
function ok(cond, name, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

(async () => {
  const exe = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1248', 'chrome-win64', 'chrome.exe');
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.click('#btn-play');
  await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
  await page.waitForTimeout(700);

  const world = () =>
    page.evaluate(() =>
      window.__COLONY__.world().buildings.map((b) => ({
        id: b.id, type: b.type, f: b.faction, g: +b.garrison.toFixed(1), lv: b.level, x: b.x, y: b.y,
      })),
    );
  const clickWorld = async (x, y) => {
    const p = await page.evaluate(([x, y]) => window.__COLONY__.toScreen(x, y), [x, y]);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  const sel = () => page.evaluate(() => window.__COLONY__.selected());
  const waitNoPacketFrom = async (id, timeout = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const n = await page.evaluate(
        (bid) => window.__COLONY__.world().packets.filter((p) => p.fromId === bid).length,
        id,
      );
      if (n === 0) return;
      await page.waitForTimeout(120);
    }
  };
  const clearSel = async () => {
    await page.mouse.click(20, 700, { button: 'right' });
    await page.waitForTimeout(120);
  };
  const select = async (b) => {
    await clearSel();
    await clickWorld(b.x, b.y);
  };

  console.log('1) 空屋 → 悬浮转化按钮（带图标）');
  let bs = await world();
  const house = bs.find((b) => b.f === 1 && b.type === 'house');
  await page.evaluate((id) => {
    window.__COLONY__.world().buildings.find((b) => b.id === id).garrison = 14;
  }, house.id);
  await clickWorld(house.x, house.y);
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'shots/chk-01-chips.png' });
  const chips = (await page.evaluate((id) => window.__COLONY__.hot(id), house.id)).chips;
  ok(chips.length === 2, '有两个转化选项');
  ok(Math.abs(chips[0].x + chips[0].w / 2 - house.x) < 140, '按钮悬浮在建筑附近', JSON.stringify(chips[0]));
  const c0 = chips[0];
  await clickWorld(c0.x + c0.w / 2, c0.y + c0.h / 2);
  bs = await world();
  ok(bs.find((b) => b.id === house.id).type === 'barracks', '点击图标完成转化');

  console.log('2) 箭头升级');
  await page.evaluate((id) => {
    window.__COLONY__.world().buildings.find((b) => b.id === id).garrison = 40;
  }, house.id);
  const arrow = (await page.evaluate((id) => window.__COLONY__.hot(id), house.id)).arrow;
  await clickWorld(arrow.x + arrow.w / 2, arrow.y + arrow.h / 2);
  bs = await world();
  ok(bs.find((b) => b.id === house.id).lv === 1, '升级到 2 级');

  console.log('3) 单击半数 / 双击全部');
  await select(house);
  const target = bs.find((b) => b.id === 4);
  await page.evaluate((id) => {
    const b = window.__COLONY__.world().buildings.find((x) => x.id === id);
    b.garrison = 12;
  }, house.id);
  await clickWorld(target.x, target.y);
  await page.waitForTimeout(320); // 220ms 双击判定窗口
  const halfPackets = await page.evaluate(() =>
    window.__COLONY__.world().packets.map((p) => ({ from: p.fromId, to: p.toId, count: p.count })),
  );
  const halfMine = halfPackets.filter((p) => p.from === house.id);
  ok(halfMine.length === 1, '单击只产生一颗球', JSON.stringify(halfPackets));
  ok(halfMine[0].count === 6, '单击 = 半数（12 → 6）', `count=${halfMine[0]?.count}`);
  ok((await sel()).length === 0, '投送后自动取消选中');

  await waitNoPacketFrom(house.id);
  await page.evaluate((id) => {
    const b = window.__COLONY__.world().buildings.find((x) => x.id === id);
    b.garrison = 12;
  }, house.id);
  await page.evaluate(() => {
    window.__COLONY__.world().buildings.find((b) => b.id === 4).faction = 0;
  });
  await select(house);
  const p2 = await page.evaluate(([x, y]) => window.__COLONY__.toScreen(x, y), [target.x, target.y]);
  await page.mouse.move(p2.x, p2.y);
  await page.mouse.dblclick(p2.x, p2.y);
  await page.waitForTimeout(320);
  const allPackets = await page.evaluate(() =>
    window.__COLONY__.world().packets.map((p) => ({ from: p.fromId, to: p.toId, count: p.count })),
  );
  const allMine = allPackets.filter((p) => p.from === house.id);
  ok(allMine.length === 1, '双击只产生一颗球（没有先发半颗）', JSON.stringify(allPackets));
  ok(allMine[0].count === 12, '双击 = 全部（12 → 12）', `count=${allMine[0]?.count}`);
  ok((await sel()).length === 0, '双击后也保持未选中');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/chk-02-ball.png' });

  console.log('4) 增援己方');
  bs = await world();
  const srcBar = bs.find((b) => b.id === 0);
  await page.evaluate(() => {
    window.__COLONY__.world().buildings.find((b) => b.id === 0).garrison = 9;
  });
  await select(srcBar);
  await clickWorld(house.x, house.y);
  await page.waitForTimeout(150);
  const reinforce = await page.evaluate(() =>
    window.__COLONY__.world().packets.map((p) => ({ from: p.fromId, to: p.toId, count: p.count })),
  );
  const rein = reinforce.filter((p) => p.from === 0 && p.to === house.id);
  ok(rein.length === 1, '点击己方另一处 = 增援投送', JSON.stringify(reinforce));
  ok(rein[0]?.count === 4, '增援同样遵循"单击半数"（9 → 4）', `count=${rein[0]?.count}`);
  ok((await sel()).length === 0, '增援后也取消选中');

  // 兵不够时不发兵、也不清空选中
  await page.evaluate(() => {
    window.__COLONY__.world().buildings.find((b) => b.id === 0).garrison = 0;
  });
  await select(srcBar);
  await clickWorld(target.x, target.y);
  await page.waitForTimeout(300);
  ok((await sel()).length === 1, '没发出去时保留选中');

  console.log('5) 占领中立');
  await page.waitForTimeout(5200);
  await page.evaluate(() => {
    const w = window.__COLONY__.world();
    const t = w.buildings.find((b) => b.id === 4);
    t.garrison = 3;
  });
  bs = await world();
  ok(bs.find((b) => b.id === 4).f === 1, '中立据点被占领');

  console.log('6) 建筑易主 → 选中自动清空');
  bs = await world();
  const mineNow = bs.find((b) => b.f === 1);
  ok(Boolean(mineNow), '手上还有据点');
  await select(mineNow);
  ok((await sel()).length >= 1, '先选中一处');
  await page.evaluate((id) => {
    window.__COLONY__.capture(id, 2);
  }, mineNow.id);
  await page.waitForTimeout(250);
  ok((await sel()).length === 0, '易主后自动取消选中', JSON.stringify(await sel()));

  console.log('7) 胜利与结算');
  await page.evaluate(() => {
    for (const b of window.__COLONY__.world().buildings) if (b.faction !== 1) b.faction = 1;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'shots/chk-03-win.png' });
  ok((await page.evaluate(() => window.__COLONY__.phase())) === 'result', '弹出结算');
  ok(await page.isVisible('#result'), '结算面板可见');

  console.log('8) 空格全选 → 点己方某塔 = 其余塔半投');
  await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const w = window.__COLONY__.world();
    for (const b of w.buildings) if (b.faction === 1) b.garrison = 12;
  });
  // 开局只有一座兵营：先把空屋转成兵营，凑出两个产出塔
  {
    const h = (await world()).find((b) => b.f === 1 && b.type === 'house');
    await clickWorld(h.x, h.y);
    await page.waitForTimeout(260);
    const cs = (await page.evaluate((id) => window.__COLONY__.hot(id), h.id)).chips;
    await clickWorld(cs[0].x + cs[0].w / 2, cs[0].y + cs[0].h / 2);
    await page.waitForTimeout(250);
  }
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  const selectedAll = await sel();
  ok(selectedAll.length >= 2, '空格选中了多个己方塔', JSON.stringify(selectedAll));

  bs = await world();
  const host = bs.find((b) => b.f === 1);
  await clickWorld(host.x, host.y);
  await page.waitForTimeout(330);
  const toHost = await page.evaluate(
    (id) => window.__COLONY__.world().packets.filter((p) => p.toId === id).map((p) => ({ from: p.fromId, count: p.count })),
    host.id,
  );
  ok(toHost.length >= 1, '其它塔向它投送', JSON.stringify(toHost));
  ok(
    toHost.every((p) => p.from !== host.id),
    '投送方不包含目标自己',
  );
  ok((await sel()).length === 0, '增援后清空选中');

  console.log('9) 空格只选孕育巢（不选空屋/棘堡）');
  await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const w = window.__COLONY__.world();
    for (const b of w.buildings) if (b.faction === 1) b.garrison = 14;
  });
  {
    // 把空屋转成棘堡：空格不应该选中它
    const h = (await world()).find((b) => b.f === 1 && b.type === 'house');
    await clickWorld(h.x, h.y);
    await page.waitForTimeout(240);
    const cs = (await page.evaluate((id) => window.__COLONY__.hot(id), h.id)).chips;
    const fortChip = cs[1];
    await clickWorld(fortChip.x + fortChip.w / 2, fortChip.y + fortChip.h / 2);
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  const picked = await page.evaluate(() => {
    const w = window.__COLONY__.world();
    return window.__COLONY__.selected().map((id) => w.buildings.find((b) => b.id === id).type);
  });
  ok(picked.length > 0, '选中了东西', JSON.stringify(picked));
  ok(picked.every((t) => t === 'barracks'), '只选孕育巢，棘堡/空屋被排除', JSON.stringify(picked));

  ok(errs.length === 0, '无控制台错误', errs.slice(0, 3).join(' | '));
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
})();
