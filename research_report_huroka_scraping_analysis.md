# Huroka.com 挑战模式数据爬取技术分析报告

## 项目背景

本项目旨在爬取 https://www.huroka.com/challenge 上崩坏：星穹铁道四个终局挑战模式的历史数据，分析数值膨胀趋势并进行预测。四个模式分别为：Forgotten Hall（忘却之庭）、Pure Fiction（虚构叙事）、Apocalyptic Shadow（末日幻影）、Anomaly Arbitration（异相仲裁）。

## 执行摘要

Huroka.com 是一个基于 Next.js（RSC 模式）的星穹铁道数据聚合站。经过浏览器自动化抓包分析确认，该站为挑战数据提供了完整的公开 REST API，无需认证、无反爬机制。两个核心 API 端点分别提供 96 组挑战的元数据列表和每组挑战的详细数值数据（包含敌人 HP、速度、韧性、效果抵抗等完整字段）。四种挑战模式通过 `groupType` 字段区分，数据结构完全一致。整体爬取技术难度较低，主要工作在于方案选择和数据分析层面，而非反爬对抗。

## 页面结构分析

### 整体架构

Huroka.com 采用 Next.js App Router + React Server Components (RSC) 架构。页面首屏为服务端渲染（SSR），客户端通过 RSC 载荷进行导航和内容切换。主页 `/challenge` 的初始 HTML 源码中包含序列化的路由清单和组件引用数据，但实际的挑战内容通过客户端 JavaScript 动态渲染。

使用浏览器自动化工具（Playwright/agent-browser）加载页面后，可以观察到以下 DOM 结构：顶部为四个按钮式页签，分别对应四种挑战模式；下方为对应模式下的挑战分组卡片列表，每组显示名称、楼层数和赛季状态（如 Open Season 或具体版本号）。

### 四个页签对应关系

通过浏览器实际加载并对 `/api/challenge` 返回数据进行归拢分析，确认四类挑战模式的 `groupType` 映射如下：

- Memory 类型（64 组）：对应 FORGOTTEN HALL（忘却之庭），分为 PERMANENT（常驻，如 "The Last Vestiges of Towering Citadel" 15 层）和 SEASONS（赛季轮换，通常 10 或 12 层）
- Story 类型（24 组）：对应 PURE FICTION（虚构叙事），每个赛季 4 层
- Boss 类型（19 组）：对应 APOCALYPTIC SHADOW（末日幻影），每个赛季 4 难度等级
- Peak 类型（7 组）：对应 ANOMALY ARBITRATION（异相仲裁），每个赛季 5 层

页面中标注的总数（如 Forgotten Hall 54 groups）与 API 返回的 64 组 Memory 数据略有差异，可能是前端做了去重展示（部分同名挑战拥有不同 `scheduleDataId`）。

### 页面交互机制

标签切换为纯前端过滤操作，通过 JavaScript 监听按钮点击事件，按 `groupType` 过滤挑战列表，不触发新的网络请求。点击任意挑战分组卡片后，浏览器导航至 `/challenge/{type}/{id}`（如 `/challenge/maze/100`），触发 RSC 数据获取，页面显示该挑战的详细楼层配置、波次信息和敌人数据。

## API 接口分析

本次研究通过直接 URL 探测和浏览器 Network 面板观察，确认 Huroka 为挑战数据提供了标准 REST 风格的 JSON API。关键发现如下。

### 端点一：挑战列表 API

**URL**：`GET https://www.huroka.com/api/challenge`

**响应格式**：JSON 数组，包含 96 个挑战分组对象。

**关键字段**（每个对象）：

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| id | string | 挑战唯一 ID | "100" |
| name | string | 挑战名称 | "The Last Vestiges of Towering Citadel" |
| groupType | string | 挑战类型 | "Memory" / "Story" / "Boss" / "Peak" |
| scheduleDataId | number | 排期数据 ID（用于时间排序） | 200101（0 表示常驻） |
| levelCount | number | 总层数 | 15 |
| hasTierce | boolean | 是否有多级变体 | false |

**注意**：存在同名但 `scheduleDataId` 不同的挑战，代表同一挑战在不同赛季的版本。例如 "Favor of Amber" 出现 7 次，每次对应不同的 `scheduleDataId`。

### 端点二：挑战详情 API

**URL**：`GET https://www.huroka.com/api/challenge/{id}`

**响应格式**：JSON 对象，包含该挑战组的完整数值数据。

**顶层字段**：`id`、`name`、`groupType`、`scheduleDataId`、`rewardLineGroupId`、`levelCount`、`mazeLevels`（楼层数组）、`seasonBuffs1`/`seasonBuffs2`（赛季全局 Buff 数组）。

**mazeLevels 单层结构**（关键数据字段）：

