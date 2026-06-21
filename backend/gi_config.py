"""Configuration for Genshin Impact data from lunaris.moe."""
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GI_DB_PATH = os.path.join(BASE_DIR, "gi_challenge.db")
GI_DB_URL = f"sqlite:///{GI_DB_PATH}"

# Lunaris API
LUNARIS_API = "https://api.lunaris.moe"
LUNARIS_MAIN = "https://lunaris.moe"
VERSION_URL = f"{LUNARIS_API}/data/version.json"

# Tower (Spiral Abyss / 深境螺旋)
TOWER_LIST_URL = f"{LUNARIS_API}/data/{{version}}/towerlist.json"
TOWER_DETAIL_URL = f"{LUNARIS_API}/data/{{version}}/en/tower/{{id}}.json"

# Leyline (Stygian Onslaught / 幽境危战)
LEYLINE_URL = f"{LUNARIS_MAIN}/data/leylinechallenge/{{id}}.json"
LEYLINE_ID_RANGE = range(5269001, 5269010)  # 5269001 ~ 5269009

# DPS calculations
TOWER_TIME = 90   # seconds for Floor 12
LEYLINE_TIME = 120  # seconds for Leyline

# Mode keys
MODE_TOWER = "tower"
MODE_LEYLINE_N4 = "leyline_n4"
MODE_LEYLINE_N5 = "leyline_n5"
MODE_LEYLINE_N6 = "leyline_n6"

MODE_DISPLAY_GI = {
    MODE_TOWER: {"en": "Spiral Abyss", "zh": "深境螺旋"},
    MODE_LEYLINE_N4: {"en": "Stygian Onslaught N4", "zh": "幽境危战 N4"},
    MODE_LEYLINE_N5: {"en": "Stygian Onslaught N5", "zh": "幽境危战 N5"},
    MODE_LEYLINE_N6: {"en": "Stygian Onslaught N6", "zh": "幽境危战 N6"},
}

MODE_COLORS_GI = {
    MODE_TOWER: "#60a5fa",
    MODE_LEYLINE_N4: "#4ade80",
    MODE_LEYLINE_N5: "#fbbf24",
    MODE_LEYLINE_N6: "#f87171",
}
