import json
from models import get_session, ChallengeGroup, MazeLevel

s = get_session()
groups = s.query(ChallengeGroup).filter_by(mode='forgotten_hall').order_by(ChallengeGroup.id.asc()).limit(5).all()
for g in groups:
    buffs = json.loads(g.season_buffs) if g.season_buffs else []
    levels = s.query(MazeLevel).filter_by(challenge_group_id=g.id).all()
    print(f'=== {g.name} (id={g.id}) ===')
    print(f'  season_buffs: {len(buffs)} entries')
    for b in buffs[:2]:
        n = b.get("name", "?")
        d = b.get("desc", "?")
        print(f'    - {n}: {d[:80]}')
    for lv in levels:
        bn = lv.buff_name
        bd = lv.buff_desc[:80] if lv.buff_desc else None
        print(f'  Level: {lv.name} | buff_name={bn!r} | buff_desc={bd!r}')

# Also check one PF for comparison
print('\n\n=== PF comparison ===')
pf_groups = s.query(ChallengeGroup).filter_by(mode='pure_fiction').order_by(ChallengeGroup.id.asc()).limit(3).all()
for g in pf_groups:
    buffs = json.loads(g.season_buffs) if g.season_buffs else []
    levels = s.query(MazeLevel).filter_by(challenge_group_id=g.id).all()
    print(f'=== {g.name} (id={g.id}) ===')
    print(f'  season_buffs: {len(buffs)} entries')
    for b in buffs[:2]:
        n = b.get("name", "?")
        d = b.get("desc", "?")
        print(f'    - {n}: {d[:80]}')
    for lv in levels:
        bn = lv.buff_name
        bd = lv.buff_desc[:80] if lv.buff_desc else None
        print(f'  Level: {lv.name} | buff_name={bn!r} | buff_desc={bd!r}')

s.close()
