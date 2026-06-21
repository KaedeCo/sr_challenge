"""
Fandom Wiki integration: match Fandom spawn data with lunaris schedules
and update missing monster quantities in the database.
"""
import json, re
from datetime import datetime
from sqlalchemy import func
from gi_models import get_session, ChallengeGroup, MazeLevel, Enemy
from gi_config import MODE_TOWER
from gi_fandom_scraper import fetch_all_dates, fetch_page

JSON_PATH = "/opt/sr-challenge/backend/fandom_spawn_table.json"


def _normalize(s: str) -> str:
    """Normalize monster name for comparison."""
    s = s.lower().strip()
    s = re.sub(r'\(.*?\)', '', s)        # Remove (Pyro), (Cryo) etc
    s = re.sub(r'[^a-z0-9\s]', '', s)    # Remove special chars
    s = re.sub(r'\s+', ' ', s)            # Collapse whitespace
    return s.strip()


def _date_overlaps(d1_start, d1_end, d2_start, d2_end) -> bool:
    """Check if two date ranges overlap."""
    try:
        s1 = datetime.strptime(d1_start[:10], "%Y-%m-%d")
        e1 = datetime.strptime(d1_end[:10], "%Y-%m-%d")
        s2 = datetime.strptime(d2_start[:10], "%Y-%m-%d")
        e2 = datetime.strptime(d2_end[:10], "%Y-%m-%d")
        return s1 <= e2 and s2 <= e1
    except (ValueError, TypeError):
        return False


def load_fandom_data():
    """Load cached Fandom spawn table JSON."""
    try:
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("data", [])
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return []


def update_fandom_cache():
    """Fetch all Fandom pages and save to JSON."""
    import time
    dates = fetch_all_dates()
    all_data = []
    for date_str in dates:
        try:
            r = fetch_page(date_str)
            all_data.append(r)
            time.sleep(1.0)
        except Exception as e:
            print(f"  [FANDOM] Failed {date_str}: {e}")
    
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump({"data": all_data, "fetched_at": datetime.now().isoformat()}, f, ensure_ascii=False, indent=2)
    
    print(f"[FANDOM] Cached {len(all_data)} pages to {JSON_PATH}")
    return all_data


def match_and_update(session, fandom_data):
    """
    Match Fandom spawn data with lunaris tower schedules in the database.
    Update enemy quantities where matches are found.
    """
    if not fandom_data:
        print("[FANDOM] No data to match")
        return 0
    
    # Get all tower schedules with their begin/end times
    groups = (
        session.query(ChallengeGroup)
        .filter_by(mode=MODE_TOWER)
        .order_by(ChallengeGroup.schedule_id.asc())
        .all()
    )
    
    updated = 0
    matched_groups = 0
    
    for group in groups:
        if not group.begin_time or not group.end_time:
            continue
        
        # Find ALL matching Fandom pages by date overlap (some spans need 2 pages)
        matching_pages = []
        for page in fandom_data:
            page_start = page.get("start", "")
            page_end = page.get("end", "")
            if not page_start:
                continue
            if not page_end:
                page_end = page_start  # fallback
            
            if _date_overlaps(group.begin_time, group.end_time, page_start, page_end):
                matching_pages.append(page)
        
        if not matching_pages:
            continue
        
        # Build combined name→count map from all matching pages (only Floor 12)
        fandom_counts = {}
        for page in matching_pages:
            for floor_data in page.get("floors", []):
                if floor_data["floor"] != 12:
                    continue
                for ci, chamber in floor_data.get("chambers", {}).items():
                    ci_int = int(ci)
                    for half in [1, 2]:
                        # Half keys may be int or str
                        actual = chamber.get(half) or chamber.get(str(half))
                        if not actual:
                            continue
                        for enemy in actual.get("enemies", []):
                            norm_name = _normalize(enemy["name"])
                            key = (12, ci_int, half, norm_name)
                            fandom_counts[key] = enemy["count"]
        
        # Get all maze levels for this group
        levels = (
            session.query(MazeLevel)
            .filter_by(challenge_group_id=group.id)
            .all()
        )
        
        group_updated = 0
        level_hp_changes = {}  # level_id -> new_total_hp
        for lv in levels:
            chamber_idx = (lv.stage_num - 1) // 2 + 1
            half = lv.half
            floor = 12
            
            enemies = (
                session.query(Enemy)
                .filter_by(maze_level_id=lv.id)
                .all()
            )
            
            for enemy in enemies:
                norm_name = _normalize(enemy.monster_name)
                key = (floor, chamber_idx, half, norm_name)
                if key in fandom_counts:
                    new_qty = fandom_counts[key]
                    if enemy.quantity != new_qty:
                        enemy.quantity = new_qty
                        group_updated += 1
            
            # Recalculate total HP for this level based on updated quantities
            new_total = sum(e.hp * e.quantity for e in enemies)
            if abs(new_total - lv.total_hp) > 0.01:
                level_hp_changes[lv.id] = {"old": lv.total_hp, "new": new_total}
                lv.total_hp = new_total
                lv.min_dps = new_total / (lv.time_limit or 90)
        
        if group_updated > 0 or level_hp_changes:
            session.commit()
            updated += group_updated
            matched_groups += 1
            if level_hp_changes:
                hp_updates = len(level_hp_changes)
                print(f"  [FANDOM] {group.schedule_id} '{group.name[:30]}': {group_updated} qtys + {hp_updates} HP recalc")
            else:
                print(f"  [FANDOM] Updated {group_updated} enemies in schedule {group.schedule_id} '{group.name[:30]}'")
    
    print(f"[FANDOM] Matched {matched_groups}/{len(groups)} schedules, updated {updated} enemies")
    return updated


