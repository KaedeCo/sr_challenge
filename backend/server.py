"""FastAPI server for SR Challenge data."""
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
import json
import threading
import schedule
import time
from datetime import datetime

from models import init_db, get_session, ChallengeGroup, MazeLevel, Enemy, engine
from config import MODE_DISPLAY, GROUP_TYPE_MAP, TOP_DIFFICULTY

app = FastAPI(title="SR Challenge Stats API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auto-scrape scheduler ──

def auto_scrape():
    """Run the scraper automatically."""
    print(f"[{datetime.now()}] Auto-scrape triggered")
    try:
        from scraper import run_scraper
        # Use a fresh session
        run_scraper()
        print(f"[{datetime.now()}] Auto-scrape complete")
    except Exception as e:
        print(f"[{datetime.now()}] Auto-scrape failed: {e}")


def scheduler_loop():
    """Background thread that runs the scheduler."""
    schedule.every().day.at("08:00").do(auto_scrape)
    while True:
        schedule.run_pending()
        time.sleep(60)  # check every minute


@app.on_event("startup")
def startup():
    init_db()
    # Start scheduler thread
    t = threading.Thread(target=scheduler_loop, daemon=True)
    t.start()
    print("[*] Auto-scrape scheduler started (daily at 08:00)")


@app.get("/api/scrape/trigger")
def trigger_scrape():
    """Manually trigger a scrape."""
    threading.Thread(target=auto_scrape, daemon=True).start()
    return {"status": "Scraping started in background"}


# ── API Routes ───────────────────────────────────────────

@app.get("/api/modes")
def get_modes():
    """Return all four game modes with metadata."""
    return [
        {
            "key": key,
            "name_en": info["en"],
            "name_zh": info["zh"],
            "top_difficulty": TOP_DIFFICULTY.get(key, "?"),
        }
        for key, info in MODE_DISPLAY.items()
    ]


@app.get("/api/seasons/{mode_key}")
def get_seasons(mode_key: str):
    """Get all seasons for a specific mode, ordered by schedule_data_id."""
    session = get_session()
    try:
        groups = (
            session.query(ChallengeGroup)
            .filter_by(mode=mode_key)
            .order_by(ChallengeGroup.schedule_data_id.asc())
            .all()
        )
        return [
            {
                "id": g.id,
                "api_id": g.api_id,
                "name": g.name,
                "name_zh": g.name_zh or g.name,
                "schedule_data_id": g.schedule_data_id,
                "has_starward": g.has_starward,
                "is_beta": g.is_beta,
                "level_count": g.level_count,
                "season_buffs": json.loads(g.season_buffs) if g.season_buffs else [],
                "season_buffs_zh": json.loads(g.season_buffs_zh) if g.season_buffs_zh else [],
            }
            for g in groups
        ]
    finally:
        session.close()


@app.get("/api/season/{season_id}")
def get_season_detail(season_id: int):
    """Get detailed data for a single season, including enemies."""
    session = get_session()
    try:
        group = session.query(ChallengeGroup).filter_by(id=season_id).first()
        if not group:
            return {"error": "Not found"}, 404

        levels = (
            session.query(MazeLevel)
            .filter_by(challenge_group_id=group.id)
            .order_by(MazeLevel.stage_num.asc())
            .all()
        )

        level_data = []
        for lv in levels:
            enemies = (
                session.query(Enemy)
                .filter_by(maze_level_id=lv.id)
                .order_by(Enemy.wave_num.asc())
                .all()
            )
            level_data.append({
                "id": lv.id,
                "name": lv.name,
                "name_zh": lv.name_zh or lv.name,
                "floor": lv.floor,
                "stage_num": lv.stage_num,
                "category": lv.category,
                "damage_types": json.loads(lv.damage_types) if lv.damage_types else [],
                "buff_name": lv.buff_name,
                "buff_desc": lv.buff_desc,
                "buff_name_zh": lv.buff_name_zh or lv.buff_name,
                "buff_desc_zh": lv.buff_desc_zh or lv.buff_desc,
                "targets": json.loads(lv.targets) if lv.targets else [],
                "total_hp": lv.total_hp,
                "is_starward": lv.is_starward,
                "enemies": [
                    {
                        "name": e.monster_name,
                        "name_zh": e.monster_name_zh or e.monster_name,
                        "level": e.enemy_level,
                        "hp": e.hp,
                        "speed": e.speed,
                        "toughness": e.toughness,
                        "effect_res": e.effect_res,
                        "quantity": e.quantity,
                        "wave_num": e.wave_num,
                    }
                    for e in enemies
                ],
            })

        return {
            "id": group.id,
            "api_id": group.api_id,
            "name": group.name,
            "name_zh": group.name_zh or group.name,
            "mode": group.mode,
            "schedule_data_id": group.schedule_data_id,
            "has_starward": group.has_starward,
            "season_buffs": json.loads(group.season_buffs) if group.season_buffs else [],
            "season_buffs_zh": json.loads(group.season_buffs_zh) if group.season_buffs_zh else [],
            "levels": level_data,
            "total_hp_all": sum(lv["total_hp"] for lv in level_data),
        }
    finally:
        session.close()


@app.get("/api/chart/{mode_key}")
def get_chart_data(mode_key: str):
    """Get time-series HP data for line chart. AA returns 3 series."""
    session = get_session()
    try:
        groups = (
            session.query(ChallengeGroup)
            .filter_by(mode=mode_key)
            .order_by(ChallengeGroup.schedule_data_id.asc(), ChallengeGroup.api_id.asc())
            .all()
        )

        if mode_key == "anomaly_arbitration":
            return _get_aa_chart_data(session, groups)
        else:
            return _get_normal_chart_data(session, groups)
    finally:
        session.close()


def _get_normal_chart_data(session, groups):
    chart_data = []
    for g in groups:
        total_hp = (
            session.query(func.sum(MazeLevel.total_hp))
            .filter_by(challenge_group_id=g.id)
            .scalar()
        ) or 0
        chart_data.append({
            "season_name": g.name,
            "season_name_zh": g.name_zh or g.name,
            "schedule_data_id": g.schedule_data_id,
            "total_hp": round(total_hp, 0),
            "has_starward": g.has_starward,
        })
    return chart_data


def _get_aa_chart_data(session, groups):
    """Anomaly Arbitration: 3 separate HP series (Knights, KIC, KICP)."""
    chart_data = []
    for g in groups:
        levels = (
            session.query(MazeLevel)
            .filter_by(challenge_group_id=g.id)
            .all()
        )
        knights_hp = sum(lv.total_hp for lv in levels if lv.category == "knight")
        kic_hp = sum(lv.total_hp for lv in levels if lv.category == "kic")
        kicp_hp = sum(lv.total_hp for lv in levels if lv.category == "kicp")

        chart_data.append({
            "season_name": g.name,
            "season_name_zh": g.name_zh or g.name,
            "schedule_data_id": g.schedule_data_id,
            "knights_hp": round(knights_hp, 0),
            "kic_hp": round(kic_hp, 0),
            "kicp_hp": round(kicp_hp, 0),
            "total_hp": round(knights_hp + kic_hp + kicp_hp, 0),
        })
    return chart_data


@app.get("/api/status")
def get_status():
    """Get database status."""
    session = get_session()
    try:
        total_groups = session.query(ChallengeGroup).count()
        total_enemies = session.query(Enemy).count()
        modes_count = {}
        for mode in ["forgotten_hall", "pure_fiction", "apocalyptic_shadow", "anomaly_arbitration"]:
            modes_count[mode] = session.query(ChallengeGroup).filter_by(mode=mode).count()
        return {
            "total_groups": total_groups,
            "total_enemies": total_enemies,
            "modes": modes_count,
        }
    finally:
        session.close()


@app.get("/api/compare/{mode_key}")
def get_comparison_data(mode_key: str, season_id: int = Query(0)):
    """Get HP comparison for enemies in a season vs their last appearance in same mode."""
    session = get_session()
    try:
        group = session.query(ChallengeGroup).filter_by(id=season_id).first()
        if not group:
            return {"error": "Not found"}, 404

        # Get all earlier seasons in same mode, ordered by time (use id as primary ordering)
        earlier = (
            session.query(ChallengeGroup)
            .filter_by(mode=mode_key)
            .filter(ChallengeGroup.id < group.id)
            .order_by(ChallengeGroup.id.desc())
            .all()
        )

        current_enemies = (
            session.query(Enemy).join(MazeLevel)
            .filter(MazeLevel.challenge_group_id == group.id)
            .all()
        )

        result = []
        for ce in current_enemies:
            cur_category = ce.maze_level.category  # 'knight', 'kic', 'kicp', or None
            # Find same monster in any earlier season
            prev = None
            for es in earlier:
                query = session.query(Enemy).join(MazeLevel).filter(
                    MazeLevel.challenge_group_id == es.id,
                )
                # AA category-aware filtering:
                # - knight floors can compare among all knight floors
                # - kic only with kic, kicp only with kicp
                if mode_key == "anomaly_arbitration" and cur_category:
                    query = query.filter(MazeLevel.category == cur_category)
                # Try monster_id first
                prev_enemy = None
                if ce.monster_id:
                    prev_enemy = query.filter(Enemy.monster_id == ce.monster_id).first()
                # Fall back to name matching if monster_id didn't work
                if not prev_enemy and ce.monster_name:
                    prev_enemy = query.filter(Enemy.monster_name == ce.monster_name).first()
                if prev_enemy:
                    prev = prev_enemy
                    break

            ratio = None
            if prev and prev.hp > 0 and ce.hp > 0:
                ratio = round((ce.hp - prev.hp) / prev.hp * 100, 1)

            result.append({
                "monster_name": ce.monster_name,
                "monster_id": ce.monster_id,
                "current_hp": ce.hp,
                "previous_hp": prev.hp if prev else None,
                "previous_season": prev.maze_level.group.name if prev else None,
                "hp_change_pct": ratio,
                "node_num": ce.node_num,
                "wave_num": ce.wave_num,
                "is_starward": ce.is_starward,
                "category": cur_category,
            })

        return result
    finally:
        session.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
