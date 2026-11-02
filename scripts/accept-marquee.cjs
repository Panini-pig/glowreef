/**
 * 浏览器验收：拖拽框选 + 等级花苞 + Lab 法术 + 计分 + 悬停卡/帮助抽屉。
 *
 *   npm run dev                 # 另开一个终端
 *   node scripts/accept-marquee.cjs
 *
 * 会顺带把 docs/ 下的截图（screenshot/marquee/level/first-run/title/lab/spell-hit/result/card/help）更新掉。
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const URL = process.env.GAME_URL || 'http://127.0.0.1:5173/';
const OUT = path.join(__dirname, '..', 'docs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

function centerIn(b, r) {
  const cx = b.x;
  const cy = b.y - 6;
  return cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
}

function expectedIn(list, r) {
  return list.filter((b) => b.faction === 1 && centerIn(b, r)).map((b) => b.id).sort((a, b) => a - b);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const exe = path.join(
    process.env.LOCALAPPDATA,
    'ms-playwright',
    'chromium-1248',
    'chrome-win64',
    'chrome.exe',
  );
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

  const toScreen = (x, y) => page.evaluate(([a, b]) => window.__COLONY__.toScreen(a, b), [x, y]);
  const state = () =>
    page.evaluate(() => {
      const w = window.__COLONY__.world();
      return {
        phase: window.__COLONY__.phase(),
        time: w.time,
        buildings: w.buildings.map((b) => ({
          id: b.id,
          type: b.type,
          faction: b.faction,
          x: b.x,
          y: b.y,
          level: b.level,
          garrison: b.garrison,
          capacity: b.capacity,
          frozen: b.frozen,
          infectT: b.infectT,
          brew: b.brew,
          brewT: b.brewT,
          potion: b.potion,
        })),
        selected: window.__COLONY__.selected(),
        marquee: window.__COLONY__.marquee(),
        packets: w.packets.map((p) => ({ id: p.id, fromId: p.fromId, toId: p.toId, count: p.count })),
      };
    });

  const clickWorld = async (x, y, jitter = 0) => {
    const p = await toScreen(x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    if (jitter) await page.mouse.move(p.x + jitter, p.y + jitter * 0.6);
    await page.mouse.up();
    await sleep(150);
  };

  const dragStart = async (r) => {
    const a = await toScreen(r.x0, r.y0);
    const b = await toScreen(r.x1, r.y1);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await sleep(130);
    return { a, b };
  };

  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__COLONY__));
    // 等启动遮罩退场再截标题页，否则会截到 “SEEDING THE TRENCH…”
    await page
      .waitForFunction(
        () => {
          const b = document.getElementById('boot');
          return !b || b.classList.contains('gone');
        },
        { timeout: 3000 },
      )
      .catch(() => {});
    await sleep(260);
    await page.screenshot({ path: path.join(OUT, 'title.png') });
    await page.click('#btn-play');
    await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
    // 自然局面的主截图：在首局提示出现前截，避免提示挡住棋盘
    await sleep(350);
    await page.screenshot({ path: path.join(OUT, 'screenshot.png') });
    await sleep(650);

    // ---------- 首次提示 ----------
    const hintOn = await page
      .waitForFunction(
        () => {
          const el = document.getElementById('marquee-hint');
          return Boolean(el && el.classList.contains('on'));
        },
        { timeout: 2500 },
      )
      .then(() => true)
      .catch(() => false);
    check('首次进局出现“拖动框选”提示', hintOn);
    await page.screenshot({ path: path.join(OUT, 'first-run.png') });

    let s = await state();
    let all = s.buildings;
    const empty = (() => {
      let best = { x: 640, y: 360 };
      let bestD = -1;
      for (let y = 110; y < 640; y += 40) {
        for (let x = 80; x < 1200; x += 40) {
          const d = Math.min(...all.map((b) => Math.hypot(b.x - x, b.y - y)));
          if (d > bestD) {
            bestD = d;
            best = { x, y };
          }
        }
      }
      return best;
    })();
    await clickWorld(empty.x, empty.y);
    await sleep(500);
    const hintGone = await page.evaluate(() => {
      const el = document.getElementById('marquee-hint');
      return !el.classList.contains('on') && localStorage.getItem('abyss.marqueeHint.v1') === '1';
    });
    check('点击后提示消失并记住（localStorage）', hintGone);

    // 把两座中立建筑收过来，方便测多选与排除
    await page.evaluate(() => {
      window.__COLONY__.capture(6, 1);
      window.__COLONY__.capture(7, 1);
    });
    await sleep(120);
    s = await state();
    all = s.buildings;
    const own = all.filter((b) => b.faction === 1);

    // ---------- 短按 = 点选 ----------
    const b0 = own.find((b) => b.type === 'barracks') || own[0];
    await clickWorld(b0.x, b0.y - 6, 3);
    s = await state();
    check('移动 < 阈值仍是点选', s.selected.length === 1 && s.selected[0] === b0.id, JSON.stringify(s.selected));

    // ---------- 框选（实时预览 + 松开保留） ----------
    const pair = (() => {
      let best = null;
      for (let i = 0; i < own.length; i += 1) {
        for (let j = i + 1; j < own.length; j += 1) {
          const d = Math.hypot(own[i].x - own[j].x, own[i].y - own[j].y);
          if (!best || d < best.d) best = { a: own[i], b: own[j], d };
        }
      }
      return best;
    })();
    const minX = Math.min(pair.a.x, pair.b.x) - 45;
    const maxX = Math.max(pair.a.x, pair.b.x) + 45;
    const minY = Math.min(pair.a.y, pair.b.y) - 45;
    const maxY = Math.max(pair.a.y, pair.b.y) + 45;
    const box1 = { x0: Math.max(24, minX), y0: Math.max(70, minY), x1: Math.min(1256, maxX), y1: Math.min(650, maxY) };
    const exp1 = expectedIn(all, box1);
    const { a: a1, b: b1 } = await dragStart(box1);
    s = await state();
    check('拖动中出现选择框', Boolean(s.marquee), JSON.stringify(s.marquee));
    check('框选结果 = 中心点在框内的己方建筑', JSON.stringify(s.selected) === JSON.stringify(exp1), `${JSON.stringify(s.selected)} vs ${JSON.stringify(exp1)}`);
    check('拖动中已实时高亮', exp1.length >= 2 && s.selected.length === exp1.length);
    await page.screenshot({ path: path.join(OUT, 'marquee.png') });
    await page.mouse.up();
    await sleep(180);
    s = await state();
    check('松开后选择框消失、选中保留', s.marquee === null && JSON.stringify(s.selected) === JSON.stringify(exp1));
    void a1;
    void b1;

    // ---------- 触发框选会清空旧选择 ----------
    await clickWorld(empty.x, empty.y);
    await clickWorld(b0.x, b0.y - 6);
    s = await state();
    const before = s.selected;
    const b6 = all.find((b) => b.id === 6);
    const box2 = { x0: b6.x - 40, y0: b6.y - 40, x1: b6.x + 40, y1: b6.y + 40 };
    const exp2 = expectedIn(all, box2);
    await dragStart(box2);
    await page.mouse.up();
    await sleep(180);
    s = await state();
    check('框选触发时清空旧选择', before.length === 1 && JSON.stringify(s.selected) === JSON.stringify(exp2) && !s.selected.includes(b0.id), `${JSON.stringify(before)} -> ${JSON.stringify(s.selected)}`);

    // ---------- 从塔身上起拖：不点选、不出兵 ----------
    const beforeDrag = await state();
    const g0 = beforeDrag.buildings.find((b) => b.id === b0.id).garrison;
    const target = { x: Math.min(1200, b0.x + 95), y: Math.min(620, b0.y + 65) };
    const ps = await toScreen(b0.x, b0.y - 6);
    const pe = await toScreen(target.x, target.y);
    await page.mouse.move(ps.x, ps.y);
    await page.mouse.down();
    await page.mouse.move(pe.x, pe.y, { steps: 8 });
    await page.mouse.up();
    await sleep(420);
    s = await state();
    const g1 = s.buildings.find((b) => b.id === b0.id).garrison;
    check('塔身上起拖 = 框选（包含塔自身）', s.selected.includes(b0.id), JSON.stringify(s.selected));
    check('塔身上起拖不会误出兵', g1 >= g0 - 0.01 && !s.packets.some((p) => p.fromId === b0.id), `garrison ${g0}->${g1}`);

    // ---------- 点空白取消 ----------
    await clickWorld(empty.x, empty.y);
    s = await state();
    check('点空白取消选择', s.selected.length === 0);

    // ---------- 框到敌方不会选中 ----------
    const foe = all.find((b) => b.faction === 2);
    const box3 = { x0: foe.x - 50, y0: foe.y - 50, x1: foe.x + 50, y1: foe.y + 50 };
    const exp3 = expectedIn(all, box3);
    await dragStart(box3);
    await page.mouse.up();
    await sleep(180);
    s = await state();
    check('框到敌方不选中敌方', !s.selected.includes(foe.id) && s.selected.every((id) => all.find((b) => b.id === id).faction === 1));
    check('框到敌方时只选己方（可能是 0 座）', JSON.stringify(s.selected) === JSON.stringify(exp3), JSON.stringify(s.selected));

    // ---------- 触屏合成事件 ----------
    await clickWorld(empty.x, empty.y);
    const a2 = await toScreen(box1.x0, box1.y0);
    const b2 = await toScreen(box1.x1, box1.y1);
    await page.evaluate(
      ([sx, sy, ex, ey]) => {
        const c = document.getElementById('game');
        const fire = (type, x, y) =>
          c.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 91,
              pointerType: 'touch',
              isPrimary: true,
              clientX: x,
              clientY: y,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
              bubbles: true,
              cancelable: true,
              composed: true,
            }),
          );
        fire('pointerdown', sx, sy);
        fire('pointermove', (sx + ex) / 2, (sy + ey) / 2);
        fire('pointermove', ex, ey);
        fire('pointerup', ex, ey);
      },
      [a2.x, a2.y, b2.x, b2.y],
    );
    await sleep(220);
    s = await state();
    check('触屏单指拖动也能框选', JSON.stringify(s.selected) === JSON.stringify(exp1), JSON.stringify(s.selected));

    // 框选后点其中一座己方塔 = 其余向它集结（用户确认保留的语义）
    const targetId = exp1[0];
    const targetB = all.find((b) => b.id === targetId);
    const gatherFrom = exp1.slice(1);
    // 固定参与集结的塔：避免 AI 在这几百毫秒里把某座塔打空/夺走，造成脚本偶发失败
    await page.evaluate(
      ([target, from]) => {
        const w = window.__COLONY__.world();
        const set = (id, g) => {
          const b = w.buildings.find((x) => x.id === id);
          if (b) {
            b.faction = 1;
            b.garrison = g;
          }
        };
        set(target, 10);
        for (const id of from) set(id, 10);
      },
      [targetId, gatherFrom],
    );
    await sleep(80);
    const preGather = await state();
    const gBefore = gatherFrom.map((id) => preGather.buildings.find((b) => b.id === id).garrison);
    const gatherIdsBefore = new Set(preGather.packets.map((p) => p.id));
    await clickWorld(targetB.x, targetB.y - 6);
    await sleep(360);
    s = await state();
    const gatherPackets = s.packets.filter(
      (p) => !gatherIdsBefore.has(p.id) && gatherFrom.includes(p.fromId) && p.toId === targetId,
    );
    check(
      '框选后点己方塔 = 其余向它集结',
      gatherPackets.length === gatherFrom.length &&
        gatherPackets.every((p) => p.count === Math.floor(gBefore[gatherFrom.indexOf(p.fromId)] / 2)) &&
        s.selected.length === 0,
      JSON.stringify(gatherPackets),
    );

    // ---------- 点击链路回归：半投 / 全投 / 增援 / 升级 / 转化 ----------
    await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
    await sleep(320);
    s = await state();
    const myBar = s.buildings.find((b) => b.faction === 1 && b.type === 'barracks');
    const foeBar = s.buildings.find((b) => b.faction === 2);

    await clickWorld(myBar.x, myBar.y - 6);
    let myNow = (await state()).buildings.find((b) => b.id === myBar.id).garrison;
    const foeScr = await toScreen(foeBar.x, foeBar.y - 6);
    let idsBefore = new Set((await state()).packets.map((p) => p.id));
    await clickWorld(foeBar.x, foeBar.y - 6);
    await sleep(340);
    s = await state();
    let fresh = s.packets.filter((p) => !idsBefore.has(p.id) && p.fromId === myBar.id && p.toId === foeBar.id);
    check(
      '单击敌方 = 半投',
      fresh.length === 1 && fresh[0].count === Math.floor(myNow / 2),
      `packet=${JSON.stringify(fresh)} garrison=${myNow}`,
    );

    await clickWorld(myBar.x, myBar.y - 6);
    myNow = (await state()).buildings.find((b) => b.id === myBar.id).garrison;
    idsBefore = new Set((await state()).packets.map((p) => p.id));
    await page.mouse.dblclick(foeScr.x, foeScr.y);
    await sleep(340);
    s = await state();
    fresh = s.packets.filter((p) => !idsBefore.has(p.id) && p.fromId === myBar.id && p.toId === foeBar.id);
    check(
      '双击敌方 = 全投',
      fresh.length === 1 && fresh[0].count === Math.floor(myNow),
      `packet=${JSON.stringify(fresh)} garrison=${myNow}`,
    );

    // 增援：A → B
    await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
    await sleep(320);
    s = await state();
    const mineList = s.buildings.filter((b) => b.faction === 1);
    const src = mineList.find((b) => b.type === 'barracks');
    const dst = mineList.find((b) => b.id !== src.id);
    await clickWorld(src.x, src.y - 6);
    const srcG = (await state()).buildings.find((b) => b.id === src.id).garrison;
    idsBefore = new Set((await state()).packets.map((p) => p.id));
    await clickWorld(dst.x, dst.y - 6);
    await sleep(340);
    s = await state();
    fresh = s.packets.filter((p) => !idsBefore.has(p.id) && p.fromId === src.id && p.toId === dst.id);
    check('点己方另一处 = 增援', fresh.length === 1 && fresh[0].count === Math.floor(srcG / 2), JSON.stringify(fresh));

    // 升级：悬停箭头 → 点箭头
    await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
    await sleep(320);
    s = await state();
    const upTower = s.buildings.find((b) => b.faction === 1 && b.type === 'barracks');
    const lv0 = upTower.level;
    // 初始兵营是 Lv.2，升到 Lv.3 要 10 兵；先补足驻军，避免测成“按钮不可负担”
    await page.evaluate((id) => {
      const b = window.__COLONY__.world().buildings.find((x) => x.id === id);
      if (b) b.garrison = 40;
    }, upTower.id);
    const arrow = (await page.evaluate((id) => window.__COLONY__.hot(id).arrow, upTower.id));
    await clickWorld(arrow.x + arrow.w / 2, arrow.y + arrow.h / 2);
    await sleep(150);
    s = await state();
    check('升级箭头仍可点击', s.buildings.find((b) => b.id === upTower.id).level === lv0 + 1);

    // 转化：选中空屋 → 点“孕育巢”按钮
    await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
    await sleep(320);
    await page.evaluate(() => {
      const w = window.__COLONY__.world();
      const h = w.buildings.find((b) => b.faction === 1 && b.type === 'house');
      if (h) h.garrison = 10;
    });
    const house = (await state()).buildings.find((b) => b.faction === 1 && b.type === 'house');
    await clickWorld(house.x, house.y - 6);
    const chip = (await page.evaluate((id) => window.__COLONY__.hot(id).chips[0], house.id));
    await clickWorld(chip.x + chip.w / 2, chip.y + chip.h / 2);
    await sleep(150);
    s = await state();
    check('转化按钮仍可点击', s.buildings.find((b) => b.id === house.id).type === 'barracks');

    // 10/10 空屋：成本 = 10 也能转棘堡（v1.3 门槛）
    await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
    await sleep(300);
    await page.evaluate(() => {
      const h = window.__COLONY__.world().buildings.find((b) => b.id === 1);
      if (h) h.garrison = 10;
    });
    await clickWorld(146, 404 - 6);
    s = await state();
    await page.screenshot({ path: path.join(OUT, 'convert.png') });
    const fortChip = await page.evaluate(() => window.__COLONY__.hot(1).chips[1]);
    await clickWorld(fortChip.x + fortChip.w / 2, fortChip.y + fortChip.h / 2);
    s = await state();
    const converted = s.buildings.find((b) => b.id === 1);
    check(
      '10/10 空屋可直接转棘堡（转完 0 兵）',
      converted.type === 'fort' && converted.garrison < 0.01,
      JSON.stringify(converted),
    );

    // ---------- UI：悬停卡 / 帮助抽屉 ----------
    await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
    await sleep(320);
    await page.evaluate(() => {
      const b = window.__COLONY__.world().buildings.find((x) => x.id === 0);
      if (b) {
        b.level = 4;
        b.capacity = 50;
        b.garrison = 50;
        b.production = 2.25;
      }
    });
    const bp = await toScreen(232, 556 - 6);
    await page.mouse.move(bp.x, bp.y);
    await sleep(450);
    const card = await page.evaluate(() => window.__COLONY__.card());
    check(
      '悬停卡锚定在塔右侧/左侧并略高于中心',
      Boolean(card) &&
        card.w <= 200 &&
        card.h <= 84 &&
        Math.abs(card.y + card.h / 2 - 518.8) < 12 &&
        (card.x > 232 + 40 || card.x + card.w < 232 - 40),
      JSON.stringify(card),
    );
    await page.screenshot({ path: path.join(OUT, 'card.png') });

    // 右侧出屏/被挡时应翻到左边
    const edgeState = await state();
    const edgeTower = edgeState.buildings.find((b) => b.id === 2);
    const ep = await toScreen(edgeTower.x, edgeTower.y - 6);
    await page.mouse.move(ep.x, ep.y);
    await sleep(420);
    const edgeCard = await page.evaluate(() => window.__COLONY__.card());
    check(
      '右侧出屏时悬停卡翻到左边',
      Boolean(edgeCard) && edgeCard.x + edgeCard.w <= edgeTower.x - 40,
      JSON.stringify(edgeCard),
    );

    const hint = await page.evaluate(() => window.__COLONY__.helpHint());
    const hp = await toScreen(hint.x + hint.w / 2, hint.y + hint.h / 2);
    await page.mouse.move(hp.x, hp.y);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(320);
    const helpOpened = await page.evaluate(() => window.__COLONY__.helpOpen());
    check('点右下 ? 打开帮助抽屉', helpOpened);
    await page.screenshot({ path: path.join(OUT, 'help.png') });
    const timeAtOpen = await page.evaluate(() => window.__COLONY__.world().time);
    await sleep(500);
    const timeAfterHelp = await page.evaluate(() => window.__COLONY__.world().time);
    check(
      '帮助打开时游戏暂停',
      Math.abs(timeAfterHelp - timeAtOpen) < 0.05,
      `${timeAtOpen} → ${timeAfterHelp}`,
    );
    await page.keyboard.press('Escape');
    await sleep(320);
    const helpClosed = await page.evaluate(
      () => !window.__COLONY__.helpOpen() && !document.getElementById('help-drawer').classList.contains('on'),
    );
    check('Esc 关闭帮助', helpClosed);

    // ---------- M2.1：Lab / 法术 / 计分 ----------
    await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
    await sleep(320);
    await page.evaluate(() => {
      const h = window.__COLONY__.world().buildings.find((b) => b.id === 1);
      if (h) h.garrison = 40;
    });
    await clickWorld(146, 404 - 6);
    const labChip = await page.evaluate(() => window.__COLONY__.hot(1).chips[2]);
    await clickWorld(labChip.x + labChip.w / 2, labChip.y + labChip.h / 2);
    s = await state();
    check('转化第三项 = 实验室', s.buildings.find((b) => b.id === 1).type === 'lab');

    await clickWorld(420, 200);
    await clickWorld(146, 404 - 6);
    const slots = await page.evaluate(() => window.__COLONY__.hot(1).slots);
    check('Lab 单选时出现 3 个法术槽', slots.length === 3, JSON.stringify(slots));
    await clickWorld(slots[0].x + slots[0].w / 2, slots[0].y + slots[0].h / 2);
    s = await state();
    const labOn = s.buildings.find((b) => b.id === 1);
    check('点冻结槽开始炼制', labOn.brew === 'freeze', JSON.stringify(labOn));
    await sleep(450);
    await page.screenshot({ path: path.join(OUT, 'lab.png') });

    const packetsBefore = new Set(s.packets.map((p) => p.id));
    await clickWorld(640, 486 - 6);
    s = await state();
    check(
      'Lab 不能出兵（点敌方不发光球）',
      !s.packets.some((p) => !packetsBefore.has(p.id) && p.fromId === 1),
    );

    await page.evaluate(() => {
      const b = window.__COLONY__.world().buildings.find((x) => x.id === 1);
      if (b) b.garrison = 20;
    });
    await sleep(500);
    s = await state();
    check('驻军跌破 25 → 炼制中断', s.buildings.find((b) => b.id === 1).brew === null);

    await page.evaluate(() => {
      const b = window.__COLONY__.world().buildings.find((x) => x.id === 1);
      if (b) b.garrison = 40;
    });
    const slots2 = await page.evaluate(() => window.__COLONY__.hot(1).slots);
    await clickWorld(slots2[0].x + slots2[0].w / 2, slots2[0].y + slots2[0].h / 2);
    await page.evaluate(() => {
      const b = window.__COLONY__.world().buildings.find((x) => x.id === 1);
      if (b && b.brew) b.brewT = 14.9;
    });
    await sleep(700);
    s = await state();
    const labReady = s.buildings.find((b) => b.id === 1);
    check(
      '15 秒炼成冻结并扣 25',
      labReady.potion === 'freeze' && labReady.garrison <= 15,
      JSON.stringify(labReady),
    );

    await clickWorld(420, 200);
    await clickWorld(146, 404 - 6);
    await clickWorld(640, 486 - 6);
    await page
      .waitForFunction(() => window.__COLONY__.world().spells.length === 0, { timeout: 6000 })
      .catch(() => {});
    await sleep(250);
    s = await state();
    const frozenFort = s.buildings.find((b) => b.id === 7);
    check('点敌方释放，棘堡被冻结', frozenFort.frozen > 0, JSON.stringify(frozenFort));
    await page.screenshot({ path: path.join(OUT, 'spell-hit.png') });

    await page.evaluate(() => {
      const w = window.__COLONY__.world();
      w.time = 60;
      w.stats.captured = 6;
      w.stats.upgradeSpent = 40;
      w.stats.peak = 30;
      w.phase = 'won';
    });
    await sleep(500);
    const resultText = await page.evaluate(() => document.getElementById('result-stat').innerText);
    check('结算显示分数与星级', resultText.includes('分数') && resultText.includes('★'), resultText);
    check(
      '最高分写入 localStorage',
      await page.evaluate(() => Boolean(localStorage.getItem('abyss.best.v1'))),
    );
    await page.screenshot({ path: path.join(OUT, 'result.png') });

    // ---------- 等级表现截图 ----------
    await page.evaluate(() => window.__COLONY__.newGame('easy', 0));
    await sleep(300);
    await page.evaluate(() => {
      const w = window.__COLONY__.world();
      const byId = (id) => w.buildings.find((b) => b.id === id);
      window.__COLONY__.capture(3, 1);
      window.__COLONY__.capture(6, 1);
      window.__COLONY__.capture(7, 1);
      const a = byId(0);
      const b = byId(3);
      const c = byId(6);
      const d = byId(7);
      const e = byId(4);
      if (a) a.level = 4;
      if (b) b.level = 1;
      if (c) c.level = 2;
      if (d) d.level = 3;
      if (e) {
        e.type = 'barracks';
        e.faction = 1;
        e.level = 0;
      }
    });
    await sleep(900);

    const zoomTarget = all.find((b) => b.id === 0);
    const zs = await toScreen(zoomTarget.x, zoomTarget.y - 20);
    const clip = {
      x: Math.max(0, Math.min(1440 - 360, zs.x - 180)),
      y: Math.max(0, Math.min(900 - 300, zs.y - 170)),
      width: 360,
      height: 300,
    };
    await page.screenshot({ path: path.join(OUT, 'level-buds.png'), clip });
    await page.screenshot({ path: path.join(OUT, 'level-buds-wide.png') });

    check('无控制台错误 / 未捕获异常', errs.length === 0, errs.join(' | '));
  } catch (e) {
    fail += 1;
    failures.push(`脚本异常 :: ${e && e.stack ? e.stack : e}`);
    console.error(e);
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(`RESULT pass=${pass} fail=${fail}`);
  if (fail > 0) {
    console.log('FAILURES:');
    for (const f of failures) console.log(' - ' + f);
    process.exitCode = 1;
  }
})();
