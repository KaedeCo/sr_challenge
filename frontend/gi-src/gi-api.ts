import type { ModeInfo, SeasonSummary, SeasonDetail, ChartDataPoint, ComparisonEntry } from './gi-types';

const BASE = '/sr/gi-challenge/api';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export function getModes(): Promise<ModeInfo[]> {
  return get<ModeInfo[]>(`${BASE}/modes`);
}

export function getSeasons(mode: string): Promise<SeasonSummary[]> {
  return get<SeasonSummary[]>(`${BASE}/seasons/${mode}`);
}

export function getSeasonDetail(id: number): Promise<SeasonDetail> {
  return get<SeasonDetail>(`${BASE}/season/${id}`);
}

export function getChartData(mode: string): Promise<ChartDataPoint[]> {
  return get<ChartDataPoint[]>(`${BASE}/chart/${mode}`);
}

export function getComparison(_mode: string, _seasonId: number): Promise<ComparisonEntry[]> {
  // GI doesn't have comparison yet
  return Promise.resolve([]);
}
