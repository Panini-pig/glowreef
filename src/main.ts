import { BUILDINGS, TICK_DT, WORLD_H, WORLD_W } from './sim/config.ts';
import { createAI, updateAI } from './sim/ai.ts';
import { LEVELS } from './sim/level.ts';
import type { Difficulty, SpellId, World } from './sim/types.ts';
import {
  cancelBrew,
  convertBuilding,
  createWorld,
  factionPower,
  getBuilding,
  issueSend,
  releaseSpell,
  startBrew,
  tick,
  upgradeBuilding,
} from './sim/world.ts';
import { runScore, runStars, scoreBreakdown } from './sim/score.ts';
import { Renderer, type ViewState } from './render/renderer.ts';
import { Sfx } from './render/audio.ts';
import { convertChipRects, spellSlotRects, upgradeButton } from './render/draw.ts';
import { helpHintRect } from './render/ui.ts';
import { buildingsInRect } from './input/selection.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const boot = document.getElementById('boot')!;
const titleEl = document.getElementById('title')!;
const resultEl = document.getElementById('result')!;
const pauseEl = document.getElementById('pause')!;
const resultTitle = document.getElementById('result-title')!;
const resultStat = document.getElementById('result-stat')!;
const helpDrawer = document.getElementById('help-drawer')!;
const helpBackdrop = document.getElementById('help-backdrop')!;

const renderer = new Renderer(canvas, WORLD_W, WORLD_H);
const sfx = new Sfx();

type Phase = 'title' | 'playing' | 'paused' | 'result';
let phase: Phase = 'title';
let world: World = createWorld('normal', 0);
let ai = createAI(12345);
let difficulty: Difficulty = 'normal';
let acc = 0;
let last = performance.now();
let viewTime = 0;
let helpOpen = false;

const selected: number[] = [];
const pointer = { x: WORLD_W / 2, y: WORLD_H / 2 };

/** 单击=半数、双击=全投；用 220ms 判定，避免双击时先误发一半。 */
const DOUBLE_MS = 220;
interface PendingSend {
  targetId: number;
  fromIds: number[];
  t0: number;
}
let pending: PendingSend | null = null;

/**
 * 按下到松开之间的“候选点击”。
 * 因为任意位置都能起拖，点选/出兵必须等到松开、且移动没超过阈值时才执行。
 */
interface PressState {
  pointerId: number;
  /** 按下的世界坐标（判定框的原点、也是点选目标） */
  x: number;
  y: number;
  /** 按下的屏幕坐标：拖动阈值按屏幕像素算，缩放后手感一致 */
  clientX: number;
  clientY: number;
  /** 当前世界坐标 */
  cx: number;
  cy: number;
  touch: boolean;
  dragging: boolean;
  /** 本次拖拽是否已经响过“选中”提示音 */
  sounded: boolean;
  /** 按下时命中的己方/敌方建筑；null = 空白 */
  buildingId: number | null;
}
let press: PressState | null = null;

/** 拖动超过这个距离才算框选，否则仍是点击。触屏手指抖，阈值放大。 */
const DRAG_THRESHOLD_MOUSE = 6;
const DRAG_THRESHOLD_TOUCH = 8;

const view: ViewState = {
  selected,
  hovered: null,
  pointer,
  time: 0,
  pendingTarget: null,
  marquee: null,
};

function fit(): void {
  const availW = window.innerWidth - 32;
  const availH = window.innerHeight - 32;
  const k = Math.min(availW / WORLD_W, availH / WORLD_H);
  const w = Math.max(320, Math.floor(WORLD_W * k));
  const h = Math.max(180, Math.floor(WORLD_H * k));
  renderer.resize(w, h);
}
window.addEventListener('resize', fit);

function openHelp(): void {
  if (phase !== 'playing' || helpOpen) return;
  helpOpen = true;
  helpDrawer.classList.add('on');
  helpBackdrop.classList.add('on');
  helpDrawer.setAttribute('aria-hidden', 'false');
  acc = 0;
  sfx.select();
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
}

function closeHelp(): void {
  if (!helpOpen) return;
  helpOpen = false;
  helpDrawer.classList.remove('on');
  helpBackdrop.classList.remove('on');
  helpDrawer.setAttribute('aria-hidden', 'true');
  acc = 0;
  last = performance.now();
}

