"""
HP calculator for Spiral Abyss monsters.
Uses HomDGCat hardlevelgroup curves + monster database.
"""

import demjson3, json, os, re
from collections import defaultdict

# ---- Load data ----

# Level curves
with open(r'F:\homdgcat-site\site\data\LevelCurves.js', 'r', encoding='utf-8') as f:
    d = f.read()
var_start = d.index('var _hardlevelgroup')
eq = d.index('=', var_start)
brace = d.index('{', eq)
depth = 0
for i in range(brace, len(d)):
    if d[i] == '{': depth += 1
    elif d[i] == '}':
        depth -= 1
        if depth == 0:
            hlg = demjson3.decode(d[brace:i+1])
            break

# Monster database (Chinese names)
with open(r'F:\homdgcat-site\site\gi\CH\database.js', 'r', encoding='utf-8') as f:
    d2 = f.read()
var_start = d2.index('_Monsters = {')
brace = d2.index('{', var_start)
depth = 0
for i in range(brace, min(len(d2), brace + 500000)):
    if d2[i] == '{': depth += 1
    elif d2[i] == '}':
        depth -= 1
        if depth == 0:
            monsters = demjson3.decode(d2[brace:i+1])
            break

# ---- Abyss coefficient timeline ----
# Source: community consensus
ABYSS_COEFF_TIMELINE = [
    # (version_start, version_end_approx, coeff, note)
    # 1.0 ~ 4.8: 250% (2.5x)
    # 5.0: 300% (3.0x)
    # 5.1+: 375% (3.75x)
    # We map to schedule_id ranges based on version release dates
]

# Floor 12 levels
FLOOR_LEVELS = {1: 95, 2: 98, 3: 100}  # chamber → level

# ---- Functions ----

def get_coeff_for_schedule(schedule_id):
    """Return abyss HP coefficient based on schedule_id and known timeline."""
    # These are approximate schedule boundaries
    # 1.0 (2020-09-28) → schedule 1
    # 5.0 (2024-08-28) → schedule ~97
    # 5.1 (2024-10-09) → schedule ~100
    
    sid = int(schedule_id)
    if sid >= 100:  # Post 5.1
        return 3.75
    elif sid >= 97:  # 5.0
        return 3.0
    else:  # 1.0 ~ 4.8
        return 2.5


def compute_monster_hp(monster_id_str, level, coeff=None, schedule_id=None):
    """
    Compute HP for a monster at given level.
    
    Args:
        monster_id_str: Monster ID as string (e.g., "61601")
        level: Monster level (95, 98, 100 for floor 12)
        coeff: Abyss HP coefficient override
        schedule_id: Schedule ID for automatic coefficient lookup
    
    Returns:
        HP value (float) or None if data missing
    """
    monster = monsters.get(monster_id_str)
    if not monster:
        return None
    
    hp_mult = float(monster['HP'])
    curve_id = str(monster['HPCurve'])
    lv_str = str(level)
    
    if curve_id not in hlg or lv_str not in hlg[curve_id]:
        return None
    
    base_hp = float(hlg[curve_id][lv_str]['HP'])
    
    if coeff is None:
        coeff = get_coeff_for_schedule(schedule_id) if schedule_id else 2.5
    
    return hp_mult * base_hp * coeff


def get_monster_info(monster_id_str):
    """Get monster name and stats from ID."""
    monster = monsters.get(monster_id_str)
    if not monster:
        return None
    return {
        'name': monster.get('Name', '?'),
        'name_en': monster.get('Name', '?'),  # CH version has Chinese names
        'hp_mult': float(monster['HP']),
        'curve_id': str(monster['HPCurve']),
        'color': monster.get('Color', ''),
    }


def compute_all_at_level(level, coeff):
    """Compute HP for all monsters at a given level and coefficient."""
    results = {}
    for mid, monster in monsters.items():
        hp_mult = float(monster['HP'])
        curve_id = str(monster['HPCurve'])
        lv_str = str(level)
        
        if curve_id in hlg and lv_str in hlg[curve_id]:
            base_hp = float(hlg[curve_id][lv_str]['HP'])
            results[mid] = {
                'name': monster.get('Name', '?'),
                'hp': hp_mult * base_hp * coeff,
                'atk': hp_mult * float(hlg[curve_id][lv_str].get('ATK', 0)) * coeff,
                'def': float(hlg[curve_id][lv_str].get('DEF', 0)),
            }
    return results


# ---- Verification ----
if __name__ == '__main__':
    # Verify against GamesAndChill ground truth
    print("=== Sternshield Crab (坚盾重甲蟹, ID 61601) ===")
    print(f"HP_mult=1.3, HPCurve=2")
    
    for coeff in [2.5, 3.0, 3.75]:
        print(f"\nAbyss coeff {coeff}x:")
        for lv in [95, 98, 100]:
            hp = compute_monster_hp('61601', lv, coeff)
            if hp:
                print(f"  Lv{lv}: {hp:,.0f}")
    
    print(f"\nGamesAndChill ground truth: Lv98 = 502,131 (coeff 3.75)")
    hp98 = compute_monster_hp('61601', 98, 3.75)
    error = abs(hp98 - 502131) / 502131 * 100 if hp98 else 0
    print(f"Our computation: Lv98 = {hp98:,.0f} (error: {error:.1f}%)")
    
    print(f"\nTotal monsters: {len(monsters)}")
    # Check curve coverage
    for cid in sorted(hlg.keys(), key=int):
        lv_range = sorted(hlg[cid].keys(), key=int)
        has_high = '95' in hlg[cid]
        print(f"  Curve {cid}: levels {lv_range[0]}-{lv_range[-1]} ({len(lv_range)} entries), has_lv95={has_high}")
