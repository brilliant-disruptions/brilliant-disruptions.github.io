"use client";

import { useEffect, useRef, useState } from "react";
import { Orbitron, Rajdhani } from "next/font/google";
import { AirHockeyGame, type SideStats, type GameOverResult } from "@/lib/air-hockey/game";

const orbitron = Orbitron({ variable: "--font-orbitron", subsets: ["latin"], weight: ["400", "700", "900"] });
const rajdhani = Rajdhani({ variable: "--font-rajdhani", subsets: ["latin"], weight: ["300", "400", "500", "600", "700"] });

const ARENA_W = 760;
const ARENA_H = 520;

export default function AirHockeyPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<AirHockeyGame | null>(null);

  const [score, setScore] = useState({ p: 0, cpu: 0 });
  const [stats, setStats] = useState<{ p: SideStats; cpu: SideStats }>({
    p: { streak: 0, topSpeed: 0, powerHits: 0 },
    cpu: { streak: 0, topSpeed: 0, powerHits: 0 },
  });
  const [muted, setMuted] = useState(true);
  const [gameOver, setGameOver] = useState<GameOverResult>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!canvasRef.current) return;
    const game = new AirHockeyGame(canvasRef.current, {
      onStats: setStats,
      onScore: setScore,
      onGameOver: setGameOver,
      onMuteChange: setMuted,
    });
    gameRef.current = game;
    game.init();
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? ARENA_W;
      setScale(Math.min(1, width / ARENA_W));
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={`${orbitron.variable} ${rajdhani.variable} flex flex-col items-center gap-4`}>
      <div ref={wrapperRef} className="flex w-full max-w-[1100px] items-center justify-center">
        <div
          style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
          className="flex items-stretch gap-0"
        >
          <StatPanel label="YOU" color="var(--cyan)" score={score.p} stats={stats.p} />

          <div
            className="relative overflow-hidden"
            style={{ width: ARENA_W, height: ARENA_H, borderRadius: 18 }}
          >
            <canvas ref={canvasRef} className="block h-full w-full" />

            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 font-mono text-[10px] tracking-widest text-[var(--muted-hi)]">
              {muted ? "PRESS S FOR SOUND" : "PRESS S TO MUTE"}
            </div>

            {gameOver && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="text-center">
                  <div className="mb-2 text-6xl">{gameOver.winner === "p" ? "\u{1F604}" : "\u{1F622}"}</div>
                  <div
                    className="mb-2 text-4xl font-black sm:text-5xl"
                    style={{
                      color: gameOver.winner === "p" ? "var(--cyan)" : "var(--danger)",
                      fontFamily: "var(--font-orbitron)",
                    }}
                  >
                    {gameOver.winner === "p" ? "YOU WIN" : "CPU WINS"}
                  </div>
                  <div className="mt-1 font-mono text-sm tracking-[0.3em] text-[var(--muted-hi)]">
                    {gameOver.winner === "p" ? "GAME · SET · MATCH" : "BETTER LUCK NEXT TIME"}
                  </div>
                  <div className="my-4 text-2xl font-bold" style={{ color: "var(--gold)" }}>
                    {gameOver.final}
                  </div>
                  <button
                    onClick={() => gameRef.current?.startGame()}
                    className="px-9 py-3 font-mono text-sm font-bold tracking-widest transition"
                    style={{
                      border: "2px solid var(--cyan)",
                      color: "var(--cyan)",
                      clipPath: "polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%)",
                    }}
                  >
                    PLAY AGAIN
                  </button>
                </div>
              </div>
            )}
          </div>

          <StatPanel label="CPU" color="var(--danger)" score={score.cpu} stats={stats.cpu} />
        </div>
      </div>
    </div>
  );
}

function StatPanel({
  label,
  color,
  score,
  stats,
}: {
  label: string;
  color: string;
  score: number;
  stats: SideStats;
}) {
  return (
    <div className="flex w-[130px] shrink-0 flex-col items-center gap-0 border border-[var(--glass-border)] bg-[var(--surface)] px-2.5 pb-3 pt-4">
      <div
        className="mb-1.5 w-full text-center text-[10px] font-bold tracking-[4px]"
        style={{ color, fontFamily: "var(--font-orbitron)" }}
      >
        {label}
      </div>
      <div
        className="mb-1.5 w-full text-center text-5xl font-black leading-none"
        style={{ color, textShadow: `0 0 20px ${color}`, fontFamily: "var(--font-orbitron)" }}
      >
        {score}
      </div>
      <div className="my-1.5 h-px w-full bg-white/[0.07]" />
      <StatRow label="STREAK" value={stats.streak} />
      <StatRow label="TOP SPEED" value={stats.topSpeed} />
      <StatRow label="POWER HITS" value={stats.powerHits} />
      <div className="my-1.5 h-px w-full bg-white/[0.07]" />
      <div className="mt-0.5 text-center font-mono text-[9px] tracking-[2px] text-white/20">
        FIRST TO 7 WINS
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="mb-2 flex w-full items-center justify-between">
      <span className="text-[9px] font-medium tracking-[1.5px] text-white/30 uppercase">{label}</span>
      <span className="font-mono text-xs font-bold text-white/75">{value}</span>
    </div>
  );
}