function setPhase(p: Phase): void {
  if (p !== 'playing' && helpOpen) closeHelp();
  phase = p;
  titleEl.classList.toggle('hidden', p !== 'title');
  resultEl.classList.toggle('hidden', p !== 'result');
  pauseEl.classList.toggle('hidden', p !== 'paused');
  // 离开对局时收掉所有未完成的指针状态，避免暂停后松开还在结算
  if (p !== 'playing') {
    press = null;
    view.marquee = null;
  }
  // 关键：进入游戏后立刻让按钮失焦，否则空格会"再次点击开始按钮"
  if (p === 'playing') {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
    scheduleMarqueeHint();
  }
}

function newGame(diff: Difficulty): void {
  closeHelp();
  difficulty = diff;
  const levelIndex = Math.floor(Math.random() * LEVELS.length);
  world = createWorld(diff, levelIndex);
  ai = createAI((Math.random() * 1e9) | 0);
  selected.length = 0;
  pending = null;
  press = null;
  view.marquee = null;
  view.hovered = null;
  acc = 0;
  setPhase('playing');
}

function showResult(): void {
  const win = world.phase === 'won';
  resultTitle.textContent = win ? '海沟已点亮' : '光被吞没';
  resultTitle.className = `result-title ${win ? 'win' : 'lose'}`;
  const secs = Math.floor(world.time);
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  sfx.result(win);

  const score = runScore(world);
  const stars = runStars(world);
  const parts = scoreBreakdown(world);
  const best = loadBest();
  const key = String(world.levelId);
  const prev = best[key];
  const isBest = win && (!prev || score > prev.score);
  if (isBest) {
    best[key] = { score, stars };
    saveBest(best);
  }
  const starText = stars > 0 ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '☆☆☆';
  const bestLine = isBest
    ? '<span class="new-best">新纪录</span>'
    : prev
      ? `本关最佳 ${prev.score} 分 ${'★'.repeat(prev.stars)}`
      : '首次通关';
  resultStat.title =
    `占领 ${parts.capture} + 升级 ${parts.upgrade} + 峰值 ${parts.peak} + 时间 ${parts.time} = ${parts.total}`;
  resultStat.innerHTML =
    `用时 <b>${mm}:${ss.toString().padStart(2, '0')}</b>　·　` +
    `分数 <b>${score}</b>　<span class="stars">${starText}</span><br/>` +
    `占领 <b>${world.stats.captured}</b> 处　·　` +
    `投送 <b>${world.stats.sent}</b> 只　·　` +
    `峰值驻军 <b>${Math.floor(world.stats.peak)}</b><br/>` +
    `<span class="best-line">${bestLine}</span>`;
  setPhase('result');
}

// ---------- 三星存档 ----------

const BEST_KEY = 'abyss.best.v1';
interface BestEntry {
  score: number;
  stars: number;
}

function loadBest(): Record<string, BestEntry> {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BestEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveBest(record: Record<string, BestEntry>): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(record));
  } catch {
    // 隐私模式 / 存储禁用：本次成绩照常显示
  }
}

function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  viewTime += dt;
  view.time = viewTime;

  if (phase === 'playing' && !helpOpen) {
    acc += dt;
    let guard = 0;
    while (acc >= TICK_DT && guard < 6) {
      tick(world, TICK_DT);
      updateAI(world, ai, TICK_DT);
      acc -= TICK_DT;
      guard += 1;
    }
    if (world.phase !== 'playing') showResult();
  }
  pruneSelection();
  flushPending(now);
  view.pendingTarget = pending ? pending.targetId : null;

  // 声音：事件驱动，先于清空 events
  for (const e of world.events) {
    // 敌方事件降噪：只保留一部分命中声
    if (e.faction !== 1 && e.type !== 'capture' && e.type === 'hit' && Math.random() > 0.35) {
      continue;
    }
    if (e.type === 'spawn') sfx.send();
    else if (e.type === 'hit') sfx.hit();
    else if (e.type === 'capture') sfx.capture();
    else if (e.type === 'upgrade' || e.type === 'convert') sfx.upgrade();
    else if (e.type === 'brew') sfx.brew();
    else if (e.type === 'potion') sfx.potion();
    else if (e.type === 'cast') sfx.cast(e.spell ?? 'freeze');
    else if (e.type === 'freeze') sfx.freeze();
    else if (e.type === 'thaw') sfx.freeze();
    else if (e.type === 'infect') sfx.infect();
    else if (e.type === 'interrupt') sfx.deny();
  }

  renderer.consume(world.events);
  world.events.length = 0;
  renderer.frame(world, view, dt, Math.min(1, acc / TICK_DT));

  requestAnimationFrame(loop);
}

