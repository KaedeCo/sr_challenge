"""Configuration for the SR Challenge scraper."""
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "sr_challenge.db")
DB_URL = f"sqlite:///{DB_PATH}"

HUROKA_BASE = "https://www.huroka.com"
API_BASE = f"{HUROKA_BASE}/api"
# Prod API for historical data (no duplicates)
CHALLENGE_LIST_URL = f"{API_BASE}/challenge"
CHALLENGE_DETAIL_URL = f"{API_BASE}/challenge/{{id}}"
# Beta API only for the single latest season per mode
CHALLENGE_LIST_BETA_URL = f"{API_BASE}/challenge?branch=beta"
CHALLENGE_DETAIL_BETA_URL = f"{API_BASE}/challenge/{{id}}?branch=beta"

# Group type -> mode mapping
GROUP_TYPE_MAP = {
    "Memory": "forgotten_hall",
    "Story": "pure_fiction",
    "Boss": "apocalyptic_shadow",
    "Peak": "anomaly_arbitration",
}

# Mode display names
MODE_DISPLAY = {
    "forgotten_hall": {"en": "Forgotten Hall", "zh": "忘却之庭"},
    "pure_fiction": {"en": "Pure Fiction", "zh": "虚构叙事"},
    "apocalyptic_shadow": {"en": "Apocalyptic Shadow", "zh": "末日幻影"},
    "anomaly_arbitration": {"en": "Anomaly Arbitration", "zh": "异相仲裁"},
}

# Highest difficulty for each mode
TOP_DIFFICULTY = {
    "forgotten_hall": 12,
    "pure_fiction": 4,
    "apocalyptic_shadow": 4,
    "anomaly_arbitration": "King in Check: Plight",
}

# Beta branch API (via ?branch=beta) provides all challenge data including latest seasons.
# No separate browser scraping needed for Beta content.
# Permanent challenges (scheduleDataId=0) like Memory 100, 900 are skipped.