def auto_verify_hp():
    """Auto-verify and fix HP values using HomDGCat lookup + GamesAndChill fallback."""
    import json, os
    from sqlalchemy import text
    
    LOOKUP_PATH = os.path.join(os.path.dirname(__file__), 'gi_hp_lookup.json')
    GC_CACHE = os.path.join(os.path.dirname(__file__), 'gc_new_monsters.json')
    
    session = get_session()
    try:
        # Load HomDGCat lookup
        with open(LOOKUP_PATH, 'r', encoding='utf-8') as f:
            lookup = json.load(f)
        
        # Build EN name index
        en_lookup = {}
        for mid, entry in lookup.items():
            en = entry.get('name_en', '')
            if en:
                en_lookup[en.lower()] = entry
        
        # Load GC cache for new monster fallback
        gc_cache = {}
        if os.path.exists(GC_CACHE):
            with open(GC_CACHE, 'r', encoding='utf-8') as f:
                gc_cache = json.load(f)
        
        # Get coefficient for schedule
        def get_coeff(schedule_id):
            sid = int(schedule_id)
            return 3.75 if sid >= 100 else (3.0 if sid >= 97 else 2.5)
        
        # Collect all tower enemies
        rows = session.execute(text("""
            SELECT e.id, e.monster_name, e.monster_level, e.hp, e.quantity,
                   ml.id as ml_id, ml.time_limit, cg.schedule_id
            FROM gi_enemies e
            JOIN gi_maze_levels ml ON e.maze_level_id = ml.id
            JOIN gi_challenge_groups cg ON ml.challenge_group_id = cg.id
            WHERE cg.mode = 'tower' AND e.monster_level > 0
        """)).fetchall()
        
        fixes = 0
        affected_ml = set()
        
        for eid, name, level, hp, qty, ml_id, time_limit, schedule_id in rows:
            lv = int(level)
            correct_hp = None
            
            # 1. GamesAndChill first (authoritative, no calibration needed)
            if gc_cache:
                from gi_gc_scraper import get_hp as gc_get_hp
                correct_hp = gc_get_hp(name, lv)
            
            # 2. HomDGCat lookup (pre-computed, covers historical monsters)
            hdc_data = None
            if not correct_hp:
                en_lower = name.lower()
                entry = en_lookup.get(en_lower)
                if not entry:
                    for k, v in en_lookup.items():
                        if k in en_lower or en_lower in k:
                            entry = v
                            break
                
                if entry:
                    coeff = get_coeff(schedule_id)
                    lv_str = str(lv)
                    coeff_key = str(coeff).replace('.0','')
                    raw = entry.get(lv_str, {}).get(coeff_key)
                    if raw is None:
                        for ks in [str(coeff), f'{coeff:.1f}', f'{coeff:.2f}']:
                            raw = entry.get(lv_str, {}).get(ks)
                            if raw is not None:
                                break
                    
                    if raw is not None:
                        if isinstance(raw, dict):
                            correct_hp = raw.get('hp', 0)
                            hdc_data = raw
                        else:
                            correct_hp = float(raw)
            
            if not correct_hp:
                continue
            
            corrected_atk = hdc_data.get('atk', 0) if hdc_data else 0
            corrected_def = hdc_data.get('def', 0) if hdc_data else 0
            
            if abs(hp - correct_hp) / max(1, correct_hp) > 0.02:
                session.execute(text(
                    "UPDATE gi_enemies SET hp=:hp, atk=:atk, def=:def WHERE id=:id"
                ), {"hp": correct_hp, "atk": corrected_atk, "def": corrected_def, "id": eid})
                fixes += 1
                affected_ml.add((ml_id, time_limit or 90))
        
        # Recalculate maze levels
        for ml_id, tl in affected_ml:
            result = session.execute(text("""
                SELECT COALESCE(SUM(e.hp * e.quantity), 0)
                FROM gi_enemies e WHERE e.maze_level_id = :ml_id
            """), {"ml_id": ml_id}).fetchone()
            new_total = result[0]
            if new_total > 0:
                session.execute(text("""
                    UPDATE gi_maze_levels SET total_hp = :hp, min_dps = :dps WHERE id = :id
                """), {"hp": new_total, "dps": new_total / tl, "id": ml_id})
        
        if fixes:
            session.commit()
            print(f"[HP-VERIFY] HomDGCat: fixed {fixes} HP across {len(affected_ml)} levels")
        else:
            print("[HP-VERIFY] HomDGCat: all HP values correct")
        return fixes
    finally:
        session.close()