// ---------- 输入 ----------

function buildingAt(x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const b of world.buildings) {
    const d = Math.hypot(b.x - x, b.y - 6 - y);
    const radius = b.type === 'house' ? 46 : 56;
    if (d < radius && d < bestD) {
      bestD = d;
      best = b.id;
    }
  }
  return best;
}

function clearSelection(): void {
  flushPending(performance.now(), true);
  view.selected.length = 0;
}

/** 建筑一旦易主，立刻从选中集里剔除——否则玩家会"指挥"敌方的炮台。 */
function pruneSelection(): void {
  for (let i = view.selected.length - 1; i >= 0; i -= 1) {
    const b = getBuilding(world, view.selected[i]);
    if (!b || b.faction !== 1) view.selected.splice(i, 1);
  }
}

/** 只清选中环，不动待决投送（点完目标后立即调用） */
function dropSelection(): void {
  view.selected.length = 0;
}

function selectOnly(id: number): void {
  view.selected.length = 0;
  view.selected.push(id);
  sfx.select();
}

function inRect(r: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** 返回鼠标下的"可交互热区"：升级箭头 / 转化按钮 / 法术槽 / 建筑 */
function hotAt(x: number, y: number):
  | { kind: 'arrow'; id: number }
  | { kind: 'convert'; id: number; type: 'barracks' | 'fort' | 'lab' }
  | { kind: 'spell'; id: number; spell: SpellId }
  | { kind: 'help' }
  | { kind: 'building'; id: number }
  | null {
  // 0. 右下角帮助入口（永远最优先，避免被建筑热区吃掉）
  if (inRect(helpHintRect(), x, y)) return { kind: 'help' };

  const sole = view.selected.length === 1 ? getBuilding(world, view.selected[0]) : null;
  if (sole) {
    // 1. 转化按钮（仅当选中了一个己方空屋）
    if (sole.faction === 1 && sole.type === 'house') {
      for (const c of convertChipRects(sole, world.buildings)) {
        if (inRect(c, x, y)) return { kind: 'convert', id: sole.id, type: c.type };
      }
    }
    // 2. 法术槽（仅当选中了一个己方 Lab）
    if (sole.faction === 1 && sole.type === 'lab') {
      for (const s of spellSlotRects(sole, world.buildings)) {
        if (inRect(s, x, y)) return { kind: 'spell', id: sole.id, spell: s.spell };
      }
    }
  }
  // 3. 升级按钮：只在鼠标悬停的那个塔上出现，所以只测它
  //    选中的 Lab 让位给法术槽（箭头不画、也不可点；升级用 E）
  const selectedLab = sole?.type === 'lab';
  if (view.hovered !== null && !selectedLab) {
    const hb = getBuilding(world, view.hovered);
    if (hb && hb.faction === 1 && hb.level < BUILDINGS[hb.type].length - 1) {
      const cost = BUILDINGS[hb.type][hb.level + 1].cost;
      if (inRect(upgradeButton(hb, cost, 0).rect, x, y)) return { kind: 'arrow', id: hb.id };
    }
  }
  // 4. 建筑本体
  const id = buildingAt(x, y);
  return id === null ? null : { kind: 'building', id };
}

function executeSend(fromIds: number[], targetId: number, mode: 'half' | 'all'): number {
  let sent = 0;
  for (const id of fromIds) {
    if (issueSend(world, id, targetId, 1, mode)) sent += 1;
  }
  if (sent === 0) sfx.deny();
  else sfx.select();
  return sent;
}

function flushPending(now: number, force = false): void {
  if (!pending) return;
  if (!force && now - pending.t0 < DOUBLE_MS) return;
  const p = pending;
  pending = null;
  executeSend(p.fromIds, p.targetId, 'half');
}

/**
 * 尝试向 targetId 投送。
 * - 220ms 内第二次落在同一目标 → 全投（用第一次点击时的快照，不依赖当前选中）
 * - 否则先按"半数"挂起，等窗口结束再真正出手
 * - 返回 true 表示"这次点击被吞下、且确实有兵可派"，调用方据此清除选中；
 *   返回 false（兵不够 / 目标是自己）则保留选中，方便直接换目标。
 */
function trySendTo(targetId: number, fromIds: number[]): boolean {
  const now = performance.now();

  // 双击窗口：同一目标 → 直接全投
  if (pending && pending.targetId === targetId && now - pending.t0 <= DOUBLE_MS) {
    const ids = pending.fromIds;
    pending = null;
    const sent = executeSend(ids, targetId, 'all');
    if (sent === 0) sfx.deny();
    return sent > 0;
  }

  const usable = fromIds.filter((id) => {
    if (id === targetId) return false;
    const b = getBuilding(world, id);
    return Boolean(
      b &&
        b.faction === 1 &&
        b.type !== 'lab' &&
        b.frozen <= 0 &&
        Math.floor(b.garrison) >= 1,
    );
  });
  if (usable.length === 0) return false;

  if (pending) flushPending(now, true);
  pending = { targetId, fromIds: usable, t0: now };
  return true;
}

function normalizedRect(x0: number, y0: number, x1: number, y1: number) {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

/** 框选只认己方建筑，判定点是塔的中心；像 Windows 一样边拖边亮。 */
function selectInRect(r: { x: number; y: number; w: number; h: number }): number {
  view.selected.length = 0;
  for (const id of buildingsInRect(world.buildings, r, 1)) view.selected.push(id);
  return view.selected.length;
}

function beginDrag(): void {
  if (!press) return;
  press.dragging = true;
  // 框选 = 新的一次选择：先结算挂起的投送，再清空旧选择（已确认的语义）
  clearSelection();
  view.hovered = null;
  view.marquee = normalizedRect(press.x, press.y, press.cx, press.cy);
  if (selectInRect(view.marquee) > 0) {
    sfx.select();
    press.sounded = true;
  }
  canvas.style.cursor = 'crosshair';
}

function updateDrag(): void {
  if (!press) return;
  view.marquee = normalizedRect(press.x, press.y, press.cx, press.cy);
  const n = selectInRect(view.marquee);
  if (n > 0 && !press.sounded) {
    sfx.select();
    press.sounded = true;
  }
}

/** 结束一次按下（点击或拖框），同时释放指针捕获。 */
function endPress(): void {
  if (!press) return;
  try {
    canvas.releasePointerCapture(press.pointerId);
  } catch {
    // 指针已经失效（例如触屏取消）时忽略
  }
  press = null;
  view.marquee = null;
}

/** 松开时结算点击：原先 pointerdown 里的逻辑原样搬过来。 */
function handleClick(buildingId: number | null): void {
  if (buildingId === null) {
    clearSelection();
    return;
  }
  const b = getBuilding(world, buildingId);
  if (!b) {
    clearSelection();
    return;
  }

  // ⓪ 就绪 Lab：单选时点敌方 = 释放药水；点自己保持选中；点己方不出兵
  const sole = view.selected.length === 1 ? getBuilding(world, view.selected[0]) : null;
  if (sole && sole.faction === 1 && sole.type === 'lab' && sole.potion) {
    if (sole.id === b.id) return;
    if (b.faction !== 1) {
      if (releaseSpell(world, sole.id, b.id, 1)) {
        sfx.cast(sole.potion);
        dropSelection();
      } else {
        sfx.deny();
      }
      return;
    }
    return; // 点己方：不出兵
  }

  // 就绪 Lab 在多选里被点到：先收敛为单选，进入"可释放"状态（不集结）
  if (b.faction === 1 && b.type === 'lab' && b.potion) {
    selectOnly(b.id);
    return;
  }

  // ① 双击窗口：落在同一目标 → 全投（快照里的源，哪怕选中已经被清掉）
  if (pending && pending.targetId === b.id && performance.now() - pending.t0 <= DOUBLE_MS) {
    const ids = pending.fromIds;
    pending = null;
    const sent = executeSend(ids, b.id, 'all');
    if (sent === 0) sfx.deny();
    return;
  }

  // ② 己方建筑：选中 / 取消选中 / 增援
  if (b.faction === 1) {
    const isSelected = view.selected.includes(b.id);

    // 只选中了它自己 → 再点一次 = 取消
    if (isSelected && view.selected.length === 1) {
      clearSelection();
      return;
    }
    if (view.selected.length === 0) {
      selectOnly(b.id);
      return;
    }
    // 多选（比如框选 A/B/C）时点 B → A、C 向 B 半投
    // 单选 A 时点 B → A 向 B 半投
    const others = view.selected.filter((id) => id !== b.id);
    if (others.length > 0 && trySendTo(b.id, others)) dropSelection();
    return;
  }

  // ③ 敌方 / 中立：投送；发出去就取消选中，没发出去保留
  if (view.selected.length === 0) return;
  if (trySendTo(b.id, view.selected)) dropSelection();
}

canvas.addEventListener('pointermove', (e) => {
  if (press && e.pointerId !== press.pointerId) return;
  const p = renderer.toWorld(e.clientX, e.clientY);
  view.pointer.x = p.x;
  view.pointer.y = p.y;

  if (press) {
    press.cx = p.x;
    press.cy = p.y;
    if (!press.dragging) {
      const d = Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY);
      const threshold = press.touch ? DRAG_THRESHOLD_TOUCH : DRAG_THRESHOLD_MOUSE;
      if (d > threshold) beginDrag();
    }
    if (press.dragging) {
      updateDrag();
      view.hovered = null;
      return;
    }
  }

  let hovered = buildingAt(p.x, p.y);
  // 升级按钮浮在塔的头顶，鼠标移上去时也要保持"悬停在这个塔"，否则按钮会消失点不到
  if (hovered === null) {
    for (const b of world.buildings) {
      if (b.faction !== 1 || b.level >= BUILDINGS[b.type].length - 1) continue;
      const cost = BUILDINGS[b.type][b.level + 1].cost;
      if (inRect(upgradeButton(b, cost, 0).rect, p.x, p.y)) {
        hovered = b.id;
        break;
      }
    }
  }
  view.hovered = hovered;
  const hot = hotAt(p.x, p.y);
  canvas.style.cursor = hot ? 'pointer' : 'crosshair';
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  sfx.unlock();
  if (phase !== 'playing') return;
  if (helpOpen) return;
  if (press) return;
  dismissMarqueeHint();

  const p = renderer.toWorld(e.clientX, e.clientY);
  const hot = hotAt(p.x, p.y);

  // 升级箭头 / 转化按钮 / 法术槽 / 帮助按钮：小热区不参与拖框，按下即执行
  if (hot?.kind === 'help') {
    openHelp();
    return;
  }
  if (hot?.kind === 'convert') {
    if (!convertBuilding(world, hot.id, hot.type, 1)) sfx.deny();
    return;
  }
  if (hot?.kind === 'spell') {
    const lab = getBuilding(world, hot.id);
    if (lab?.brew === hot.spell) {
      if (cancelBrew(world, hot.id, 1)) sfx.select();
      else sfx.deny();
    } else if (startBrew(world, hot.id, hot.spell, 1)) {
      sfx.brew();
    } else {
      sfx.deny();
    }
    return;
  }
  if (hot?.kind === 'arrow') {
    if (!upgradeBuilding(world, hot.id, 1)) sfx.deny();
    return;
  }

  press = {
    pointerId: e.pointerId,
    x: p.x,
    y: p.y,
    clientX: e.clientX,
    clientY: e.clientY,
    cx: p.x,
    cy: p.y,
    touch: e.pointerType === 'touch',
    dragging: false,
    sounded: false,
    buildingId: hot?.kind === 'building' ? hot.id : null,
  };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // 合成事件（自动化测试）没有真实指针，捕获失败不影响后续逻辑
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (!press || e.pointerId !== press.pointerId) return;
  const wasDragging = press.dragging;
  const buildingId = press.buildingId;
  endPress();
  if (wasDragging) return;
  handleClick(buildingId);
});

canvas.addEventListener('pointercancel', (e) => {
  if (!press || e.pointerId !== press.pointerId) return;
  // 触屏手势被系统打断：保留已经亮起的选中，结束拖框
  endPress();
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  endPress();
  clearSelection();
});

window.addEventListener('keydown', (e) => {
  // 空格永远属于游戏（否则会"点击"当前聚焦的按钮）
  if (e.code === 'Space') e.preventDefault();

  // 帮助层优先：打开时吞掉其它按键，Esc / ? / H 关闭
  if (helpOpen) {
    if (e.code === 'Escape' || e.key === '?' || e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      closeHelp();
    }
    return;
  }
  if (e.key === '?' || e.key === 'h' || e.key === 'H') {
    if (phase === 'playing') {
      e.preventDefault();
      openHelp();
    }
    return;
  }

  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

  // 拖框途中按 Esc：先收掉框，不急着暂停
  if (e.code === 'Escape' && press) {
    e.preventDefault();
    endPress();
    return;
  }
  if (press) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (phase !== 'playing') return;
    // 空格只挑"孕育巢"——空屋和棘堡都不参与，避免误把防守塔的兵抽空
    const mine = world.buildings.filter((b) => b.faction === 1 && b.type === 'barracks');
    view.selected.length = 0;
    for (const b of mine) view.selected.push(b.id);
    if (mine.length > 0) sfx.select();
    else sfx.deny();
    return;
  }
  if (e.code === 'Escape') {
    if (phase === 'playing') setPhase('paused');
    else if (phase === 'paused') setPhase('playing');
    return;
  }
  if (e.key === 'e' || e.key === 'E') {
    for (const id of view.selected) upgradeBuilding(world, id, 1);
    return;
  }
  if (e.key === 'm' || e.key === 'M') {
    sfx.toggleMute();
    return;
  }
  if (e.key === '1') {
    for (const id of view.selected) convertBuilding(world, id, 'barracks', 1);
    return;
  }
  if (e.key === '2') {
    for (const id of view.selected) convertBuilding(world, id, 'fort', 1);
    return;
  }
  if (e.key === '3') {
    for (const id of view.selected) convertBuilding(world, id, 'lab', 1);
  }
});

