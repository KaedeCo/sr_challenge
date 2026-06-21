export interface ModeInfo {
  key: string;
  name_en: string;
  name_zh: string;
}

export interface SeasonSummary {
  id: number;
  schedule_id: number;
  name: string;
  name_zh: string;
  begin_time: string;
  end_time: string;
}

export interface EnemyData {
  name: string;
  name_zh: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  quantity: number;
}

export interface LevelDetail {
  id: number;
  name: string;
  name_zh: string;
  stage_num: number;
  half: number | null;
  total_hp: number;
  min_dps: number;
  time_limit: number;
  enemies: EnemyData[];
}

export interface SeasonDetail extends SeasonSummary {
  mode: string;
  levels: LevelDetail[];
  total_hp_all: number;
  blessing_name?: string;
  blessing_desc?: string;
  blessing_name_zh?: string;
  blessing_desc_zh?: string;
}

export interface ChartDataPoint {
  season_name: string;
  season_name_zh: string;
  schedule_data_id: number;
  total_hp: number;
}

export interface ComparisonEntry {
  monster_name: string;
  hp_change_pct: number | null;
}

export interface ExpFitResult {
  A: number;
  B: number;
  formula: string;
  r2: number;
  inf3: number;
  inf5: number;
  preds: { season: string; hp: number }[];
  growthWindows: { label: string; avgPct: number; doubling: number }[];
}

export const MODE_COLORS: Record<string, string> = {
  tower: "#60a5fa",
  leyline_n4: "#4ade80",
  leyline_n5: "#fbbf24",
  leyline_n6: "#f87171",
};

export const MODE_NAMES: Record<string, { en: string; zh: string }> = {
  tower: { en: "Spiral Abyss", zh: "深境螺旋" },
  leyline_n4: { en: "Stygian Onslaught N4", zh: "幽境危战 N4" },
  leyline_n5: { en: "Stygian Onslaught N5", zh: "幽境危战 N5" },
  leyline_n6: { en: "Stygian Onslaught N6", zh: "幽境危战 N6" },
};
