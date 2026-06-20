from collections import Counter
from models import init_db, get_session, ChallengeGroup

init_db()
s = get_session()
for mode in ["forgotten_hall", "pure_fiction", "apocalyptic_shadow", "anomaly_arbitration"]:
    gs = s.query(ChallengeGroup).filter_by(mode=mode).all()
    names = [g.name for g in gs]
    dupes = {n: c for n, c in Counter(names).items() if c > 1}
    msg = str(dupes) if dupes else "none"
    print(f"{mode}: {len(gs)} groups, dupes: {msg}")
s.close()
