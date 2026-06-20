"""SQLAlchemy models for SR Challenge data."""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, relationship, Session
from datetime import datetime, timezone

from config import DB_URL
from sqlalchemy import event

engine = create_engine(DB_URL, echo=False)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode for concurrent read/write support."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


class Base(DeclarativeBase):
    pass


class ChallengeGroup(Base):
    """A challenge season/group (e.g. 'Housecleaning Storm')."""
    __tablename__ = "challenge_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    api_id = Column(String, unique=True, index=True)      # API id like "1034"
    name = Column(String, nullable=False)
    name_zh = Column(String)                                # Chinese name
    group_type = Column(String, nullable=False)             # Memory, Story, Boss, Peak
    mode = Column(String, nullable=False)                   # forgotten_hall, pure_fiction, etc.
    schedule_data_id = Column(Integer, default=0)
    level_count = Column(Integer, default=0)
    has_starward = Column(Boolean, default=False)
    is_beta = Column(Boolean, default=False)
    season_buffs = Column(Text)                             # JSON string
    season_buffs_zh = Column(Text)                          # JSON string with Chinese text
    scraped_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    levels = relationship("MazeLevel", back_populates="group", cascade="all, delete-orphan")


class MazeLevel(Base):
    """A single phase/floor within a challenge (e.g. Phase 12)."""
    __tablename__ = "maze_levels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    challenge_group_id = Column(Integer, ForeignKey("challenge_groups.id"), index=True)
    level_api_id = Column(String)
    name = Column(String)
    name_zh = Column(String)                                # Chinese name
    floor = Column(Integer)
    stage_num = Column(Integer, default=1)
    damage_types = Column(String)      # JSON array
    buff_name = Column(String)
    buff_desc = Column(Text)
    buff_name_zh = Column(String)                           # Chinese buff name
    buff_desc_zh = Column(Text)                             # Chinese buff desc
    targets = Column(Text)             # JSON
    is_starward = Column(Boolean, default=False)
    total_hp = Column(Float, default=0.0)
    category = Column(String, nullable=True)  # 'knight', 'kic', 'kicp' for Anomaly Arbitration

    group = relationship("ChallengeGroup", back_populates="levels")
    enemies = relationship("Enemy", back_populates="maze_level", cascade="all, delete-orphan")


class Enemy(Base):
    """An individual enemy in a wave/node."""
    __tablename__ = "enemies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    maze_level_id = Column(Integer, ForeignKey("maze_levels.id"), index=True)
    wave_num = Column(Integer)
    node_num = Column(Integer)
    monster_name = Column(String)
    monster_name_zh = Column(String)                        # Chinese monster name
    monster_id = Column(String)
    enemy_level = Column("level", Integer)
    hp = Column(Float)
    speed = Column(Float, default=0)
    toughness = Column(Float, default=0)
    effect_res = Column(Float, default=0)
    quantity = Column(Integer, default=1)
    is_starward = Column(Boolean, default=False)

    maze_level = relationship("MazeLevel", back_populates="enemies")


def get_session():
    return Session(engine)


def init_db():
    Base.metadata.create_all(engine)
