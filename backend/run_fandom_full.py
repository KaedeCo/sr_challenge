"""Full Fandom Wiki scraper - fetches all 54 pages and saves to JSON."""
import sys, json, time
from gi_fandom_scraper import fetch_page, fetch_all_dates

OUTPUT = "/opt/sr-challenge/backend/fandom_spawn_table.json"

print("=== GI Fandom Wiki Full Scraper ===\n")
dates = fetch_all_dates()
print(f"Found {len(dates)} pages to fetch\n")

all_data = []
errors = []

for i, date_str in enumerate(dates):
    try:
        r = fetch_page(date_str)
        floors_count = len(r.get("floors", []))
        all_data.append(r)
        print(f"  [{i+1:2d}/{len(dates)}] {date_str}  {r.get('version','?'):15s}  {floors_count} floors")
    except Exception as e:
        print(f"  [{i+1:2d}/{len(dates)}] {date_str}  ERROR: {e}")
        errors.append({"date": date_str, "error": str(e)})
    time.sleep(1.0)

with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump({"data": all_data, "errors": errors, "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S")}, f, ensure_ascii=False, indent=2)

print(f"\n{'='*50}")
print(f"Done! {len(all_data)} pages saved to {OUTPUT}")
if errors:
    print(f"{len(errors)} errors: {[e['date'] for e in errors]}")
else:
    print("All pages fetched successfully!")
print(f"{'='*50}")
