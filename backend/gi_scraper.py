"""Scraper for Genshin Impact challenge data from lunaris.moe.

Modes:
  - Tower (深境螺旋): Floor 12 only, upper/lower halves
  - Leyline N4/N5/N6 (幽境危战): 3 bosses per difficulty

Strategy:
  - Tower: fetch version → towerlist.json → for each new schedule_id, fetch detail JSON
  - Leyline: iterate schedule_id range (5269001-5269009), fetch JSON directly
"""
import json
import re
import time
import fcntl
import threading

import requests

from gi_config import (
    VERSION_URL, TOWER_LIST_URL, TOWER_DETAIL_URL, LEYLINE_URL, LEYLINE_ID_RANGE,
    MODE_TOWER, MODE_LEYLINE_N4, MODE_LEYLINE_N5, MODE_LEYLINE_N6,
    TOWER_TIME, LEYLINE_TIME,
)
from gi_models import init_db, get_session, ChallengeGroup, MazeLevel, Enemy

REQUEST_DELAY = 0.5
_session = requests.Session()
_session.headers.update({"User-Agent": "SR-Challenge-Scraper/2.0"})

# Concurrency locks
_scrape_lock = threading.Lock()
_lock_fd = None
_LOCK_FILE = "/tmp/gi_challenge_scraper.lock"


def _clean_html(text: str) -> str:
    """Strip HTML-like tags from text."""
    if not text:
        return text
    text = re.sub(r'<[^>]+>', '', text)
    return text.strip()


def _fix_hp(monster_name: str, hp: float) -> float:
    """Fix HP for monsters that have inflated values in lunaris API.
    Ruin Guard / 遗迹守卫 HP is stored 1000x too high."""
    name_lower = monster_name.lower()
    if "ruin guard" in name_lower or "遗迹守卫" in monster_name or "遺跡守衛" in monster_name:
        return hp / 1000.0
    return hp


def _fetch_json(url):
    resp = _session.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


def _get_version():
    """Get the latest data version from lunaris API."""
    data = _fetch_json(VERSION_URL)
    return data.get("version", "6.6.54.3")


# ── Tower scraping ─────────────────────────────────────

def _scrape_tower(session, version):
    """Scrape all Tower (深境螺旋) seasons."""
    print(f"[*] Fetching tower list (version {version})...")
    tower_list = _fetch_json(TOWER_LIST_URL.format(version=version))
    print(f"[*] Tower: {len(tower_list)} schedules")

    count = 0
    # tower_list is a dict: { "1": {...}, "2": {...}, ... }
    if isinstance(tower_list, dict):
        items = tower_list.items()
    else:
        items = [(str(i.get("id")), i) for i in tower_list if not isinstance(i, str)]

    for sid_str, item in items:
        sid = int(sid_str) if sid_str.isdigit() else None
        if sid is None:
            continue

        existing = session.query(ChallengeGroup).filter_by(
            schedule_id=int(sid), mode=MODE_TOWER
        ).first()
        if existing:
            continue

        try:
            detail = _fetch_json(TOWER_DETAIL_URL.format(version=version, id=sid))
            # Get names from tower list item
            ename = item.get("enBuffName", "") if isinstance(item, dict) else ""
            name_zh = item.get("chsBuffName", "") if isinstance(item, dict) else ""
            group, levels, enemies = _parse_tower(detail, sid, ename, name_zh)
            _store(session, group, levels, enemies)
            count += 1
            total_hp = sum(lv["total_hp"] for lv in levels)
            print(f"  [TOWER] OK id={sid} '{group['name'][:30]}' | {len(levels)} chambers | HP={total_hp:,.0f}")
        except Exception as e:
            print(f"  [TOWER] FAIL id={sid}: {e}")
        time.sleep(REQUEST_DELAY)

    print(f"[*] Tower: {count} new seasons scraped")
    session.commit()


