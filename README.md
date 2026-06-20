# SR Challenge Stats

A web app that tracks and visualizes HP power creep across all four endgame challenge modes in Honkai: Star Rail, using data scraped from [huroka.com](https://www.huroka.com).

## What it does

- Scrapes challenge data from huroka.com's public API (Prod + Beta branches)
- Tracks 4 modes: Forgotten Hall, Pure Fiction, Apocalyptic Shadow, Anomaly Arbitration
- Visualizes total HP inflation over time with exponential trend fitting
- Shows per-enemy HP comparison vs last appearance
- Auto-scrapes daily at 08:00

## Tech Stack

- **Backend**: Python + FastAPI + SQLAlchemy + SQLite
- **Frontend**: React + TypeScript + Vite + TailwindCSS + Recharts
- **Fonts**: Orbitron, Cambria Math, Cascadia Code, Inter, Space Mono

## Getting Started

```bash
# Backend
cd backend
pip install -r requirements.txt
python server.py   # runs on port 8765

# Frontend
cd frontend
npm install
npm run dev        # runs on port 5173
```

## Data Source

All data comes from huroka.com's public REST API. Prod API for historical data, Beta API (`?branch=beta`) for the latest season per mode.
