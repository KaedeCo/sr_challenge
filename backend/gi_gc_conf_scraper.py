"""
GamesAndChill Conflagration (Stygian Onslaught) scraper.
Extracts boss HP for N5/N6 difficulties from embedded React state.
"""
import urllib.request, re, json, html, os

GC_CONF_URL = "https://gamesndchill.com/end-game/conflagration/"
CACHE_PATH = os.path.join(os.path.dirname(__file__), "gc_conf_bosses.json")


def scrape():
    """Scrape GC Conflagration and return {boss_name: {n5: hp, n6: hp}}."""
    req = urllib.request.Request(GC_CONF_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode('utf-8')
    
    unescaped = html.unescape(raw)
    results = {}
    
    # Pattern: "name":[0,"Boss Name"],...,"hp_data":[0,{"n5":[0,"N"],"n6":[0,"N"]}]
    for m in re.finditer(
        r'"name":\[0,"([^"]+)"\]',
        unescaped
    ):
        name = m.group(1).strip()
        # Skip labels/UI elements
        if not name or name.startswith(('N4', 'N5', 'Conflag')) or '/' in name:
            continue
        if len(name) < 5:
            continue
        
        # Get hp_data from context after this name
        pos = m.start()
        ctx = unescaped[pos:pos+3000]
        
        hp_match = re.search(
            r'"hp_data":\[0,\{.*?"n5":\[0,"(\d+)"\].*?"n6":\[0,"(\d+)"\].*?\}\]',
            ctx, re.DOTALL
        )
        
        if hp_match:
            n5_hp = int(hp_match.group(1))
            n6_hp = int(hp_match.group(2))
            results[name] = {'n5': n5_hp, 'n6': n6_hp}
    
    return results


def update_cache():
    """Scrape and save to cache."""
    data = scrape()
    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Conflagration cache: {len(data)} bosses saved")
    return data


def get_hp(boss_name, difficulty):
    """Look up boss HP by name. difficulty = 'n5' or 'n6'."""
    if not os.path.exists(CACHE_PATH):
        return None
    with open(CACHE_PATH, 'r', encoding='utf-8') as f:
        cache = json.load(f)
    
    name_lower = boss_name.lower()
    for name, data in cache.items():
        if name_lower == name.lower() or name_lower in name.lower() or name.lower() in name_lower:
            return data.get(difficulty)
    return None


if __name__ == "__main__":
    update_cache()
    # Verify
    for name in ["Whisperer of Nightmares", "Secret Source Automaton", "Control Array"]:
        for diff in ['n5', 'n6']:
            hp = get_hp(name, diff)
            if hp:
                print(f'{name} {diff}: {hp:,}')
