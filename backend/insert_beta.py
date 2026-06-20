"""Insert Beta challenge data (Housecleaning Storm, Starward Mode)."""
import json
from models import init_db, get_session, ChallengeGroup, MazeLevel, Enemy

def insert_housecleaning_storm():
    init_db()
    session = get_session()

    # Check if already exists
    existing = session.query(ChallengeGroup).filter_by(api_id="1034").first()
    if existing:
        print("Housecleaning Storm already in DB, skipping.")
        session.close()
        return

    # Insert challenge group
    group = ChallengeGroup(
        api_id="1034",
        name="Housecleaning Storm",
        group_type="Memory",
        mode="forgotten_hall",
        schedule_data_id=201034,
        level_count=12,
        has_starward=True,
        is_beta=True,
        season_buffs=json.dumps([{
            "name": "Stormcleanse",
            "desc": "At the beginning of each Cycle, randomly causes an ally target following the Path of The Hunt or the Path of Erudition to take action immediately, and increases their DMG dealt by 80% for 1 turn(s)."
        }], ensure_ascii=False),
    )
    session.add(group)
    session.flush()

    # ── Node 1 ──
    node1 = MazeLevel(
        challenge_group_id=group.id,
        level_api_id="1034012_1",
        name="Stormcleanse (XII) - Node 1",
        floor=12,
        stage_num=1,
        damage_types=json.dumps(["LIGHTNING", "QUANTUM"]),
        buff_name="Stormcleanse",
        buff_desc="Random Hunt/Erudition ally takes immediate action, +80% DMG for 1 turn.",
        targets=json.dumps(["Win with at least 15 Cycle(s) left", "Win with at least 30 Cycle(s) left", "No more than 0 downed character(s)"]),
        total_hp=17_248_396,
    )
    session.add(node1)
    session.flush()

    node1_enemies = [
        Enemy(maze_level_id=node1.id, wave_num=1, node_num=1, monster_name='Memory Zone Meme "Shell of Faded Rage"', monster_id="", enemy_level=95, hp=3_177_336, speed=145, toughness=120, effect_res=0.30),
        Enemy(maze_level_id=node1.id, wave_num=1, node_num=1, monster_name='Frigid Prowler', monster_id="", enemy_level=95, hp=2_723_431, speed=132, toughness=100, effect_res=0.30),
        Enemy(maze_level_id=node1.id, wave_num=2, node_num=1, monster_name='Stellaron Hunter: Sam', monster_id="", enemy_level=95, hp=11_347_629, speed=158, toughness=200, effect_res=0.40),
    ]
    session.add_all(node1_enemies)

    # ── Node 2 ──
    node2 = MazeLevel(
        challenge_group_id=group.id,
        level_api_id="1034012_2",
        name="Stormcleanse (XII) - Node 2",
        floor=12,
        stage_num=2,
        damage_types=json.dumps(["FIRE", "IMAGINARY"]),
        buff_name="Stormcleanse",
        buff_desc="Random Hunt/Erudition ally takes immediate action, +80% DMG for 1 turn.",
        targets=json.dumps(["Win with at least 15 Cycle(s) left", "Win with at least 30 Cycle(s) left", "No more than 0 downed character(s)"]),
        total_hp=23_830_020,
    )
    session.add(node2)
    session.flush()

    node2_enemies = [
        Enemy(maze_level_id=node2.id, wave_num=1, node_num=2, monster_name='Daybreak Squadron: Azurewing', monster_id="", enemy_level=95, hp=3_404_289, speed=158, toughness=160, effect_res=0.30),
        Enemy(maze_level_id=node2.id, wave_num=1, node_num=2, monster_name='Daybreak Squadron: Cinderborne', monster_id="", enemy_level=95, hp=3_404_289, speed=158, toughness=160, effect_res=0.30),
        Enemy(maze_level_id=node2.id, wave_num=2, node_num=2, monster_name='Alloy Mechatron: King Pom-Pom', monster_id="", enemy_level=95, hp=8_510_721, speed=158, toughness=240, effect_res=0.40, quantity=2),
    ]
    session.add_all(node2_enemies)

    # ── Starward Mode (Node 3) ──
    node3 = MazeLevel(
        challenge_group_id=group.id,
        level_api_id="1034012_sw",
        name="Stormcleanse (XII) - Starward Mode",
        floor=12,
        stage_num=3,
        damage_types=json.dumps(["PHYSICAL", "FIRE"]),
        buff_name="Stormcleanse",
        buff_desc="Random Hunt/Erudition ally takes immediate action, +80% DMG for 1 turn.",
        targets=json.dumps(["Gain 3 stars and win with 33 or more Cycles remaining"]),
        total_hp=29_971_705,
        is_starward=True,
    )
    session.add(node3)
    session.flush()

    node3_enemies = [
        Enemy(maze_level_id=node3.id, wave_num=1, node_num=3, monster_name='Present Inebriated in Revelry', monster_id="", enemy_level=95, hp=3_100_521, speed=158, toughness=100, effect_res=0.30, is_starward=True),
        Enemy(maze_level_id=node3.id, wave_num=1, node_num=3, monster_name='Tomorrow in Harmonious Chords', monster_id="", enemy_level=95, hp=3_100_521, speed=132, toughness=100, effect_res=0.30, is_starward=True),
        Enemy(maze_level_id=node3.id, wave_num=1, node_num=3, monster_name='Past Confined and Caged', monster_id="", enemy_level=95, hp=3_100_521, speed=132, toughness=100, effect_res=0.30, is_starward=True),
        Enemy(maze_level_id=node3.id, wave_num=2, node_num=3, monster_name='Harbinger of Death: Swarm Nightmare', monster_id="", enemy_level=95, hp=20_670_142, speed=190, toughness=200, effect_res=0.40, is_starward=True),
    ]
    session.add_all(node3_enemies)

    session.commit()
    print(f"Inserted Housecleaning Storm | 3 nodes | Total HP={17_248_396+23_830_020+29_971_705:,}")
    session.close()

if __name__ == "__main__":
    insert_housecleaning_storm()
