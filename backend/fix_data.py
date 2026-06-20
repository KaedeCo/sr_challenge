"""
Fix existing scraped data:
  1. Map Enemy_XXXXXX IDs to real monster names via /api/monster
  2. Strip <color=...> and <unbreak> markup from descriptions
  3. Round floating-point speed/HP values to integers
"""
import json
import re
import requests
from math import floor

from models import init_db, get_session, ChallengeGroup, MazeLevel, Enemy

MONSTER_API = "https://www.huroka.com/api/monster"


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


def build_monster_lookup():
    """Fetch all monsters from Huroka API and build ID -> name mapping."""
    print("[*] Fetching monster list...")
    resp = requests.get(MONSTER_API, timeout=60)
    data = resp.json()
    lookup = {}
    for m in data:
        mid = str(m.get("id", ""))
        name = m.get("name", "")
        if mid and name:
            lookup[mid] = name
    print(f"[*] Built lookup: {len(lookup)} monsters")
    return lookup


def fix_enemy_names(session, lookup):
    """Replace 'Enemy_XXXXXX' names with real monster names."""
    enemies = session.query(Enemy).filter(Enemy.monster_name.like("Enemy_%")).all()
    print(f"[*] Found {len(enemies)} enemies with generic names")

    fixed = 0
    for e in enemies:
        # Try to find an ID in the metadata
        if e.monster_id and e.monster_id in lookup:
            e.monster_name = lookup[e.monster_id]
            fixed += 1
        elif e.monster_name.startswith("Enemy_"):
            mid = e.monster_name.replace("Enemy_", "")
            if mid in lookup:
                e.monster_name = lookup[mid]
                e.monster_id = mid
                fixed += 1

    print(f"[*] Fixed {fixed} enemy names")
    session.commit()


def fix_numbers(session):
    """Round floating-point HP and speed to integers."""
    enemies = session.query(Enemy).all()
    fixes = 0
    for e in enemies:
        old_hp, old_spd = e.hp, e.speed
        e.hp = floor(e.hp)
        e.speed = floor(e.speed)
        if old_hp != e.hp or old_spd != e.speed:
            fixes += 1

    # Also fix level total_hp
    levels = session.query(MazeLevel).all()
    for lv in levels:
        lv.total_hp = floor(lv.total_hp)

    print(f"[*] Rounded {fixes} enemy entries and {len(levels)} level totals")
    session.commit()


def fix_descriptions(session):
    """Strip game markup from buff descriptions."""
    groups = session.query(ChallengeGroup).all()
    for g in groups:
        if g.season_buffs:
            try:
                buffs = json.loads(g.season_buffs)
                for b in buffs:
                    if "desc" in b:
                        b["desc"] = clean_text(b["desc"])
                g.season_buffs = json.dumps(buffs, ensure_ascii=False)
            except (json.JSONDecodeError, TypeError):
                pass

    levels = session.query(MazeLevel).all()
    for lv in levels:
        lv.buff_desc = clean_text(lv.buff_desc or "")

    session.commit()
    print("[*] Fixed descriptions")


def run_fix():
    init_db()
    lookup = build_monster_lookup()
    session = get_session()
    try:
        fix_enemy_names(session, lookup)
        fix_numbers(session)
        fix_descriptions(session)
        print("[*] All fixes applied!")
    finally:
        session.close()


if __name__ == "__main__":
    run_fix()