// ---------- UI / 首次提示 ----------

const HINT_KEY = 'abyss.marqueeHint.v1';
const hintEl = document.getElementById('marquee-hint')!;
let hintTimer = 0;
let hintShown = false;

function scheduleMarqueeHint(): void {
  if (hintShown) return;
  hintShown = true;
  window.setTimeout(showMarqueeHint, 650);
}

function showMarqueeHint(): void {
  if (phase !== 'playing') return;
  try {
    if (localStorage.getItem(HINT_KEY)) return;
  } catch {
    // 隐私模式 / 禁用存储：本次仍然提示
  }
  hintEl.classList.remove('hidden');
  requestAnimationFrame(() => hintEl.classList.add('on'));
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(dismissMarqueeHint, 7000);
}

function dismissMarqueeHint(): void {
  if (!hintEl.classList.contains('on')) return;
  hintEl.classList.remove('on');
  window.clearTimeout(hintTimer);
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    // 忽略存储失败
  }
  window.setTimeout(() => {
    if (!hintEl.classList.contains('on')) hintEl.classList.add('hidden');
  }, 400);
}

// ---------- UI ----------

document.getElementById('btn-play')!.addEventListener('click', () => newGame(difficulty));
document.getElementById('btn-again')!.addEventListener('click', () => newGame(difficulty));
document.getElementById('btn-menu')!.addEventListener('click', () => setPhase('title'));
document.getElementById('btn-resume')!.addEventListener('click', () => setPhase('playing'));
document.getElementById('btn-restart')!.addEventListener('click', () => newGame(difficulty));
document.getElementById('btn-quit')!.addEventListener('click', () => setPhase('title'));
document.getElementById('help-close')!.addEventListener('click', closeHelp);
helpBackdrop.addEventListener('click', closeHelp);

