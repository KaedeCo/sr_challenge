"""
Re-scrape challenges that have Starward Mode (tierceMazeLevels).
Detects: 1033 (Academy Ghost Story), 2024 (Falsehood to Fact), 3018 (Gale of Forgetting).
"""
from models import init_db, get_session, ChallengeGroup, MazeLevel, Enemy
from scraper import parse_challenge, fetch_challenge_detail, get_monster_lookup

STARWARD_IDS = ["1033", "2024", "3018"]


def rescrape_starward():
    get_monster_lookup()  # prime the cache
    init_db()
    session = get_session()

    for api_id in STARWARD_IDS:
        # Delete existing data
        group = session.query(ChallengeGroup).filter_by(api_id=api_id).first()
        if group:
            print(f"[*] Deleting existing {group.name} (ID={api_id})...")
            session.delete(group)
            session.flush()

        # Re-fetch and parse
        try:
            detail = fetch_challenge_detail(api_id)
            group_data, levels, enemies = parse_challenge(detail, api_id)
            has_sw = group_data.get("has_starward", False)

            # Insert
            g = ChallengeGroup(**group_data)
            session.add(g)
            session.flush()

            for lv in levels:
                lv["challenge_group_id"] = g.id
                ml = MazeLevel(**lv)
                session.add(ml)
                session.flush()

                lv_enemies = [e for e in enemies if e["node_num"] == lv["stage_num"]
                              and e.get("is_starward", False) == lv.get("is_starward", False)]
                for en in lv_enemies:
                    en["maze_level_id"] = ml.id
                    session.add(Enemy(**en))

            sw_nodes = [l for l in levels if l.get("is_starward")]
            normal_nodes = [l for l in levels if not l.get("is_starward")]
            hp = sum(l["total_hp"] for l in levels)
            print(f"  OK: {group_data['name']} | {len(normal_nodes)} nodes + {len(sw_nodes)} SW | HP={hp:,.0f} | has_sw={has_sw}")

        except Exception as e:
            print(f"  FAIL {api_id}: {e}")
            session.rollback()

    session.commit()
    session.close()
    print("[*] Starward re-scrape complete!")


if __name__ == "__main__":
    rescrape_starward()