def enrich_with_fandom():
    """Main entry: update Fandom cache and match with DB."""
    session = get_session()
    try:
        print("[FANDOM] Loading cached data...")
        fandom_data = load_fandom_data()
        
        if not fandom_data:
            print("[FANDOM] No cache found, fetching all pages...")
            fandom_data = update_fandom_cache()
        
        print(f"[FANDOM] Loaded {len(fandom_data)} pages, matching...")
        updated = match_and_update(session, fandom_data)
        
        # Auto-verify HP after enrichment
        auto_verify_hp()
        
        # Apply GC structured data to latest schedule (positional match)
        apply_gc_structured()
        
        return updated
    finally:
        session.close()


def verify_leyline_hp():
    """Verify Leyline (Stygian Onslaught) boss HP against GamesAndChill data."""
    import json, os
    from sqlalchemy import text
    
    GC_CONF = os.path.join(os.path.dirname(__file__), 'gc_conf_bosses.json')
    if not os.path.exists(GC_CONF):
        print("[LEYLINE-VERIFY] No GC cache, skipping")
        return 0
    
    with open(GC_CONF, 'r', encoding='utf-8') as f:
        gc_data = json.load(f)
    
    session = get_session()
    try:
        fixes = 0
        rows = session.execute(text("""
            SELECT e.id, e.monster_name, e.hp, e.quantity,
                   ml.id as ml_id, ml.time_limit, cg.mode
            FROM gi_enemies e
            JOIN gi_maze_levels ml ON e.maze_level_id = ml.id
            JOIN gi_challenge_groups cg ON ml.challenge_group_id = cg.id
            WHERE cg.mode IN ('leyline_n5', 'leyline_n6')
        """)).fetchall()
        
        for eid, name, hp, qty, ml_id, tl, mode in rows:
            diff = 'n5' if 'n5' in mode else 'n6'
            name_lower = name.lower()
            
            gc_hp = None
            for gc_name, gc_data_entry in gc_data.items():
                if name_lower == gc_name.lower() or name_lower in gc_name.lower() or gc_name.lower() in name_lower:
                    gc_hp = gc_data_entry.get(diff)
                    break
            
            if gc_hp and abs(hp - gc_hp) / max(1, gc_hp) > 0.02:
                session.execute(text("UPDATE gi_enemies SET hp = :hp WHERE id = :id"),
                              {"hp": gc_hp, "id": eid})
                fixes += 1
                # Recalculate DPS
                new_total = gc_hp * qty
                tl_val = tl or 120
                session.execute(text("""
                    UPDATE gi_maze_levels SET total_hp = :hp, min_dps = :dps WHERE id = :id
                """), {"hp": new_total, "dps": new_total / tl_val, "id": ml_id})
        
        if fixes:
            session.commit()
            print(f"[LEYLINE-VERIFY] GC: fixed {fixes} boss HP values")
        else:
            print("[LEYLINE-VERIFY] GC: all Leyline HP correct")
        return fixes
    finally:
        session.close()


