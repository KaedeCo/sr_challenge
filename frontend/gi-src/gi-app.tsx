import React, { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import type { ModeInfo, SeasonSummary, SeasonDetail, ChartDataPoint, ComparisonEntry, LevelDetail, EnemyData } from "./gi-types";
import { MODE_COLORS, MODE_NAMES } from "./gi-types";
import { getModes, getSeasons, getSeasonDetail, getChartData, getComparison } from "./gi-api";

// ── i18n ──
type Lang = "en" | "zh";
const UI_TEXT: Record<Lang, Record<string, string>> = {
  en: {
    seasonDial: "Season Dial",
    totalHPTrend: "Total HP · Exponential Trend",
    predictiveAnalysis: "Predictive Analysis",
    currentSeason: "Current Season",
    totalHP: "Total HP",
    collapse: "Collapse",
    enemies: "enemies",
    wave: "WAVE",
    nodes: "Nodes",
    selectSeason: "Select a season",
    noData: "No data",
    analysis: "ANALYSIS",
    switchLang: "中文",
    metric: "Metric",
    value: "Value",
    formula: "Formula",
    r2: "R²",
    pred1: "Pred +1",
    pred2: "Pred +2",
    pred3: "Pred +3",
    inflation3: "3-Season",
    inflation5: "5-Season",
    minDPS: "Min DPS",
    modeTitle: "GI Challenge Stats",
  },
  zh: {
    seasonDial: "赛季表盘",
    totalHPTrend: "总血量 · 指数趋势",
    predictiveAnalysis: "预测分析",
    currentSeason: "当前赛季",
    totalHP: "总血量",
    collapse: "收起",
    enemies: "个敌人",
    wave: "波次",
    nodes: "节点",
    selectSeason: "选择一个赛季",
    noData: "无数据",
    analysis: "分析",
    switchLang: "EN",
    metric: "指标",
    value: "数值",
    formula: "公式",
    r2: "决定系数 R²",
    pred1: "接下来1期",
    pred2: "接下来2期",
    pred3: "接下来3期",
    inflation3: "近3期",
    inflation5: "近5期",
    minDPS: "最低DPS",
    modeTitle: "GI Challenge Stats",
  },
};

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}
function fmtFull(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// ── i18n Context ──
const I18nContext = React.createContext<{ lang: Lang; t: (k: string) => string; tr: (en: string, zh: string) => string }>({ lang: "zh", t: (k) => k, tr: (en, zh) => zh || en });
const useI18n = () => React.useContext(I18nContext);

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
  function growthStats(startIdx: number, endIdx: number) {
    const fh = pts[startIdx].y, lh = pts[endIdx].y;
    const span = endIdx - startIdx;
    if (fh <= 0 || span <= 0) return { avgPct: 0, doubling: Infinity };
    const avgPct = (Math.pow(lh / fh, 1 / span) - 1) * 100;
    const doubling = avgPct > 0 ? Math.log(2) / Math.log(1 + avgPct / 100) : Infinity;
    return { avgPct, doubling };
  }
  const growthWindows = [
    { label: "LAST 5", ...growthStats(Math.max(0, n - 5), n - 1) },
    { label: "LAST 10", ...growthStats(Math.max(0, n - 10), n - 1) },
    { label: "ALL TIME", ...growthStats(0, n - 1) },
  ];
  return { A, B, formula: `y = ${A.toFixed(0)} · e^(${B.toFixed(4)}·x)`, r2, inf3, inf5, preds, growthWindows };
}