| 字段 | 说明 | 示例 |
|------|------|------|
| id、floor、stageNum | 楼层标识和阶段数 | floor: 15, stageNum: 2 |
| damageType1 / damageType2 | 推荐弱点属性 | ["Physical", "Imaginary"] |
| monsterWaves1 / monsterWaves2 | 敌人波次二维数组 | 每波包含多个敌人对象 |
| mazeBuffId / buff | 楼层 Buff ID 及本地化描述 | name: "Ruinous Embers" |
| targets | 星级评分目标 | 剩余回合数要求、倒地人数限制 |

**单个敌人对象字段**（四种模式通用）：

| 字段 | 类型 | 说明 | 示例（Memory XV BOSS） |
|------|------|------|------|
| hp | number[] | 生命值数组（可能多部位） | [120200] |
| level | number | 敌人等级 | 65 |
| speed | number | 速度 | 120 |
| toughness | number | 韧性值 | 120 |
| effectRes | number | 效果抵抗 | 0.20 |
| stanceCount | number | 姿态计数 | 2 |

**实际数据示例对比**：同一挑战组内，不同楼层的 BOSS HP 存在明显阶梯增长。以 "The Last Vestiges of Towering Citadel"（Memory 类型）为例：Memory I BOSS HP 约 6,239，Memory V BOSS HP 约 17,616，Memory X BOSS HP 约 35,164，Memory XV BOSS HP 约 120,200。这种跨楼层的数值梯度是分析数值膨胀的核心数据基础。

### 端点三：schedule 数据接口

尝试了 `/api/challenge/schedule`、`/api/challenge/schedule/{id}` 等多种路径，均返回 404。Schedule 数据可能通过 Next.js RSC 载荷在页面级渲染时内嵌提供，而非独立 API。不过，对于数值膨胀分析而言，`scheduleDataId` 已经可以作为时间维度的代理变量：同一名称、不同 `scheduleDataId` 的挑战按 ID 递增顺序排列即为时间序列。

### 关于反爬

两个核心 API 端点均为公开 JSON 接口，无需 Cookie、Token 或任何认证头。直接使用 Python `requests` 库即可获取数据，响应头中未见速率限制（Rate-Limit）字段。该站的数据策略显然是开放友好的（数据来源注明 Project Yatta、HoneyHunterWorld、SRTools 等公开数据源），因此不存在反爬对抗问题。

## 爬取方案选型分析

基于上述技术调研，以下列出三种可能的爬取方案及其对比。

### 方案 A：纯 REST API 直连（推荐）

**实施方式**：使用 Python `requests` + `json` 直接调用 API，先获取 `/api/challenge` 列表（一次性），再根据需求遍历调用 `/api/challenge/{id}` 获取每组详情。

**优势**：完全解析的结构化 JSON，无 DOM 解析开销；无需浏览器环境，可在命令行和 CI 中运行；速度极快，96 组详情可在 1-2 分钟内完成（串行请求）；数据完整度和准确性最高。

**劣势**：无法获取 schedule 的精确时间映射（版本号和日期），因为 schedule 数据可能不通过 REST API 暴露。

**技术难度**：低。核心代码量约 50-80 行 Python。

### 方案 B：混合模式（API + 浏览器辅助）

**实施方式**：主体数据通过方案 A 的 REST API 获取；仅在需要 schedule 精确日期时，使用 Playwright 加载挑战列表页面的完整 DOM，从渲染后的页面文本中提取赛季名称和日期信息（页面中显示如 "Version 2.7"、"2025-03" 等）。

**优势**：利用 API 的效率优势处理 95% 的数据，仅用浏览器处理 5% 的边缘信息。

**劣势**：需要安装 Playwright 及其浏览器依赖（约 200 MB），开发复杂度略增。Schedule 日期提取逻辑需要适配页面文本格式。

**技术难度**：中等。核心代码量约 150-200 行 Python。

### 方案 C：纯浏览器自动化

**实施方式**：全部通过 Playwright 或 Selenium 加载页面、点击标签、提取 DOM 文本，不直接调用 API。

**优势**：获取的是页面最终渲染结果，包括所有可见文本。

**劣势**：速度极慢（96 组数据需要大量页面导航）；DOM 解析比 JSON 解析脆弱，易受页面结构变更影响；资源消耗大；开发调试成本高。

**技术难度**：中等偏高。代码量约 300-400 行 Python，且需要处理异常和超时。

### 方案选型结论

强烈推荐方案 A（纯 REST API 直连）。理由如下：API 数据是完整的结构化 JSON，已经完全覆盖数值膨胀分析所需的全部核心字段（HP、SPD、Toughness、EffRES、楼层数、波次数）。Schedule 的精确日期可以通过 `scheduleDataId` 的递增顺序作为时间序列的代理，或者在后续手动建立 `scheduleDataId` 到版本号的对照表（该对照表可以一次性手动录入，工作量不超过 30 分钟）。

