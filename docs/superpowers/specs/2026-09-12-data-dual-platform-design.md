# 八字选股系统：全市场数据 + 双端使用 设计文档

日期：2026-09-12
状态：已确认（用户批准）

## 背景与问题

1. `data/sequoia_v2.db` 的 `stock_daily` 仅覆盖沪市（60/68 开头共 2176 只），缺深主板（00）、创业板（30）、北交所，导致"股票数据拉不下来"的感知；`stock_names` 已有全量 8815 只名称。
2. 扫描 universe 依赖 `stock_daily`，全市场股票无法参与命理评分，且不展示价格。
3. 手机 APK 已就绪（bazixuangu 仓库 + GitHub Actions 自动构建），但股票扫描需电脑后端；电脑端无大屏操作形态。

## 目标

- 数据：akshare 全市场快照（~5400 只，含沪深创 + 北交所）+ 每日增量，扫描展示最新价/涨跌幅。
- 双端：电脑浏览器大屏版（同一套 Vue 代码响应式适配），手机 APK 可配置电脑后端地址联用。
- 一键启动：`启动选股工具.bat` 起服务并打开浏览器。

## 方案（已选定：方案 A + 自动增量）

单服务一体化：Flask 承担 数据同步 + API + 静态页面托管；前端一套代码双端响应式；启动时自动检测并后台拉取当日快照，支持手动触发。

### 1. 数据层（server/data_sync.py，新模块）

- 数据源：akshare `stock_zh_a_spot_em()`，一次调用返回全市场快照。
- 新表 `stock_spot(symbol TEXT PRIMARY KEY, name TEXT, price REAL, change_pct REAL, market TEXT, updated_at TEXT)`，每次同步事务内整表替换。
- 状态机：idle → syncing（含进度）→ done/failed；状态存模块内存 + `sync_meta` 表（记录上次成功日期）。
- 启动检测：当日无成功快照则后台线程自动同步（不阻塞 API 启动）。
- 容错：失败重试 2 次（间隔 5s）；最终失败时扫描降级用 `stock_names`（全量名称评分，无价格），命理功能不中断。

### 2. 后端 API（server/app.py 重构）

| 路由 | 说明 |
|---|---|
| `GET /` | 托管 `dist/`，电脑大屏入口 |
| `GET /api/scan` | universe 改用 `stock_spot`（评分 + 最新价 + 涨跌幅 + market）；无快照降级 `stock_names` |
| `POST /api/sync` | 手动触发同步（幂等：syncing 时返回 409） |
| `GET /api/sync/status` | 状态 + 进度 + 上次成功时间 |
| `GET /api/sectors` | 全 universe 按五行分组计数（大屏图表用） |

- 监听 `0.0.0.0:5175`（手机经 WiFi 访问电脑 IP），启动时打印局域网地址。
- 路由用 Blueprint 拆分（api 蓝图 + 静态托管），统一 JSON 错误格式。
- JSON 输出统一 camelCase（与前端约定一致）。

### 3. 前端双端适配（src/）

- 桌面大屏（`>=960px`）：ScanPage 升级为工作台——左栏评分排行（代码/名称/五行/评分/最新价/涨跌幅），右栏命理概况 + 五行分布图 + 数据同步面板（状态/进度/手动按钮）。
- 手机（`<960px`）：保持现有单栏，增加价格列与同步入口。
- 后端地址设置：设置弹窗（localStorage `backend_base`，默认 `/api`），手机可填电脑局域网 IP 直连电脑数据。
- 五行分布图用 CSS 横向柱状图（不引图表库，控制 APK 体积）。

### 4. 启动与部署

- `启动选股工具.bat`：起 Flask（独立窗口）→ 2 秒后打开浏览器。
- 手机 APK：CI 流程不变，推送自动出新包。
- README 补双端使用说明。

### 5. 测试

- 后端 pytest：评分/降级逻辑/同步状态机（mock akshare）/API 契约。
- 数据：实跑一次 akshare 快照验证落库。
- 前端：vite build + 浏览器双视口（桌面/手机）实测扫描全流程。

### 6. 代码优化（随本次完成）

- HomePage/DailyPage 中重复的干支→五行映射收敛到 `core/elements.js` 单一来源。
- ScanPage 加载/空/错误三态补全；API 调用超时已有，补取消逻辑。
- app.py 拆分 + 统一错误响应。

## 明确不做（YAGNI）

- 不补历史 K 线（现有 2176 只保持）；不引 Electron/Tauri；不引重型图表库；不做用户系统/鉴权。
