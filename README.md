# SR Challenge Stats —— 星铁数值膨胀观测站

> "HP↑↑↑" —— 这不是 bug，这是策划的 KPI。

## 这是什么

一个用数据说话的崩坏：星穹铁道终局玩法数值膨胀追踪器。从 [huroka.com](https://www.huroka.com) 爬取四个终局模式的全部历史赛季数据，用指数拟合曲线告诉你一个残酷的事实：你的练度在涨，怪物的血量涨得更快。

## 数据会说话

以下是爬取到的真实数据，没有修饰，没有滤镜：

**忘却之庭（Forgotten Hall）—— 42 期赛季**
- 第一期 "Favor of Amber"：总血量 1,891,795
- 最新一期 "Housecleaning Storm"：总血量 71,050,115
- 膨胀倍数：**37.5 倍**
- 如果你的 DPS 没有涨 37 倍，那不是你的问题

**虚构叙事（Pure Fiction）—— 25 期赛季**
- 第一期 "Youci's Wandering Words"：总血量 3,114,754
- 最新一期 "Fabricated Business"：总血量 239,411,421
- 膨胀倍数：**76.8 倍**
- 虚构叙事？不如叫"虚构膨胀"

**末日幻影（Apocalyptic Shadow）—— 19 期赛季**
- 第一期 "Stormwind Knight"：总血量 6,159,363
- 最新一期 "Vanguard Knight"：总血量 99,275,748
- 膨胀倍数：**16.1 倍**

**异相仲裁（Anomaly Arbitration）—— 8 期赛季**
- 第一期 "Intellitron Endgame"：总血量 283,080,254
- 最新一期 "4.4 Anomaly Arbitration"：总血量 298,614,042
- 膨胀倍数：**1.05 倍**
- 才出了 8 期，别急，膨胀在路上

我们的指数拟合曲线（`y = A·e^(B·x)`）会基于历史数据预测下三期赛季的血量。从 R² 拟合优度来看，这条膨胀曲线比你的股票 K 线图规律多了——因为策划的膨胀是确定性的，而股市至少还有随机性。

## 功能一览

- **仪表盘式赛季选择器**：半圆形仪表盘，拖动指针在 42 期忘却之庭之间穿梭，体验血量从 189 万到 7105 万的视觉冲击
- **逐怪物膨胀对比**：每个怪物都会和它在同模式下上一次登场时的血量对比，显示膨胀百分比。红色发光代表数值膨胀，绿色代表良心发现（罕见）
- **指数趋势预测**：对历史总血量做指数回归拟合，预测未来 3 期赛季的血量走势。3 期膨胀率和 5 期膨胀率用 Orbitron 字体大字标出，醒目到刺眼
- **异相仲裁三线分析**：Knight I/II/III 互通对比，KIC 和 KICP 各自独立分析，三张图表三个预测，膨胀一目了然
- **每日自动爬取**：每天早上 8 点自动拉取最新赛季数据，膨胀永不缺席
- **Starward Mode 支持**：自动检测并爬取星启模式数据，不遗漏任何一次数值膨胀

## 技术栈

- **后端**：Python + FastAPI + SQLAlchemy + SQLite，`schedule` 库定时爬取
- **前端**：React + TypeScript + Vite + TailwindCSS + Recharts
- **字体**：Orbitron（科幻标题）、Cambria Math（数学数字）、Cascadia Code（代码）、Inter（正文）、Space Mono（装饰）
- **数据源**：huroka.com 公开 REST API，Prod 历史数据 + Beta（`?branch=beta`）最新赛季

## 部署方法

### 1. 后端

```bash
cd backend
pip install -r requirements.txt
python server.py   # 启动在端口 8765
```

后端启动后会自动初始化 SQLite 数据库，并启动每日 08:00 的定时爬取。首次运行需要手动触发一次爬取来填充历史数据：

```bash
curl http://localhost:8765/api/scrape/trigger
```

爬取约需 2-3 分钟，会拉取全部 94 个赛季的 1144 个怪物数据。

### 2. 前端

```bash
cd frontend
npm install
npm run dev        # 开发模式，端口 5173
npm run build      # 生产构建到 dist/
```

开发模式下，Vite 会自动将 `/api` 请求代理到 `localhost:8765`。

### 3. 生产部署（Nginx）

如果部署在子路径（如 `/sr/sr-challenge/`），需修改 `frontend/vite.config.ts` 中的 `base` 字段：

```typescript
export default defineConfig({
  base: "/sr/sr-challenge/",
  // ...
});
```

Nginx 配置示例：

```nginx
# 前端静态文件
location /sr/sr-challenge/ {
    alias /opt/sr-challenge/frontend/dist/;
    try_files $uri /sr/sr-challenge/index.html;
}

# 后端 API 反向代理
location /sr/sr-challenge/api/ {
    proxy_pass http://127.0.0.1:8765/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

使用 systemd 管理后端进程：

```ini
[Unit]
Description=SR Challenge Stats Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/sr-challenge/backend
ExecStart=/usr/bin/python3 server.py
Restart=always

[Install]
WantedBy=multi-user.target
```

### 4. 数据说明

- **忘却之庭**：仅爬取第 12 层
- **虚构叙事**：仅爬取第 4 层
- **末日幻影**：仅爬取第 4 层（最高难度）
- **异相仲裁**：爬取全部 5 个关卡（Knight I/II/III + King in Check + King in Check: Plight）
- 如果存在 Starward Mode（星启模式），则使用星启模式数据
- 按赛季名称去重，保留最早出现的那一条记录

## 数据来源

所有数据来自 [huroka.com](https://www.huroka.com) 的公开 REST API。Prod API 提供历史数据，Beta API（`?branch=beta`）提供每模式的最新赛季数据。

## 免责声明

本项目仅用于数据可视化与分析，不代表对游戏运营策略的任何评价。数值膨胀是长线运营游戏的常见现象，我们只是把它画成了图表而已。如果你看了图表感到不适，建议回归现实生活——现实生活的通货膨胀也不遑多让。