const diffRow = document.getElementById('diff-row')!;
diffRow.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName !== 'BUTTON') return;
  const d = t.dataset.diff as Difficulty | undefined;
  if (!d) return;
  difficulty = d;
  for (const btn of Array.from(diffRow.querySelectorAll('button'))) {
    btn.classList.toggle('on', btn === t);
  }
});

// ---------- 调试钩子（自动化测试用） ----------

interface DebugApi {
  world: () => World;
  newGame: (d: Difficulty, level: number) => void;
  toScreen: (x: number, y: number) => { x: number; y: number };
  capture: (id: number, faction: 1 | 2) => void;
  phase: () => string;
  selected: () => number[];
  hot: (id: number) => {
    arrow: { x: number; y: number; w: number; h: number };
    chips: Array<{ x: number; y: number; w: number; h: number; type: 'barracks' | 'fort' | 'lab' }>;
    slots: Array<{ x: number; y: number; w: number; h: number; spell: SpellId }>;
  } | null;
  power: () => { p1: number; p2: number };
  click: (x: number, y: number) => void;
  resetHint: () => void;
  marquee: () => { x: number; y: number; w: number; h: number } | null;
  brew: (id: number, spell: SpellId) => boolean;
  cancelBrew: (id: number) => boolean;
  release: (id: number, targetId: number) => boolean;
  score: () => number;
  stars: () => number;
  scoreParts: () => ReturnType<typeof scoreBreakdown>;
  best: () => BestEntry | null;
  level: () => { id: number; name: string; par: number; star3: number };
  card: () => { x: number; y: number; w: number; h: number } | null;
  helpHint: () => { x: number; y: number; w: number; h: number };
  helpOpen: () => boolean;
  openHelp: () => void;
  closeHelp: () => void;
}
declare global {
  interface Window {
    __COLONY__?: DebugApi;
  }
}

