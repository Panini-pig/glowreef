import { SPELLS, SPELL_ORDER, WORLD_H, WORLD_W, levelSlots, openLevelSlots } from '../sim/config.ts';
import type { Building, Faction, SpellId } from '../sim/types.ts';
import { GOLD, INK, PAINT, SPELL_COLOR, type FactionPaint } from './palette.ts';
import { FONT_SIZE, RADIUS, SPELL_SLOT, font } from './ui.ts';

export function blobPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  phase: number,
  wobble: number,
  segments = 12,
): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r =
      1 +
      Math.sin(a * 3 + phase) * wobble +
      Math.sin(a * 5 - phase * 0.7) * wobble * 0.55;
    pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
  }
  ctx.beginPath();
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const m0 = mid(pts[0], pts[1]);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 1; i <= pts.length; i++) {
    const cur = pts[i % pts.length];
    const nxt = pts[(i + 1) % pts.length];
    const m = mid(cur, nxt);
    ctx.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
  }
  ctx.closePath();
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const glowCache = new Map<string, HTMLCanvasElement>();

function glowSprite(color: string): HTMLCanvasElement | null {
  const hit = glowCache.get(color);
  if (hit) return hit;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const mid = color.startsWith("#") ? hexToRgba(color, 0.3) : color.replace(/[\d.]+\)$/, "0.3)");
  grad.addColorStop(0, color);
  grad.addColorStop(0.45, mid);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowCache.set(color, c);
  return c;
}

/** 光晕：用缓存好的精灵 drawImage，避免每帧新建几十个径向渐变（低端机杀手）。 */
export function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
): void {
  const sprite = glowSprite(color);
  if (!sprite) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function bodyRadius(b: Building): number {
  if (b.type === 'house') return 25;
  if (b.type === 'lab') return 29 + b.level * 1.5;
  return (b.type === 'fort' ? 29 : 31) + b.level * 1.5;
}

export function bodyCenter(b: Building): { cx: number; cy: number; r: number } {
  const r = bodyRadius(b);
  return { cx: b.x, cy: b.y - 6 - r * 0.52, r };
}

/**
 * 珊瑚礁平台。
 * 这不只是底座——它是"信任感"：玩家要一眼看出哪块礁盘属于谁。
 */
export function drawPlatform(ctx: CanvasRenderingContext2D, b: Building, time: number): void {
  const paint = PAINT[b.faction];
  const pulse = 1 + Math.sin(time * 1.4 + b.id) * 0.012;
  const rx = (b.type === 'house' ? 44 : 54) * pulse;
  const ry = (b.type === 'house' ? 16 : 19) * pulse;
  const cy = b.y + 20;

  // 悬浮阴影
  ctx.save();
  ctx.globalAlpha = 0.55;
  glow(ctx, b.x, cy + 10, rx * 1.45, paint.deep, 0.55);
  ctx.restore();

  // 岩体
  const g = ctx.createLinearGradient(b.x, cy - ry, b.x, cy + ry);
  g.addColorStop(0, 'rgba(34, 66, 78, 1)');
  g.addColorStop(0.5, 'rgba(14, 34, 44, 1)');
  g.addColorStop(1, 'rgba(3, 11, 16, 1)');
  ctx.fillStyle = g;
  blobPath(ctx, b.x, cy, rx, ry, b.id * 1.7, 0.06, 14);
  ctx.fill();

  // 顶部受光边缘
  const rim = ctx.createLinearGradient(b.x - rx, cy - ry, b.x + rx, cy);
  rim.addColorStop(0, paint.core);
  rim.addColorStop(0.35, paint.mid);
  rim.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.5 + b.captureFlash * 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 礁盘纹理（放射状沟壑）
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI + Math.PI * 0.05;
    const x1 = b.x + Math.cos(a) * rx * 0.18;
    const y1 = cy + Math.sin(a) * ry * 0.15;
    const x2 = b.x + Math.cos(a) * rx * 0.92;
    const y2 = cy + Math.sin(a) * ry * 0.92;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 - 2, x2, y2);
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  ctx.restore();

  // 生物发光点
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + b.id * 0.7;
    const gx = b.x + Math.cos(a) * rx * 0.78;
    const gy = cy + Math.sin(a) * ry * 0.72;
    glow(ctx, gx, gy, 7, paint.glow, 0.3 + Math.sin(time * 2 + i + b.id) * 0.12);
  }

  // 等级：礁盘前缘的珊瑚花苞，亮起的朵数 = 等级
  drawLevelMark(ctx, b, cy, ry, time);
}

const levelBloom = new Map<number, { level: number; start: number }>();

