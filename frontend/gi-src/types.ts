export interface ModeInfo {
  key: string;
  name_en: string;
  name_zh: string;
  top_difficulty: string | number;
}

export interface SeasonSummary {
  id: number;
  api_id: string;
  name: string;
  name_zh: string;
  schedule_data_id: number;
  has_starward: boolean;
  is_beta: boolean;
  level_count: number;
  season_buffs: { name: string; desc: string }[];
  season_buffs_zh: { name: string; desc: string }[];
}

export interface EnemyData {
  name: string;
  name_zh: string;
  level: number;
  hp: number;
  speed: number;
  toughness: number;
  effect_res: number;
  quantity: number;
  wave_num: number;
}

export interface LevelDetail {
  id: number;
  name: string;
  name_zh: string;
  floor: number;
  stage_num: number;
  category: string | null;
  damage_types: string[];
  buff_name: string;
  buff_desc: string;
  buff_name_zh: string;
  buff_desc_zh: string;
  targets: string[];
  total_hp: number;
  is_starward: boolean;
  enemies: EnemyData[];
}

export interface SeasonDetail extends SeasonSummary {
  mode: string;
  levels: LevelDetail[];
  total_hp_all: number;
}

export interface ChartDataPoint {
  season_name: string;
  season_name_zh: string;
  schedule_data_id: number;
  total_hp: number;
  has_starward: boolean;
  knights_hp?: number;
  kic_hp?: number;
  kicp_hp?: number;
}

export interface ComparisonEntry {
  monster_name: string;
  monster_id: string;
  current_hp: number;
  previous_hp: number | null;
  previous_season: string | null;
  hp_change_pct: number | null;
  node_num: number;
  wave_num: number;
  is_starward: boolean;
  category: string | null;
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
  forgotten_hall: "#60a5fa",
  pure_fiction: "#4ade80",
  apocalyptic_shadow: "#f87171",
  anomaly_arbitration: "#a78bfa",
};

export const MODE_NAMES: Record<string, { en: string; zh: string }> = {
  forgotten_hall: { en: "Forgotten Hall", zh: "忘却之庭" },
  pure_fiction: { en: "Pure Fiction", zh: "虚构叙事" },
  apocalyptic_shadow: { en: "Apocalyptic Shadow", zh: "末日幻影" },
  anomaly_arbitration: { en: "Anomaly Arbitration", zh: "异相仲裁" },
};
