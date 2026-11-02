interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  gravity: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  vr: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

/** 轻量粒子系统：爆浆、冲击环、升级火花。只做表现，不影响模拟。 */
export class Particles {
  private list: Particle[] = [];
  private rings: Ring[] = [];

  burst(x: number, y: number, color: string, count = 12, speed = 130): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.list.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 20,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        size: 1.5 + Math.random() * 2.6,
        color,
        drag: 2.6,
        gravity: 26,
      });
    }
  }

  ring(x: number, y: number, color: string, r0 = 8, vr = 190, life = 0.6, width = 2.6): void {
    this.rings.push({ x, y, r: r0, vr, life, max: life, color, width });
  }

  sparkle(x: number, y: number, color: string): void {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const s = 60 + Math.random() * 110;
      this.list.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.7 + Math.random() * 0.5,
        max: 1,
        size: 1.4 + Math.random() * 1.8,
        color,
        drag: 1.2,
        gravity: -40,
      });
    }
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.life -= dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
    for (const r of this.rings) {
      r.life -= dt;
      r.r += r.vr * dt;
    }
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const a = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const r of this.rings) {
      const a = Math.max(0, r.life / r.max);
      ctx.globalAlpha = a * 0.7;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * a;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.list = [];
    this.rings = [];
  }
}
