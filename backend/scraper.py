"""
Scraper for Huroka.com challenge data.

Strategy:
  - Prod data (92 groups): Pure REST API, fast and easy.
  - Beta data (4 groups, latest season only): Browser automation via agent-browser.
    Requires: Beta branch in Settings, Starward Mode button click, lazy-scroll.

Only the highest-difficulty phase is scraped per mode:
  - Forgotten Hall: floor 12
  - Pure Fiction: floor 4
  - Apocalyptic Shadow: floor 4 (difficulty 4)
  - Anomaly Arbitration: "King in Check: Plight"
"""
import json
import re
import time
from math import floor

import requests

from config import (
    CHALLENGE_LIST_URL, CHALLENGE_DETAIL_URL,
    CHALLENGE_LIST_BETA_URL, CHALLENGE_DETAIL_BETA_URL,
    GROUP_TYPE_MAP, TOP_DIFFICULTY,
)
from models import init_db, get_session, ChallengeGroup, MazeLevel, Enemy

AGENT_BROWSER = "agent-browser"
REQUEST_DELAY = 0.3
MONSTER_API = "https://www.huroka.com/api/monster"
TEXTMAP_API = "https://www.huroka.com/api/textmap?lang={lang}&branch={branch}"
TRANSLATIONS_FILE = "translations.json"


# ── Text cleanup ─────────────────────────────────────────

def clean_text(text: str) -> str:
    """Remove game text markup: <color=...>, <unbreak>, etc."""
    if not text:
        return text
    text = re.sub(r'<color=[^>]*>', '', text)
    text = re.sub(r'</color>', '', text)
    text = re.sub(r'<unbreak>', '', text)
    text = re.sub(r'</unbreak>', '', text)
    text = re.sub(r'<[^>]+>', '', text)
    return text.strip()


# ── Monster name lookup ──────────────────────────────────

_monster_lookup = None

def get_monster_lookup():
    global _monster_lookup
    if _monster_lookup is not None:
        return _monster_lookup
    try:
        resp = requests.get(MONSTER_API, timeout=60)
        data = resp.json()
        _monster_lookup = {str(m["id"]): m["name"] for m in data if m.get("id") and m.get("name")}
        print(f"[*] Loaded {len(_monster_lookup)} monster names")
    except Exception as e:
        print(f"[!] Failed to load monster names: {e}")
        _monster_lookup = {}
    return _monster_lookup


def get_monster_name(monster_id):
    lookup = get_monster_lookup()
    mid = str(monster_id) if monster_id else ""
    return lookup.get(mid, f"Unknown_{mid}")


# ── API-based scraping (Prod) ────────────────────────────

def fetch_json(url):
    """Fetch JSON from a URL with error handling."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_challenge_list():
    """Fetch all challenge groups from the list API."""
    return fetch_json(CHALLENGE_LIST_URL)


def fetch_challenge_detail(api_id):
    """Fetch a single challenge's detailed data."""
    return fetch_json(CHALLENGE_DETAIL_URL.format(id=api_id))


# ── Parsing helpers ──────────────────────────────────────

def parse_enemy_wave(wave_data, wave_num, node_num):
    """Parse a wave of enemies and return list of enemy dicts + total HP."""
    enemies = []
    total_hp = 0
    if not wave_data:
        return enemies, total_hp

    for wave_enemies in wave_data:
        for monster in wave_enemies:
            hp_val = floor(sum(monster.get("hp", [0])))
            qty = 1
            mid = str(monster.get("id", ""))
            name = get_monster_name(mid)

            enemy = {
                "monster_name": name,
                "monster_id": mid,
                "enemy_level": monster.get("level", 0),
                "hp": hp_val,
                "speed": floor(monster.get("spd", monster.get("speed", 0))),
                "toughness": monster.get("toughness", 0),
                "effect_res": monster.get("effectRes", monster.get("effect_res", 0)),
                "wave_num": wave_num,
                "node_num": node_num,
                "quantity": qty,
            }
            enemies.append(enemy)
            total_hp += hp_val * qty
    return enemies, total_hp


def find_top_level(levels, mode):
    """Find the highest-difficulty level for the given mode."""
    top = TOP_DIFFICULTY[mode]
    candidates = []

    if mode == "forgotten_hall":
        candidates = [lv for lv in levels if lv.get("floor") == top]
    elif mode == "pure_fiction":
        candidates = [lv for lv in levels if lv.get("floor") == top]
    elif mode == "apocalyptic_shadow":
        candidates = [lv for lv in levels if lv.get("floor") == top]
    elif mode == "anomaly_arbitration":
        candidates = [lv for lv in levels if top in (lv.get("name") or "")]

    if not candidates and mode == "anomaly_arbitration":
        candidates = [lv for lv in levels if "Plight" in (lv.get("name") or "")]
    if not candidates:
        candidates = [levels[-1]] if levels else []

    return candidates[0] if candidates else None


