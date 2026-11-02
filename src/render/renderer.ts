import { BREW_TIME, BUILDINGS, CONVERT_COST, MATCH_TIME, SPELLS, SPELL_ORDER } from '../sim/config.ts';
import { LEVELS } from '../sim/level.ts';
import { factionPower, isValidSpellTarget, packetPos, spellPos } from '../sim/world.ts';
import type { Building, SimEvent, World } from '../sim/types.ts';
import { Backdrop } from './background.ts';
import { Particles } from './particles.ts';
import {
  bodyCenter,
  bodyRadius,
  drawAimLine,
  drawConvertChips,
  drawCreature,
  drawGarrison,
  drawLabel,
  drawMarquee,
  drawPlatform,
  drawRangeRing,
  drawSelectionRing,
  drawSpellIcon,
  drawSpellSlots,
  drawTargetRing,
  drawUpgradeButton,
  glow,
  roundRect,
  type MarqueeRect,
  type SpellSlotView,
} from './draw.ts';
import { GOLD, PAINT, SPELL_COLOR } from './palette.ts';
import {
  CARD,
  FONT_SIZE,
  RADIUS,
  SPACE,
  font,
  helpHintRect,
} from './ui.ts';

export interface ViewState {
  selected: number[];
  hovered: number | null;
  pointer: { x: number; y: number };
  time: number;
  /** 正在等待"单击/双击"判定的目标；用于画一个待确认的环 */
  pendingTarget: number | null;
  /** 正在拖拽的框选矩形（世界坐标）；null = 没有在框选 */
  marquee: MarqueeRect | null;
}

interface ShotLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  faction: 1 | 2;
}

const TYPE_NAME: Record<string, string> = {
  house: '空屋',
  barracks: '孕育巢',
  fort: '棘堡',
  lab: '实验室',
};

interface CardRow {
  label: string;
  value: string;
  color?: string;
}

interface CardStatus {
  kind: 'freeze' | 'infect';
  label: string;
}

/** 按类型给 3 行关键属性；数值右对齐，空位不再留白。 */
function cardRows(b: Building): CardRow[] {
  const over = Math.max(0, Math.floor(b.garrison) - b.capacity);
  const garrison = `${Math.floor(b.garrison)} / ${b.capacity}` + (over > 0 ? ` +${over}` : '');
  const garrisonRow: CardRow = {
    label: '驻军',
    value: garrison,
    color: over > 0 ? GOLD : undefined,
  };

  if (b.type === 'barracks') {
    return [
      garrisonRow,
      { label: '产能', value: `${b.production.toFixed(2)}/s` },
      {
        label: '满仓',
        value: b.production > 0 ? `${(b.capacity / b.production).toFixed(1)}s` : '—',
      },
    ];
  }
  if (b.type === 'fort') {
    return [
      garrisonRow,
      { label: '防御', value: `×${b.defense}` },
      {
        label: '射程·单发',
        value: `${Math.round(b.range)} · ${b.damage.toFixed(1)}`,
      },
    ];
  }
  if (b.type === 'house') {
    return [
      garrisonRow,
      { label: '产能', value: `${b.production.toFixed(2)}/s` },
      {
        label: '转化',
        value: `${CONVERT_COST.barracks} / ${CONVERT_COST.fort} / ${CONVERT_COST.lab}`,
      },
    ];
  }

  const spells =
    SPELL_ORDER.filter((id) => b.level >= SPELLS[id].unlockLevel)
      .map((id) => SPELLS[id].name)
      .join('·') || '未解锁';
  const state = b.brew
    ? `炼制 ${Math.round((b.brewT / BREW_TIME) * 100)}%`
    : b.potion
      ? `药水 ${SPELLS[b.potion].name}`
      : '空闲';
  return [
    garrisonRow,
    { label: '法术', value: spells },
    {
      label: '状态',
      value: state,
      color: b.brew
        ? SPELL_COLOR[b.brew].core
        : b.potion
          ? SPELL_COLOR[b.potion].core
          : undefined,
    },
  ];
}