// ── Sidebar ──
function Sidebar({ modes, active, onMode, seasons, selIdx, onSeason, color }: {
  modes: ModeInfo[]; active: string; onMode: (k: string) => void;
  seasons: SeasonSummary[]; selIdx: number; onSeason: (i: number) => void; color: string;
}) {
  const { lang, tr } = useI18n();
  return (
    <div className="sidebar-fixed">
      <div className="sidebar-header">
        <div className="sidebar-title">GI Challenge</div>
        <div className="sidebar-subtitle">— From the Moon to Teyvat —</div>
      </div>
      <div className="sidebar-tabs">
        {modes.map(m => {
          const isA = m.key === active;
          const c = MODE_COLORS[m.key] || "#6366f1";
          return (
            <button key={m.key} onClick={() => onMode(m.key)}
              className="clip-tab w-full text-left"
              style={{ background: isA ? `${c}1a` : "rgba(255,255,255,0.03)", color: isA ? c : "#8894a8" }}>
              {lang === "zh" ? MODE_NAMES[m.key]?.zh || m.name_zh : m.name_en}
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
              className={`season-list-item ${isA ? "active" : ""}`}
              style={isA ? { borderLeftColor: color, color } : {}}>
              {seasons.length - i}. {tr(s.name, s.name_zh)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Gauge ──
function Gauge({ total, idx, onChange, color }: {
  total: number; idx: number; onChange: (i: number) => void; color: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const cx = 300, cy = 220, R = 200;
  const anglePer = total > 1 ? 180 / (total - 1) : 180;
  const clampedIdx = Math.max(0, Math.min(total - 1, idx));
  const needleAngle = total > 1 ? 180 - clampedIdx * anglePer : 90;

  const handleMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width / 600, scaleY = rect.height / 270;
    const cx2 = cx * scaleX, cy2 = cy * scaleY;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const dx = clientX - rect.left - cx2, dy = clientY - rect.top - cy2;
    let a = Math.atan2(-dy, dx) * (180 / Math.PI);
    a = Math.max(0.5, Math.min(179.5, a));
    onChange(Math.max(0, Math.min(total - 1, Math.round((180 - a) / anglePer))));
  }, [total, anglePer, onChange]);

  const arcPath = (r: number) => {
    const x1 = cx + r, y1 = cy, x2 = cx - r, y2 = cy;
    return `M ${x1} ${y1} A ${r} ${r} 0 0 0 ${x2} ${y2}`;
  };

  return (
    <div className="gauge-card p-5 select-none" onMouseDown={handleMove} onTouchStart={handleMove}>
      <div className="font-orb text-center mb-2" style={{ fontSize: "0.85rem", fontWeight: 600, letterSpacing: "0.12em", color: "rgba(125,211,252,0.55)", textTransform: "uppercase", textShadow: "0 0 10px rgba(125,211,252,0.15)" }}>
        {useI18n().t("seasonDial")}
      </div>
      <svg ref={svgRef} viewBox="0 0 600 270" className="w-full" style={{ cursor: "pointer" }}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" /><stop offset="50%" stopColor="#facc15" /><stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <path d={arcPath(R + 8)} fill="none" stroke="rgba(125,211,252,0.08)" strokeWidth="2" />
        <path d={arcPath(R)} fill="none" stroke="url(#gaugeGrad)" strokeWidth="14" strokeLinecap="round" opacity="0.85" />
        {Array.from({ length: total }, (_, i) => {
          const a = (180 - i * anglePer) * Math.PI / 180;
          const x1 = cx + (R - 10) * Math.cos(a), y1 = cy - (R - 10) * Math.sin(a);
          const x2 = cx + R * Math.cos(a), y2 = cy - R * Math.sin(a);
          const isMajor = i % 5 === 0 || i === total - 1;
          const isCurrent = i === idx;
          const lblX = cx + (R - 30) * Math.cos(a), lblY = cy - (R - 30) * Math.sin(a);
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isCurrent ? "#fff" : isMajor ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)"} strokeWidth={isCurrent ? 2.5 : isMajor ? 1.5 : 0.8} />
              {isMajor && <text x={lblX} y={lblY + 3} fill={isCurrent ? "#fff" : "rgba(255,255,255,0.35)"} fontSize="10" fontFamily="Orbitron" textAnchor="middle">{i}</text>}
            </g>
          );
        })}
        <line x1={cx} y1={cy} x2={cx + (R - 35) * Math.cos(needleAngle * Math.PI / 180)} y2={cy - (R - 35) * Math.sin(needleAngle * Math.PI / 180)} className="needle-line" strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="10" fill="rgba(0,0,0,0.85)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r="5" className="needle-center" fill="currentColor" style={{ color }} />
      </svg>
    </div>
  );
}

// ── How It Works Modal ──
function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [curves, setCurves] = useState<any>(null);
  const [tab, setTab] = useState<"hp" | "atk" | "def">("hp");
  const { lang, t } = useI18n();

  useEffect(() => {
    if (open && !curves) {
      fetch("/sr/gi-challenge/curves.json")
        .then(r => r.json())
        .then(setCurves);
    }
  }, [open]);

  if (!open) return null;

  const curveColors = ["#7dd3fc", "#c084fc", "#fbbf24"];

  const chartData: any[] = [];
  if (curves) {
    const maxLen = Math.max(
      ...Object.values(curves).map((c: any) => c.points.length)
    );
    for (let i = 0; i < maxLen; i++) {
      const pt: any = { lv: i + 1 };
      Object.entries(curves).forEach(([key, curve]: [string, any]) => {
        const name = curve.name || key;
        if (i < curve.points.length) {
          pt[`${name}_${tab}`] = curve.points[i][tab];
        }
      });
      chartData.push(pt);
    }
  }

  const isZh = lang === "zh";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative glass-card w-full max-w-[860px] max-h-[88vh] overflow-y-auto p-10" onClick={e => e.stopPropagation()}>
        {/* Close button - always visible */}
        <button onClick={onClose}
          className="absolute top-5 right-5 w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/80 font-orb text-lg flex items-center justify-center transition-all z-10"
          title={isZh ? "关闭" : "Close"}>
          ✕
        </button>

        {/* ===== Title ===== */}
        <h2 className="font-orb text-[28px] font-bold text-center mb-1" style={{
          background: "linear-gradient(135deg, #7dd3fc, #c084fc)",
          WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent",
          textShadow: "0 0 30px rgba(125,211,252,0.2)",
        }}>
          {isZh ? "计算说明" : "How does it count?"}
        </h2>
        <p className="text-center text-white/25 text-[13px] font-orb mb-10">
          {isZh ? "深渊怪物 HP / ATK / DEF 计算公式全解" : "Spiral Abyss HP / ATK / DEF formula explained"}
        </p>

        {/* ===== Section 1: Three Factors ===== */}
        <div className="mb-10">
          <h3 className="font-orb text-[16px] text-sky-300/70 mb-4 text-center">
            {isZh ? "怪物属性由三个因素共同决定" : "Enemy stats are determined by three factors"}
          </h3>
          <div className="flex flex-wrap gap-4 justify-center">
            <div className="flex flex-col items-center gap-2 px-6 py-4 rounded-xl bg-sky-500/8 border border-sky-500/15" style={{ minWidth: "200px" }}>
              <span className="font-orb text-[20px] font-bold text-sky-300">①</span>
              <span className="font-orb text-[14px] text-sky-200/80 text-center">
                {isZh ? "成长曲线" : "Growth Curve"}
              </span>
              <span className="text-[11px] text-sky-300/40 text-center">
                {isZh ? "按等级查表，3种类型" : "Lookup by level, 3 types"}
              </span>
            </div>
            <div className="flex flex-col items-center gap-2 px-6 py-4 rounded-xl bg-purple-500/8 border border-purple-500/15" style={{ minWidth: "200px" }}>
              <span className="font-orb text-[20px] font-bold text-purple-300">②</span>
              <span className="font-orb text-[14px] text-purple-200/80 text-center">
                {isZh ? "怪物基础倍率" : "Enemy Base Multiplier"}
              </span>
              <span className="text-[11px] text-purple-300/40 text-center">
                {isZh ? "每个怪物独有" : "Unique per monster"}
              </span>
            </div>
            <div className="flex flex-col items-center gap-2 px-6 py-4 rounded-xl bg-amber-500/8 border border-amber-500/15" style={{ minWidth: "200px" }}>
              <span className="font-orb text-[20px] font-bold text-amber-300">③</span>
              <span className="font-orb text-[14px] text-amber-200/80 text-center">
                {isZh ? "深渊血量系数" : "Abyss HP Coefficient"}
              </span>
              <span className="text-[11px] text-amber-300/40 text-center">
                {isZh ? "随版本变化" : "Changes per version"}
              </span>
            </div>
          </div>
        </div>

        {/* ===== Section 2: Formula ===== */}
        <div className="mb-10">
          <h3 className="font-orb text-[16px] text-sky-300/70 mb-5 text-center">
            {isZh ? "计算公式" : "Formula"}
          </h3>
          <div className="bg-white/[0.03] rounded-2xl p-8 space-y-5">
            {/* HP formula */}
            <div className="font-orb text-[18px] text-center leading-loose tracking-wide">
              <span style={{ color: "#fbbf24", fontWeight: 700 }}>HP</span>
              <span className="text-white/30 mx-3">=</span>
              <span style={{ color: "#7dd3fc" }}>
                {isZh ? "成长曲线[等级][曲线类型]" : "GrowthCurve[Lv][Type]"}
              </span>
              <span className="text-white/30 mx-3">×</span>
              <span style={{ color: "#c084fc" }}>
                {isZh ? "怪物基础HP" : "EnemyBaseHP"}
              </span>
              <span className="text-white/30 mx-3">×</span>
              <span style={{ color: "#f59e0b" }}>
                {isZh ? "深渊系数" : "AbyssCoeff"}
              </span>
            </div>
            {/* ATK formula */}
            <div className="font-orb text-[16px] text-center leading-loose tracking-wide">
              <span style={{ color: "#fbbf24", fontWeight: 700 }}>ATK</span>
              <span className="text-white/30 mx-3">=</span>
              <span style={{ color: "#7dd3fc" }}>GrowthCurve[Lv][Type]</span>
              <span className="text-white/30 mx-3">×</span>
              <span style={{ color: "#c084fc" }}>EnemyBaseATK</span>
            </div>
            {/* DEF formula */}
            <div className="font-orb text-[16px] text-center leading-loose tracking-wide">
              <span style={{ color: "#fbbf24", fontWeight: 700 }}>DEF</span>
              <span className="text-white/30 mx-3">=</span>
              <span style={{ color: "#7dd3fc" }}>GrowthCurve[Lv][Type]</span>
              <span className="text-white/30 mx-2 text-[12px]">
                ({isZh ? "DEF 不受倍率影响" : "DEF not affected by multiplier"})
              </span>
            </div>
            {/* Abyss coefficient timeline */}
            <div className="pt-4 border-t border-white/5">
              <p className="text-white/30 text-[12px] font-orb text-center mb-2">
                {isZh ? "深渊血量系数时间线" : "Abyss HP Coefficient Timeline"}
              </p>
              <div className="flex justify-center gap-6 font-orb text-[12px]">
                <span className="text-white/40">1.0 ~ 4.8: <span className="text-amber-300/70">2.5×</span></span>
                <span className="text-white/40">5.0: <span className="text-amber-300/70">3.0×</span></span>
                <span className="text-white/40">5.1+: <span className="text-amber-300/70">3.75×</span></span>
              </div>
            </div>
          </div>
        </div>

        {/* ===== Section 3: Curve Chart ===== */}
        <div className="mb-10">
          <h3 className="font-orb text-[16px] text-sky-300/70 mb-5 text-center">
            {isZh ? "成长曲线图表" : "Growth Curve Chart"}
          </h3>
          {/* Tab switcher */}
          <div className="flex justify-center gap-3 mb-5">
            {(["hp","atk","def"] as const).map(tb => (
              <button key={tb}
                onClick={() => setTab(tb)}
                className={`font-orb text-[13px] px-5 py-2 rounded-full transition-all duration-300 ${
                  tab === tb
                    ? "bg-white/10 text-white border border-white/20"
                    : "text-white/25 hover:text-white/50 border border-transparent"
                }`}>
                {tb.toUpperCase()}
              </button>
            ))}
          </div>
          {/* Chart */}
          {curves && (
            <div className="bg-white/[0.02] rounded-xl p-6">
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="lv" stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 11, fontFamily: 'Orbitron' }}
                    label={{ value: isZh ? "等级" : "Level", position: 'insideBottom', offset: -10, fill: 'rgba(255,255,255,0.3)', fontSize: 12 }} />
                  <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 11, fontFamily: 'Orbitron' }}
                    tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v.toString()} />
                  <Tooltip contentStyle={{ background: 'rgba(8,8,22,0.95)', border: '1px solid rgba(125,211,252,0.2)', borderRadius: 8 }}
                    labelFormatter={lv => `${isZh ? "等级" : "Level"} ${lv}`}
                    formatter={(v: any) => [Number(v).toLocaleString(), '']} />
                  <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'Orbitron', paddingTop: 10 }} />
                  {Object.entries(curves).map(([key, curve]: [string, any], i) => (
                    <Line key={key} type="monotone" dataKey={`${curve.name}_${tab}`}
                      name={curve.name} stroke={curveColors[i]} strokeWidth={2.5}
                      dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              {/* Legend explanation */}
              <div className="flex justify-center gap-6 mt-4 font-orb text-[11px]">
                {curveColors.map((c, i) => (
                  <span key={i} className="flex items-center gap-2 text-white/30">
                    <span style={{ display: "inline-block", width: 12, height: 3, background: c, borderRadius: 2 }} />
                    {["Common Enemy", "Elite Enemy", "Boss"][i]}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ===== Section 4: Worked Example ===== */}
        <div>
          <h3 className="font-orb text-[16px] text-sky-300/70 mb-5 text-center">
            {isZh ? "计算示例" : "Worked Example"}
          </h3>
          <div className="bg-white/[0.03] rounded-2xl p-8">
            <p className="text-white/50 text-[14px] font-orb text-center mb-5">
              {isZh
                ? "坚盾重甲蟹 · HP 倍率 1.3 · 曲线 2 · 等级 98 · 深渊系数 3.75×"
                : "Sternshield Crab · HP multiplier 1.3 · Curve 2 · Level 98 · Abyss 3.75×"}
            </p>
            {/* Step-by-step with colors */}
            <div className="font-orb text-[20px] text-center leading-loose tracking-wide">
              <span style={{ color: "#fbbf24", fontWeight: 700 }}>HP</span>
              <span className="text-white/30 mx-2">=</span>
              <span style={{ color: "#7dd3fc" }}>103,001</span>
              <span className="text-white/30 mx-2">×</span>
              <span style={{ color: "#c084fc" }}>1.3</span>
              <span className="text-white/30 mx-2">×</span>
              <span style={{ color: "#f59e0b" }}>3.75</span>
              <span className="text-white/30 mx-2">=</span>
              <span style={{ color: "#4ade80", fontWeight: 700 }}>502,131</span>
            </div>
            {/* Color legend for the example */}
            <div className="flex justify-center gap-6 mt-6 font-orb text-[11px]">
              <span className="flex items-center gap-2 text-white/30">
                <span style={{ color: "#7dd3fc" }}>●</span>
                {isZh ? "成长曲线值" : "Growth Curve"}
              </span>
              <span className="flex items-center gap-2 text-white/30">
                <span style={{ color: "#c084fc" }}>●</span>
                {isZh ? "怪物倍率" : "Enemy Base"}
              </span>
              <span className="flex items-center gap-2 text-white/30">
                <span style={{ color: "#f59e0b" }}>●</span>
                {isZh ? "深渊系数" : "Abyss Coeff"}
              </span>
              <span className="flex items-center gap-2 text-white/30">
                <span style={{ color: "#4ade80" }}>●</span>
                {isZh ? "最终血量" : "Final HP"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── GI Monster Columns ──
const GI_MONSTER_COLS = [
  { idx: 0, key: "name", label: "Monster", zhLabel: "怪物" },
  { idx: 1, key: "level", label: "Lv", zhLabel: "等级" },
  { idx: 2, key: "hp", label: "HP", zhLabel: "血量" },
  { idx: 3, key: "atk", label: "ATK", zhLabel: "攻击" },
  { idx: 4, key: "def", label: "DEF", zhLabel: "防御" },
  { idx: 5, key: "dps", label: "Min DPS", zhLabel: "最低DPS" },
];

function defaultColFractions(): number[] {
  return [3.0, 0.7, 1.5, 1.0, 0.8, 1.5];
}

function expandedColFractions(expIdx: number): number[] {
  const base = defaultColFractions();
  for (let i = 0; i < base.length; i++) {
    base[i] = i === expIdx ? base[i] * 2.8 : base[i] * 0.45;
  }
  return base;
}

function textVisualWidth(text: string): number {
  let w = 0;
  for (const c of text) {
    const code = c.charCodeAt(0);
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3000 && code <= 0x303F) 
        || (code >= 0xFF00 && code <= 0xFFEF)) w += 2;
    else w += 1;
  }
  return w;
}

// ── Enemy Row (Grid-based, SR style) ──
function EnemyRow({ name, level, hp, atk, def, quantity, dps, gridCols, expandedCol, onCellClick }: {
  name: string; level: number; hp: number; atk: number; def: number;
  quantity: number; dps: number; gridCols: string;
  expandedCol: number | null; onCellClick: (colIdx: number) => void;
}) {
  const cells = [
    <span key={0} className={`monster-cell name-cell ${expandedCol === 0 ? "monster-cell-expanded" : "truncate"}`}
      onClick={() => onCellClick(0)}>
      {name}{quantity > 1 && <span className="ml-1 font-orb font-bold" style={{background:"linear-gradient(135deg,#7dd3fc,#c084fc)",WebkitBackgroundClip:"text",backgroundClip:"text",WebkitTextFillColor:"transparent"}}> x{quantity}</span>}
    </span>,
    <span key={1} className="monster-cell level-cell" onClick={() => onCellClick(1)}>Lv.{level}</span>,
    <span key={2} className="monster-cell hp-cell" onClick={() => onCellClick(2)}>{fmtFull(hp)}</span>,
    <span key={3} className="monster-cell stat-cell" onClick={() => onCellClick(3)}
      style={atk > 0 ? {} : {background:"linear-gradient(135deg,#7dd3fc,#c084fc)",WebkitBackgroundClip:"text",backgroundClip:"text",WebkitTextFillColor:"transparent"}}>
      {atk > 0 ? fmtFull(atk) : "\u2014"}
    </span>,
    <span key={4} className="monster-cell stat-cell" onClick={() => onCellClick(4)}
      style={def > 0 ? {} : {background:"linear-gradient(135deg,#7dd3fc,#c084fc)",WebkitBackgroundClip:"text",backgroundClip:"text",WebkitTextFillColor:"transparent"}}>
      {def > 0 ? fmtFull(def) : "\u2014"}
    </span>,
    <span key={5} className="monster-cell dps-cell" onClick={() => onCellClick(5)}>{fmtFull(dps)}</span>,
  ];

  return (
    <div className="monster-row" style={{ gridTemplateColumns: gridCols }}>
      {cells}
    </div>
  );
}

// ── Node Card ──
function NodeCard({ level }: { level: LevelDetail }) {
  const [on, setOn] = useState(true);
  const [expandedCol, setExpandedCol] = useState<number | null>(null);
  const { lang, t, tr } = useI18n();

  const allNames = level.enemies.map(e => tr(e.name, e.name_zh));
  const maxNameWidth = Math.max(...allNames.map(textVisualWidth), 8);
  const nameFrac = Math.min(4.5, Math.max(2.0, maxNameWidth / 8));
  const baseFractions = [nameFrac, 0.7, 1.5, 1.0, 0.8, 1.5];

  const ef = expandedCol !== null ? expandedColFractions(expandedCol) : baseFractions;
  const gridCols = ef.map(f => `${f}fr`).join(" ");

  const handleCellClick = (colIdx: number) => {
    setExpandedCol(prev => prev === colIdx ? null : colIdx);
  };
  useEffect(() => { if (!on) setExpandedCol(null); }, [on]);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-orb font-semibold text-[17px]" style={{ letterSpacing: "0.04em" }}>
          {tr(level.name, level.name_zh)}
        </h4>
        <span className="font-math text-[14px] text-sky-300/55">HP {fmt(level.total_hp)}</span>
      </div>
      <div className="font-orb text-[12px] text-white/15 mb-2">
        {t("minDPS")} = HP / {level.time_limit}s = <span className="font-orb font-bold text-[16px]" style={{background:"linear-gradient(135deg,#7dd3fc,#c084fc)",WebkitBackgroundClip:"text",backgroundClip:"text",WebkitTextFillColor:"transparent"}}>{fmtFull(level.total_hp / (level.time_limit || 90))}</span>
      </div>
      <button onClick={() => setOn(!on)} className="font-orb text-[13px] text-sky-400/55 hover:text-sky-300">
        {on ? `\u25bc ${t("collapse")}` : `\u25b6 ${level.enemies.length} ${t("enemies")}`}
      </button>
      {on && (
        <div className="mt-2">
          <div className="monster-header" style={{ gridTemplateColumns: gridCols }}>
            {GI_MONSTER_COLS.map(c => (
              <span key={c.idx}
                className={`monster-hcell ${expandedCol === c.idx ? "monster-hcell-active" : ""}`}
                onClick={() => handleCellClick(c.idx)}
                title={expandedCol === c.idx ? undefined : (lang === "zh" ? "\u70B9\u51FB\u5C55\u5F00" : "Click to expand")}>
                {lang === "zh" ? (c.zhLabel || c.label) : c.label}
              </span>
            ))}
          </div>
          {level.enemies.map((e, i) => (
            <EnemyRow key={i}
              name={tr(e.name, e.name_zh)} level={e.level}
              hp={e.hp * e.quantity} atk={e.atk} def={e.def} quantity={e.quantity}
              dps={level.total_hp / (level.time_limit || 90)}
              gridCols={gridCols} expandedCol={expandedCol} onCellClick={handleCellClick} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dedup utility ──
function dedupData(data: ChartDataPoint[]): ChartDataPoint[] {
  const result: ChartDataPoint[] = [];
  for (const d of data) {
    if (result.length === 0 || Math.abs(d.total_hp - result[result.length - 1].total_hp) > 1) {
      result.push(d);
    }
  }
  return result;
}

// ── Chart Panel ──
function ChartPanel({ chartData, color, idx, activeMode }: { chartData: ChartDataPoint[]; color: string; idx: number; activeMode: string }) {
  const { lang, t, tr } = useI18n();
  const [dedup, setDedup] = useState(false);

  const displayData = dedup && activeMode === "tower" ? dedupData(chartData) : chartData;
  const fit = computeExpFit(displayData);
  if (displayData.length < 1) return <div className="glass-card p-12 text-center text-white/15 font-orb">{t("noData")}</div>;

  const combined: any[] = displayData.map((d, i) => ({
    season_name: tr(d.season_name, d.season_name_zh),
    actual: d.total_hp,
    fit: fit ? fit.A * Math.exp(fit.B * (i + 1)) : null,
    pred: null,
  }));
  if (fit && chartData.length > 0) {
    const last = chartData[chartData.length - 1];
    combined.push({ season_name: last.season_name, actual: null, fit: null, pred: last.total_hp });
    fit.preds.forEach(p => combined.push({ season_name: p.season, actual: null, fit: null, pred: p.hp }));
  }

  const refName = displayData[Math.min(idx, displayData.length - 1)]?.season_name;
  const lastActualName = displayData[displayData.length - 1]?.season_name;

  return (
    <div className="space-y-5">
      <div className="font-orb text-center" style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "0.12em", color: "rgba(125,211,252,0.8)", textTransform: "uppercase", textShadow: "0 0 12px rgba(125,211,252,0.25)" }}>
        {t("totalHPTrend")}
      </div>
      <div className="glass-card p-5">
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={combined} margin={{ top: 5, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
            <XAxis dataKey="season_name" angle={-35} textAnchor="end" tick={{ fill: "#64748b", fontSize: 9 }} height={70} interval="preserveStartEnd" />
            <YAxis tickFormatter={fmt} tick={{ fill: "#64748b", fontSize: 9 }} stroke="rgba(255,255,255,0.04)" />
            <Tooltip contentStyle={{ background: "rgba(8,8,26,0.97)", border: "1px solid rgba(125,211,252,0.2)", borderRadius: "8px", color: "#cdd3de", fontSize: 12 }} formatter={(v: number) => [fmt(v), "HP"]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {refName && <ReferenceLine x={refName} stroke={color} strokeWidth={1.5} strokeDasharray="4 4" />}
            {lastActualName && <ReferenceLine x={lastActualName} stroke="rgba(250,204,21,0.3)" strokeWidth={1} strokeDasharray="2 4" />}
            <Line type="monotone" dataKey="actual" stroke={color} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} name="Actual HP" isAnimationActive={false} connectNulls={false} />
            <Line type="monotone" dataKey="fit" stroke="#facc15" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Exp Fit" isAnimationActive={false} connectNulls={false} />
            <Line type="monotone" dataKey="pred" stroke={color} strokeWidth={1.5} strokeDasharray="3 4" dot={{ r: 3, fill: color }} name="Prediction" isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {activeMode === "tower" && (
        <div className="flex justify-end">
          <label className="flex items-center gap-2.5 cursor-pointer select-none group">
            <div className="relative w-9 h-5">
              <input type="checkbox" checked={dedup} onChange={() => setDedup(!dedup)} className="sr-only peer" />
              <div className="absolute inset-0 rounded-full transition-colors duration-300"
                style={{ background: dedup ? "rgba(125,211,252,0.35)" : "rgba(255,255,255,0.08)" }} />
              <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-300"
                style={{ transform: dedup ? "translateX(16px)" : "translateX(0)", background: dedup ? "#7dd3fc" : "rgba(255,255,255,0.35)" }} />
            </div>
            <span className="font-orb text-[12px] text-sky-300/60 group-hover:text-sky-300/90 transition-colors">
              {lang === "zh" ? "去除重复数据" : "Remove Duplicates"}
            </span>
          </label>
        </div>
      )}
      {chartData[idx] && (
        <div className="display-screen p-5 flex justify-between items-center">
          <div>
            <div className="font-orb text-[12px] text-emerald-400/50 tracking-[0.1em] uppercase mb-1">{t("currentSeason")}</div>
            <div className="font-orb text-[18px] tracking-wider text-white/90">{tr(chartData[idx].season_name, chartData[idx].season_name_zh)}</div>
          </div>
          <div className="text-right">
            <div className="font-orb text-[12px] text-emerald-400/50 tracking-[0.1em] uppercase mb-1">{t("totalHP")}</div>
            <div className="flex items-baseline justify-end gap-2">
              <span className="font-orb text-[30px] font-bold text-emerald-300 tracking-wider">{fmt(chartData[idx].total_hp)}</span>
              <span className="font-orb text-[14px] text-emerald-400/50">({fmtFull(chartData[idx].total_hp)})</span>
            </div>
          </div>
        </div>
      )}

      {fit && (
        <div className="analysis-card">
          <div className="font-orb px-5 py-4 border-b border-white/5 text-center" style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "0.14em", color: "rgba(125,211,252,0.7)", textTransform: "uppercase", textShadow: "0 0 10px rgba(125,211,252,0.15)" }}>
            {t("predictiveAnalysis")}
          </div>
          <table className="data-table w-full">
            <thead><tr><th>{t("metric")}</th><th>{t("value")}</th><th>{t("metric")}</th><th>{t("value")}</th></tr></thead>
            <tbody>
              <tr>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("formula")}</td>
                <td className="font-math font-bold text-amber-300/85 text-[15px]">{fit.formula}</td>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("r2")}</td>
                <td className="font-math text-white/70 text-[15px]">{fit.r2.toFixed(4)}</td>
              </tr>
              <tr>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("inflation3")}</td>
                <td className="font-orb font-bold text-[20px]" style={{ color: fit.inf3 > 0 ? "#f87171" : "#4ade80" }}>{(fit.inf3 >= 0 ? "+" : "") + fit.inf3.toFixed(1)}%</td>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("inflation5")}</td>
                <td className="font-orb font-bold text-[20px]" style={{ color: fit.inf5 > 0 ? "#f87171" : "#4ade80" }}>{(fit.inf5 >= 0 ? "+" : "") + fit.inf5.toFixed(1)}%</td>
              </tr>
              <tr>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("pred1")}</td>
                <td className="font-math font-bold text-amber-300/70 text-[15px]">{fmt(fit.preds[0].hp)}</td>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("pred2")}</td>
                <td className="font-math font-bold text-amber-300/70 text-[15px]">{fmt(fit.preds[1].hp)}</td>
              </tr>
              <tr>
                <td className="font-orb" style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>{t("pred3")}</td>
                <td className="font-math font-bold text-amber-300/70 text-[15px]">{fmt(fit.preds[2].hp)}</td>
                <td></td><td></td>
              </tr>
              {fit.growthWindows.map((w, i) => {
                const isPositive = w.avgPct > 0;
                const col = isPositive ? "#f87171" : "#4ade80";
                const glow = isPositive ? "rgba(248,113,113,0.4)" : "rgba(74,222,128,0.3)";
                const fs = "1.4rem";
                return (
                  <tr key={i}>
                    <td colSpan={4} className="text-center" style={i === 0 ? { borderTop: "1px solid rgba(125,211,252,0.08)" } : {}}>
                      <div style={{ padding: "10px 0 2px", display: "flex", justifyContent: "center", alignItems: "baseline", gap: "18px", flexWrap: "wrap" }}>
                        <span className="font-orb font-bold" style={{ fontSize: fs, letterSpacing: "0.06em", background: "linear-gradient(135deg, #7dd3fc, #c084fc)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>{w.label}</span>
                        <span className="font-orb" style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.62rem", letterSpacing: "0.05em" }}>AVG</span>
                        <span className="font-orb font-bold" style={{ fontSize: fs, color: col, textShadow: `0 0 12px ${glow}` }}>{isPositive ? "+" : ""}{w.avgPct.toFixed(2)}%</span>
                        <span className="font-orb" style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.62rem", letterSpacing: "0.05em" }}>×2 IN</span>
                        <span className="font-orb font-bold" style={{ fontSize: fs, color: col, textShadow: `0 0 12px ${glow}` }}>{isFinite(w.doubling) ? w.doubling.toFixed(1) : "∞"}</span>
                        <span className="font-orb" style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.62rem", letterSpacing: "0.05em" }}>SEASONS</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── GI App ──
export default function GIApp() {
  const [modes, setModes] = useState<ModeInfo[]>([]);
  const [activeMode, setActiveMode] = useState("tower");
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [gaugeIdx, setGaugeIdx] = useState(0);
  const [detail, setDetail] = useState<SeasonDetail | null>(null);
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("gi-lang") as Lang) || "zh");
  const [howsOpen, setHowsOpen] = useState(false);
  const color = MODE_COLORS[activeMode] || "#7dd3fc";

  const tr = useCallback((en: string, zh: string) => lang === "zh" ? (zh || en) : en, [lang]);
  const t = useCallback((key: string) => (UI_TEXT[lang] || UI_TEXT.en)[key] || key, [lang]);

  useEffect(() => { getModes().then(setModes); }, []);
  useEffect(() => {
    setDetail(null); setGaugeIdx(0);
    Promise.all([getSeasons(activeMode), getChartData(activeMode)]).then(([s, c]) => { setSeasons(s); setChartData(c); setGaugeIdx(s.length - 1); });
  }, [activeMode]);

  const toggleLang = () => {
    const newLang = lang === "en" ? "zh" : "en";
    setLang(newLang);
    localStorage.setItem("gi-lang", newLang);
  };

  const loadSeason = async (idx: number) => {
    setGaugeIdx(idx);
    if (!seasons[idx]) return;
    const d = await getSeasonDetail(seasons[idx].id);
    setDetail(d);
  };

  useEffect(() => {
    if (seasons.length > 0 && gaugeIdx >= 0 && gaugeIdx < seasons.length) loadSeason(gaugeIdx);
  }, [seasons]);

  return (
    <I18nContext.Provider value={{ lang, t, tr }}>
    <div className="app-container">
      <Sidebar modes={modes} active={activeMode} onMode={setActiveMode} seasons={seasons} selIdx={gaugeIdx} onSeason={loadSeason} color={color} />
      <main className="main-content">
        <div style={{ position: "fixed", top: "20px", right: "24px", zIndex: 100, display: "flex", gap: "8px" }}>
          <button onClick={() => setHowsOpen(true)} className="how-btn font-orb">{lang === "zh" ? "计算说明" : "How it works"}</button>
        <a href="/sr/sr-challenge/" className="lang-toggle font-orb" style={{ textDecoration: "none", right: "auto", position: "static" }}
             title={lang==="zh"?"切换到星铁":"Switch to SR"}>
            {lang==="zh"?"星铁":"SR"}
          </a>
          <button onClick={toggleLang} className="lang-toggle font-orb" style={{ position: "static" }}>{t("switchLang")}</button>
        </div>
        <header className="text-center pt-10 pb-6">
          <h1 className="sidebar-title" style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)" }}>{t("modeTitle")}</h1>
          <p className="font-mono mt-2 text-[clamp(0.65rem,1.2vw,0.8rem)] text-white/25 italic">From the Moon to Teyvat</p>

        </header>

        <div className="flex flex-col lg:flex-row gap-6 mb-10">
          <div className="lg:w-[640px] shrink-0">
            <Gauge total={seasons.length} idx={gaugeIdx} onChange={loadSeason} color={color} />
            {detail && (
              <div className="mt-4 glass-card p-6 flex flex-col justify-center min-h-[120px]">
                <div className="flex flex-col items-center gap-2 mb-4">
                  <h3 className="font-orb font-bold text-xl text-center" style={{
                    background: "linear-gradient(135deg, #4ade80, #7dd3fc)",
                    WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent",
                  }}>{tr(detail.name, detail.name_zh)}</h3>
                  <div className="font-orb text-[30px] font-bold tracking-wider text-center" style={{
                    background: "linear-gradient(135deg, #4ade80, #7dd3fc)",
                    WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent",
                  }}>{fmtFull(detail.total_hp_all)} HP · {detail.levels.length} {t("nodes")}</div>
                </div>
                {detail.blessing_desc && (
                  <div className="mt-auto p-4 rounded-lg bg-white/[0.03] border border-white/[0.04] font-orb text-center tracking-wide">
                    {detail.blessing_name && <div className="font-orb font-bold text-[15px] text-sky-300/60 mb-2">{tr(detail.blessing_name, detail.blessing_name_zh)}</div>}
                    <div className="text-[14px] text-white/40 leading-relaxed">{tr(detail.blessing_desc, detail.blessing_desc_zh)}</div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="detail-scroll space-y-3 lg:h-[500px] lg:overflow-y-auto">
              {detail ? (
                detail.levels.map(lv => <NodeCard key={lv.id} level={lv} />)
              ) : (
                <div className="glass-card p-12 text-center text-white/12 font-orb text-[14px]">{t("selectSeason")}</div>
              )}
            </div>
          </div>
        </div>

        <div><ChartPanel chartData={chartData} color={color} idx={gaugeIdx} activeMode={activeMode} /></div>
        <HowItWorks open={howsOpen} onClose={() => setHowsOpen(false)} />
        <footer className="text-center pt-12 pb-4 text-[9px] text-white/8 font-orb">lunaris.moe · Genshin Impact &copy; HoYoverse</footer>
      </main>
    </div>
    </I18nContext.Provider>
  );
}