def _parse_tower(detail, schedule_id, ename="", name_zh=""):
    """Parse tower detail JSON into group + levels + enemies."""
    raw_name = _clean_html(detail.get("buffName", ""))
    name = raw_name or ename or f"Tower {schedule_id}"
    begin = detail.get("beginTime", "") or detail.get("startTime", "") or detail.get("openTime", "")
    end = detail.get("endTime", "") or detail.get("closeTime", "")

    # Monthly buff (blessing)
    blessing = detail.get("monthlyBuff", {})
    bname = _clean_html(blessing.get("name", ""))
    bdesc = _clean_html(blessing.get("desc", ""))

    group = {
        "schedule_id": int(schedule_id),
        "mode": MODE_TOWER,
        "name": name,
        "name_zh": name_zh,
        "begin_time": begin,
        "end_time": end,
        "blessing_name": bname,
        "blessing_desc": bdesc,
        "blessing_name_zh": "",
        "blessing_desc_zh": "",
    }

    levels = []
    enemies = []

    floors = detail.get("floors", [])
    floor12 = None
    for f in floors:
        if f.get("floorIndex") == 12:
            floor12 = f
            break

    if not floor12:
        return group, levels, enemies

    chambers = floor12.get("chambers", [])
    for ci, chamber in enumerate(chambers):
        for half_key, stage_num in [("firstHalfMonsters", ci * 2 + 1), ("secondHalfMonsters", ci * 2 + 2)]:
            monsters = chamber.get(half_key, [])
            if not monsters:
                continue

            half_total_hp = 0
            half_enemies = []
            for m in monsters:
                raw_name = _clean_html(m.get("name", "?"))
                hp_val = float(m.get("hp", 0))
                hp_val = _fix_hp(raw_name, hp_val)
                half_enemies.append({
                    "monster_name": raw_name,
                    "monster_name_zh": "",
                    "monster_id": str(m.get("id", "")),
                    "monster_level": m.get("level", m.get("monsterLevel", 0)),
                    "hp": hp_val,
                    "atk": 0,
                    "def": 0,
                    "quantity": 1,
                    "stage_num_hint": stage_num,
                })
                half_total_hp += hp_val

            half_name = "Upper" if half_key == "firstHalfMonsters" else "Lower"
            half_label = f"12-{ci+1} {half_name}"
            level = {
                "name": half_label,
                "name_zh": "",
                "stage_num": stage_num,
                "half": 1 if half_key == "firstHalfMonsters" else 2,
                "total_hp": half_total_hp,
                "min_dps": 0,  # DPS calculated from total chamber HP in frontend/chart
                "time_limit": TOWER_TIME,
            }
            levels.append(level)
            for e in half_enemies:
                e["level_name"] = half_label
            enemies.extend(half_enemies)

    return group, levels, enemies


# ── Leyline scraping ───────────────────────────────────

def _scrape_leyline(session):
    """Scrape all Leyline (幽境危战) seasons, creating N4/N5/N6 entries."""
    print("[*] Fetching leyline data...")
    count = 0
    for sid in LEYLINE_ID_RANGE:
        try:
            detail = _fetch_json(LEYLINE_URL.format(id=sid))
        except Exception as e:
            # 404 means no more schedules in range
            print(f"  [LEYLINE] No data for {sid}: {e}")
            continue

        schedule_id = detail.get("scheduleId", sid)
        name_raw = detail.get("name", {})
        name_en = name_raw.get("en", f"Leyline {schedule_id}") if isinstance(name_raw, dict) else str(name_raw)
        name_zh = name_raw.get("chs", "") if isinstance(name_raw, dict) else ""
        begin = detail.get("beginTime", "")
        end = detail.get("endTime", "")

        configs = detail.get("levels", detail.get("levelConfigs", []))

        # Map level id to difficulty number
        diff_map = {}
        for cfg in configs:
            lid = str(cfg.get("id", cfg.get("levelId", "")))
            # Level IDs follow pattern: 100{schedule_index}{difficulty}
            # e.g. 100104, 100204, ..., 100706 → match by last 2 digits
            if lid.endswith("04"):
                diff_map[4] = cfg
            elif lid.endswith("05"):
                diff_map[5] = cfg
            elif lid.endswith("06"):
                diff_map[6] = cfg

        for diff in [4, 5, 6]:
            if diff not in diff_map:
                continue
            cfg = diff_map[diff]
            mode = {
                4: MODE_LEYLINE_N4,
                5: MODE_LEYLINE_N5,
                6: MODE_LEYLINE_N6,
            }[diff]

            # Check if already stored
            existing = session.query(ChallengeGroup).filter_by(
                schedule_id=int(schedule_id), mode=mode
            ).first()
            if existing:
                continue

            group = {
                "schedule_id": int(schedule_id),
                "mode": mode,
                "name": f"{name_en} N{diff}",
                "name_zh": f"{name_zh} N{diff}" if name_zh else f"幽境危战 {schedule_id} N{diff}",
                "begin_time": begin,
                "end_time": end,
                "blessing_name": "",
                "blessing_desc": "",
                "blessing_name_zh": "",
                "blessing_desc_zh": "",
            }

            levels = []
            enemies = []
            total_all_hp = 0

            # Bosses are in levelConfigs array
            level_configs = cfg.get("levelConfigs", [])
            for bi, lc in enumerate(level_configs):
                # Each lc has enLevelName/chsLevelName and monsterStats directly
                bname = lc.get("enLevelName", "") or lc.get("enMonsterSpecialMechanicName", "") or f"Boss {bi+1}"
                bname_zh = lc.get("chsLevelName", "") or lc.get("chsMonsterSpecialMechanicName", "")
                stats = lc.get("monsterStats", {}) or {}
                hp_val = float(stats.get("hp", 0))
                hp_val = _fix_hp(bname, hp_val)

                level = {
                    "name": bname,
                    "name_zh": bname_zh,
                    "stage_num": bi + 1,
                    "half": None,
                    "total_hp": hp_val,
                    "min_dps": hp_val / LEYLINE_TIME if LEYLINE_TIME else 0,
                    "time_limit": LEYLINE_TIME,
                }
                levels.append(level)
                enemies.append({
                    "monster_name": bname,
                    "monster_name_zh": bname_zh,
                    "monster_id": str(stats.get("id", "")),
                    "monster_level": cfg.get("monsterLevel", 0),
                    "hp": hp_val,
                    "atk": float(stats.get("attack", 0)),
                    "def": float(stats.get("defense", 0)),
                    "quantity": 1,
                    "level_name": bname,
                })
                total_all_hp += hp_val

            if levels:
                _store(session, group, levels, enemies)
                count += 1
                print(f"  [LEYLINE] OK {schedule_id} N{diff} '{group['name'][:40]}' | {len(levels)} bosses | HP={total_all_hp:,.0f}")

        time.sleep(REQUEST_DELAY)

    print(f"[*] Leyline: {count} new entries scraped")
    session.commit()


