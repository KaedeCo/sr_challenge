"""SQLAlchemy models for Genshin Impact challenge data."""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, relationship, Session
from sqlalchemy import event
from datetime import datetime, timezone

from gi_config import GI_DB_URL

engine = create_engine(GI_DB_URL, echo=False)

@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()

class Base(DeclarativeBase):
    pass

class ChallengeGroup(Base):
    """A challenge season (e.g. 'Frost-Surging Moon' or '6.4 N4')."""
    __tablename__ = "gi_challenge_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    schedule_id = Column(Integer, index=True)           # lunaris schedule ID
    mode = Column(String, nullable=False, index=True)   # tower, leyline_n4, leyline_n5, leyline_n6
    name = Column(String, nullable=False)               # season name (EN)
    name_zh = Column(String)                            # Chinese name
    begin_time = Column(String)
    end_time = Column(String)
    blessing_name = Column(String)                      # tower blessing name
    blessing_desc = Column(Text)                        # tower blessing desc
    blessing_name_zh = Column(String)
    blessing_desc_zh = Column(Text)
    scraped_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    levels = relationship("MazeLevel", back_populates="group", cascade="all, delete-orphan")

class MazeLevel(Base):
    """A chamber/half within a challenge (e.g. Floor 12-1 upper, or Boss 1)."""
    __tablename__ = "gi_maze_levels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    challenge_group_id = Column(Integer, ForeignKey("gi_challenge_groups.id"), index=True)
    name = Column(String)                   # "Floor 12-1 Upper" or boss name
    name_zh = Column(String)
    stage_num = Column(Integer, default=1)  # chamber number (1-3) or boss slot (1-3)
    half = Column(Integer, nullable=True)   # 1=upper, 2=lower (tower only)
    total_hp = Column(Float, default=0.0)
    min_dps = Column(Float, default=0.0)    # total_hp / time_limit
    time_limit = Column(Integer)            # 90 for tower, 120 for leyline

    group = relationship("ChallengeGroup", back_populates="levels")
    enemies = relationship("Enemy", back_populates="maze_level", cascade="all, delete-orphan")

class Enemy(Base):
    """An individual enemy in a chamber/half."""
    __tablename__ = "gi_enemies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    maze_level_id = Column(Integer, ForeignKey("gi_maze_levels.id"), index=True)
    monster_name = Column(String)
    monster_name_zh = Column(String)
    monster_id = Column(String, nullable=True)
    monster_level = Column(Integer)
    hp = Column(Float)
    atk = Column(Float, default=0)
    def_ = Column("def", Float, default=0)
    quantity = Column(Integer, default=1)

    maze_level = relationship("MazeLevel", back_populates="enemies")

def get_session():
    return Session(engine)

def init_db():
    Base.metadata.create_all(engine)