window.__COLONY__ = {
  world: () => world,
  newGame: (d, level) => {
    world = createWorld(d, level);
    ai = createAI(7);
    selected.length = 0;
    view.selected.length = 0;
    press = null;
    pending = null;
    view.marquee = null;
    view.hovered = null;
    acc = 0;
    setPhase('playing');
  },
  toScreen: (x, y) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: r.left + (x / WORLD_W) * r.width,
      y: r.top + (y / WORLD_H) * r.height,
    };
  },
  capture: (id, faction) => {
    const b = getBuilding(world, id);
    if (b) {
      b.faction = faction;
      b.garrison = Math.max(b.garrison, 4);
    }
  },
  phase: () => phase,
  selected: () => [...view.selected],
  hot: (id) => {
    const b = getBuilding(world, id);
    if (!b) return null;
    const cost = BUILDINGS[b.type][b.level + 1]?.cost ?? 0;
    return {
      arrow: upgradeButton(b, cost, 0).rect,
      chips: convertChipRects(b, world.buildings),
      slots: spellSlotRects(b, world.buildings),
    };
  },
  power: () => ({ p1: factionPower(world, 1), p2: factionPower(world, 2) }),
  click: (x, y) => {
    const p = renderer.toWorld(x, y);
    const id = buildingAt(p.x, p.y);
    if (id === null) return;
    const b = getBuilding(world, id)!;
    if (b.faction === 1) {
      selectOnly(id);
      return;
    }
    const sole = view.selected.length === 1 ? getBuilding(world, view.selected[0]) : null;
    if (sole && sole.faction === 1 && sole.type === 'lab' && sole.potion) {
      releaseSpell(world, sole.id, id, 1);
      return;
    }
    for (const src of view.selected) issueSend(world, src, id, 1);
  },
  brew: (id, spell) => startBrew(world, id, spell, 1),
  cancelBrew: (id) => cancelBrew(world, id, 1),
  release: (id, targetId) => releaseSpell(world, id, targetId, 1),
  score: () => runScore(world),
  stars: () => runStars(world),
  scoreParts: () => scoreBreakdown(world),
  best: () => loadBest()[String(world.levelId)] ?? null,
  level: () => {
    const lv = LEVELS[world.levelId] ?? LEVELS[0];
    return { id: lv.id, name: lv.name, par: lv.par, star3: lv.star3 };
  },
  card: () => renderer.cardBounds(),
  helpHint: () => helpHintRect(),
  helpOpen: () => helpOpen,
  openHelp,
  closeHelp,
  resetHint: () => {
    try {
      localStorage.removeItem(HINT_KEY);
    } catch {
      // 忽略
    }
    hintShown = false;
    hintEl.classList.remove('on');
    hintEl.classList.add('hidden');
  },
  marquee: () => (view.marquee ? { ...view.marquee } : null),
};

// ---------- 启动 ----------

fit();
setPhase('title');
requestAnimationFrame((t) => {
  last = t;
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 600);
  requestAnimationFrame(loop);
});
