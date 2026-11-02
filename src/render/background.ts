import { ABYSS_BOTTOM, ABYSS_TOP } from './palette.ts';

interface Drifter {
  x: number;
  y: number;
  z: number; // 0..1 深度，越小越远
  r: number;
  phase: number;
}

interface Rock {
  x: number;
  y: number;
  rx: number;
  ry: number;
  seed: number;
  flip: number;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 静态背景缓存：abyss 渐变 + 远景岩脊 + 珊瑚剪影。 */
export class Backdrop {
  private cache: HTMLCanvasElement | null = null;
  private drifters: Drifter[] = [];
  private w = 1280;
  private h = 720;
  private ready = false;

  build(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, ABYSS_TOP);
    g.addColorStop(0.45, '#04121d');
    g.addColorStop(1, ABYSS_BOTTOM);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 中央微光（远处的海面）
    const haze = ctx.createRadialGradient(w * 0.5, -h * 0.15, 10, w * 0.5, h * 0.2, h * 0.9);
    haze.addColorStop(0, 'rgba(60, 210, 220, 0.16)');
    haze.addColorStop(0.45, 'rgba(24, 120, 140, 0.07)');
    haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, h);

    const rnd = mulberry(20261029);

    // 远景岩脊
    const rocks: Rock[] = [];
    for (let i = 0; i < 9; i++) {
      rocks.push({
        x: rnd() * w,
        y: h * (0.55 + rnd() * 0.5),
        rx: 90 + rnd() * 190,
        ry: 60 + rnd() * 130,
        seed: rnd() * 10,
        flip: rnd() > 0.5 ? 1 : -1,
      });
    }
    for (const r of rocks) {
      this.ridge(ctx, r, 'rgba(5, 18, 28, 0.92)');
    }

    // 前景珊瑚剪影（贴边，制造画框）
    this.coral(ctx, -30, h + 40, 1, 'rgba(2, 9, 14, 0.95)');
    this.coral(ctx, w + 30, h + 20, -1, 'rgba(2, 9, 14, 0.95)');
    this.coral(ctx, w * 0.14, -20, 1, 'rgba(2, 9, 14, 0.55)');

    // 暗角
    const vig = ctx.createRadialGradient(w / 2, h * 0.48, h * 0.25, w / 2, h * 0.5, h * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0, 2, 6, 0.75)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    this.cache = c;

    // 海雪
    this.drifters = [];
    for (let i = 0; i < 150; i++) {
      this.drifters.push({
        x: rnd() * w,
        y: rnd() * h,
        z: 0.25 + rnd() * 0.75,
        r: 0.6 + rnd() * 1.9,
        phase: rnd() * Math.PI * 2,
      });
    }
    this.ready = true;
  }

  private ridge(ctx: CanvasRenderingContext2D, r: Rock, color: string): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    const segs = 9;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const x = r.x - r.rx + t * r.rx * 2;
      const bump =
        Math.sin(t * Math.PI) * r.ry +
        Math.sin(t * 5 + r.seed) * r.ry * 0.18 +
        Math.sin(t * 11 + r.seed * 2) * r.ry * 0.08;
      const y = r.y - bump;
      if (i === 0) ctx.moveTo(x, r.y + r.ry);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(r.x + r.rx, r.y + r.ry);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private coral(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    dir: number,
    color: string,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';

    const branch = (bx: number, by: number, len: number, ang: number, width: number, depth: number) => {
      if (depth <= 0) return;
      const ex = bx + Math.cos(ang) * len;
      const ey = by + Math.sin(ang) * len;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(
        bx + Math.cos(ang + 0.4) * len * 0.6,
        by + Math.sin(ang + 0.4) * len * 0.6,
        ex,
        ey,
      );
      ctx.lineWidth = width;
      ctx.stroke();
      branch(ex, ey, len * 0.66, ang - 0.55, width * 0.62, depth - 1);
      branch(ex, ey, len * 0.7, ang + 0.35, width * 0.6, depth - 1);
      if (depth % 2 === 1) branch(ex, ey, len * 0.5, ang + 0.08, width * 0.45, depth - 1);
    };

    branch(0, 0, 120, -Math.PI / 2 - 0.25, 16, 4);
    branch(40, 10, 90, -Math.PI / 2 + 0.35, 12, 3);
    branch(-30, 20, 70, -Math.PI / 2 - 0.5, 10, 3);
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, time: number): void {
    if (!this.ready) this.build(this.w, this.h);
    if (!this.cache) return;
    ctx.drawImage(this.cache, 0, 0);

    // 光柱（加法混合，缓慢摆动）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const t = time * 0.08 + i * 1.7;
      const x = this.w * (0.18 + i * 0.22) + Math.sin(t) * 40;
      const topW = 26 + i * 6;
      const botW = topW * 4.2;
      const grad = ctx.createLinearGradient(x, 0, x, this.h * 0.85);
      grad.addColorStop(0, 'rgba(120, 240, 235, 0.055)');
      grad.addColorStop(0.5, 'rgba(90, 200, 210, 0.022)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x - topW, -20);
      ctx.lineTo(x + topW, -20);
      ctx.lineTo(x + botW + Math.sin(t + 1) * 30, this.h * 0.9);
      ctx.lineTo(x - botW + Math.sin(t + 1) * 30, this.h * 0.9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 海雪
    ctx.save();
    for (const d of this.drifters) {
      const y = ((d.y - time * (6 + d.z * 16)) % this.h + this.h) % this.h;
      const x = d.x + Math.sin(time * 0.4 + d.phase) * 14 * d.z;
      const a = 0.12 + d.z * 0.35;
      ctx.globalAlpha = a * (0.7 + 0.3 * Math.sin(time * 1.6 + d.phase));
      ctx.fillStyle = d.z > 0.7 ? 'rgba(150, 245, 240, 0.9)' : 'rgba(190, 225, 235, 0.7)';
      ctx.beginPath();
      ctx.arc(x, y, d.r * d.z, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
