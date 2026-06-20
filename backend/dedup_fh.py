"""Deduplicate Forgotten Hall: keep only first occurrence of each season name by scheduleDataId."""
from models import init_db, get_session, ChallengeGroup

init_db()
session = get_session()

groups = (
    session.query(ChallengeGroup)
    .filter_by(mode="forgotten_hall")
    .order_by(ChallengeGroup.schedule_data_id.asc())
    .all()
)

seen = set()
to_delete = []
to_keep = []

for g in groups:
    if g.name in seen:
        to_delete.append(g)
    else:
        seen.add(g.name)
        to_keep.append(g)

print(f"Before: {len(groups)} groups")
print(f"Keeping: {len(to_keep)}")
print(f"Deleting: {len(to_delete)}")

print("\nDuplicates to remove:")
for g in to_delete:
    print(f"  DELETE: {g.name} (id={g.api_id}, sch={g.schedule_data_id})")

for g in to_delete:
    session.delete(g)

session.commit()
print(f"\nAfter: {len(to_keep)} unique groups")
session.close()