## 技术难度综合评估

### 爬取层面

难度评定为低。两个 API 端点均为公开 GET 请求，返回标准 JSON。无需处理以下常见爬虫难题：认证（Token/Cookie/Session）、反爬（验证码/IP 封禁/请求签名）、分页（API 已返回全量 96 条）、动态渲染（JSON 即结构化数据）、数据清洗（字段稳定规范）。

唯一需要注意的技术点是避免请求过于密集。建议在遍历 96 组详情时加入 0.3-0.5 秒的请求间隔，总计约 30-50 秒即可完成全量数据采集。

### 数据处理层面

难度评定为中等。主要挑战在于：

第一，跨赛季数值对比需要统一基准。不同挑战组的 `levelCount`、敌人类型和 Buff 机制不同，需要制定标准化的对比维度（如同等级敌人 HP 中位数、单楼层总 HP 等）。

第二，四种模式的数据特征差异明显：Forgotten Hall 侧重敌人组合，Pure Fiction 侧重积分目标，Apocalyptic Shadow 有 Boss 阶段机制，Anomaly Arbitration 有负向 Debuff 机制。跨模式的数值膨胀分析需要在统一框架下进行。

第三，`scheduleDataId` 到版本号的映射需要手动建立，建议在项目初期投入 1-2 小时完成此对照表。

### 预测建模层面

难度评定为中等到高。准确预测未来数值膨胀趋势需要结合：游戏版本更新的历史规律（通常每 6 周一个新版本）、数值增长率的历史拟合、开发者可能的平衡调整策略等因素。简单的线性回归可能不够，需要考虑对数增长模型或分段回归。

## 项目建议

### 数据采集策略

第一步，调用 `/api/challenge` 获取 96 组元数据，按 `groupType` 分类为四个 DataFrame。第二步，建立 `scheduleDataId` 到版本号的对照表（手动）。第三步，批量调用 `/api/challenge/{id}` 获取每组详情，提取每层每波敌人的 HP、SPD、Toughness 数据并存储。第四步，按 `scheduleDataId`（即时间排序）重新组织数据，生成四种模式的数值时间序列。

### 数据结构建议

建议以 Pandas DataFrame 作为核心数据结构，主表字段包括：模式名称、挑战 ID、挑战名称、scheduleDataId（时间序号）、楼层、波次、敌人等级、敌人 HP、敌人 SPD、敌人 Toughness、敌人 EffRES、Buff 描述。这种结构天然支持时间序列分析和跨维度对比。

### 存储格式

鉴于数据量级（96 组 × 平均 8 层 × 平均 3 波 × 平均 4 敌人 ≈ 约 9000 条敌人记录），建议使用 CSV 或 Parquet 格式存储，兼具可读性和 Pandas 兼容性。

### 风险提示

Huroka.com 作为一个社区维护的数据库站点，其域名和服务器可能不具备商业级可靠性。建议在项目初期完成全量数据采集并本地备份，避免因站点不可用导致项目中断。数据的完整性依赖上游数据源（Project Yatta、HoneyHunterWorld、SRTools）的维护，若上游停止更新则本站数据也将停滞。

## 结论

Huroka.com 为崩坏：星穹铁道挑战模式数据提供了高度结构化的公开 JSON API，两个端点（列表 `/api/challenge`、详情 `/api/challenge/{id}`）足以覆盖所有数值膨胀分析所需的数据字段。爬取难度为该项目中最简单的环节，建议采用纯 REST API 直连方案，配合本地 schedule 版本对照表，可在 1 小时内完成全量数据采集。项目的核心技术挑战不在于爬取本身，而在于数据处理、数值膨胀分析模型搭建和预测建模。

## 参考文献

1. [Huroka - 挑战模式主页](https://www.huroka.com/challenge)
2. [Huroka - API 挑战列表](https://www.huroka.com/api/challenge)
3. [Huroka - API 挑战详情 (Memory)](https://www.huroka.com/api/challenge/100)
4. [Huroka - API 挑战详情 (Story)](https://www.huroka.com/api/challenge/2001)
5. [Huroka - API 挑战详情 (Boss)](https://www.huroka.com/api/challenge/3001)
6. [Huroka - API 挑战详情 (Peak)](https://www.huroka.com/api/challenge/4001)
7. [Project Yatta - 星穹铁道数据](https://projectyatta.com/)
8. [HoneyHunterWorld - 星穹铁道数据库](https://hsr.honeyhunterworld.com/)
9. [SRTools - 星轨工具箱](https://srtools.jamsg.cn/)
