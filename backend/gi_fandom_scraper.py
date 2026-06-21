"""
Fandom Wiki Spiral Abyss scraper - PRODUCTION VERSION v2.
Extracts floor/chamber/half/enemy_name/count/monster_level from Wiki {{Domain Enemies}} templates.
Covers all 54 rotations from 2020-09-28 to 2026-06-16.
"""
import re, time, requests

API = "https://genshin-impact.fandom.com/api.php"
HEADERS = {"User-Agent": "GI-Challenge-Scraper/2.0"}
ALL_FLOORS = [9, 10, 11, 12]

_session = requests.Session()
_session.headers.update(HEADERS)


def _clean_name(s: str) -> str:
    """Remove wiki markup from monster name."""
    s = re.sub(r'\{\{.*?\}\}', '', s)       # Remove {{...}} templates
    s = re.sub(r'\[\[.*?\|', '', s)          # Remove [[Page|display]]
    s = re.sub(r'[\[\]]', '', s)             # Remove remaining brackets
    s = re.sub(r'<.*?>', '', s)              # Remove HTML tags
    s = re.sub(r"'''.*?'''", '', s).strip()  # Remove bold
    # Remove trailing template fragments like *1/ or *+
    s = re.sub(r'\s*\*.*$', '', s).strip()
    s = re.sub(r'\s*/\s*$', '', s).strip()
    return s


def _fetch_wiki_text(page_title: str) -> str:
    params = {"action": "query", "prop": "revisions", "rvprop": "content",
              "rvslots": "main", "titles": page_title, "format": "json", "formatversion": "2"}
    resp = _session.get(API, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    pages = data.get("query", {}).get("pages", [])
    if not pages:
        return ""
    return pages[0].get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "")


def _parse_domain_enemies(template_text: str) -> dict:
    """Parse a single {{Domain Enemies}} template."""
    params = {}
    for line in template_text.split("\n"):
        m = re.match(r"\|\s*(\w+)\s*=\s*(.*)", line.strip())
        if m:
            key, val = m.group(1).strip(), m.group(2).strip()
            val = re.sub(r'<!--.*?-->', '', val).strip()
            if val:
                params[key] = val
    
    result = {}
    for ci_s in set(re.findall(r"^level(\d+)", "\n".join(params.keys()), re.M)):
        ci = int(ci_s)
        try:
            level = int(params.get(f"level{ci}", "0"))
        except ValueError:
            level = 0
        
        result[ci] = {}
        for half in [1, 2]:
            raw = params.get(f"enemies{ci}_{half}", "")
            if not raw:
                continue
            
            # Parse: "Name*3;Name*2" or "Name//Name" or mixed
            waves = raw.split("//")
            all_enemies = []
            for wave in waves:
                wave = wave.strip()
                if not wave:
                    continue
                groups = wave.split(";")
                for group in groups:
                    group = group.strip()
                    if not group:
                        continue
                    m = re.match(r"^(.*?)\s*\*\s*(\d+)$", group)
                    if m:
                        name = _clean_name(m.group(1))
                        cnt = int(m.group(2))
                    else:
                        name = _clean_name(group)
                        cnt = 1
                    if name:
                        all_enemies.append({"name": name, "count": cnt})
            
            if all_enemies:
                result[ci][half] = {"level": level, "enemies": all_enemies}
    
    return result


def _get_meta(wiki_text: str) -> dict:
    meta = {}
    for key, pattern in [
        ("start", r'start\s*=\s*([\d-]+)'),
        ("end", r'end\s*=\s*([\d-]+)'),
        ("version", r'startVersion\s*=\s*(.+)'),
    ]:
        m = re.search(pattern, wiki_text)
        if m:
            meta[key] = m.group(1).strip()
    return meta


def fetch_all_dates() -> list[str]:
    params = {"action": "query", "list": "categorymembers",
              "cmtitle": "Category:Spiral_Abyss_Floors", "cmprop": "title",
              "cmlimit": 500, "format": "json", "formatversion": "2"}
    resp = _session.get(API, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    dates = []
    for member in data.get("query", {}).get("categorymembers", []):
        m = re.search(r"(\d{4}-\d{2}-\d{2})", member["title"])
        if m:
            dates.append(m.group(1))
    return sorted(dates)


def fetch_page(date_str: str) -> dict:
    """Fetch and parse a Fandom wiki floor page."""
    page_title = f"Spiral_Abyss/Floors/{date_str}"
    wiki_text = _fetch_wiki_text(page_title)
    if not wiki_text:
        return {"error": "Empty page"}
    
    meta = _get_meta(wiki_text)
    floors_data = []
    
    # Split by ===Floor N=== headers (3 = signs for H3)
    floor_sections = re.split(r"===\s*Floor\s*(\d+)\s*===\s*\n", wiki_text)
    for i in range(1, len(floor_sections), 2):
        floor_num = int(floor_sections[i])
        floor_content = floor_sections[i+1] if i+1 < len(floor_sections) else ""
        
        m = re.search(r"\{\{Domain Enemies\s*\n(.*?)\}\}", floor_content, re.DOTALL)
        if m:
            chambers = _parse_domain_enemies(m.group(0))
            if chambers:
                floors_data.append({"floor": floor_num, "chambers": chambers})
    
    # Fallback: find any untagged templates, determine floor from context
    for m in re.finditer(r"\{\{Domain Enemies\s*\n(.*?)\}\}", wiki_text, re.DOTALL):
        template_text = m.group(0)
        if any(re.search(re.escape(template_text), fs) for fs in floor_sections[2::2] if isinstance(fs, str)):
            continue
        chambers = _parse_domain_enemies(template_text)
        if chambers:
            pos = m.start()
            before = wiki_text[:pos]
            fm = re.search(r"===\s*Floor\s*(\d+)\s*=+", before[::-1])
            floor_num = int(fm.group(1)[::-1]) if fm else 12
            floors_data.append({"floor": floor_num, "chambers": chambers})
    
    floors_data = [f for f in floors_data if f["floor"] in ALL_FLOORS]
    # Dedup: keep first occurrence per floor
    seen = set()
    unique = []
    for f in floors_data:
        if f["floor"] not in seen:
            seen.add(f["floor"])
            unique.append(f)
    
    return {"date": date_str, "start": meta.get("start", date_str),
            "end": meta.get("end", ""), "version": meta.get("version", ""),
            "floors": sorted(unique, key=lambda x: x["floor"])}


if __name__ == "__main__":
    print("=== Fandom Wiki Spiral Abyss Scraper ===\n")
    dates = fetch_all_dates()
    print(f"Found {len(dates)} dated pages\n")
    
    for date_str in [dates[-1], dates[0], dates[len(dates)//2]]:
        r = fetch_page(date_str)
        print(f"--- {date_str} ({r.get('version','?')}) ---")
        for fd in r.get("floors", []):
            floor = fd["floor"]
            for ci in sorted(fd["chambers"]):
                data = fd["chambers"][ci]
                for half in [1, 2]:
                    if half in data:
                        names = ", ".join(f"{e['count']}x {e['name']}" for e in data[half]["enemies"])
                        total = sum(e["count"] for e in data[half]["enemies"])
                        print(f"  F{floor} C{ci} H{half} Lv{data[half]['level']}: [{total}] {names}")
        print()