function cardStatuses(b: Building): CardStatus[] {
  const out: CardStatus[] = [];
  if (b.frozen > 0) out.push({ kind: 'freeze', label: `${Math.ceil(b.frozen)}` });
  if (b.infectT > 0) out.push({ kind: 'infect', label: `${Math.ceil(b.infectT)}s` });
  return out;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private backdrop = new Backdrop();
  private particles = new Particles();
  private trails = new Map<number, Array<{ x: number; y: number }>>();
  private selectedCount = 0;
  private shots: ShotLine[] = [];
  private scale = 1;
  private dpr = 1;
  private cardTarget: number | null = null;
  private cardAt = 0;
  private cardRect: { x: number; y: number; w: number; h: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private logicalW: number,
    private logicalH: number,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.scale = cssW / this.logicalW;
    void cssH;
  }

  /** 调试/验收用：最近一次悬停卡的实际矩形。 */
  cardBounds(): { x: number; y: number; w: number; h: number } | null {
    return this.cardRect ? { ...this.cardRect } : null;
  }

  /** 屏幕坐标 → 世界坐标 */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * this.logicalW,
      y: ((clientY - r.top) / r.height) * this.logicalH,
    };
  }

  private begin(): void {
    const k = this.scale * this.dpr;
    this.ctx.setTransform(k, 0, 0, k, 0, 0);
    this.ctx.clearRect(0, 0, this.logicalW, this.logicalH);
  }

  consume(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'hit') {
        this.particles.burst(e.x, e.y, PAINT[e.faction].core, 7, 110);
      } else if (e.type === 'capture') {
        this.particles.ring(e.x, e.y, PAINT[e.faction].core, 10, 240, 0.55, 3);
        this.particles.burst(e.x, e.y, PAINT[e.faction].core, 22, 200);
      } else if (e.type === 'upgrade') {
        this.particles.sparkle(e.x, e.y - 20, GOLD);
        this.particles.ring(e.x, e.y, GOLD, 12, 120, 0.5, 2);
      } else if (e.type === 'convert') {
        this.particles.sparkle(e.x, e.y - 16, PAINT[e.faction].core);
        this.particles.ring(e.x, e.y, PAINT[e.faction].core, 8, 150, 0.45, 2);
      } else if (e.type === 'shot' && e.x2 !== undefined && e.y2 !== undefined) {
        this.shots.push({
          x1: e.x,
          y1: e.y,
          x2: e.x2,
          y2: e.y2,
          life: 0.16,
          max: 0.16,
          faction: e.faction === 0 ? 1 : (e.faction as 1 | 2),
        });
      } else if (e.type === 'wither') {
        this.particles.burst(e.x, e.y, PAINT[e.faction].mid, 5, 60);
      } else if (e.type === 'freeze') {
        const c = SPELL_COLOR.freeze;
        this.particles.ring(e.x, e.y, c.core, 14, 210, 0.6, 3);
        this.particles.burst(e.x, e.y, c.core, 20, 140);
      } else if (e.type === 'thaw') {
        this.particles.ring(e.x, e.y, SPELL_COLOR.freeze.core, 10, 180, 0.5, 2);
        this.particles.burst(e.x, e.y, '#FFFFFF', 14, 120);
      } else if (e.type === 'infect') {
        const c = SPELL_COLOR.infect;
        this.particles.ring(e.x, e.y, c.core, 12, 190, 0.55, 2.4);
        this.particles.burst(e.x, e.y, c.mid, 18, 110);
      } else if (e.type === 'cure') {
        this.particles.burst(e.x, e.y, 'rgba(140,255,122,0.8)', 8, 70);
      } else if (e.type === 'brew') {
        this.particles.sparkle(e.x, e.y - 24, SPELL_COLOR[e.spell ?? 'freeze'].core);
      } else if (e.type === 'potion') {
        const c = SPELL_COLOR[e.spell ?? 'freeze'];
        this.particles.ring(e.x, e.y, c.core, 12, 160, 0.55, 2.4);
        this.particles.sparkle(e.x, e.y - 20, c.core);
      } else if (e.type === 'interrupt') {
        this.particles.burst(e.x, e.y, 'rgba(180, 200, 210, 0.7)', 10, 90);
      } else if (e.type === 'cast') {
        const c = SPELL_COLOR[e.spell ?? 'freeze'];
        this.particles.ring(e.x, e.y, c.mid, 12, 140, 0.4, 2);
      } else if (e.type === 'spellhit') {
        const c = SPELL_COLOR[e.spell ?? 'freeze'];
        this.particles.ring(e.x, e.y, c.core, 16, 230, 0.55, 3);
        this.particles.burst(e.x, e.y, c.mid, 24, 170);
      }
    }
  }

  frame(world: World, view: ViewState, dt: number, alpha: number): void {
    this.begin();
    const ctx = this.ctx;
    const t = view.time;
    this.selectedCount = view.selected.length;

    this.backdrop.draw(ctx, t);

    this.drawFilaments(ctx, world, t);
    this.drawRanges(ctx, world, view, t);
    this.drawAimLines(ctx, world, view, t);

    // 平台 + 生物
    for (const b of world.buildings) drawPlatform(ctx, b, t);
    for (const b of world.buildings) {
      drawCreature(ctx, b, t, view.pointer);
    }
    for (const b of world.buildings) {
      drawAdditional(ctx, b, t);
    }

    this.drawPackets(ctx, world, alpha, t);
    this.drawSpellShots(ctx, world, alpha, t);

    for (const b of world.buildings) {
      drawGarrison(ctx, b, view.selected.includes(b.id));
    }

    // 就绪 Lab 单选：把合法的敌方/中立目标圈出来
    const readyLab = this.readyLab(world, view);
    if (readyLab?.potion) {
      for (const b of world.buildings) {
        if (isValidSpellTarget(b, readyLab.potion, 1)) {
          drawTargetRing(ctx, b, readyLab.potion, t);
        }
      }
    }

    if (view.hovered !== null) {
      const hb = world.buildings.find((b) => b.id === view.hovered);
      if (hb) this.drawHoverRing(ctx, hb, t);
    }

    if (view.pendingTarget !== null) {
      const pb = world.buildings.find((b) => b.id === view.pendingTarget);
      if (pb) this.drawPendingRing(ctx, pb, t);
    }

    // 升级按钮：只给鼠标悬停的那一个塔显示（足够克制，也符合原作）
    // 选中的 Lab 让位给法术槽，避免箭头与槽位重叠。
    const hoverB =
      view.hovered !== null
        ? world.buildings.find((b) => b.id === view.hovered) ?? null
        : null;
    const hoverIsSelectedLab =
      hoverB !== null &&
      view.selected.length === 1 &&
      view.selected[0] === hoverB.id &&
      hoverB.type === 'lab';
    if (hoverB && hoverB.faction === 1 && canUpgrade(hoverB) && !hoverIsSelectedLab) {
      drawUpgradeButton(ctx, hoverB, upgradeCost(hoverB), affordable(hoverB), t);
    }

    // 选中一个己方空屋 → 悬浮转化按钮（带目标形态图标）
    const selB =
      view.selected.length === 1 ? world.buildings.find((b) => b.id === view.selected[0]) : null;
    if (selB && selB.faction === 1 && selB.type === 'house') {
      drawConvertChips(
        ctx,
        selB,
        { barracks: selB.garrison >= 5, fort: selB.garrison >= 10, lab: selB.garrison >= 10 },
        t,
        world.buildings,
      );
    } else if (selB && selB.faction === 1 && selB.type === 'lab') {
      drawSpellSlots(ctx, selB, this.spellSlotViews(selB), t, world.buildings);
    }

    // 选中环（最后画，保证在最上层）
    for (const id of view.selected) {
      const b = world.buildings.find((x) => x.id === id);
      if (b) drawSelectionRing(ctx, b, t);
    }

    this.drawShots(ctx, dt);
    this.particles.update(dt);
    this.particles.draw(ctx);
    if (view.marquee) drawMarquee(ctx, view.marquee, t);

    this.drawHoverCard(ctx, world, view);
    this.drawHud(ctx, world);
    this.drawHelpHint(ctx, view);
  }

  /** 当前唯一选中、且已经炼成药水的己方 Lab。 */
  private readyLab(world: World, view: ViewState): Building | null {
    if (view.selected.length !== 1) return null;
    const b = world.buildings.find((x) => x.id === view.selected[0]);
    if (!b || b.faction !== 1 || b.type !== 'lab' || !b.potion) return null;
    return b;
  }

  private spellSlotViews(lab: Building): SpellSlotView[] {
    return SPELL_ORDER.map((spell) => {
      const def = SPELLS[spell];
      return {
        spell,
        unlocked: lab.level >= def.unlockLevel,
        affordable: lab.garrison >= def.cost,
        ready: lab.potion === spell,
        active: lab.brew === spell,
        progress: lab.brew === spell ? lab.brewT / BREW_TIME : 0,
        cost: def.cost,
      };
    });
  }

  /** 法术弹道：小光球 + 尾迹，颜色区分法术。 */
  private drawSpellShots(
    ctx: CanvasRenderingContext2D,
    w: World,
    alpha: number,
    t: number,
  ): void {
    for (const s of w.spells) {
      const pos = spellPos(s, alpha);
      const c = SPELL_COLOR[s.spell];
      const r = 7 + Math.sin(t * 8 + s.id) * 1.2;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = c.mid;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.px, s.py);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.restore();

      glow(ctx, pos.x, pos.y, r * 4, c.glow, 0.9);
      const g = ctx.createRadialGradient(pos.x - r * 0.3, pos.y - r * 0.3, 1, pos.x, pos.y, r);
      g.addColorStop(0, '#FFFFFF');
      g.addColorStop(0.45, c.core);
      g.addColorStop(1, c.deep);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      drawSpellIcon(ctx, pos.x, pos.y, 6, s.spell, c.core);
    }
  }

  /** 等待双击判定：一个快速收拢的环，暗示"再点一下就是全部" */
  private drawPendingRing(ctx: CanvasRenderingContext2D, b: Building, t: number): void {
    const paint = PAINT[b.faction === 1 ? 1 : 2];
    const r = (b.type === 'house' ? 40 : 48) + b.level * 1.6;
    ctx.save();
    ctx.translate(b.x, b.y + 2);
    ctx.scale(1, 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -t * 90;
    ctx.strokeStyle = paint.core;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private drawHoverRing(ctx: CanvasRenderingContext2D, b: Building, t: number): void {
    if (b.faction === 1 && this.selectedCount === 0) return;
    const paint = PAINT[b.faction === 1 ? 1 : b.faction];
    const r = (b.type === 'house' ? 34 : 42) + b.level * 1.6;
    ctx.save();
    ctx.translate(b.x, b.y + 4);
    ctx.scale(1, 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = paint.core;
    ctx.globalAlpha = 0.45 + Math.sin(t * 6) * 0.12;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  private drawFilaments(ctx: CanvasRenderingContext2D, w: World, t: number): void {
    const bs = w.buildings;
    ctx.save();
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const b = bs[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 300) continue;
        const fade = 1 - d / 300;
        const m = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const bend = 22 * Math.sin(a.id * 3.1 + b.id * 1.7 + t * 0.15);
        const mx = (a.x + b.x) / 2 + (-(b.y - a.y) / m) * bend;
        const my = (a.y + b.y) / 2 + ((b.x - a.x) / m) * bend;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y + 14);
        ctx.quadraticCurveTo(mx, my + 14, b.x, b.y + 14);
        ctx.strokeStyle = `rgba(96, 176, 190, ${(0.05 + fade * 0.12).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        // 生物发光节点
        const steps = 3;
        for (let k = 1; k < steps; k++) {
          const s = k / steps;
          const x = (1 - s) * (1 - s) * a.x + 2 * (1 - s) * s * mx + s * s * b.x;
          const y = (1 - s) * (1 - s) * (a.y + 14) + 2 * (1 - s) * s * (my + 14) + s * s * (b.y + 14);
          const phase = Math.sin(t * 1.6 - s * 4 + a.id) * 0.5 + 0.5;
          ctx.globalAlpha = 0.10 + phase * 0.18;
          ctx.fillStyle = 'rgba(120, 240, 235, 1)';
          ctx.beginPath();
          ctx.arc(x, y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  private drawRanges(
    ctx: CanvasRenderingContext2D,
    w: World,
    view: ViewState,
    t: number,
  ): void {
    const ids = new Set<number>(view.selected);
    if (view.hovered !== null) ids.add(view.hovered);
    for (const id of ids) {
      const b = w.buildings.find((x) => x.id === id);
      if (b && b.type === 'fort') drawRangeRing(ctx, b, t);
    }
  }

  /** 选中塔 → 鼠标 的直线瞄准线：永远跟着鼠标走，不吸附、不弯曲。 */
  private drawAimLines(
    ctx: CanvasRenderingContext2D,
    w: World,
    view: ViewState,
    t: number,
  ): void {
    if (view.selected.length === 0) return;
    // 框选时先收起瞄准线：否则十几条线会一起汇到框角，把框本身糊掉
    if (view.marquee) return;
    const color = PAINT[1].core;
    const n = view.selected.length;
    // 人越多线越淡越细，但一条都不少
    const alpha = n <= 4 ? 0.5 : Math.max(0.2, 0.5 - (n - 4) * 0.05);
    const width = n <= 8 ? 1.4 : 1.1;
    for (const id of view.selected) {
      const b = w.buildings.find((x) => x.id === id);
      if (!b || b.faction !== 1) continue;
      drawAimLine(ctx, b.x, b.y - 8, view.pointer.x, view.pointer.y, color, t, alpha, width);
    }
  }

  private drawPackets(
    ctx: CanvasRenderingContext2D,
    w: World,
    alpha: number,
    t: number,
  ): void {
    const seen = new Set<number>();
    for (const p of w.packets) {
      seen.add(p.id);
      const pos = packetPos(p, alpha);
      const paint = PAINT[p.faction];
      const count = Math.round(p.count);
      const r = 7 + Math.min(13, Math.log2(Math.max(1, count)) * 3.2);

      // 记录轨迹（用来画一条渐隐的彗尾，而不是一串光点）
      let trail = this.trails.get(p.id);
      if (!trail) {
        trail = [];
        this.trails.set(p.id, trail);
      }
      trail.push({ x: pos.x, y: pos.y });
      if (trail.length > 12) trail.shift();

      // 彗尾：逐段变细变淡
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 1; i < trail.length; i++) {
        const k = i / trail.length;
        const a = trail[i - 1];
        const b = trail[i];
        ctx.globalAlpha = k * k * 0.45;
        ctx.strokeStyle = paint.mid;
        ctx.lineWidth = r * 1.1 * k;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();

      // 光球
      glow(ctx, pos.x, pos.y, r * 3.2, paint.glow, 0.6);
      const g = ctx.createRadialGradient(
        pos.x - r * 0.35,
        pos.y - r * 0.4,
        r * 0.1,
        pos.x,
        pos.y,
        r,
      );
      g.addColorStop(0, '#FFFFFF');
      g.addColorStop(0.4, paint.core);
      g.addColorStop(1, paint.deep);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = paint.mid;
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 球上的数字：一颗球 = 一个数量
      const fontSize = Math.max(9, Math.round(r * 0.95));
      ctx.font = `800 ${fontSize}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(3, 14, 20, 0.85)';
      ctx.strokeText(String(count), pos.x, pos.y + 0.5);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(String(count), pos.x, pos.y + 0.5);
      void t;
    }

    // 清理已消失的拖尾
    for (const key of this.trails.keys()) {
      if (!seen.has(key)) this.trails.delete(key);
    }
  }

  private drawShots(ctx: CanvasRenderingContext2D, dt: number): void {
    for (const s of this.shots) s.life -= dt;
    this.shots = this.shots.filter((s) => s.life > 0);
    for (const s of this.shots) {
      const a = Math.max(0, s.life / s.max);
      const paint = PAINT[s.faction];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a;
      ctx.strokeStyle = paint.core;
      ctx.lineWidth = 2.2 * a + 0.6;
      ctx.shadowColor = paint.glow;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawHoverCard(
    ctx: CanvasRenderingContext2D,
    w: World,
    view: ViewState,
  ): void {
    if (view.hovered === null) {
      this.cardTarget = null;
      this.cardRect = null;
      return;
    }
    const b = w.buildings.find((x) => x.id === view.hovered);
    if (!b) {
      this.cardTarget = null;
      this.cardRect = null;
      return;
    }
    if (this.cardTarget !== b.id) {
      this.cardTarget = b.id;
      this.cardAt = view.time;
    }

    const paint = PAINT[b.faction];
    const header = `${TYPE_NAME[b.type] ?? b.type} · Lv.${b.level + 1}`;
    const rows = cardRows(b);
    const statuses = cardStatuses(b);

    // 量文字：宽高都由内容决定，不再用固定 184×77
    ctx.font = font(700, FONT_SIZE.md);
    const headerW = ctx.measureText(header).width;
    ctx.font = font(500, FONT_SIZE.sm);
    let rowsW = 0;
    for (const row of rows) {
      rowsW = Math.max(
        rowsW,
        ctx.measureText(row.label).width + SPACE.md + ctx.measureText(row.value).width,
      );
    }
    ctx.font = font(700, 9);
    const statusW = statuses.reduce(
      (sum, s) => sum + CARD.statusIcon + CARD.statusGap + ctx.measureText(s.label).width + 6,
      0,
    );
    const contentW = Math.max(
      headerW + (statusW > 0 ? statusW + SPACE.sm : 0),
      rowsW,
    );
    const wdt = Math.max(
      CARD.minW,
      Math.min(CARD.maxW, Math.ceil(contentW + CARD.pad * 2)),
    );
    const hgt = CARD.pad * 2 + CARD.headerH + CARD.gap + rows.length * CARD.rowH;

    // 锚定在塔上：垂直中心比身体中心高 12px；左侧/右侧贴礁盘外缘 +2px
    const { cy: bodyCy } = bodyCenter(b);
    const platformRx = b.type === 'house' ? 44 : 54;
    const anchoredY = Math.max(
      12,
      Math.min(this.logicalH - 12 - hgt, bodyCy - 12 - hgt / 2),
    );
    const rightX = b.x + platformRx + 2;
    const leftX = b.x - platformRx - 2 - wdt;
    const clampRect = (r: { x: number; y: number }) => ({
      x: Math.max(12, Math.min(this.logicalW - 12 - wdt, r.x)),
      y: Math.max(12, Math.min(this.logicalH - 12 - hgt, r.y)),
      w: wdt,
      h: hgt,
    });
    const boxes = w.buildings
      .filter((o) => o.id !== b.id)
      .map((o) => {
        const or = bodyRadius(o);
        return {
          x: o.x - or - 14,
          y: o.y - 6 - or - 28,
          w: or * 2 + 28,
          h: or * 2 + 76,
        };
      });
    const intersects = (
      r: { x: number; y: number; w: number; h: number },
      s: { x: number; y: number; w: number; h: number },
    ) => r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y;
    const overlapArea = (
      r: { x: number; y: number; w: number; h: number },
      s: { x: number; y: number; w: number; h: number },
    ) => {
      if (!intersects(r, s)) return 0;
      return (
        Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x)
      ) * (
        Math.min(r.y + r.h, s.y + s.h) - Math.max(r.y, s.y)
      );
    };
    const sideScore = (r: { x: number; y: number; w: number; h: number }) => {
      let score = 0;
      for (const box of boxes) score += overlapArea(r, box);
      // 屏幕边缘优先于“避让建筑”：保证永远不出屏
      if (r.x < 12) score += 100000;
      if (r.x + r.w > this.logicalW - 12) score += 100000;
      if (r.y < 12) score += 100000;
      if (r.y + r.h > this.logicalH - 12) score += 100000;
      return score;
    };

    const right = { x: rightX, y: anchoredY, w: wdt, h: hgt };
    const left = { x: leftX, y: anchoredY, w: wdt, h: hgt };
    const rect = clampRect(sideScore(right) <= sideScore(left) ? right : left);
    this.cardRect = rect;

    const alpha = Math.min(1, Math.max(0, (view.time - this.cardAt) / 0.12));
    const slide = (1 - alpha) * 2;

    ctx.save();
    ctx.globalAlpha = 0.95 * alpha;
    ctx.translate(0, slide);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    roundRect(ctx, rect.x, rect.y, wdt, hgt, RADIUS.md);
    ctx.fillStyle = 'rgba(4, 18, 28, 0.94)';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle =
      b.frozen > 0
        ? SPELL_COLOR.freeze.mid
        : b.infectT > 0
          ? SPELL_COLOR.infect.mid
          : paint.dim;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 阵营色竖条
    ctx.fillStyle = paint.mid;
    roundRect(ctx, rect.x, rect.y + CARD.pad - 2, 3, hgt - CARD.pad * 2 + 4, 2);
    ctx.fill();

    const headerY = rect.y + CARD.pad + CARD.headerH / 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font(700, FONT_SIZE.md);
    ctx.fillStyle = paint.core;
    ctx.fillText(header, rect.x + CARD.pad + 8, headerY);

    // 右上角状态图标 + 小数字
    let cursor = rect.x + wdt - CARD.pad;
    for (let i = statuses.length - 1; i >= 0; i -= 1) {
      const s = statuses[i];
      const c = SPELL_COLOR[s.kind];
      ctx.font = font(700, 9);
      const tw = ctx.measureText(s.label).width;
      cursor -= tw;
      ctx.textAlign = 'left';
      ctx.fillStyle = c.core;
      ctx.fillText(s.label, cursor, headerY);
      cursor -= CARD.statusIcon + CARD.statusGap;
      drawSpellIcon(
        ctx,
        cursor + CARD.statusIcon / 2,
        headerY,
        4.5,
        s.kind,
        c.core,
      );
      cursor -= 6;
    }

    // 分隔线
    ctx.beginPath();
    ctx.moveTo(rect.x + CARD.pad + 8, rect.y + CARD.pad + CARD.headerH + CARD.gap / 2);
    ctx.lineTo(rect.x + wdt - CARD.pad, rect.y + CARD.pad + CARD.headerH + CARD.gap / 2);
    ctx.strokeStyle = 'rgba(120, 200, 210, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 三行数据：标签左、数值右
    const firstRowY = rect.y + CARD.pad + CARD.headerH + CARD.gap;
    rows.forEach((row, i) => {
      const rowY = firstRowY + i * CARD.rowH + CARD.rowH / 2;
      ctx.font = font(500, FONT_SIZE.sm);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(160, 195, 205, 0.9)';
      ctx.fillText(row.label, rect.x + CARD.pad + 8, rowY);
      ctx.font = font(700, FONT_SIZE.sm);
      ctx.textAlign = 'right';
      ctx.fillStyle = row.color ?? 'rgba(230, 245, 250, 0.95)';
      ctx.fillText(row.value, rect.x + wdt - CARD.pad, rowY);
    });

    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D, w: World): void {
    const p1 = factionPower(w, 1);
    const p2 = factionPower(w, 2);
    const total = p1 + p2 || 1;
    const ratio = p1 / total;

    const barW = 560;
    const barH = 14;
    const bx = (this.logicalW - barW) / 2;
    const by = this.logicalH - 44;

    // 底槽
    roundRect(ctx, bx, by, barW, barH, barH / 2);
    ctx.fillStyle = 'rgba(6, 20, 30, 0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 220, 220, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 双方填充
    const split = Math.max(10, Math.min(barW - 10, barW * ratio));
    ctx.save();
    roundRect(ctx, bx, by, barW, barH, barH / 2);
    ctx.clip();
    const gl = ctx.createLinearGradient(bx, 0, bx + split, 0);
    gl.addColorStop(0, 'rgba(20, 90, 110, 0.95)');
    gl.addColorStop(1, 'rgba(60, 240, 235, 0.95)');
    ctx.fillStyle = gl;
    ctx.fillRect(bx, by, split, barH);

    const gr = ctx.createLinearGradient(bx + barW, 0, bx + split, 0);
    gr.addColorStop(0, 'rgba(130, 24, 60, 0.95)');
    gr.addColorStop(1, 'rgba(255, 90, 140, 0.95)');
    ctx.fillStyle = gr;
    ctx.fillRect(bx + split, by, barW - split, barH);
    ctx.restore();

    // 分界线
    glow(ctx, bx + split, by + barH / 2, 26, 'rgba(255,255,255,0.5)', 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(bx + split - 1, by - 3, 2, barH + 6);

    // 数值
    drawLabel(ctx, String(Math.round(p1)), bx - 18, by + barH / 2, PAINT[1].core, 14, 'right');
    drawLabel(ctx, String(Math.round(p2)), bx + barW + 18, by + barH / 2, PAINT[2].core, 14, 'left');

    // 计时
    const left = Math.max(0, MATCH_TIME - w.time);
    const mm = Math.floor(left / 60);
    const ss = Math.floor(left % 60);
    const clock = `${mm}:${ss.toString().padStart(2, '0')}`;
    drawLabel(ctx, clock, this.logicalW / 2, 34, GOLD, 20);
    drawLabel(ctx, LEVELS[w.levelId]?.name ?? '海沟', 28, 32, 'rgba(180, 220, 226, 0.62)', 11, 'left');
  }

  /** 右下角唯一的常驻提示：`? 操作与机制`。 */
  private drawHelpHint(ctx: CanvasRenderingContext2D, view: ViewState): void {
    const r = helpHintRect();
    const hover =
      view.pointer.x >= r.x &&
      view.pointer.x <= r.x + r.w &&
      view.pointer.y >= r.y &&
      view.pointer.y <= r.y + r.h;
    const cy = r.y + r.h / 2;

    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, RADIUS.lg);
    ctx.fillStyle = hover ? 'rgba(8, 34, 44, 0.94)' : 'rgba(5, 18, 26, 0.82)';
    ctx.fill();
    ctx.strokeStyle = hover ? 'rgba(120, 250, 255, 0.55)' : 'rgba(120, 220, 220, 0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(r.x + 14, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = hover ? 'rgba(24, 92, 102, 0.95)' : 'rgba(10, 49, 58, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 240, 245, 0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(700, FONT_SIZE.sm);
    ctx.fillStyle = '#DDF7FA';
    ctx.fillText('?', r.x + 14, cy + 0.5);

    ctx.textAlign = 'left';
    ctx.font = font(600, FONT_SIZE.sm);
    ctx.fillStyle = hover ? '#E8FEFF' : 'rgba(190, 225, 232, 0.8)';
    ctx.fillText('操作与机制', r.x + 26, cy + 0.5);
    ctx.restore();
  }
}

function upgradeCost(b: Building): number {
  const rows = BUILDINGS[b.type];
  return rows[b.level + 1]?.cost ?? 0;
}

function canUpgrade(b: Building): boolean {
  if (b.faction === 0) return false;
  return b.level < BUILDINGS[b.type].length - 1;
}

function affordable(b: Building): boolean {
  return b.garrison >= upgradeCost(b);
}

export function drawAdditional(
  ctx: CanvasRenderingContext2D,
  b: Building,
  t: number,
): void {
  // 堡垒蓄力环：快开火时脉冲（冻结/感染中不开火，不画）
  if (b.type === 'fort' && b.faction !== 0 && b.frozen <= 0 && b.infectT <= 0) {
    const ready = 1 - Math.min(1, Math.max(0, b.fireCd * b.fireRate));
    ctx.save();
    ctx.globalAlpha = 0.25 + ready * 0.4;
    ctx.strokeStyle = PAINT[b.faction].core;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y + 18, 30, -Math.PI / 2, -Math.PI / 2 + ready * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 冻结：冰壳 + 雪花
  if (b.frozen > 0) {
    const { cx, cy, r } = bodyCenter(b);
    ctx.save();
    ctx.beginPath();
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const rad = r * 1.12 + (i % 2 === 0 ? 1 : 5) + Math.sin(t * 1.4 + i) * 1.6;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad * 0.94;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(180, 235, 255, 0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(225, 250, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = 'rgba(240, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a = -0.9 + i * 0.9;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.15, cy + Math.sin(a) * r * 0.1);
      ctx.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.72);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(235, 252, 255, 0.95)';
    ctx.lineWidth = 1.4;
    const sx = cx;
    const sy = cy - r * 0.18;
    const s = 6;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(sx - Math.cos(a) * s, sy - Math.sin(a) * s);
      ctx.lineTo(sx + Math.cos(a) * s, sy + Math.sin(a) * s);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 感染：绿色菌泡 + 薄雾
  if (b.infectT > 0) {
    const { cx, cy, r } = bodyCenter(b);
    ctx.save();
    ctx.globalAlpha = 0.14;
    glow(ctx, cx, cy, r * 2.1, 'rgba(140, 255, 122, 0.9)', 0.6);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + t * 0.35;
      const rad = r * (0.72 + (i % 3) * 0.16);
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad * 0.88 + Math.sin(t * 2 + i) * 2;
      const br = 1.6 + (i % 3) * 1.1 + Math.sin(t * 3 + i) * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, br, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(140, 255, 122, 0.55)';
      ctx.fill();
    }
    ctx.restore();
  }

  // Lab 炼制：身体外唯一的大环（常驻、药水色、0→360°）
  if (b.type === 'lab' && b.brew) {
    const { r } = bodyCenter(b);
    const c = SPELL_COLOR[b.brew];
    const p = Math.min(1, b.brewT / BREW_TIME);
    const cy = b.y + 8;
    ctx.save();

    // 暗色底环：让“还剩多少”有参照
    ctx.beginPath();
    ctx.arc(b.x, cy, r * 1.35, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(210, 240, 250, 0.14)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // 进度弧
    const start = -Math.PI / 2;
    const end = start + p * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(b.x, cy, r * 1.35, start, end);
    ctx.strokeStyle = c.mid;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.95;
    ctx.stroke();

    // 弧尖光点
    const tipX = b.x + Math.cos(end) * r * 1.35;
    const tipY = cy + Math.sin(end) * r * 1.35;
    glow(ctx, tipX, tipY, 16, c.glow, 0.85);
    ctx.beginPath();
    ctx.arc(tipX, tipY, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = c.core;
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Lab 就绪：药水色光柱 + 上升光点
  if (b.type === 'lab' && b.potion) {
    const c = SPELL_COLOR[b.potion];
    const { r } = bodyCenter(b);
    ctx.save();
    ctx.globalAlpha = 0.3 + Math.sin(t * 2.6) * 0.1;
    glow(ctx, b.x, b.y - r * 0.4, r * 2.6, c.glow, 0.8);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const ph = (t * 0.55 + i * 0.25) % 1;
      const x = b.x + Math.sin(t * 1.8 + i * 2) * r * 0.55;
      const y = b.y + 12 - ph * r * 2.1;
      ctx.globalAlpha = (1 - ph) * 0.8;
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + (1 - ph) * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = c.core;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  if (b.captureFlash > 0.02) {
    ctx.save();
    ctx.globalAlpha = b.captureFlash * 0.5;
    glow(ctx, b.x, b.y, 90 * (1.4 - b.captureFlash), PAINT[b.faction].core, 0.6);
    ctx.restore();
  }
  void t;
}
