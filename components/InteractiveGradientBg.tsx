"use client";

import { useEffect, useRef } from "react";

/**
 * Full-page interactive gradient background.
 * Mouse/touch position shifts warm gradient orbs with smooth interpolation.
 */
export default function InteractiveGradientBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mouse = { x: 0.5, y: 0.3 };
    const eased = { x: 0.5, y: 0.3 };
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Half-res for performance — CSS stretches smoothly
      canvas.width = Math.floor(window.innerWidth / 2) * dpr;
      canvas.height = Math.floor(window.innerHeight / 2) * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      mouse.x = clientX / window.innerWidth;
      mouse.y = clientY / window.innerHeight;
    };
    window.addEventListener("mousemove", handleMove, { passive: true });
    window.addEventListener("touchmove", handleMove, { passive: true });

    const draw = () => {
      // Smooth follow — eased lag behind cursor
      eased.x += (mouse.x - eased.x) * 0.035;
      eased.y += (mouse.y - eased.y) * 0.035;

      const w = canvas.width;
      const h = canvas.height;
      const mx = eased.x * w;
      const my = eased.y * h;

      // Base warm paper
      ctx.fillStyle = "#f6f1e8";
      ctx.fillRect(0, 0, w, h);

      // Orb 1 — large warm foil-gold bloom, follows mouse
      const g1 = ctx.createRadialGradient(mx, my, 0, mx, my, w * 0.7);
      g1.addColorStop(0, "rgba(206, 168, 92, 0.58)");
      g1.addColorStop(0.35, "rgba(222, 196, 132, 0.34)");
      g1.addColorStop(0.7, "rgba(242, 232, 210, 0.14)");
      g1.addColorStop(1, "rgba(246, 241, 232, 0)");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, w, h);

      // Orb 2 — deeper amber, moves opposite to mouse
      const ox = w - mx * 0.7;
      const oy = h * 0.4 + (1 - eased.y) * h * 0.3;
      const g2 = ctx.createRadialGradient(ox, oy, 0, ox, oy, w * 0.55);
      g2.addColorStop(0, "rgba(184, 138, 70, 0.42)");
      g2.addColorStop(0.4, "rgba(208, 172, 108, 0.22)");
      g2.addColorStop(0.8, "rgba(238, 226, 204, 0.10)");
      g2.addColorStop(1, "rgba(246, 241, 232, 0)");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);

      // Orb 3 — pitch-green sporting accent at bottom, drifts gently
      const bx = w * 0.4 + (0.5 - eased.x) * w * 0.5;
      const by = h * 0.82 + (0.5 - eased.y) * h * 0.15;
      const g3 = ctx.createRadialGradient(bx, by, 0, bx, by, w * 0.5);
      g3.addColorStop(0, "rgba(60, 120, 88, 0.26)");
      g3.addColorStop(0.5, "rgba(120, 165, 138, 0.12)");
      g3.addColorStop(1, "rgba(246, 241, 232, 0)");
      ctx.fillStyle = g3;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("touchmove", handleMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
