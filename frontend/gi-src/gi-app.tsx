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
    modeTitle: "原神挑战数据",
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

// ── DPS Row (instead of change%) ──
function DPSRow({ name, nameZh, hp, dps }: { name: string; nameZh: string; hp: number; dps: number }) {
  const { tr } = useI18n();
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[14px] border-b border-white/[0.03]">
      <span className="flex-1 min-w-0 truncate text-sky-200/75 text-[13px]">{tr(name, nameZh)}</span>
      <span className="w-24 text-right text-amber-300/65 font-math text-[14px]">{fmt(hp)}</span>
      <span className="w-28 text-right font-orb font-bold text-[17px] text-red-400" style={{ textShadow: "0 0 10px rgba(248,113,113,0.4)" }}>{fmt(dps)}</span>
    </div>
  );
}

// ── Node Card ──
function NodeCard({ level }: { level: LevelDetail }) {
  const [on, setOn] = useState(true);
  const { t, tr } = useI18n();
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-orb font-semibold text-[17px]">{tr(level.name, level.name_zh)}</h4>
        <span className="font-math text-[14px] text-sky-300/55">HP {fmt(level.total_hp)}</span>
      </div>
      {level.time_limit && <div className="font-orb text-[13px] text-white/20 mb-2">{t("minDPS")} = HP / {level.time_limit}s</div>}
      <button onClick={() => setOn(!on)} className="font-orb text-[13px] text-sky-400/55 hover:text-sky-300">{on ? `▼ ${t("collapse")}` : `▶ ${level.enemies.length} ${t("enemies")}`}</button>
      {on && <div className="mt-2">
        <div className="flex items-center gap-2 px-3 py-1 text-[11px] font-orb text-white/15 border-b border-white/[0.04]">
          <span className="flex-1">Monster</span><span className="w-24 text-right">HP</span><span className="w-28 text-right">{t("minDPS")}</span>
        </div>
        {level.enemies.map((e, i) => <DPSRow key={i} name={e.name} nameZh={e.name_zh} hp={e.hp} dps={level.min_dps} />)}
      </div>}
    </div>
  );
}

// ── Chart Panel ──
function ChartPanel({ chartData, color, idx }: { chartData: ChartDataPoint[]; color: string; idx: number }) {
  const { t, tr } = useI18n();
  const fit = computeExpFit(chartData);
  if (chartData.length < 1) return <div className="glass-card p-12 text-center text-white/15 font-orb">{t("noData")}</div>;

  const combined: any[] = chartData.map((d, i) => ({
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

  const refName = chartData[idx]?.season_name;
  const lastActualName = chartData[chartData.length - 1]?.season_name;

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
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <h3 className="font-orb font-bold text-xl">{tr(detail.name, detail.name_zh)}</h3>
                </div>
                <div className="flex gap-3 mt-1 flex-wrap mb-4">
                  <span className="font-code text-[13px] text-white/35 bg-white/[0.04] px-3 py-1.5 rounded font-math">HP {fmt(detail.total_hp_all)}</span>
                  <span className="font-code text-[13px] text-white/35 bg-white/[0.04] px-3 py-1.5 rounded">{detail.levels.length} {t("nodes")}</span>
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

        <div><ChartPanel chartData={chartData} color={color} idx={gaugeIdx} /></div>
        <footer className="text-center pt-12 pb-4 text-[9px] text-white/8 font-orb">lunaris.moe · Genshin Impact &copy; HoYoverse</footer>
      </main>
    </div>
    </I18nContext.Provider>
  );
}
