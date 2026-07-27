import React, { useEffect, useRef } from 'react';

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    rot: number;
    vrot: number;
    life: number;
    maxLife: number;
    shape: number;
}

// Festive spread built from the app's palette plus a few celebratory accents.
const COLORS = ['#6366f1', '#818cf8', '#c084fc', '#f472b6', '#22c55e', '#fbbf24', '#38bdf8'];

/**
 * A full-screen confetti burst. Bumping `trigger` (a nonce) fires another burst; particles
 * animate under gravity and fade out, and the render loop stops once none remain. The canvas
 * never blocks clicks (pointer-events: none).
 */
export const Celebration: React.FC<{ trigger: number }> = ({ trigger }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particlesRef = useRef<Particle[]>([]);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        if (trigger === 0) return; // don't fire on initial mount
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Burst outward from just above the middle.
        const cx = w / 2;
        const cy = h * 0.45;
        for (let i = 0; i < 90; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 4 + Math.random() * 7;
            particlesRef.current.push({
                x: cx + (Math.random() - 0.5) * 40,
                y: cy + (Math.random() - 0.5) * 20,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - Math.random() * 4,
                size: 5 + Math.random() * 7,
                color: COLORS[(Math.random() * COLORS.length) | 0],
                rot: Math.random() * Math.PI,
                vrot: (Math.random() - 0.5) * 0.3,
                life: 0,
                maxLife: 70 + Math.random() * 45,
                shape: (Math.random() * 3) | 0,
            });
        }

        const gravity = 0.16;
        const draw = () => {
            ctx.clearRect(0, 0, w, h);
            const ps = particlesRef.current;
            for (let i = ps.length - 1; i >= 0; i--) {
                const p = ps[i];
                p.life++;
                p.vy += gravity;
                p.vx *= 0.99;
                p.x += p.vx;
                p.y += p.vy;
                p.rot += p.vrot;
                const t = p.life / p.maxLife;
                if (t >= 1 || p.y > h + 24) {
                    ps.splice(i, 1);
                    continue;
                }
                ctx.save();
                ctx.globalAlpha = Math.max(0, 1 - t);
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillStyle = p.color;
                if (p.shape === 0) {
                    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
                } else if (p.shape === 1) {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.beginPath();
                    ctx.moveTo(0, -p.size / 2);
                    ctx.lineTo(p.size / 2, p.size / 2);
                    ctx.lineTo(-p.size / 2, p.size / 2);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.restore();
            }
            if (ps.length > 0) {
                rafRef.current = requestAnimationFrame(draw);
            } else {
                rafRef.current = null;
                ctx.clearRect(0, 0, w, h);
            }
        };
        // Only start a loop if one isn't already running (overlapping bursts just add particles).
        if (rafRef.current == null) {
            rafRef.current = requestAnimationFrame(draw);
        }
    }, [trigger]);

    useEffect(
        () => () => {
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        },
        [],
    );

    return <canvas ref={canvasRef} className="celebration-canvas" aria-hidden="true" />;
};
