"""
Scrape Beta-only challenge data using agent-browser.

The Prod API doesn't serve Beta branch content. Beta challenges are:
  - Memory: 1034 (Housecleaning Storm)
  - Story:  2025 (latest Pure Fiction)
  - Boss:   3020 (latest Apocalyptic Shadow)

This script uses agent-browser CLI to:
  1. Open Huroka challenge page
  2. Switch Settings → Data Branch → Beta
  3. Navigate to each challenge URL
  4. Click Starward Mode button if present
  5. Extract text from main content
  6. Parse and save to DB

Usage: python scrape_beta.py
"""
import subprocess
import time
import json
import re
from math import floor

from models import init_db, get_session, ChallengeGroup, MazeLevel, Enemy
from scraper import get_monster_lookup, clean_text, GROUP_TYPE_MAP, MODE_DISPLAY

# Beta challenge URLs on Huroka
BETA_CHALLENGES = [
    {"url": "https://www.huroka.com/challenge/maze/1034", "mode": "forgotten_hall", "api_id": "1034", "group_type": "Memory"},
    {"url": "https://www.huroka.com/challenge/maze/2025", "mode": "pure_fiction", "api_id": "2025", "group_type": "Story"},
    {"url": "https://www.huroka.com/challenge/maze/3020", "mode": "apocalyptic_shadow", "api_id": "3020", "group_type": "Boss"},
]

AB = "agent-browser"


def run_ab(*args):
    """Run agent-browser command and return output."""
    cmd = [AB] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout


def ensure_beta_branch():
    """Ensure the Settings Data Branch is set to Beta."""
    # Open the page first
    run_ab("open", "https://www.huroka.com/challenge")
    time.sleep(2)

    # Open Settings (it might have a stable CSS selector)
    # Strategy: use eval to find and click Settings button
    js = """
    (() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            if (b.textContent.includes('Prod') || b.textContent.includes('Beta')) {
                // Already on some branch
            }
            if (b.getAttribute('aria-label') === 'Settings' || b.querySelector('img[alt="Settings"]')) {
                b.click();
                return 'settings_clicked';
            }
        }
        return 'settings_not_found';
    })()
    """
    # TODO: full implementation with element references
    # For now, this is a manual process - documented steps
    print("[!] Manual Beta switch required: Settings → Data Branch → Beta (4.3.53)")
    print("[!] Use: agent-browser click <settings-ref> → snapshot → beta-ref → click")


def extract_page_text():
    """Extract challenge data text from the currently loaded page."""
    js = "document.querySelector('main') ? document.querySelector('main').innerText : 'NODATA'"
    run_ab("eval", js)
    # Output is captured in stdout
    return ""


def main():
    print("[*] Beta scraper using agent-browser")
    print("[*] Manual steps needed for each challenge:")
    print()
    for chal in BETA_CHALLENGES:
        print(f"  {chal['mode']}: {chal['url']}")
        print(f"    1. agent-browser open {chal['url']}")
        print(f"    2. Settings → Beta")
        print(f"    3. Click Starward Mode if present")
        print(f"    4. Scroll down to load all nodes")
        print(f"    5. Extract text, parse, save")
        print()

    print("[*] Alternatively, use Playwright for full automation.")
    print("[*] See: https://playwright.dev/python/")


if __name__ == "__main__":
    main()
