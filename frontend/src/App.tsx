import React, { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { ModeInfo, SeasonSummary, SeasonDetail, ChartDataPoint, ComparisonEntry, LevelDetail } from "./types";
import { MODE_COLORS, MODE_NAMES } from "./types";
import { getModes, getSeasons, getSeasonDetail, getChartData, getComparison, getTranslations } from "./api";

// ── i18n ──
type Lang = "en" | "zh";
const UI_TEXT = {
  en: {
    seasonDial: "Season Dial · Drag to Navigate",
    totalHPTrend: "Total HP · Exponential Trend",
    predictiveAnalysis: "Predictive Analysis",
    currentSeason: "Current Season",
    totalHP: "Total HP",
    formula: "Formula",
    inflation3: "3-Season Inflation",
    inflation5: "5-Season Inflation",
    collapse: "Collapse",
    enemies: "enemies",
    wave: "WAVE",
    nodes: "Nodes",
    selectSeason: "Select a season",
    noData: "No data",
    aaBreakdown: "Anomaly Arbitration · HP Breakdown",
    analysis: "Analysis",
    switchLang: "中文",
    metric: "Metric",
    value: "Value",
    r2: "R²",
    pred1: "Pred +1",
    pred2: "Pred +2",
    pred3: "Pred +3",
  },
  zh: {
    seasonDial: "赛季表盘 · 拖动导航",
    totalHPTrend: "总血量 · 指数趋势",
    predictiveAnalysis: "预测分析",
    currentSeason: "当前赛季",
    totalHP: "总血量",
    formula: "公式",
    inflation3: "近3期膨胀率",
    inflation5: "近5期膨胀率",
    collapse: "收起",
    enemies: "个敌人",
    wave: "波次",
    nodes: "节点",
    selectSeason: "选择一个赛季",
    noData: "无数据",
    aaBreakdown: "异相仲裁 · 血量分解",
    analysis: "分析",
    switchLang: "EN",
    metric: "指标",
    value: "数值",
    r2: "决定系数 R²",
    pred1: "接下来1期",
    pred2: "接下来2期",
    pred3: "接下来3期",
  },
};

// ── Formatters ──
function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}
function fmtFull(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// ── i18n Context ──
const I18nContext = React.createContext<{
  lang: Lang;
  t: (key: keyof typeof UI_TEXT["en"]) => string;
  tr: (text: string) => string;
}>({ lang: "en", t: (k) => UI_TEXT.en[k], tr: (t) => t });
const useI18n = () => React.useContext(I18nContext);


function GrowthRows({ windows, fontSize }: { windows: { label: string; avgPct: number; doubling: number }[]; fontSize: string }) {
  return (
    <>
      {windows.map((w, i) => {
        const isPositive = w.avgPct > 0;
        const color = isPositive ? "#f87171" : "#4ade80";
        const glow = isPositive ? "rgba(248,113,113,0.4)" : "rgba(74,222,128,0.3)";
        return (
          <tr key={i}>
            <td colSpan={4} className="text-center" style={i === 0 ? { borderTop: "1px solid rgba(125,211,252,0.08)" } : {}}>
              <div style={{ padding: "10px 0 2px", display: "flex", justifyContent: "center", alignItems: "baseline", gap: "18px", flexWrap: "wrap" }}>
                <span className="font-orb font-bold" style={{ fontSize, letterSpacing: "0.06em", background: "linear-gradient(135deg, #7dd3fc, #c084fc)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>{w.label}</span>
                <span className="font-orb" style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.62rem", letterSpacing: "0.05em" }}>AVG</span>
                <span className="font-orb font-bold" style={{ fontSize, color, textShadow: `0 0 12px ${glow}` }}>{isPositive ? "+" : ""}{w.avgPct.toFixed(2)}%</span>
                <span className="font-orb" style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.62rem", letterSpacing: "0.05em" }}>×2 IN</span>
                <span className="font-orb font-bold" style={{ fontSize, color, textShadow: `0 0 12px ${glow}` }}>{isFinite(w.doubling) ? w.doubling.toFixed(1) : "∞"}</span>
                <span className="font-orb" style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.62rem", letterSpacing: "0.05em" }}>SEASONS</span>
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ── Exp Fit ──
function computeExpFit(data: ChartDataPoint[]) {
  if (data.length < 3) return null;
  const pts = data.map((d, i) => ({ x: i + 1, y: d.total_hp }));
  const n = pts.length;
  let sx = 0, sly = 0, sxx = 0, sxy = 0;
  for (const p of pts) { const ly = Math.log(p.y); sx += p.x; sly += ly; sxx += p.x * p.x; sxy += p.x * ly; }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const B = (n * sxy - sx * sly) / denom;
  const A = Math.exp((sly - B * sx) / n);
  const yMean = pts.reduce((s, p) => s + p.y, 0) / n;
  let ssRes = 0, ssTot = 0;
  for (const p of pts) { const pred = A * Math.exp(B * p.x); ssRes += (p.y - pred) ** 2; ssTot += (p.y - yMean) ** 2; }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const inf3 = n >= 3 ? (pts[n - 1].y - pts[n - 3].y) / pts[n - 3].y * 100 : 0;
  const inf5 = n >= 5 ? (pts[n - 1].y - pts[n - 5].y) / pts[n - 5].y * 100 : 0;
  const preds: { season: string; hp: number }[] = [];
  for (let i = 1; i <= 3; i++) preds.push({ season: `Pred +${i}`, hp: A * Math.exp(B * (n + i)) });
  // Compute growth stats for multiple windows
  function growthStats(startIdx: number, endIdx: number) {
    const fh = pts[startIdx].y, lh = pts[endIdx].y;
    const span = endIdx - startIdx;
    if (fh <= 0 || span <= 0) return { avgPct: 0, doubling: Infinity };
    const avgPct = (Math.pow(lh / fh, 1 / span) - 1) * 100;
    const doubling = avgPct > 0 ? Math.log(2) / Math.log(1 + avgPct / 100) : Infinity;
    return { avgPct, doubling };
  }
  const win5 = growthStats(Math.max(0, n - 5), n - 1);
  const win10 = growthStats(Math.max(0, n - 10), n - 1);
  const winAll = growthStats(0, n - 1);
  const growthWindows = [
    { label: "LAST 5", ...win5 },
    { label: "LAST 10", ...win10 },
    { label: "ALL TIME", ...winAll },
  ];
  return { A, B, formula: `y = ${A.toFixed(0)} · e^(${B.toFixed(4)}·x)`, r2, inf3, inf5, preds, growthWindows };
}

// ── Cool O Circle ──
function CoolO() {
  const r = 7, cx = 11, cy = 11;
  const angles = [0, 72, 144, 216, 288];
  return (
    <span className="cool-circle">
      {angles.map((a, i) => {
        const rad = a * Math.PI / 180;
        const x = cx + r * Math.sin(rad);
        const y = cy - r * Math.cos(rad);
        return <span key={i} className="o-letter" style={{ left: `${x}px`, top: `${y}px` }}>O</span>;
      })}
    </span>
  );
}

// ── Sidebar ──
function Sidebar({ modes, active, onMode, seasons, selIdx, onSeason, color }: {
  modes: ModeInfo[]; active: string; onMode: (k: string) => void;
  seasons: SeasonSummary[]; selIdx: number; onSeason: (i: number) => void; color: string;
}) {
  const [tooltip, setTooltip] = useState<{ name: string; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const mousePos = useRef({ x: 0, y: 0 });

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  const handleMouseEnter = (name: string) => {
    hoverTimer.current = window.setTimeout(() => {
      setTooltip({ name, x: mousePos.current.x, y: mousePos.current.y });
    }, 2000);
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    mousePos.current = { x: e.clientX, y: e.clientY };
    if (tooltip) setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
  };
  const handleMouseLeave = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setTooltip(null);
  };

  const { lang, tr } = useI18n();
  return (
    <>
      <div className="sidebar-fixed">
        <div className="sidebar-header">
          <div className="sidebar-title">SR Challenge</div>
          <div className="sidebar-subtitle">— We just define some C<CoolO />L things. —</div>
        </div>
        <div className="sidebar-tabs">
          {modes.map(m => {
            const isA = m.key === active;
            const c = MODE_COLORS[m.key] || "#6366f1";
            return (
              <button key={m.key} onClick={() => onMode(m.key)}
                className="clip-tab w-full text-left"
                style={{ background: isA ? `${c}1a` : "rgba(255,255,255,0.03)", color: isA ? c : "#8894a8" }}>
                {lang === "zh" ? MODE_NAMES[m.key]?.zh || m.name_en : m.name_en}
              </button>
            );
          })}
        </div>
        <div className="sidebar-content">
          <div className="sidebar-section-label">Seasons · {seasons.length}</div>
          {[...seasons].reverse().map((s, i) => {
            const realIdx = seasons.length - 1 - i;
            const isA = realIdx === selIdx;
            return (
              <div key={s.id} onClick={() => onSeason(realIdx)}
                onMouseEnter={() => handleMouseEnter(s.name)}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                className={`season-list-item ${isA ? "active" : ""}`}
                style={isA ? { borderLeftColor: color, color } : {}}>
                {seasons.length - i}. {tr(s.name)}
              </div>
            );
          })}
        </div>
      </div>
      {tooltip && (
        <div
          className="season-tooltip"
          style={tooltip.x > window.innerWidth / 2
            ? { top: `${tooltip.y - 12}px`, right: `${window.innerWidth - tooltip.x + 16}px` }
            : { top: `${tooltip.y - 12}px`, left: `${tooltip.x + 16}px` }}
        >
          {tooltip.name}
        </div>
      )}
    </>
  );
}

// ── Gauge (top semicircle, static gradient) ──
function Gauge({ total, idx, onChange, color }: {
  total: number; idx: number; onChange: (i: number) => void; color: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const cx = 300, cy = 220, R = 200;
  const anglePer = total > 1 ? 180 / (total - 1) : 180;
  // Clamp idx and compute needle angle; ensure visible at edges
  const clampedIdx = Math.max(0, Math.min(total - 1, idx));
  const needleAngle = total > 1 ? 180 - clampedIdx * anglePer : 90;

  const handleMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width / 600, scaleY = rect.height / 270;
    const cx2 = cx * scaleX, cy2 = cy * scaleY;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const dx = clientX - rect.left - cx2;
    const dy = clientY - rect.top - cy2;
    let a = Math.atan2(-dy, dx) * (180 / Math.PI);
    // Clamp to [0, 180] with small epsilon to avoid exact 0/180 invisibility
    a = Math.max(0.5, Math.min(179.5, a));
    onChange(Math.max(0, Math.min(total - 1, Math.round((180 - a) / anglePer))));
  }, [total, anglePer, onChange, cx, cy]);

  // Arc path: top semicircle. sweep-flag=0 for counterclockwise in SVG = goes through top
  const arcPath = (r: number) => {
    const x1 = cx + r, y1 = cy;          // right point
    const x2 = cx - r, y2 = cy;          // left point
    return `M ${x1} ${y1} A ${r} ${r} 0 0 0 ${x2} ${y2}`;  // sweep=0 → top
  };

  return (
    <div className="gauge-card p-5 select-none" onMouseDown={handleMove} onTouchStart={handleMove}>
      <div className="font-orb text-center mb-2" style={{ fontSize: "0.85rem", fontWeight: 600, letterSpacing: "0.12em", color: "rgba(125,211,252,0.55)", textTransform: "uppercase", textShadow: "0 0 10px rgba(125,211,252,0.15)" }}>
        {useI18n().t("seasonDial")}
      </div>
      <svg ref={svgRef} viewBox="0 0 600 270" className="w-full" style={{ cursor: "pointer" }}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="50%" stopColor="#facc15" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {/* Outer glow ring */}
        <path d={arcPath(R + 8)} fill="none" stroke="rgba(125,211,252,0.08)" strokeWidth="2" filter="url(#glow)" />
        {/* Static gradient arc (top semicircle) */}
        <path d={arcPath(R)} fill="none" stroke="url(#gaugeGrad)" strokeWidth="14" strokeLinecap="round" opacity="0.85" />
        {/* Inner dim track */}
        <path d={arcPath(R)} fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="8" strokeLinecap="round" opacity="0.5" />
        {/* Inner glow ring */}
        <path d={arcPath(R - 16)} fill="none" stroke="rgba(125,211,252,0.06)" strokeWidth="1.5" filter="url(#glow)" />
        {/* Ticks + every-5 labels */}
        {Array.from({ length: total }, (_, i) => {
          const a = (180 - i * anglePer) * Math.PI / 180;
          const x1 = cx + (R - 10) * Math.cos(a), y1 = cy - (R - 10) * Math.sin(a);
          const x2 = cx + R * Math.cos(a), y2 = cy - R * Math.sin(a);
          const isMajor = i % 5 === 0 || i === total - 1;
          const isCurrent = i === idx;
          const lblX = cx + (R - 30) * Math.cos(a), lblY = cy - (R - 30) * Math.sin(a);
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={isCurrent ? "#fff" : isMajor ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)"}
                strokeWidth={isCurrent ? 2.5 : isMajor ? 1.5 : 0.8} />
              {isMajor && (
                <text x={lblX} y={lblY + 3} fill={isCurrent ? "#fff" : "rgba(255,255,255,0.35)"}
                  fontSize="10" fontFamily="Orbitron" textAnchor="middle">{i}</text>
              )}
            </g>
          );
        })}
        {/* Needle with animated gradient */}
        <line x1={cx} y1={cy}
          x2={cx + (R - 35) * Math.cos(needleAngle * Math.PI / 180)}
          y2={cy - (R - 35) * Math.sin(needleAngle * Math.PI / 180)}
          className="needle-line" strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="10" fill="rgba(0,0,0,0.85)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r="5" className="needle-center" fill="currentColor" style={{ color }} />
      </svg>
    </div>
  );
}

// ── Enemy Row ──
function EnemyRow({ name, level, hp, spd, tough, effRes, qty, changePct }: {
  name: string; level: number; hp: number; spd: number; tough: number; effRes: number; qty: number; changePct: number | null;
}) {
  return (
    <div className="enemy-row flex items-center gap-3 px-4 py-2 text-[15px] border-b border-white/[0.04] last:border-0">
      <span className="flex-1 min-w-0 truncate text-sky-200/85 text-[14px]">{name}</span>
      <span className="w-16 text-right text-amber-400 font-code text-[13px]" style={{ textShadow: "0 0 6px rgba(250,204,21,0.3)" }}>Lv.{level}</span>
      <span className="w-36 text-right text-amber-300/75 font-math text-[15px]">{fmt(hp)}{qty > 1 ? ` x${qty}` : ""}</span>
      <span className="w-20 text-right text-white/20 font-code text-[13px]">{spd}</span>
      <span className="w-24 text-right text-white/20 font-code text-[13px]">{tough}</span>
      <span className="w-20 text-right text-white/18 font-code text-[13px]">{Math.round(effRes * 100)}%</span>
      <span className={`w-28 text-right font-orb font-bold text-[18px] ${changePct !== null && changePct > 0 ? "text-red-400" : changePct !== null ? "text-green-400/70" : "text-white/10"}`}
        style={changePct !== null ? { textShadow: changePct > 0 ? "0 0 8px rgba(248,113,113,0.4)" : "0 0 8px rgba(74,222,128,0.3)" } : {}}>
        {changePct !== null ? (changePct >= 0 ? "+" : "") + changePct.toFixed(1) + "%" : "—"}
      </span>
    </div>
  );
}

// ── Node Card ──
function NodeCard({ level, compare }: { level: LevelDetail; compare: ComparisonEntry[] }) {
  const [on, setOn] = useState(true);
  const { t, tr } = useI18n();
  const waves = new Map<number, typeof level.enemies>();
  level.enemies.forEach(e => { const l = waves.get(e.wave_num) || []; l.push(e); waves.set(e.wave_num, l); });
  return (
    <div className={`glass-card p-5 ${level.is_starward ? "border-purple-500/15" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h4 className="font-orb font-semibold text-[17px]" style={{ letterSpacing: "0.04em" }}>{tr(level.name)}</h4>
          {level.is_starward && <span className="font-orb text-[11px] px-2 py-0.5 rounded bg-purple-500/12 text-purple-300">SW</span>}
        </div>
        <span className="font-math text-[14px] text-sky-300/55">HP {fmt(level.total_hp)}</span>
      </div>
      <button onClick={() => setOn(!on)} className="font-orb text-[13px] text-sky-400/55 hover:text-sky-300">{on ? `▼ ${t("collapse")}` : `▶ ${level.enemies.length} ${t("enemies")}`}</button>
      {on && <div className="mt-2">{Array.from(waves.entries()).sort(([a],[b])=>a-b).map(([wn,ens])=>(
        <div key={wn} className="mb-2">
          <div className="font-orb text-[12px] text-white/20 px-4 mb-1">{t("wave")} {wn}</div>
          {ens.map((e,i)=>{const cmp=compare.find(c=>c.monster_name===e.name&&c.category===level.category);return <EnemyRow key={i} name={tr(e.name)} level={e.level} hp={e.hp} spd={e.speed} tough={e.toughness} effRes={e.effect_res} qty={e.quantity} changePct={cmp?.hp_change_pct??null}/>;})}
        </div>
      ))}</div>}
    </div>
  );
}

// ── Display Screen ──
function DisplayScreen({ name, hp }: { name: string; hp: number }) {
  const { t, tr } = useI18n();
  return (
    <div className="display-screen p-5 flex justify-between items-center">
      <div>
        <div className="font-orb text-[12px] text-emerald-400/50 tracking-[0.1em] uppercase mb-1">{t("currentSeason")}</div>
        <div className="font-orb text-[18px] tracking-wider text-white/90">{tr(name)}</div>
      </div>
      <div className="text-right">
        <div className="font-orb text-[12px] text-emerald-400/50 tracking-[0.1em] uppercase mb-1">{t("totalHP")}</div>
        <div className="flex items-baseline justify-end gap-2">
          <span className="font-orb text-[30px] font-bold text-emerald-300 tracking-wider" style={{ textShadow: "0 0 12px rgba(74,222,128,0.4)" }}>{fmt(hp)}</span>
          <span className="font-orb text-[14px] text-emerald-400/50">({fmtFull(hp)})</span>
        </div>
      </div>
    </div>
  );
}

// ── Chart Panel ──
function ChartPanel({ chartData, color, idx }: {
  chartData: ChartDataPoint[]; color: string; idx: number;
}) {
  const { t, tr } = useI18n();
  const fit = computeExpFit(chartData);
  if (chartData.length < 1) return <div className="glass-card p-12 text-center text-white/15 font-orb">{t("noData")}</div>;

  // Combined data: actual + prediction with null gap
  const combined: any[] = chartData.map((d, i) => ({
    season_name: tr(d.season_name),
    actual: d.total_hp,
    fit: fit ? fit.A * Math.exp(fit.B * (i + 1)) : null,
    pred: null,
  }));

  // Prediction segment: bridge point + 3 predictions
  if (fit && chartData.length > 0) {
    const lastIdx = chartData.length;
    const last = chartData[chartData.length - 1];
    // Bridge: same season, actual=null, pred=last actual value
    combined.push({
      season_name: last.season_name,
      actual: null,
      fit: null,
      pred: last.total_hp,  // bridge point
    });
    fit.preds.forEach((p) => {
      combined.push({
        season_name: p.season,
        actual: null,
        fit: null,
        pred: p.hp,
      });
    });
  }

  const refName = chartData[idx]?.season_name;
  const lastActualName = chartData[chartData.length - 1]?.season_name;

  return (
    <div className="space-y-5">
      <div className="font-orb text-center" style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "0.12em", color: "rgba(125,211,252,0.8)", textTransform: "uppercase", textShadow: "0 0 12px rgba(125,211,252,0.25)" }}>
        {useI18n().t("totalHPTrend")}
      </div>
      <div className="glass-card p-5">
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={combined} margin={{ top: 5, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
            <XAxis dataKey="season_name" angle={-35} textAnchor="end" tick={{ fill: "#64748b", fontSize: 9 }} height={70} interval="preserveStartEnd" />
            <YAxis tickFormatter={fmt} tick={{ fill: "#64748b", fontSize: 9 }} stroke="rgba(255,255,255,0.04)" />
            <Tooltip contentStyle={{ background: "rgba(8,8,26,0.97)", border: "1px solid rgba(125,211,252,0.2)", borderRadius: "8px", color: "#cdd3de", fontSize: 12 }} formatter={(v: number) => [fmt(v), "HP"]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {/* Vertical line at current selection */}
            {refName && <ReferenceLine x={refName} stroke={color} strokeWidth={1.5} strokeDasharray="4 4" />}
            {/* Boundary between actual and prediction */}
            {lastActualName && <ReferenceLine x={lastActualName} stroke="rgba(250,204,21,0.3)" strokeWidth={1} strokeDasharray="2 4" label={{ value: "PREDICT →", fill: "rgba(250,204,21,0.4)", fontSize: 9, position: "top" }} />}
            {/* Actual data: solid line */}
            <Line type="monotone" dataKey="actual" stroke={color} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} name="Actual HP" isAnimationActive={false} connectNulls={false} />
            {/* Fit curve: dashed yellow */}
            <Line type="monotone" dataKey="fit" stroke="#facc15" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Exp Fit" isAnimationActive={false} connectNulls={false} />
            {/* Prediction: dashed color line with dots */}
            <Line type="monotone" dataKey="pred" stroke={color} strokeWidth={1.5} strokeDasharray="3 4" dot={{ r: 3, fill: color, stroke: color }} name="Prediction" isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Display screen */}
      {chartData[idx] && <DisplayScreen name={chartData[idx].season_name} hp={chartData[idx].total_hp} />}

      {/* Analysis table */}
      {fit && (
        <div className="analysis-card">
          <div className="font-orb px-5 py-4 border-b border-white/5 text-center" style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "0.14em", color: "rgba(125,211,252,0.7)", textTransform: "uppercase", textShadow: "0 0 10px rgba(125,211,252,0.15)" }}>
            {t("predictiveAnalysis")}
          </div>
          <table className="data-table w-full">
            <thead>
              <tr><th>{t("metric")}</th><th>{t("value")}</th><th>{t("metric")}</th><th>{t("value")}</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("formula")}</td>
                <td className="font-math font-bold text-amber-300/85 text-[15px]">{fit.formula}</td>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("r2")}</td>
                <td className="font-math text-white/70 text-[15px]">{fit.r2.toFixed(4)}</td>
              </tr>
              <tr>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("inflation3")}</td>
                <td className="font-orb font-bold text-[20px]" style={{ color: fit.inf3 > 0 ? "#f87171" : "#4ade80", textShadow: fit.inf3 > 0 ? "0 0 10px rgba(248,113,113,0.4)" : "0 0 10px rgba(74,222,128,0.3)" }}>{(fit.inf3 >= 0 ? "+" : "") + fit.inf3.toFixed(1)}%</td>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("inflation5")}</td>
                <td className="font-orb font-bold text-[20px]" style={{ color: fit.inf5 > 0 ? "#f87171" : "#4ade80", textShadow: fit.inf5 > 0 ? "0 0 10px rgba(248,113,113,0.4)" : "0 0 10px rgba(74,222,128,0.3)" }}>{(fit.inf5 >= 0 ? "+" : "") + fit.inf5.toFixed(1)}%</td>
              </tr>
              <tr>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("pred1")}</td>
                <td className="font-math font-bold text-amber-300/70 text-[15px]">{fmt(fit.preds[0].hp)} <span className="font-code text-[12px] text-amber-300/30">({fmtFull(fit.preds[0].hp)})</span></td>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("pred2")}</td>
                <td className="font-math font-bold text-amber-300/70 text-[15px]">{fmt(fit.preds[1].hp)} <span className="font-code text-[12px] text-amber-300/30">({fmtFull(fit.preds[1].hp)})</span></td>
              </tr>
              <tr>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("pred3")}</td>
                <td className="font-math font-bold text-amber-300/70 text-[15px]">{fmt(fit.preds[2].hp)} <span className="font-code text-[12px] text-amber-300/30">({fmtFull(fit.preds[2].hp)})</span></td>
                <td></td><td></td>
              </tr>
              <GrowthRows windows={fit.growthWindows} fontSize="1.4rem" />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── AA Charts with individual exp fit ──
function AACharts({ chartData }: { chartData: ChartDataPoint[] }) {
  const { t, tr } = useI18n();
  if (chartData.length < 1) return <div className="glass-card p-12 text-center text-white/15 font-orb text-[16px]">{t("noData")}</div>;
  const series = [
    { k: "knights_hp" as const, l: "Knights I+II+III", c: "#4ade80" },
    { k: "kic_hp" as const, l: "King in Check", c: "#facc15" },
    { k: "kicp_hp" as const, l: "King in Check: Plight", c: "#f87171" },
  ];
  return (
    <div className="space-y-6">
      <div className="font-orb text-center" style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "0.12em", color: "rgba(125,211,252,0.8)", textTransform: "uppercase", textShadow: "0 0 12px rgba(125,211,252,0.25)" }}>
        {t("aaBreakdown")}
      </div>
      {series.map(({ k, l, c }) => {
        // Convert AA data to ChartDataPoint format for fit
        const fitData: ChartDataPoint[] = chartData.map(d => ({ ...d, total_hp: (d[k] as number) || 0 }));
        const fit = computeExpFit(fitData);
        const combined: any[] = fitData.map((d, i) => ({ season_name: tr(d.season_name), actual: d.total_hp, fit: fit ? fit.A * Math.exp(fit.B * (i + 1)) : null, pred: null }));
        if (fit && fitData.length > 0) {
          const last = fitData[fitData.length - 1];
          combined.push({ season_name: last.season_name, actual: null, fit: null, pred: last.total_hp });
          fit.preds.forEach(p => combined.push({ season_name: p.season, actual: null, fit: null, pred: p.hp }));
        }
        return (
          <div key={k} className="space-y-3">
            <div className="glass-card p-4">
              <div className="font-orb text-center mb-2" style={{ fontSize: "0.95rem", fontWeight: 600, color: c, textShadow: `0 0 10px ${c}33` }}>{l}</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={combined} margin={{ top: 5, right: 20, left: 15, bottom: 45 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="season_name" angle={-35} textAnchor="end" tick={{ fill: "#64748b", fontSize: 10 }} height={55} />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#64748b", fontSize: 10 }} stroke="rgba(255,255,255,0.04)" />
                  <Tooltip contentStyle={{ background: "rgba(8,8,26,0.97)", border: "1px solid rgba(125,211,252,0.2)", borderRadius: "8px", color: "#cdd3de", fontSize: 13 }} formatter={(v: number) => [fmt(v), l]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="actual" stroke={c} strokeWidth={2} dot={{ r: 2 }} name="Actual" isAnimationActive={false} connectNulls={false} />
                  {fit && <Line type="monotone" dataKey="fit" stroke="#facc15" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Exp Fit" isAnimationActive={false} connectNulls={false} />}
                  {fit && <Line type="monotone" dataKey="pred" stroke={c} strokeWidth={1.5} strokeDasharray="3 4" dot={{ r: 3, fill: c }} name="Prediction" isAnimationActive={false} connectNulls={false} />}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {fit && (
              <div className="analysis-card">
                <div className="font-orb px-5 py-3 border-b border-white/5 text-center" style={{ fontSize: "0.85rem", fontWeight: 600, letterSpacing: "0.12em", color: "rgba(125,211,252,0.6)", textTransform: "uppercase" }}>{tr(l)} · {t("analysis")}</div>
                <table className="data-table w-full">
                  <thead><tr><th>{t("metric")}</th><th>{t("value")}</th><th>{t("metric")}</th><th>{t("value")}</th></tr></thead>
                  <tbody>
                    <tr>
                      <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("formula")}</td>
                      <td className="font-math font-bold text-amber-300/85 text-[14px]">{fit.formula}</td>
                      <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("r2")}</td>
                      <td className="font-math text-white/70 text-[14px]">{fit.r2.toFixed(4)}</td>
                    </tr>
                    <tr>
                      <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("inflation3")}</td>
                      <td className="font-orb font-bold text-[18px]" style={{ color: fit.inf3 > 0 ? "#f87171" : "#4ade80", textShadow: fit.inf3 > 0 ? "0 0 10px rgba(248,113,113,0.4)" : "0 0 10px rgba(74,222,128,0.3)" }}>{(fit.inf3 >= 0 ? "+" : "") + fit.inf3.toFixed(1)}%</td>
                      <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("inflation5")}</td>
                      <td className="font-orb font-bold text-[18px]" style={{ color: fit.inf5 > 0 ? "#f87171" : "#4ade80", textShadow: fit.inf5 > 0 ? "0 0 10px rgba(248,113,113,0.4)" : "0 0 10px rgba(74,222,128,0.3)" }}>{(fit.inf5 >= 0 ? "+" : "") + fit.inf5.toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("pred1")}</td>
                      <td className="font-math font-bold text-amber-300/70 text-[14px]">{fmt(fit.preds[0].hp)}</td>
                      <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("pred2")}</td>
                      <td className="font-math font-bold text-amber-300/70 text-[14px]">{fmt(fit.preds[1].hp)}</td>
                    </tr>
                    <GrowthRows windows={fit.growthWindows} fontSize="1.2rem" />
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── App ──
export default function App() {
  const [modes, setModes] = useState<ModeInfo[]>([]);
  const [activeMode, setActiveMode] = useState("forgotten_hall");
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [gaugeIdx, setGaugeIdx] = useState(0);
  const [detail, setDetail] = useState<SeasonDetail | null>(null);
  const [compare, setCompare] = useState<ComparisonEntry[]>([]);
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("sr-lang") as Lang) || "en");
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const color = MODE_COLORS[activeMode] || "#7dd3fc";
  const isAA = activeMode === "anomaly_arbitration";

  const tr = useCallback((text: string) => {
    if (lang === "en" || !text) return text;
    return translations[text] || text;
  }, [lang, translations]);

  const t = useCallback((key: keyof typeof UI_TEXT["en"]) => UI_TEXT[lang][key] || UI_TEXT.en[key], [lang]);

  useEffect(() => { getModes().then(setModes); }, []);
  useEffect(() => { getTranslations().then(setTranslations).catch(() => {}); }, []);
  useEffect(() => {
    setDetail(null); setCompare([]); setGaugeIdx(0);
    Promise.all([getSeasons(activeMode), getChartData(activeMode)]).then(([s, c]) => { setSeasons(s); setChartData(c); setGaugeIdx(s.length - 1); });
  }, [activeMode]);

  const toggleLang = () => {
    const newLang = lang === "en" ? "zh" : "en";
    setLang(newLang);
    localStorage.setItem("sr-lang", newLang);
  };

  const loadSeason = async (idx: number) => {
    setGaugeIdx(idx);
    if (!seasons[idx]) return;
    const d = await getSeasonDetail(seasons[idx].id);
    setDetail(d);
    try { setCompare(await getComparison(activeMode, seasons[idx].id)); } catch { setCompare([]); }
  };

  // Auto-load season detail when seasons change (e.g. after mode switch)
  useEffect(() => {
    if (seasons.length > 0 && gaugeIdx >= 0 && gaugeIdx < seasons.length) {
      loadSeason(gaugeIdx);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasons]);

  return (
    <I18nContext.Provider value={{ lang, t, tr }}>
    <div className="app-container">
      <Sidebar modes={modes} active={activeMode} onMode={setActiveMode}
        seasons={seasons} selIdx={gaugeIdx} onSeason={loadSeason} color={color} />
      <main className="main-content">
        {/* Language toggle */}
        <button onClick={toggleLang} className="lang-toggle font-orb" title="Switch Language">
          {t("switchLang")}
        </button>
        {/* Title */}
        <header className="text-center pt-10 pb-6">
          <h1 className="sidebar-title" style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)" }}>
            SR Challenge Stats
          </h1>
          <p className="font-mono mt-2 text-[clamp(0.65rem,1.2vw,0.8rem)] text-white/25 italic">
            — We just define some COOOOOL things. —
          </p>
        </header>

        {/* Wide layout: Gauge left, Detail right - full width, no max cap */}
        <div className="flex flex-col lg:flex-row gap-6 mb-10">
          {/* Left: Gauge + season info */}
          <div className="lg:w-[640px] shrink-0">
            <Gauge total={seasons.length} idx={gaugeIdx} onChange={loadSeason} color={color} />
            {detail && (
              <div className="mt-4 glass-card p-6 flex flex-col justify-center min-h-[180px]">
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <h3 className="font-orb font-bold text-xl" style={{ letterSpacing: "0.06em" }}>{tr(detail.name)}</h3>
                  {detail.has_starward && <span className="font-orb text-[11px] px-2.5 py-1 rounded bg-purple-500/15 text-purple-300 tracking-wider">{lang === "zh" ? "星启" : "STARWARD"}</span>}
                </div>
                <div className="flex gap-3 mt-1 flex-wrap mb-4">
                  <span className="font-code text-[13px] text-white/35 bg-white/[0.04] px-3 py-1.5 rounded font-math">HP {fmt(detail.total_hp_all)}</span>
                  <span className="font-code text-[13px] text-white/35 bg-white/[0.04] px-3 py-1.5 rounded">{detail.levels.length} {t("nodes")}</span>
                </div>
                {(() => {
                  const buffDesc = detail.season_buffs?.[0]?.desc || detail.levels?.[0]?.buff_desc;
                  return buffDesc ? (
                    <div className="mt-auto p-4 rounded-lg bg-white/[0.03] border border-white/[0.04] font-orb text-[14px] text-white/40 leading-relaxed text-center tracking-wide" style={{ textShadow: "0 0 8px rgba(125,211,252,0.08)" }}>
                      {tr(buffDesc)}
                    </div>
                  ) : null;
                })()}
              </div>
            )}
          </div>
          {/* Right: Node cards - fixed height matching gauge, scrollable */}
          <div className="flex-1 min-w-0">
            <div className="detail-scroll space-y-3 lg:h-[500px] lg:overflow-y-auto">
              {detail ? (
                detail.levels.map(lv => <NodeCard key={lv.id} level={lv} compare={compare} />)
              ) : (
                <div className="glass-card p-12 text-center text-white/12 font-orb text-[14px]">{t("selectSeason")}</div>
              )}
            </div>
          </div>
        </div>

        {/* Charts: full width */}
        <div>
          {isAA ? <AACharts chartData={chartData} /> : <ChartPanel chartData={chartData} color={color} idx={gaugeIdx} />}
        </div>

        <footer className="text-center pt-12 pb-4 text-[9px] text-white/8 font-orb">Huroka.com · Honkai: Star Rail &copy; HoYoverse</footer>
      </main>
    </div>
    </I18nContext.Provider>
  );
}