def parse_challenge(data, api_id):
    """Parse a single challenge detail JSON into structured data,
    including Starward Mode (tierceMazeLevels) if present."""
    group_type = data.get("groupType", "")
    mode = GROUP_TYPE_MAP.get(group_type, group_type.lower())

    # Clean season buff descriptions
    raw_buffs = data.get("seasonBuffs1", [])
    for b in raw_buffs:
        if "desc" in b:
            b["desc"] = clean_text(b["desc"])

    has_starward = bool(data.get("tierceMazeLevels"))

    raw_name = data.get("name", "")
    name = clean_text(raw_name) if raw_name else f"Group{api_id}"

    group = {
        "api_id": str(api_id),
        "name": name,
        "group_type": group_type,
        "mode": mode,
        "schedule_data_id": data.get("scheduleDataId", 0),
        "level_count": data.get("levelCount", len(data.get("mazeLevels", []))),
        "has_starward": has_starward,
        "season_buffs": json.dumps(raw_buffs, ensure_ascii=False),
    }

    levels = []
    enemies = []

    maze_levels = data.get("mazeLevels", [])

    if group_type == "Peak":
        # ── Anomaly Arbitration: parse ALL 5 floors with categories ──
        for lv in maze_levels:
            name = lv.get("name", "")
            if "Knight" in name:
                cat = "knight"
            elif "Plight" in name:
                cat = "kicp"
            elif "King" in name:
                cat = "kic"
            else:
                cat = "knight"

            ld = _parse_single_level(lv, mode, 1, False)
            ld["level"]["category"] = cat
            levels.append(ld["level"])
            enemies.extend(ld["enemies"])

    else:
        # ── Other modes: only top difficulty ──
        top_level = find_top_level(maze_levels, mode)

        if top_level:
            level_data = _parse_single_level(top_level, mode, 1, False)
            levels.append(level_data["level"])
            enemies.extend(level_data["enemies"])

            if top_level.get("stageNum", 1) >= 2:
                level_data_2 = _parse_single_level(top_level, mode, 2, False)
                levels.append(level_data_2["level"])
                enemies.extend(level_data_2["enemies"])

    # ── Starward Mode / Tierce node ──
    tierce_levels = data.get("tierceMazeLevels", [])
    if tierce_levels:
        # tierceMazeLevels usually has one entry — the Starward node
        sw_top = find_top_level(tierce_levels, mode)
        if not sw_top and tierce_levels:
            sw_top = tierce_levels[0]  # fallback: first entry

        if sw_top:
            sw_data = _parse_single_level(sw_top, mode, 1, True)
            sw_data["level"]["name"] = sw_data["level"]["name"] or f"Starward Mode"
            levels.append(sw_data["level"])
            enemies.extend(sw_data["enemies"])

            # TIerce might have node 2 as well
            if sw_top.get("stageNum", 1) >= 2:
                sw_data_2 = _parse_single_level(sw_top, mode, 2, True)
                levels.append(sw_data_2["level"])
                enemies.extend(sw_data_2["enemies"])

    return group, levels, enemies


def _parse_single_level(raw_level, mode, node_num, is_starward=False):
    """Parse one node's data from a raw maze level object."""
    node_key = f"monsterWaves{node_num}"
    waves = raw_level.get(node_key, [])

    damage_types = raw_level.get(f"damageType{node_num}", [])
    buff = raw_level.get("buff", {})
    targets = raw_level.get("targets", [])

    level_info = {
        "level_api_id": str(raw_level.get("id", "")),
        "name": raw_level.get("name", f"Node {node_num}"),
        "floor": raw_level.get("floor", 0),
        "stage_num": node_num,
        "damage_types": json.dumps(damage_types, ensure_ascii=False),
        "buff_name": buff.get("name", ""),
        "buff_desc": clean_text(buff.get("desc", "")),
        "targets": json.dumps(targets, ensure_ascii=False),
        "is_starward": is_starward,
    }

    all_enemies = []
    total_hp = 0
    level_api_id = str(raw_level.get("id", ""))
    for w_idx, wave in enumerate(waves):
        wave_enemies, wave_hp = parse_enemy_wave([wave], w_idx + 1, node_num)
        for e in wave_enemies:
            e["is_starward"] = is_starward
            e["level_api_id"] = level_api_id
        all_enemies.extend(wave_enemies)
        total_hp += wave_hp

    level_info["total_hp"] = total_hp

    return {"level": level_info, "enemies": all_enemies}


# ── Database storage ─────────────────────────────────────

def store_challenge(session, group_data, levels_data, enemies_data):
    """Store a parsed challenge in the database."""
    group = ChallengeGroup(**group_data)
    session.add(group)
    session.flush()  # to get group.id

    for lv in levels_data:
        lv["challenge_group_id"] = group.id
        maze_level = MazeLevel(**lv)
        session.add(maze_level)
        session.flush()

        # Link enemies to this level by api_id + stage_num + is_starward
        level_enemies = [e for e in enemies_data
                         if e.get("level_api_id") == lv.get("level_api_id")
                         and e["node_num"] == lv["stage_num"]
                         and e.get("is_starward", False) == lv.get("is_starward", False)]
        # Fallback for old data without level_api_id
        if not level_enemies:
            level_enemies = [e for e in enemies_data
                             if e["node_num"] == lv["stage_num"]
                             and e.get("is_starward", False) == lv.get("is_starward", False)]
        for en in level_enemies:
            en["maze_level_id"] = maze_level.id
            # Use ORM mapper attribute names for filtering
            valid_attrs = set(Enemy.__mapper__.columns.keys())
            clean_en = {k: v for k, v in en.items() if k in valid_attrs}
            enemy = Enemy(**clean_en)
            session.add(enemy)

    session.commit()
    return group


