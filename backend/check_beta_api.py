import requests

r = requests.get("https://www.huroka.com/api/challenge?branch=beta")
data = r.json()
print(f"Total: {len(data)} groups")

for gtype in ["Memory", "Story", "Boss", "Peak"]:
    items = [c for c in data if c.get("groupType") == gtype]
    ids = sorted(int(c["id"]) for c in items)
    print(f"\n{gtype}: {len(items)} groups")
    print(f"  Max ID: {max(ids)}")
    last = items[-3:]
    for c in last:
        tierce = c.get("hasTierce", False)
        print(f"  ID={c['id']} sch={c.get('scheduleDataId',0)} name={c['name']} tierce={tierce}")
