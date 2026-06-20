import requests

r = requests.get("http://localhost:8765/api/seasons/anomaly_arbitration")
print("Names:")
for s in r.json():
    print(f"  {s['api_id']}: {s['name']}")

print("\n--- AA detail (season 106) ---")
r2 = requests.get("http://localhost:8765/api/season/106")
data = r2.json()
print(f"Name: {data['name']}")
print(f"Levels: {len(data['levels'])}")
for lv in data["levels"]:
    print(f"  {lv['name']} ({lv['category']}): {len(lv['enemies'])} enemies, HP={lv['total_hp']:.0f}")