# ── Database storage ──────────────────────────────────

def _store(session, group_data, levels_data, enemies_data):
    """Store a parsed challenge in the database."""
    group = ChallengeGroup(**group_data)
    session.add(group)
    session.flush()

    remaining = list(enemies_data)  # copy since we're consuming

    for lv_data in levels_data:
        lv_data["challenge_group_id"] = group.id
        lv_name = lv_data.get("name", "")  # match by level name
        maze_level = MazeLevel(**lv_data)
        session.add(maze_level)
        session.flush()

        # Match enemies to this level by name or stage_num order
        matched = [e for e in remaining if e.get("level_name") == lv_name]
        if not matched:
            # Fallback: take enemies for this stage_num in order
            sn = lv_data.get("stage_num", 1)
            matched = [e for e in remaining if e.get("stage_num_hint", 0) == sn]
        if not matched and remaining:
            matched = [remaining.pop(0)]  # last resort: take next available
        for e in matched:
            if e in remaining:
                remaining.remove(e)

        for en in matched:
            en.pop("level_name", None)
            en.pop("stage_num_hint", None)
            en["maze_level_id"] = maze_level.id
            valid_attrs = set(Enemy.__mapper__.columns.keys())
            clean_en = {k: v for k, v in en.items() if k in valid_attrs}
            enemy = Enemy(**clean_en)
            session.add(enemy)

    session.commit()


# ── Main entry ────────────────────────────────────────

def _run_scraper_impl():
    """Actual scraping logic."""
    init_db()
    session = get_session()

    # 1. Get version
    print("[*] Fetching lunaris version...")
    version = _get_version()
    print(f"[*] Data version: {version}")

    # 2. Scrape Tower
    print("\n=== Scraping Tower (Spiral Abyss) ===")
    _scrape_tower(session, version)

    # 3. Scrape Leyline
    print("\n=== Scraping Leyline (Stygian Onslaught) ===")
    _scrape_leyline(session)

    print("\n[*] GI scraping complete!")
    session.close()


def run_scraper():
    """Public entry point with dual-lock protection."""
    global _lock_fd

    if not _scrape_lock.acquire(blocking=False):
        print("[!] Another GI scraper is already running (thread), skipping.")
        return False

    try:
        _lock_fd = open(_LOCK_FILE, 'w')
    except Exception as e:
        print(f"[!] Cannot open lock file: {e}")
        _scrape_lock.release()
        return False

    try:
        fcntl.flock(_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (IOError, OSError):
        print("[!] Another GI scraper is already running (process), skipping.")
        _lock_fd.close()
        _lock_fd = None
        _scrape_lock.release()
        return False

    try:
        _run_scraper_impl()
        return True
    finally:
        if _lock_fd:
            fcntl.flock(_lock_fd, fcntl.LOCK_UN)
            _lock_fd.close()
            _lock_fd = None
        _scrape_lock.release()


if __name__ == "__main__":
    run_scraper()
