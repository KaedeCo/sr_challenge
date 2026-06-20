import requests
import json

# Get Peak list
r = requests.get("https://www.huroka.com/api/challenge?branch=beta")
data = r.json()
peaks = [c for c in data if c.get("groupType") == "Peak"]
print(f"Peak groups: {len(peaks)}")
for p in peaks:
    print(f"  ID={p['id']} sch={p.get('scheduleDataId',0)} name={p['name'][:50]}")

# Check detail for 4008
r2 = requests.get("https://www.huroka.com/api/challenge/4008?branch=beta")
d = r2.json()
print(f"\n4008 name: {d['name']}")
print(f"  levelCount: {d['levelCount']}")
print(f"  mazeLevels count: {len(d.get('mazeLevels', []))}")
print(f"  tierceMazeLevels count: {len(d.get('tierceMazeLevels', []))}")

# Print all level names
for lv in d.get("mazeLevels", []):
    print(f"  Floor={lv['floor']} stageNum={lv['stageNum']} name='{lv['name']}' monsters1={len(lv.get('monsterWaves1',[]))} waves")

# Check if there are tierce levels
if d.get("tierceMazeLevels"):
    print("\ntierceMazeLevels:")
    for lv in d["tierceMazeLevels"]:
        print(f"  Floor={lv['floor']} stageNum={lv['stageNum']} name='{lv['name']}'")
