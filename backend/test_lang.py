import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import requests, json

base = "https://www.huroka.com"

# Fetch Chinese textmap
print("=== Fetching Chinese textmap ===")
r = requests.get(f"{base}/api/textmap?lang=chs&branch=prod", timeout=60)
data_zh = r.json()
print(f"Type: {type(data_zh)}")
if isinstance(data_zh, dict):
    print(f"Keys count: {len(data_zh)}")
    for i, (k, v) in enumerate(data_zh.items()):
        if i >= 5:
            break
        print(f"  {k}: {v}")

# Fetch English textmap
print("\n=== Fetching English textmap ===")
r2 = requests.get(f"{base}/api/textmap?lang=en&branch=prod", timeout=60)
data_en = r2.json()
if isinstance(data_en, dict):
    print(f"Keys count: {len(data_en)}")

# Search for known names
print("\n=== Looking for known names ===")
if isinstance(data_zh, dict) and isinstance(data_en, dict):
    for search_term in ["Favor of Amber", "Flamespawn", "Forgotten Hall", "Memory Turbulence", "Incineration Shadewalker"]:
        found = False
        for k, v in data_en.items():
            if isinstance(v, str) and v == search_term:
                zh_val = data_zh.get(k, "NOT FOUND")
                print(f"  EN '{search_term}' -> ZH '{zh_val}' (key={k})")
                found = True
                break
        if not found:
            print(f"  '{search_term}': not found")

    # Also check: are the keys the same in both?
    zh_keys = set(data_zh.keys())
    en_keys = set(data_en.keys())
    print(f"\n  Same keys: {zh_keys == en_keys}")
    print(f"  ZH only: {len(zh_keys - en_keys)}, EN only: {len(en_keys - zh_keys)}")

# Save to file for inspection
with open("textmap_zh_sample.json", "w", encoding="utf-8") as f:
    sample = dict(list(data_zh.items())[:50])
    json.dump(sample, f, ensure_ascii=False, indent=2)
print("\nSaved sample to textmap_zh_sample.json")