/** 刚升上来的那一株，从 0.25 倍弹到 1 倍，带一点过冲。 */
function bloomScale(b: Building, index: number, time: number): number {
  let rec = levelBloom.get(b.id);
  if (!rec) {
    rec = { level: b.level, start: -100 };
    levelBloom.set(b.id, rec);
  } else if (rec.level !== b.level) {
    rec.level = b.level;
    rec.start = time;
  }
  if (index !== b.level) return 1;
  const t = Math.min(1, Math.max(0, (time - rec.start) / 0.55));
  if (t >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  return 0.25 + 0.75 * eased;
}

function drawLevelMark(
  ctx: CanvasRenderingContext2D,
  b: Building,
  cy: number,
  ry: number,
  time: number,
): void {
  const max = levelSlots(b.type);
  const baseY = cy + ry * 0.67;
  const paint = PAINT[b.faction];
  const open = openLevelSlots(b.level);
  const spacing = 13.5;
  const spread = (max - 1) / 2;

  // 珊瑚苗床：一条暗色礁脊，把等级标记从生物的触手里“托”出来
  ctx.save();
  blobPath(ctx, b.x, baseY - 0.2, Math.max(9, spread * spacing + 7), 2.8, b.id * 1.7, 0.1, 12);
  ctx.fillStyle = 'rgba(3, 13, 19, 0.9)';
  ctx.fill();
  ctx.strokeStyle = paint.dim;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  for (let i = 0; i < max; i++) {
    const x = b.x + (i - spread) * spacing;
    const scale = bloomScale(b, i, time);
    drawGlowBud(ctx, b, x, baseY, i, i < open, scale, paint, time);
  }
}

/** 一朵发光花苞：亮起的是已解锁等级，暗色的是还没长出来的位置。 */
function drawGlowBud(
  ctx: CanvasRenderingContext2D,
  b: Building,
  x: number,
  y: number,
  i: number,
  open: boolean,
  scale: number,
  paint: FactionPaint,
  time: number,
): void {
  ctx.save();
  const sway = Math.sin(time * 1.4 + i * 1.2 + b.id) * 0.5;

  if (!open) {
    // 合拢的花苞：暗色水滴 + 一点微光，表示“位置还在，还没开”
    ctx.beginPath();
    ctx.ellipse(x + sway, y - 2.8, 2.2, 3.1, sway * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4, 15, 21, 0.92)';
    ctx.fill();
    ctx.strokeStyle = paint.dim;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    return;
  }

  const fx = x + sway;
  const fy = y - 5.6;
  const pr = 5.6 * scale;

  // 暗晕：保证花瓣压在触手/礁盘上也够清楚
  ctx.beginPath();
  ctx.arc(fx, fy, pr * 1.32, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(2, 10, 15, 0.6)';
  ctx.fill();

  // 花萼：一朵花“坐”在礁脊上，而不是漂着的星星
  ctx.beginPath();
  ctx.ellipse(x, y - 1.2, 3.4, 2.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = paint.deep;
  ctx.fill();
  ctx.strokeStyle = 'rgba(2, 10, 16, 0.8)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  glow(ctx, fx, fy, 11 * scale, paint.glow, 0.5);

  // 五片花瓣
  const rot = time * 0.4 + i * 0.9 + b.id;
  for (let k = 0; k < 5; k++) {
    const a = rot + (k * Math.PI * 2) / 5;
    const px = fx + Math.cos(a) * pr * 0.55;
    const py = fy + Math.sin(a) * pr * 0.55;
    ctx.beginPath();
    ctx.ellipse(px, py, pr * 0.6, pr * 0.34, a, 0, Math.PI * 2);
    ctx.fillStyle = paint.mid;
    ctx.globalAlpha = 0.96;
    ctx.fill();
  }

  // 花心
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(fx, fy, 2.2 * scale, 0, Math.PI * 2);
  ctx.fillStyle = paint.core;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(fx, fy, 1.1 * scale, 0, Math.PI * 2);
  ctx.fillStyle = GOLD;
  ctx.globalAlpha = b.faction === 0 ? 0.65 : 0.95;
  ctx.fill();

  ctx.restore();
}

/** 触手：让它"抓住"礁盘，而不是浮在上面。 */
function drawTentacles(
  ctx: CanvasRenderingContext2D,
  b: Building,
  cx: number,
  cy: number,
  r: number,
  time: number,
): void {
  const paint = PAINT[b.faction];
  const count = b.type === 'house' ? 2 : 4;
  const baseY = cy + r * 0.62;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const spread = (i - (count - 1) / 2) * r * 0.42;
    const sway = Math.sin(time * 1.7 + i * 1.3 + b.id) * 4;
    const len = r * (0.62 + (i % 2) * 0.18);
    ctx.beginPath();
    ctx.moveTo(cx + spread, baseY);
    ctx.quadraticCurveTo(
      cx + spread + sway * 1.2,
      baseY + len * 0.6,
      cx + spread + sway * 2.2,
      baseY + len,
    );
    ctx.strokeStyle = paint.deep;
    ctx.lineWidth = 3.4;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.strokeStyle = paint.mid;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    // 触手末端荧光
    glow(ctx, cx + spread + sway * 2.2, baseY + len, 6, paint.glow, 0.5);
  }
  ctx.restore();
}

/** 生物本体：会呼吸、会看、会被打扁。 */
/**
 * Lab 的玻璃罩：三颗药泡 + 炼制冒泡 + 就绪染色。
 * 它把 Lab 和"孕育巢/棘堡"在轮廓上区分开——一眼能看出这是法术建筑。
 */
function drawLabDome(
  ctx: CanvasRenderingContext2D,
  b: Building,
  cx: number,
  cy: number,
  r: number,
  time: number,
): void {
  const paint = PAINT[b.faction];
  const baseY = cy - r * 0.88;
  const domeR = r * 0.6;
  const domeY = baseY - domeR * 0.45;
  const fillSpell = b.potion ?? b.brew;
  const fill = fillSpell ? SPELL_COLOR[fillSpell].mid : paint.mid;

  // 罩座
  ctx.beginPath();
  ctx.ellipse(cx, baseY, domeR * 1.08, domeR * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8, 30, 40, 0.92)';
  ctx.fill();
  ctx.strokeStyle = paint.dim;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 玻璃罩轮廓（先裁切，再灌液体）
  const domePath = (): void => {
    ctx.beginPath();
    ctx.arc(cx, domeY, domeR, Math.PI, 0);
    ctx.lineTo(cx + domeR, baseY);
    ctx.lineTo(cx - domeR, baseY);
    ctx.closePath();
  };
  const glass = ctx.createRadialGradient(
    cx - domeR * 0.4,
    domeY - domeR * 0.5,
    1,
    cx,
    domeY,
    domeR * 1.3,
  );
  glass.addColorStop(0, 'rgba(240, 255, 255, 0.30)');
  glass.addColorStop(0.55, 'rgba(150, 220, 240, 0.13)');
  glass.addColorStop(1, 'rgba(20, 60, 80, 0.20)');
  domePath();
  ctx.fillStyle = glass;
  ctx.fill();

  // 罩内液体：下方 42%
  ctx.save();
  domePath();
  ctx.clip();
  ctx.globalAlpha = fillSpell ? 0.75 : 0.4;
  ctx.fillStyle = fill;
  ctx.fillRect(cx - domeR, domeY + domeR * 0.35, domeR * 2, domeR * 1.2);
  ctx.globalAlpha = 1;
  // 液面高光
  ctx.beginPath();
  ctx.ellipse(cx, domeY + domeR * 0.35, domeR * 0.82, domeR * 0.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(240, 255, 255, 0.35)';
  ctx.fill();
  ctx.restore();

  // 玻璃描边 + 瓶塞
  domePath();
  ctx.strokeStyle = b.potion ? SPELL_COLOR[b.potion].core : 'rgba(210, 245, 250, 0.55)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  const corkW = domeR * 0.42;
  const corkH = domeR * 0.26;
  ctx.beginPath();
  ctx.roundRect?.(cx - corkW / 2, domeY - domeR - corkH * 0.55, corkW, corkH, 2);
  if (!ctx.roundRect) {
    ctx.rect(cx - corkW / 2, domeY - domeR - corkH * 0.55, corkW, corkH);
  }
  ctx.fillStyle = paint.deep;
  ctx.fill();
  ctx.strokeStyle = paint.mid;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 三颗药泡：亮 = 已解锁
  for (let i = 0; i < SPELL_ORDER.length; i++) {
    const id = SPELL_ORDER[i];
    const unlocked = b.level >= SPELLS[id].unlockLevel;
    const c = SPELL_COLOR[id];
    const bx = cx + (i - 1) * domeR * 0.5;
    const by = domeY + domeR * 0.52 + Math.sin(time * 2.2 + i * 1.7 + b.id) * 2;
    if (unlocked) glow(ctx, bx, by, domeR * 0.8, c.glow, 0.5);
    ctx.beginPath();
    ctx.arc(bx, by, domeR * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = unlocked ? c.core : 'rgba(120, 150, 160, 0.35)';
    ctx.globalAlpha = unlocked ? 0.95 : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 就绪：罩内染色 + 光晕
  if (b.potion) {
    const c = SPELL_COLOR[b.potion];
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(time * 3) * 0.1;
    glow(ctx, cx, domeY, domeR * 3.4, c.glow, 0.85);
    ctx.restore();
  }

  // 炼制：罩内冒泡（进度只由身体外的大环表达）
  if (b.brew) {
    const c = SPELL_COLOR[b.brew];
    for (let i = 0; i < 4; i++) {
      const ph = (time * 0.9 + i * 0.25) % 1;
      const bx = cx + Math.sin(time * 2 + i * 2.1) * domeR * 0.5;
      const by = baseY - ph * domeR * 1.2;
      ctx.globalAlpha = (1 - ph) * 0.9;
      ctx.beginPath();
      ctx.arc(bx, by, 1.4 + (1 - ph) * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = c.core;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

export function drawCreature(
  ctx: CanvasRenderingContext2D,
  b: Building,
  time: number,
  look: { x: number; y: number },
): void {
  const paint = PAINT[b.faction];
  const { cx, cy, r } = bodyCenter(b);
  const squash = 1 + b.hitFlash * 0.18 - b.spawnPulse * 0.14;
  const breath = 1 + Math.sin(time * 1.8 + b.id * 1.3) * 0.035;

  drawTentacles(ctx, b, cx, cy, r, time);

  // 堡垒棘刺 / 兵营侧鳍
  if (b.type === 'fort') {
    const spikes = 12;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + time * 0.04;
      const x1 = cx + Math.cos(a) * r * 0.88;
      const y1 = cy + Math.sin(a) * r * 0.88;
      const x2 = cx + Math.cos(a) * r * 1.42;
      const y2 = cy + Math.sin(a) * r * 1.42;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = paint.deep;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.strokeStyle = paint.mid;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  } else if (b.type === 'barracks') {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * r * 0.82, cy - r * 0.1);
      ctx.quadraticCurveTo(
        cx + s * r * 1.5,
        cy - r * 0.35 + Math.sin(time * 2 + b.id) * 2,
        cx + s * r * 1.25,
        cy + r * 0.5,
      );
      ctx.closePath();
      ctx.fillStyle = paint.deep;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // 外发光
  glow(ctx, cx, cy, r * 2.3, paint.glow, 0.18 + b.captureFlash * 0.45);

  const ratio = b.capacity > 0 ? Math.max(0, Math.min(1, b.garrison / b.capacity)) : 0;
  const overflow = b.garrison - b.capacity;
  const topY = cy - r * 0.94;
  const botY = cy + r * 0.94;
  const surfaceY = botY - (botY - topY) * ratio;

  // 外壳：半透明，像一层果冻膜，真正的颜色来自里面的"液面"
  const shell = ctx.createRadialGradient(
    cx - r * 0.4,
    cy - r * 0.5,
    r * 0.05,
    cx,
    cy,
    r * 1.2,
  );
  shell.addColorStop(0, 'rgba(235, 255, 255, 0.10)');
  shell.addColorStop(0.55, 'rgba(140, 205, 225, 0.06)');
  shell.addColorStop(1, 'rgba(12, 36, 48, 0.22)');

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1 + b.hitFlash * 0.08, breath * squash);
  ctx.translate(-cx, -cy);

  blobPath(ctx, cx, cy, r, r * 0.94, b.id * 0.9 + time * 0.25, 0.035, 12);
  ctx.fillStyle = shell;
  ctx.fill();

  // 液面：裁剪在体内，按 驻军/容量 从下往上填
  ctx.save();
  blobPath(ctx, cx, cy, r, r * 0.94, b.id * 0.9 + time * 0.25, 0.035, 12);
  ctx.clip();

  if (ratio > 0.001) {
    const liquid = ctx.createLinearGradient(0, surfaceY, 0, botY);
    liquid.addColorStop(0, paint.core);
    liquid.addColorStop(0.28, paint.mid);
    liquid.addColorStop(1, paint.deep);
    ctx.globalAlpha = 0.96;
    ctx.fillStyle = liquid;

    // 带一点波动的液面
    ctx.beginPath();
    const waveAmp = 1.6 + Math.min(2.4, ratio * 2);
    const waveY = (x: number) =>
      surfaceY + Math.sin(x * 0.07 + time * 2.2 + b.id) * waveAmp;
    ctx.moveTo(cx - r * 1.1, waveY(cx - r * 1.1));
    for (let x = cx - r * 1.1; x <= cx + r * 1.1; x += 4) ctx.lineTo(x, waveY(x));
    ctx.lineTo(cx + r * 1.1, botY + 6);
    ctx.lineTo(cx - r * 1.1, botY + 6);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // 液面高光
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.1, waveY(cx - r * 1.1));
    for (let x = cx - r * 1.1; x <= cx + r * 1.1; x += 4) ctx.lineTo(x, waveY(x));
    ctx.strokeStyle = paint.core;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore(); // 结束裁剪

  // 溢出：从头顶往外冒泡（读作"装不下了"）
  if (overflow > 0 && ratio >= 1) {
    for (let i = 0; i < 5; i++) {
      const ph = (time * 0.75 + i * 0.27) % 1;
      const bx = cx + Math.sin(time * 1.7 + i * 2.1) * r * 0.55;
      const by = cy - r * 0.85 - ph * r * 0.75;
      const br = 1.4 + (1 - ph) * 2.6;
      ctx.globalAlpha = (1 - ph) * 0.85;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = paint.core;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 外膜描边
  blobPath(ctx, cx, cy, r, r * 0.94, b.id * 0.9 + time * 0.25, 0.035, 12);
  ctx.strokeStyle = 'rgba(210, 245, 250, 0.45)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.restore();

  // 溢出时的外溢水珠：贴着壳往下滑
  if (overflow > 0 && ratio >= 1) {
    for (let i = 0; i < 2; i++) {
      const ph = (time * 0.5 + i * 0.5) % 1;
      const dx = cx + (i === 0 ? -1 : 1) * r * 0.66;
      const dy = cy - r * 0.28 + ph * r * 1.35;
      ctx.globalAlpha = (1 - ph) * 0.8;
      ctx.beginPath();
      ctx.ellipse(dx, dy, 2.2, 3.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = paint.core;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }


  // 顶部高光（胶质反光）
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.32, cy - r * 0.52, r * 0.24, r * 0.14, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // 眼睛
  const eyeY = cy - r * 0.16;
  const eyeDx = r * 0.34;
  const eyeR = r * 0.25;
  const lookDx = Math.max(-1, Math.min(1, (look.x - cx) / 280));
  const lookDy = Math.max(-1, Math.min(1, (look.y - eyeY) / 280));
  const dormant = b.faction === 0;

  for (const sign of [-1, 1]) {
    const ex = cx + sign * eyeDx;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#F6FEFF';
    ctx.fill();

    if (dormant) {
      ctx.beginPath();
      ctx.ellipse(ex, eyeY - eyeR * 0.15, eyeR * 1.02, eyeR * 0.62, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 30, 40, 0.85)';
      ctx.fill();
    } else {
      const px = ex + lookDx * eyeR * 0.4;
      const py = eyeY + lookDy * eyeR * 0.4;
      ctx.beginPath();
      ctx.arc(px, py, eyeR * 0.56, 0, Math.PI * 2);
      ctx.fillStyle = '#04141d';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px - eyeR * 0.16, py - eyeR * 0.2, eyeR * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fill();
    }

    // 眉毛：敌意 / 平静
    if (!dormant) {
      ctx.beginPath();
      const by = eyeY - eyeR * 1.35;
      const dir = b.faction === 2 ? 1 : -1;
      ctx.moveTo(ex - eyeR * 1.05, by + dir * 2);
      ctx.lineTo(ex + eyeR * 1.05, by - dir * 2);
      ctx.strokeStyle = paint.deep;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  // 触角（发光诱饵）；Lab 的头顶让给玻璃罩
  if (b.type !== 'house' && b.type !== 'lab') {
    for (const s of [-1, 1]) {
      const bx = cx + s * r * 0.34;
      const by = cy - r * 0.92;
      const tx = bx + s * 8 + Math.sin(time * 1.6 + s + b.id) * 5;
      const ty = by - r * 0.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + s * 12, by - r * 0.32, tx, ty);
      ctx.strokeStyle = paint.mid;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
      glow(ctx, tx, ty, 7, paint.glow, 0.85);
      ctx.beginPath();
      ctx.arc(tx, ty, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    }
  }

  // 嘴：小弧线，给一点情绪
  if (!dormant) {
    const my = cy + r * 0.42;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.16, my);
    ctx.quadraticCurveTo(cx, my + (b.faction === 2 ? 5 : 3.5), cx + r * 0.16, my);
    ctx.strokeStyle = 'rgba(4, 20, 28, 0.75)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Lab：头顶玻璃罩（三颗药泡 / 炼制 / 就绪）
  if (b.type === 'lab') drawLabDome(ctx, b, cx, cy, r, time);

  // 受击闪白
  if (b.hitFlash > 0.02) {
    ctx.save();
    ctx.globalAlpha = b.hitFlash * 0.45;
    ctx.globalCompositeOperation = 'lighter';
    blobPath(ctx, cx, cy, r, r * 0.94, b.id * 0.9 + time * 0.25, 0.035, 12);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }
}

/** 礁盘下方的读数牌：把"数字"从脸上请下来，变成一眼可扫的战术信息。 */
export function drawGarrison(
  ctx: CanvasRenderingContext2D,
  b: Building,
  selected: boolean,
): void {
  const value = Math.floor(b.garrison);
  const text = String(value);
  const paint = PAINT[b.faction];
  const over = b.garrison > b.capacity + 0.001;
  const w = 26 + text.length * 9;
  const h = 19;
  const x = b.x - w / 2;
  const y = b.y + 37;

  ctx.save();
  if (selected) {
    ctx.globalAlpha = 0.5;
    glow(ctx, b.x, y + h / 2, w, paint.glow, 0.5);
    ctx.globalAlpha = 1;
  }
  roundRect(ctx, x, y, w, h, 9);
  ctx.fillStyle = 'rgba(3, 14, 21, 0.78)';
  ctx.fill();
  ctx.strokeStyle = over ? 'rgba(255, 214, 107, 0.9)' : b.faction === 0 ? 'rgba(150, 176, 190, 0.35)' : paint.dim;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '800 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (b.faction === 0) {
    ctx.fillStyle = 'rgba(226, 240, 246, 0.8)';
  } else if (value === 0) {
    ctx.fillStyle = 'rgba(140, 165, 175, 0.6)';
  } else if (over) {
    ctx.fillStyle = GOLD;
  } else {
    ctx.fillStyle = '#FFFFFF';
  }
  // 捕获瞬间：数字不变（保留驻军），用短暂放大提示“已经易主”
  if (b.captureFlash > 0.02) {
    const zoom = 1 + b.captureFlash * 0.35;
    ctx.save();
    ctx.translate(b.x, y + h / 2 + 0.5);
    ctx.scale(zoom, zoom);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(text, b.x, y + h / 2 + 0.5);
  }
  ctx.restore();

  // 状态小挂件：图标 + 极小数字，贴在读数牌侧面
  const pills: Array<{
    kind: 'freeze' | 'infect';
    label: string;
    border: string;
    text: string;
  }> = [];
  if (b.frozen > 0) {
    pills.push({
      kind: 'freeze',
      label: `${Math.ceil(b.frozen)}`,
      border: 'rgba(150, 230, 255, 0.9)',
      text: '#DFF8FF',
    });
  }
  if (b.infectT > 0) {
    pills.push({
      kind: 'infect',
      label: `${Math.ceil(b.infectT)}s`,
      border: 'rgba(140, 255, 122, 0.9)',
      text: '#E4FFD6',
    });
  }
  if (pills.length === 0) return;

  ctx.font = font(700, 9);
  const widths = pills.map((p) => Math.max(28, 13 + ctx.measureText(p.label).width + 6));
  const maxW = Math.max(...widths);
  let px = x + w + 5;
  if (px + maxW > WORLD_W - 16) px = x - maxW - 5;
  pills.forEach((p, i) => {
    const pw = widths[i];
    const py = y + i * 16;
    ctx.save();
    roundRect(ctx, px, py, pw, 14, 7);
    ctx.fillStyle = 'rgba(3, 14, 21, 0.9)';
    ctx.fill();
    ctx.strokeStyle = p.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    drawSpellIcon(ctx, px + 6, py + 7, 4.2, p.kind, p.text);
    ctx.font = font(700, 9);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.text;
    ctx.fillText(p.label, px + 12, py + 7.5);
    ctx.restore();
  });
}

/**
 * 升级按钮（参考原作）：头顶一个圆形按钮 + 左上角金色数值徽章。
 * 只有鼠标悬停在该塔上时才绘制/可点，避免满屏按钮。
 */
export interface UpgradeButton {
  cx: number;
  cy: number;
  r: number;
  badge: { x: number; y: number; r: number };
  rect: { x: number; y: number; w: number; h: number };
}

export function upgradeButton(b: Building, cost: number, time: number): UpgradeButton {
  const { cx, cy, r } = bodyCenter(b);
  const bob = Math.sin(time * 2.6 + b.id) * 2;
  const bx = cx;
  const by = cy - r * 1.35 - 34 + bob;
  const br = 19;
  const badge = { x: bx - br * 0.86, y: by - br * 0.78, r: 12 };
  const pad = 6;
  const left = Math.min(bx - br, badge.x - badge.r) - pad;
  const top = Math.min(by - br, badge.y - badge.r) - pad;
  const right = Math.max(bx + br, badge.x + badge.r) + pad;
  const bottom = Math.max(by + br, badge.y + badge.r) + pad;
  void cost;
  return {
    cx: bx,
    cy: by,
    r: br,
    badge,
    rect: { x: left, y: top, w: right - left, h: bottom - top },
  };
}

export function drawUpgradeButton(
  ctx: CanvasRenderingContext2D,
  b: Building,
  cost: number,
  affordable: boolean,
  time: number,
): void {
  const btn = upgradeButton(b, cost, time);
  const paint = PAINT[1];

  ctx.save();

  // 圆底
  ctx.beginPath();
  ctx.arc(btn.cx, btn.cy, btn.r, 0, Math.PI * 2);
  ctx.fillStyle = affordable ? 'rgba(9, 40, 48, 0.94)' : 'rgba(8, 22, 28, 0.85)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = affordable ? paint.core : 'rgba(120, 150, 160, 0.45)';
  ctx.stroke();
  if (affordable) {
    ctx.globalAlpha = 0.45 + Math.sin(time * 3) * 0.12;
    glow(ctx, btn.cx, btn.cy, 34, paint.glow, 0.5);
    ctx.globalAlpha = 1;
  }

  // 向上箭头
  const s = btn.r * 0.52;
  ctx.beginPath();
  ctx.moveTo(btn.cx, btn.cy - s * 0.95);
  ctx.lineTo(btn.cx + s * 0.82, btn.cy - s * 0.05);
  ctx.lineTo(btn.cx + s * 0.34, btn.cy - s * 0.05);
  ctx.lineTo(btn.cx + s * 0.34, btn.cy + s * 0.92);
  ctx.lineTo(btn.cx - s * 0.34, btn.cy + s * 0.92);
  ctx.lineTo(btn.cx - s * 0.34, btn.cy - s * 0.05);
  ctx.lineTo(btn.cx - s * 0.82, btn.cy - s * 0.05);
  ctx.closePath();
  ctx.fillStyle = affordable ? '#EAFEFF' : 'rgba(170, 190, 198, 0.7)';
  ctx.fill();

  // 成本徽章
  ctx.beginPath();
  ctx.arc(btn.badge.x, btn.badge.y, btn.badge.r, 0, Math.PI * 2);
  ctx.fillStyle = affordable ? '#FFD66B' : 'rgba(120, 110, 70, 0.85)';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(40, 30, 8, 0.55)';
  ctx.stroke();

  ctx.font = '800 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = affordable ? '#2A1C00' : 'rgba(30, 24, 10, 0.85)';
  ctx.fillText(String(cost), btn.badge.x, btn.badge.y + 0.5);

  ctx.restore();
}

interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectOverlap(a: PanelRect, b: PanelRect): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

/**
 * 悬浮面板（转化按钮 / 法术槽）的避让摆放：
 * 依次尝试 下 / 上 / 右 / 左，对"压到别的建筑"和"贴边"扣分，取最干净的位置。
 * 地图越来越密，固定放下方会盖住邻塔的读数牌。
 */
function placePanel(
  b: Building,
  w: number,
  h: number,
  buildings?: Building[],
): PanelRect {
  const candidates: Array<{ x: number; y: number; pref: number }> = [
    { x: b.x - w / 2, y: b.y + 64, pref: 0 },
    { x: b.x - w / 2, y: b.y - 64 - h, pref: 1 },
    { x: b.x + 66, y: b.y - h / 2, pref: 2 },
    { x: b.x - 66 - w, y: b.y - h / 2, pref: 3 },
  ];

  let best: PanelRect = { x: 16, y: 70, w, h };
  let bestScore = Infinity;
  for (const c of candidates) {
    const r: PanelRect = {
      x: Math.max(16, Math.min(WORLD_W - 16 - w, c.x)),
      y: Math.max(70, Math.min(WORLD_H - 46 - h, c.y)),
      w,
      h,
    };
    let score = c.pref * 8;
    for (const o of buildings ?? []) {
      if (o.id === b.id) continue;
      const or = bodyRadius(o);
      const box: PanelRect = {
        x: o.x - or - 12,
        y: o.y - 6 - or - 28,
        w: or * 2 + 24,
        h: or * 2 + 72,
      };
      score += rectOverlap(r, box);
    }
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

/** 空屋转化：三颗悬浮按钮，跟着建筑走，带目标形态的图标。 */
export function convertChipRects(
  b: Building,
  buildings?: Building[],
): Array<{
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'barracks' | 'fort' | 'lab';
}> {
  const w = 96;
  const h = 36;
  const gap = 8;
  const total = w * 3 + gap * 2;
  const r = placePanel(b, total, h, buildings);
  return [
    { x: r.x, y: r.y, w, h, type: 'barracks' },
    { x: r.x + w + gap, y: r.y, w, h, type: 'fort' },
    { x: r.x + (w + gap) * 2, y: r.y, w, h, type: 'lab' },
  ];
}

function iconBarracks(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  // 身体
  ctx.beginPath();
  ctx.ellipse(0, s * 0.16, s * 0.36, s * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // 触角
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(dir * s * 0.16, -s * 0.1);
    ctx.quadraticCurveTo(dir * s * 0.3, -s * 0.42, dir * s * 0.12, -s * 0.52);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(dir * s * 0.12, -s * 0.52, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  // 眼睛
  ctx.fillStyle = 'rgba(3, 16, 22, 0.85)';
  ctx.beginPath();
  ctx.arc(-s * 0.12, s * 0.12, s * 0.06, 0, Math.PI * 2);
  ctx.arc(s * 0.12, s * 0.12, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function iconFort(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  // 棘刺
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * s * 0.26, Math.sin(a) * s * 0.26);
    ctx.lineTo(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5);
    ctx.stroke();
  }
  // 甲壳
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(3, 16, 22, 0.85)';
  ctx.beginPath();
  ctx.arc(-s * 0.09, -s * 0.02, s * 0.05, 0, Math.PI * 2);
  ctx.arc(s * 0.09, -s * 0.02, s * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function iconLab(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  // 瓶颈
  ctx.beginPath();
  ctx.moveTo(-s * 0.09, -s * 0.46);
  ctx.lineTo(-s * 0.09, -s * 0.24);
  ctx.moveTo(s * 0.09, -s * 0.46);
  ctx.lineTo(s * 0.09, -s * 0.24);
  ctx.stroke();
  // 瓶塞
  ctx.beginPath();
  ctx.arc(0, -s * 0.48, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // 瓶身
  ctx.beginPath();
  ctx.arc(0, s * 0.1, s * 0.3, 0, Math.PI * 2);
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  // 气泡
  ctx.fillStyle = 'rgba(3, 16, 22, 0.75)';
  ctx.beginPath();
  ctx.arc(-s * 0.08, s * 0.04, s * 0.055, 0, Math.PI * 2);
  ctx.arc(s * 0.08, s * 0.16, s * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawConvertChips(
  ctx: CanvasRenderingContext2D,
  b: Building,
  affordable: { barracks: boolean; fort: boolean; lab: boolean },
  time: number,
  buildings?: Building[],
): void {
  const paint = PAINT[b.faction === 0 ? 1 : b.faction];
  const chips = convertChipRects(b, buildings);
  const labels = ['孕育巢', '棘堡', '实验室'];
  const costs = ['5', '10', '10'];
  const keys = ['barracks', 'fort', 'lab'] as const;

  // 与建筑之间的小连线，表明"这些按钮属于它"
  ctx.save();
  ctx.strokeStyle = 'rgba(140, 220, 226, 0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  const anchorY = chips[0].y < b.y ? chips[0].y + chips[0].h : chips[0].y;
  const panelCx = chips[0].x + (chips[2].x + chips[2].w - chips[0].x) / 2;
  ctx.moveTo(b.x, b.y + 30);
  ctx.lineTo(panelCx, anchorY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  chips.forEach((c, i) => {
    const on = affordable[keys[i]];
    const bob = Math.sin(time * 2.4 + i * 1.4) * 1.5;
    const y = c.y + bob;

    ctx.save();
    roundRect(ctx, c.x, y, c.w, c.h, 10);
    ctx.fillStyle = on ? 'rgba(8, 44, 52, 0.95)' : 'rgba(6, 20, 26, 0.82)';
    ctx.fill();
    ctx.strokeStyle = on
      ? i === 2
        ? 'rgba(199, 155, 255, 0.95)'
        : paint.core
      : 'rgba(110, 150, 160, 0.35)';
    ctx.lineWidth = on ? 1.6 : 1;
    ctx.stroke();

    if (on) {
      ctx.globalAlpha = 0.35 + Math.sin(time * 3 + i) * 0.12;
      glow(ctx, c.x + c.w / 2, y + c.h / 2, 52, i === 2 ? 'rgba(199, 155, 255, 0.55)' : paint.glow, 0.5);
      ctx.globalAlpha = 1;
    }

    const iconColor = on ? (i === 2 ? '#E7D2FF' : paint.core) : 'rgba(140, 170, 180, 0.6)';
    if (i === 0) iconBarracks(ctx, c.x + 20, y + c.h / 2, 26, iconColor);
    else if (i === 1) iconFort(ctx, c.x + 20, y + c.h / 2, 24, iconColor);
    else iconLab(ctx, c.x + 20, y + c.h / 2, 26, iconColor);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '700 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = on ? '#EAFEFF' : 'rgba(150, 175, 185, 0.6)';
    ctx.fillText(labels[i], c.x + 38, y + c.h / 2 - 6);

    ctx.font = '600 11px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = on ? GOLD : 'rgba(140, 165, 175, 0.55)';
    ctx.fillText(`${costs[i]} 只`, c.x + 38, y + c.h / 2 + 9);
    ctx.restore();
  });
}

/** 正在出兵的建筑：一圈流动的弧。 */
export function drawSendingRing(
  ctx: CanvasRenderingContext2D,
  b: Building,
  time: number,
): void {
  const paint = PAINT[b.faction];
  const { cy, r } = bodyCenter(b);
  ctx.save();
  ctx.translate(b.x, cy);
  ctx.scale(1, 0.9);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.35, time * 6, time * 6 + Math.PI * 1.1);
  ctx.strokeStyle = paint.core;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.35, time * 6 + Math.PI, time * 6 + Math.PI * 1.6);
  ctx.globalAlpha = 0.28;
  ctx.stroke();
  ctx.restore();
}

export function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  b: Building,
  time: number,
): void {
  const paint = PAINT[b.faction];
  const r = (b.type === 'house' ? 32 : 40) + b.level * 1.6;
  const cy = b.y + 4;
  ctx.save();
  ctx.translate(b.x, cy);
  ctx.scale(1, 0.52);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.setLineDash([8, 8]);
  ctx.lineDashOffset = -time * 30;
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = paint.core;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.restore();
}

export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 框选矩形：保留 Windows 橡胶带的结构（半透明填充 + 双线 + 四角），
 * 但换成深海语言：青色流动虚线、四角生物荧光点、顶边巡游光点。
 */
export function drawMarquee(
  ctx: CanvasRenderingContext2D,
  rect: MarqueeRect,
  time: number,
): void {
  const x = Math.min(rect.x, rect.x + rect.w);
  const y = Math.min(rect.y, rect.y + rect.h);
  const w = Math.abs(rect.w);
  const h = Math.abs(rect.h);
  if (w < 2 || h < 2) return;

  ctx.save();

  // 水光填充
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, 'rgba(96, 248, 255, 0.12)');
  fill.addColorStop(0.5, 'rgba(48, 190, 220, 0.05)');
  fill.addColorStop(1, 'rgba(96, 248, 255, 0.1)');
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);

  // 内侧线：Windows 那种“双线感”，但压到很淡
  if (w > 10 && h > 10) {
    ctx.strokeStyle = 'rgba(184, 254, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
  }

  // 外框：流动虚线
  ctx.beginPath();
  ctx.rect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  ctx.setLineDash([7, 6]);
  ctx.lineDashOffset = -time * 42;
  ctx.strokeStyle = 'rgba(120, 250, 255, 0.92)';
  ctx.lineWidth = 1.35;
  ctx.shadowColor = 'rgba(60, 240, 235, 0.9)';
  ctx.shadowBlur = 9;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  // 四角括号
  const len = Math.min(16, w * 0.35, h * 0.35);
  const corners: Array<[number, number, number, number]> = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ];
  ctx.strokeStyle = 'rgba(214, 255, 255, 0.95)';
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * len, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * len);
    ctx.stroke();
  }

  // 四角光点
  for (const [cx, cy] of corners) {
    glow(ctx, cx, cy, 11, 'rgba(150, 252, 255, 0.95)', 0.8);
    ctx.beginPath();
    ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = '#EAFEFF';
    ctx.fill();
  }

  // 顶边巡游的一颗光点：像在“扫描”框里的生物
  const sweep = x + ((time * 70) % Math.max(1, w));
  glow(ctx, sweep, y, 10, 'rgba(120, 250, 255, 0.9)', 0.35);
  ctx.beginPath();
  ctx.arc(sweep, y, 1.1, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(234, 255, 255, 0.9)';
  ctx.fill();

  ctx.restore();
}

export function drawRangeRing(
  ctx: CanvasRenderingContext2D,
  b: Building,
  time: number,
): void {
  if (b.type !== 'fort') return;
  const paint = PAINT[b.faction === 0 ? 0 : b.faction];
  ctx.save();
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.range, 0, Math.PI * 2);
  ctx.setLineDash([4, 10]);
  ctx.lineDashOffset = time * 14;
  ctx.strokeStyle = paint.mid;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 选中后跟随鼠标的直线瞄准线（不再吸附、不再弯）。 */
export function drawAimLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  time: number,
  alpha = 0.55,
  width = 1.4,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 虚线主线
  ctx.beginPath();
  ctx.moveTo(x1 + nx * 18, y1 + ny * 18);
  ctx.lineTo(x2, y2);
  ctx.setLineDash([4, 10]);
  ctx.lineDashOffset = -time * 70;
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.stroke();

  // 末端亮一下，像准星
  ctx.setLineDash([]);
  ctx.globalAlpha = alpha * 1.4;
  ctx.beginPath();
  ctx.arc(x2, y2, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = alpha * 0.5;
  ctx.beginPath();
  ctx.arc(x2, y2, 8, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

export function drawBeam(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  time: number,
): void {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 40;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, my, x2, y2);
  ctx.setLineDash([3, 9]);
  ctx.lineDashOffset = -time * 60;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.6;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.restore();
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color = GOLD,
  size = 12,
  align: CanvasTextAlign = 'center',
): void {
  ctx.save();
  ctx.font = `600 ${size}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(2, 10, 16, 0.8)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function factionInk(f: Faction): string {
  return PAINT[f].core;
}

// ---------------------------------------------------------------------------
// Lab：法术槽 / 目标环 / 法术图标
// ---------------------------------------------------------------------------

export interface SpellSlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
  spell: SpellId;
}

export interface SpellSlotView {
  spell: SpellId;
  unlocked: boolean;
  affordable: boolean;
  /** 已经炼成、等待释放 */
  ready: boolean;
  /** 正在炼制这个法术 */
  active: boolean;
  /** 炼制进度 0..1 */
  progress: number;
  cost: number;
}

/** 法术槽：选中 Lab 时浮在建筑附近，靠边/压到邻塔时自动换位。 */
export function spellSlotRects(b: Building, buildings?: Building[]): SpellSlotRect[] {
  const { w, h, gap } = SPELL_SLOT;
  const total = w * 3 + gap * 2;
  const r = placePanel(b, total, h, buildings);
  return SPELL_ORDER.map((spell, i) => ({
    x: r.x + i * (w + gap),
    y: r.y,
    w,
    h,
    spell,
  }));
}

/** 三种法术的小图标：雪花 / 病毒 / 漩涡。 */
export function drawSpellIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  spell: SpellId,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';

  if (spell === 'freeze') {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(a) * s, -Math.sin(a) * s);
      ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      ctx.stroke();
      // 分叉
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * s * sign * 0.55, Math.sin(a) * s * sign * 0.55);
        ctx.lineTo(
          Math.cos(a) * s * sign * 0.55 + Math.cos(a + 0.9) * s * 0.32,
          Math.sin(a) * s * sign * 0.55 + Math.sin(a + 0.9) * s * 0.32,
        );
        ctx.stroke();
      }
    }
  } else if (spell === 'infect') {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55);
      ctx.lineTo(Math.cos(a) * s * 0.92, Math.sin(a) * s * 0.92);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(Math.cos(a) * s * 0.98, Math.sin(a) * s * 0.98, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(3, 20, 8, 0.8)';
    ctx.beginPath();
    ctx.arc(-s * 0.16, -s * 0.1, s * 0.07, 0, Math.PI * 2);
    ctx.arc(s * 0.16, s * 0.12, s * 0.06, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 漩涡：三段渐收的弧
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, s * (0.26 + i * 0.24), i * 1.7, i * 1.7 + 2.1);
      ctx.lineWidth = 2.1 - i * 0.45;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawSpellSlots(
  ctx: CanvasRenderingContext2D,
  b: Building,
  slots: SpellSlotView[],
  time: number,
  buildings?: Building[],
): void {
  const rects = spellSlotRects(b, buildings);
  // 与建筑之间的小连线
  ctx.save();
  ctx.strokeStyle = 'rgba(180, 210, 226, 0.32)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  const anchorY = rects[0].y < b.y ? rects[0].y + rects[0].h : rects[0].y;
  const panelCx = rects[0].x + (rects[2].x + rects[2].w - rects[0].x) / 2;
  ctx.moveTo(b.x, b.y + 30);
  ctx.lineTo(panelCx, anchorY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const anyActive = slots.some((s) => s.active);

  rects.forEach((r, i) => {
    const v = slots[i];
    if (!v) return;
    const c = SPELL_COLOR[v.spell];
    const bob = Math.sin(time * 2.2 + i * 1.3) * 1.2;
    const y = r.y + bob;
    const on = v.unlocked && v.affordable;
    const dim = anyActive && !v.active;

    ctx.save();
    roundRect(ctx, r.x, y, r.w, r.h, RADIUS.md);
    ctx.fillStyle = v.ready ? 'rgba(18, 26, 40, 0.96)' : 'rgba(5, 18, 26, 0.92)';
    ctx.fill();
    ctx.strokeStyle = v.ready ? c.core : on ? c.mid : 'rgba(110, 145, 156, 0.32)';
    ctx.lineWidth = v.ready ? 2 : on ? 1.4 : 1;
    ctx.stroke();

    if (v.ready) {
      ctx.globalAlpha = 0.4 + Math.sin(time * 3.4) * 0.16;
      glow(ctx, r.x + r.w / 2, y + r.h / 2, 50, c.glow, 0.85);
      ctx.globalAlpha = 1;
    }

    // 图标
    drawSpellIcon(
      ctx,
      r.x + r.w / 2,
      y + 18,
      12,
      v.spell,
      v.unlocked ? (on ? c.core : c.mid) : 'rgba(130, 158, 168, 0.5)',
    );

    // 名称
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(700, FONT_SIZE.xs);
    ctx.fillStyle = v.unlocked ? '#DDF4FA' : 'rgba(140, 165, 175, 0.5)';
    ctx.fillText(SPELLS[v.spell].name, r.x + r.w / 2, y + 35);

    // 名称下方：炼制中写百分比；就绪只发光不写字；其余写成本/等级
    let status = '';
    let statusColor = 'rgba(140, 165, 175, 0.5)';
    if (v.active) {
      status = `炼制 ${Math.round(Math.min(1, v.progress) * 100)}%`;
      statusColor = c.core;
    } else if (!v.ready) {
      if (v.unlocked) {
        status = `${v.cost}`;
        statusColor = on ? GOLD : 'rgba(200, 170, 100, 0.7)';
      } else {
        status = `Lv.${SPELLS[v.spell].unlockLevel + 1}`;
      }
    }
    if (status) {
      ctx.font = font(700, FONT_SIZE.xs);
      ctx.fillStyle = statusColor;
      ctx.fillText(status, r.x + r.w / 2, y + 50);
    }

    // 锁定：暗罩 + 小锁
    if (!v.unlocked) {
      ctx.fillStyle = 'rgba(2, 10, 16, 0.45)';
      roundRect(ctx, r.x, y, r.w, r.h, RADIUS.md);
      ctx.fill();
      const lx = r.x + r.w - 12;
      const ly = y + 11;
      ctx.strokeStyle = 'rgba(200, 220, 228, 0.65)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(lx, ly - 2, 3.2, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = 'rgba(200, 220, 228, 0.65)';
      roundRect(ctx, lx - 4.5, ly - 2, 9, 7, 2);
      ctx.fill();
    }

    // 炼制中：其他槽变暗，但保留名称/等级
    if (dim) {
      ctx.fillStyle = 'rgba(2, 10, 16, 0.42)';
      roundRect(ctx, r.x, y, r.w, r.h, RADIUS.md);
      ctx.fill();
    }
    ctx.restore();
  });
}

/** 合法目标的脉冲环：就绪 Lab 单选时，把"可以点谁"标出来。 */
export function drawTargetRing(
  ctx: CanvasRenderingContext2D,
  b: Building,
  spell: SpellId,
  time: number,
): void {
  const c = SPELL_COLOR[spell];
  const r = (b.type === 'house' ? 40 : 50) + b.level * 1.6;
  ctx.save();
  ctx.translate(b.x, b.y + 2);
  ctx.scale(1, 0.5);
  ctx.beginPath();
  ctx.arc(0, 0, r + Math.sin(time * 4) * 2, 0, Math.PI * 2);
  ctx.setLineDash([6, 8]);
  ctx.lineDashOffset = -time * 70;
  ctx.strokeStyle = c.core;
  ctx.globalAlpha = 0.55 + Math.sin(time * 5) * 0.2;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

export { INK };
