"""
GamesAndChill scraper for abyss monster HP (Floor 12).
Extracts per-monster HP from HTML-embedded React state via plain requests.
"""
import urllib.request, re, json, html, os
from collections import defaultdict

GC_BASE = "https://gamesndchill.com/end-game/abyss/"
CACHE_PATH = os.path.join(os.path.dirname(__file__), "gc_new_monsters.json")


def scrape_version(version_slug):
    """Scrape one GC version, return {monster_name: {level: hp}} for Floor 12."""
    url = GC_BASE + version_slug + "/"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode('utf-8')
    
    unescaped = html.unescape(raw)
    results = {}
    
    # Find all F12 encounter blocks by locating their labels
    f12_labels = [(m.start(), m.group(1), m.group(2)) for m in 
                  re.finditer(r'"label":\[0,"(12-\d Lv(\d+))"\]', unescaped)]
    
    for pos, label, lv_str in f12_labels:
        level = int(lv_str)
        # Get chunk: from this label to next encounter boundary (~8KB)
        chunk = unescaped[pos:pos+10000]
        
        # Find all enemy wave blocks within this chunk
        # Each wave has "side":[...], "enemies":[...]
        wave_blocks = re.findall(
            r'"side":\[0,"(first_half|second_half)"\].*?"enemies":\[1,\[(.*?)\]\]',
            chunk, re.DOTALL
        )
        
        for side, enemies_str in wave_blocks:
            # Extract individual enemy entries from the enemies array
            # Each enemy: [0,{"name":[...],"count":[...],"hp":[...]}]
            enemy_entries = re.findall(
                r'"name":\[0,"([^"]+)"\]',
                enemies_str
            )
            count_entries = re.findall(
                r'"count":\[0,(\d+)\]',
                enemies_str
            )
            hp_entries = re.findall(
                r'"hp":\[0,"(\d+)"\]',
                enemies_str
            )
            
            # Zip name, count, hp
            for i in range(min(len(enemy_entries), len(count_entries), len(hp_entries))):
                name = enemy_entries[i].strip()
                count = int(count_entries[i])
                hp = int(hp_entries[i])
                
                # Skip labels/chamber names
                if name.startswith(('12-', '11-', '10-', '9-')) or name == 'Spiral Abyss':
                    continue
                
                results.setdefault(name, {})[level] = hp
    
    return results


def update_cache(versions=None):
    """Scrape GC and merge into cache JSON."""
    if versions is None:
        versions = ['6-7']
    
    cache = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, 'r', encoding='utf-8') as f:
            cache = json.load(f)
    
    for v in versions:
        try:
            print(f"Scraping GC {v}...")
            data = scrape_version(v)
            print(f"  Floor 12 monsters: {len(data)}")
            for name, levels in list(data.items())[:5]:
                print(f"    {name}: {levels}")
            cache[v] = data
        except Exception as e:
            print(f"  Failed: {e}")
            import traceback; traceback.print_exc()
    
    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    
    total = sum(len(v) for v in cache.values())
    print(f"Cache: {total} entries across {len(cache)} versions")
    return cache


def get_hp(monster_name, level):
    """Look up Floor 12 HP from GC cache (latest version first)."""
    if not os.path.exists(CACHE_PATH):
        return None
    
    with open(CACHE_PATH, 'r', encoding='utf-8') as f:
        cache = json.load(f)
    
    for v in sorted(cache.keys(), reverse=True):
        for name, data in cache[v].items():
            if name.lower() == monster_name.lower():
                return data.get(str(level)) or data.get(level)
    
    # Fuzzy match
    name_lower = monster_name.lower()
    for v in sorted(cache.keys(), reverse=True):
        for name, data in cache[v].items():
            if name_lower in name.lower() or name.lower() in name_lower:
                return data.get(str(level)) or data.get(level)
    
    return None


def scrape_structured(version_slug):
    """Scrape Floor 12 with full structure: chamber→half→wave→[enemies].
    Returns dict: {chamber_label: {side: [(name, count, hp), ...]}}"""
    url = GC_BASE + version_slug + "/"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode('utf-8')
    
    unescaped = html.unescape(raw)
    chambers = {}
    
    f12_labels = [(m.start(), m.group(1), m.group(2)) for m in 
                  re.finditer(r'"label":\[0,"(12-\d Lv(\d+))"\]', unescaped)]
    
    for pos, label, lv_str in f12_labels:
        chunk = unescaped[pos:pos+10000]
        chamber_data = {'first_half': [], 'second_half': []}
        
        wave_blocks = re.findall(
            r'"side":\[0,"(first_half|second_half)"\].*?"enemies":\[1,\[(.*?)\]\]',
            chunk, re.DOTALL
        )

        for side, enemies_str in wave_blocks:
            names = re.findall(r'"name":\[0,"([^"]+)"\]', enemies_str)
            counts = re.findall(r'"count":\[0,(\d+)\]', enemies_str)
            hps = re.findall(r'"hp":\[0,"(\d+)"\]', enemies_str)

            for i in range(min(len(names), len(counts), len(hps))):
                name = names[i].strip()
                if name.startswith(('12-', '11-', '10-', '9-')) or name == 'Spiral Abyss':
                    continue
                chamber_data[side].append({
                    'name': name,
                    'count': int(counts[i]),
                    'hp': int(hps[i])
                })

        if chamber_data['first_half'] or chamber_data['second_half']:
            chambers[label] = chamber_data
    
    return chambers


STRUCTURED_CACHE = os.path.join(os.path.dirname(__file__), "gc_abyss_structured.json")


def update_structured_cache(versions=None):
    """Scrape structured Fl12 data and save."""
    if versions is None:
        versions = ['6-7']
    all_data = {}
    for v in versions:
        try:
            all_data[v] = scrape_structured(v)
            print(f"GC structured {v}: {len(all_data[v])} chambers")
        except Exception as e:
            print(f"Failed {v}: {e}")
    with open(STRUCTURED_CACHE, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)
    return all_data


if __name__ == "__main__":
    update_cache()
    update_structured_cache()
    
    # Verify structured
    import json as j
    with open(STRUCTURED_CACHE) as f:
        sd = j.load(f)
    for v, chambers in sd.items():
        print(f"\n{v}:")
        for label, data in chambers.items():
            for side in ['first_half', 'second_half']:
                enemies = data.get(side, [])
                if enemies:
                    names = [f"{e['name']}({e['hp']:,})" for e in enemies]
                    print(f"  {label} {side}: {', '.join(names)}")
