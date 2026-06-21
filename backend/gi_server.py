"""FastAPI server for Genshin Impact Challenge data."""
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
import json
import threading
import schedule
import time
from datetime import datetime

from gi_models import init_db, get_session, ChallengeGroup, MazeLevel, Enemy
from gi_config import (
    MODE_DISPLAY_GI, MODE_COLORS_GI,
    MODE_TOWER, MODE_LEYLINE_N4, MODE_LEYLINE_N5, MODE_LEYLINE_N6,
)

app = FastAPI(title="GI Challenge Stats API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ALL_MODES = [MODE_TOWER, MODE_LEYLINE_N4, MODE_LEYLINE_N5, MODE_LEYLINE_N6]


# ── Auto-scrape scheduler ──

def auto_scrape():
    print(f"[{datetime.now()}] GI Auto-scrape triggered")
    try:
        from gi_scraper import run_scraper
        success = run_scraper()
        if success:
            print(f"[{datetime.now()}] GI scrape complete, restarting...")
            import os, signal
            os.kill(os.getpid(), signal.SIGTERM)
        else:
            print(f"[{datetime.now()}] GI scrape skipped (already running)")
    except Exception as e:
        print(f"[{datetime.now()}] GI scrape failed: {e}")


def scheduler_loop():
    schedule.every().day.at("08:10").do(auto_scrape)  # 10 min after SR scrape
    while True:
        schedule.run_pending()
        time.sleep(60)


@app.on_event("startup")
def startup():
    init_db()
    t = threading.Thread(target=scheduler_loop, daemon=True)
    t.start()
    print("[*] GI Auto-scrape scheduler started (daily at 08:10)")


@app.get("/api/scrape/trigger")
def trigger_scrape():
    threading.Thread(target=auto_scrape, daemon=True).start()
    return {"status": "Scraping started in background"}


# ── API Routes ──

@app.get("/api/modes")
def get_modes():
    return [
        {"key": m, "name_en": MODE_DISPLAY_GI[m]["en"], "name_zh": MODE_DISPLAY_GI[m]["zh"]}
        for m in ALL_MODES
    ]


@app.get("/api/seasons/{mode_key}")
def get_seasons(mode_key: str):
    session = get_session()
    try:
        groups = (
            session.query(ChallengeGroup)
            .filter_by(mode=mode_key)
            .order_by(ChallengeGroup.schedule_id.asc())
            .all()
        )
        return [
            {
                "id": g.id,
                "schedule_id": g.schedule_id,
                "name": g.name,
                "name_zh": g.name_zh,
                "begin_time": g.begin_time,
                "end_time": g.end_time,
            }
            for g in groups
        ]
    finally:
        session.close()


@app.get("/api/season/{season_id}")
def get_season(season_id: int):
    session = get_session()
    try:
        group = session.query(ChallengeGroup).filter_by(id=season_id).first()
        if not group:
            return {"error": "Season not found"}

        levels = (
            session.query(MazeLevel)
            .filter_by(challenge_group_id=group.id)
            .order_by(MazeLevel.stage_num.asc())
            .all()
        )

        level_list = []
        for lv in levels:
            enemies = (
                session.query(Enemy)
                .filter_by(maze_level_id=lv.id)
                .all()
            )
            level_list.append({
                "id": lv.id,
                "name": lv.name,
                "name_zh": lv.name_zh,
                "stage_num": lv.stage_num,
                "half": lv.half,
                "total_hp": lv.total_hp,
                "min_dps": lv.min_dps,
                "time_limit": lv.time_limit,
                "enemies": [
                    {
                        "name": e.monster_name,
                        "name_zh": e.monster_name_zh,
                        "monster_id": e.monster_id,
                        "level": e.monster_level,
                        "hp": e.hp,
                        "atk": e.atk,
                        "def": float(getattr(e, 'def_', 0)),
                        "quantity": e.quantity,
                    }
                    for e in enemies
                ],
            })

        return {
            "id": group.id,
            "schedule_id": group.schedule_id,
            "mode": group.mode,
            "name": group.name,
            "name_zh": group.name_zh,
            "begin_time": group.begin_time,
            "end_time": group.end_time,
            "blessing_name": group.blessing_name,
            "blessing_desc": group.blessing_desc,
            "blessing_name_zh": group.blessing_name_zh,
            "blessing_desc_zh": group.blessing_desc_zh,
            "levels": level_list,
            "total_hp_all": sum(lv.total_hp for lv in levels),
        }
    finally:
        session.close()


@app.get("/api/chart/{mode_key}")
def get_chart(mode_key: str):
    session = get_session()
    try:
        groups = (
            session.query(ChallengeGroup)
            .filter_by(mode=mode_key)
            .order_by(ChallengeGroup.schedule_id.asc())
            .all()
        )
        points = []
        for g in groups:
            total_hp = (
                session.query(func.sum(MazeLevel.total_hp))
                .filter_by(challenge_group_id=g.id)
                .scalar()
            ) or 0
            points.append({
                "season_name": g.name,
                "season_name_zh": g.name_zh,
                "schedule_data_id": g.schedule_id,
                "total_hp": total_hp,
            })
        return points
    finally:
        session.close()


@app.get("/api/status")
def get_status():
    session = get_session()
    try:
        stats = {}
        for mode in ALL_MODES:
            cnt = session.query(func.count(ChallengeGroup.id)).filter_by(mode=mode).scalar()
            stats[mode] = {"key": mode, "name": MODE_DISPLAY_GI[mode], "season_count": cnt}
        return stats
    finally:
        session.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8766)