# ── Deduplication ────────────────────────────────────────

def deduplicate_by_name(session):
    """Remove duplicate seasons: keep only the first (earliest scheduleDataId)
    occurrence of each season name, per mode."""
    for mode in ["forgotten_hall", "pure_fiction", "apocalyptic_shadow", "anomaly_arbitration"]:
        groups = (
            session.query(ChallengeGroup)
            .filter_by(mode=mode)
            .order_by(ChallengeGroup.schedule_data_id.asc(), ChallengeGroup.api_id.asc())
            .all()
        )
        seen = set()
        for g in groups:
            if g.name in seen:
                session.delete(g)
            else:
                seen.add(g.name)


# ── Textmap / Translation ────────────────────────

def fetch_and_build_translations():
    """Fetch EN and CHS textmaps, build EN→ZH translation dictionary."""
    import os
    print("[*] Fetching textmaps for translation...")
    try:
        en_map = fetch_json(TEXTMAP_API.format(lang="en", branch="prod"))
        zh_map = fetch_json(TEXTMAP_API.format(lang="chs", branch="prod"))
        if not isinstance(en_map, dict) or not isinstance(zh_map, dict):
            print("[!] Textmap format unexpected, skipping translations")
            return
        # Build EN→ZH: for each key, if EN value differs from ZH value, map EN→ZH
        translations = {}
        for key, en_val in en_map.items():
            zh_val = zh_map.get(key)
            if zh_val and en_val and en_val != zh_val:
                translations[en_val] = zh_val
        print(f"[*] Built {len(translations)} EN→ZH translations")
        filepath = os.path.join(os.path.dirname(__file__), TRANSLATIONS_FILE)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(translations, f, ensure_ascii=False)
        print(f"[*] Saved translations to {filepath}")
    except Exception as e:
        print(f"[!] Failed to build translations: {e}")


# ── Main scraping entry ──────────────────────────────────

def _scrape_seasonal(session, challenge_list, detail_url):
    """Scrape seasonal challenges from a given list, using a given detail URL."""
    seasonal = [c for c in challenge_list
                if c.get("scheduleDataId", 0) > 0 or c.get("groupType") == "Peak"]
    for chal in seasonal:
        api_id = chal["id"]
        name = chal.get("name", "?")
        existing = session.query(ChallengeGroup).filter_by(api_id=str(api_id)).first()
        if existing:
            continue
        try:
            detail = fetch_json(detail_url.format(id=api_id))
            group, levels, enemies = parse_challenge(detail, api_id)
            store_challenge(session, group, levels, enemies)
            total_hp = sum(lv["total_hp"] for lv in levels)
            print(f"  [{detail_url[:40]}...] OK {name} (id={api_id}) | {len(levels)} nodes | HP={total_hp:,.0f}")
        except Exception as e:
            print(f"  [{detail_url[:40]}...] FAIL {name} (id={api_id}): {e}")
        time.sleep(REQUEST_DELAY)


def run_scraper():
    """Prod for history + Beta ONLY for the single latest season per mode."""
    global _monster_lookup
    # Reset monster name cache so new monsters from game updates are fetched
    _monster_lookup = None

    # Fetch and build EN→ZH translations
    fetch_and_build_translations()

    init_db()
    session = get_session()

    # 1. Fetch both lists
    print("[*] Fetching Prod list...")
    prod_list = fetch_json(CHALLENGE_LIST_URL)
    print(f"[*] Prod: {len(prod_list)} groups")

    print("[*] Fetching Beta list...")
    beta_list = fetch_json(CHALLENGE_LIST_BETA_URL)
    print(f"[*] Beta: {len(beta_list)} groups")

    # 2. Beta-only = IDs that exist in Beta but NOT in Prod (latest season per mode)
    prod_ids = {str(c["id"]) for c in prod_list}
    beta_only = [c for c in beta_list if str(c["id"]) not in prod_ids]
    print(f"[*] Beta-only IDs: {[c['id'] for c in beta_only]}")

    # 3. Scrape from Prod
    print("\n=== Scraping from Prod API ===")
    _scrape_seasonal(session, prod_list, CHALLENGE_DETAIL_URL)
    session.commit()

    # 4. Scrape Beta-only from Beta API
    if beta_only:
        print("\n=== Scraping Beta-only from Beta API ===")
        _scrape_seasonal(session, beta_only, CHALLENGE_DETAIL_BETA_URL)
        session.commit()

    # 5. Deduplicate: keep only earliest occurrence of each season name per mode
    print("\n=== Deduplicating ===")
    deduplicate_by_name(session)
    session.commit()

    print("\n[*] Scraping complete!")
    session.close()


if __name__ == "__main__":
    run_scraper()