def apply_gc_structured():
    """
    Match ALL tower schedules against GC structured data by monster name fingerprint,
    then fix HP/names by position. Covers all GC versions (6.2~6.7).
    """
    import json, os
    from sqlalchemy import text
    
    STRUCTURED = os.path.join(os.path.dirname(__file__), 'gc_abyss_structured.json')
    if not os.path.exists(STRUCTURED):
        print("[GC-STRUCT] No structured cache")
        return 0
    
    with open(STRUCTURED, 'r', encoding='utf-8') as f:
        gc_data = json.load(f)
    
    # Build GC name fingerprints
    gc_names = {}
    for v, chambers in gc_data.items():
        for label, data in chambers.items():
            ch = label.split()[0]
            for side in ['first_half', 'second_half']:
                enemies = data.get(side, [])
                names = frozenset(e['name'] for e in enemies)
                if names:
                    gc_names[(v, ch, side)] = names
    
    chamber_map = {1: '12-1', 2: '12-1', 3: '12-2', 4: '12-2', 5: '12-3', 6: '12-3'}
    side_map = {1: 'first_half', 2: 'second_half'}
    
    session = get_session()
    try:
        groups = session.execute(text("""
            SELECT id, schedule_id FROM gi_challenge_groups
            WHERE mode = 'tower' ORDER BY CAST(schedule_id AS INTEGER) DESC
        """)).fetchall()
        
        total_fixes = 0
        
        for group_id, sched_id in groups:
            # Get levels
            levels = session.execute(text("""
                SELECT id, stage_num, half FROM gi_maze_levels
                WHERE challenge_group_id = :gid ORDER BY stage_num, half
            """), {"gid": group_id}).fetchall()
            
            # Build DB name fingerprint
            db_names = {}
            for lr in levels:
                ch = chamber_map.get(lr[1], '12-1')
                side = side_map.get(lr[2], 'first_half')
                enemies = session.execute(text("""
                    SELECT monster_name FROM gi_enemies WHERE maze_level_id = :mlid ORDER BY id
                """), {"mlid": lr[0]}).fetchall()
                names = frozenset(r[0] for r in enemies)
                if names:
                    db_names[(ch, side)] = names
            
            # Find best GC version match
            best_v = None
            best_score = 0
            for v in sorted(gc_data.keys(), reverse=True):
                score = 0
                for (ch, side), db_set in db_names.items():
                    gc_set = gc_names.get((v, ch, side))
                    if gc_set and gc_set == db_set:
                        score += 3
                    elif gc_set:
                        overlap = len(db_set & gc_set)
                        if overlap >= 1:
                            score += overlap
                if score > best_score:
                    best_score = score
                    best_v = v
                # Early exit if perfect match
                if best_score >= 15:
                    break
            
            if not best_v or best_score < 3:
                continue
            
            # Apply fixes
            schedule_fixes = 0
            for lr in levels:
                ch = chamber_map.get(lr[1], '12-1')
                side = side_map.get(lr[2], 'first_half')
                
                gc_enemies = []
                for label, data in gc_data[best_v].items():
                    if label.startswith(ch):
                        gc_enemies = data.get(side, [])
                        break
                
                if not gc_enemies:
                    continue
                
                db_enemies = session.execute(text("""
                    SELECT id, monster_name, hp, quantity FROM gi_enemies
                    WHERE maze_level_id = :mlid ORDER BY id
                """), {"mlid": lr[0]}).fetchall()
                
                fixed = False
                for i, e in enumerate(db_enemies):
                    if i >= len(gc_enemies):
                        break
                    gc_e = gc_enemies[i]
                    if abs(e[2] - gc_e['hp']) / max(1, gc_e['hp']) > 0.02 or e[1] != gc_e['name']:
                        session.execute(text("UPDATE gi_enemies SET hp=:hp, monster_name=:nm WHERE id=:id"),
                                      {"hp": gc_e['hp'], "nm": gc_e['name'], "id": e[0]})
                        schedule_fixes += 1
                        fixed = True
                
                if fixed:
                    result = session.execute(text("""
                        SELECT COALESCE(SUM(hp*quantity),0) FROM gi_enemies WHERE maze_level_id=:mlid
                    """), {"mlid": lr[0]}).fetchone()
                    if result[0] > 0:
                        session.execute(text("""
                            UPDATE gi_maze_levels SET total_hp=:hp, min_dps=:dps WHERE id=:id
                        """), {"hp": result[0], "dps": result[0]/90, "id": lr[0]})
            
            if schedule_fixes > 0:
                session.commit()
                print(f"[GC-STRUCT] S{sched_id} ↔ GC {best_v}: {schedule_fixes} fixes")
                total_fixes += schedule_fixes
        
        if total_fixes == 0:
            print("[GC-STRUCT] All schedules verified")
        return total_fixes
    finally:
        session.close()


if __name__ == "__main__":
    enrich_with_fandom()
