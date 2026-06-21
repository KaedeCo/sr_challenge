import type { ModeInfo, SeasonSummary, SeasonDetail, ChartDataPoint, ComparisonEntry } from "./types";

// Use relative path so it works both in dev (proxy) and prod (nginx)
const BASE = import.meta.env.BASE_URL + "api";

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

export function getModes() { return fetchJSON<ModeInfo[]>(`${BASE}/modes`); }
export function getSeasons(mode: string) { return fetchJSON<SeasonSummary[]>(`${BASE}/seasons/${mode}`); }
export function getSeasonDetail(id: number) { return fetchJSON<SeasonDetail>(`${BASE}/season/${id}`); }
export function getChartData(mode: string) { return fetchJSON<ChartDataPoint[]>(`${BASE}/chart/${mode}`); }
export function getComparison(mode: string, seasonId: number) {
  return fetchJSON<ComparisonEntry[]>(`${BASE}/compare/${mode}?season_id=${seasonId}`);
}
