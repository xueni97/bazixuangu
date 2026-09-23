# 八字选股 服务器运维手册

适用环境：腾讯云学生服务器（Ubuntu 22.04, 用户 ubuntu）

| 项 | 值 |
|---|---|
| 项目路径 | `/home/ubuntu/yanfwu/bazixuangu` |
| 虚拟环境 | `/home/ubuntu/yanfwu/bazixuangu/.venv`（Python 3.10） |
| 服务端口 | `5000`（gunicorn，访问 `http://服务器IP:5000`） |
| 数据库 | `<项目>/data/sequoia_v2.db`（SQLite） |
| 数据同步日志 | `<项目>/logs/sync.log` |
| 代码分支 | 开发在 `feature/*`，稳定在 `main` |

---

## 1. 服务管理

### 1.1 手动方式（当前）

```bash
# 启动（后台守护）
cd /home/ubuntu/yanfwu/bazixuangu/server
/home/ubuntu/yanfwu/bazixuangu/.venv/bin/gunicorn app:app \
  --workers 1 --bind 0.0.0.0:5000 --preload --daemon

# 停止
pkill -f 'gunicorn app:app'

# 重启（等价于 停止 + 启动）
pkill -f 'gunicorn app:app' ; sleep 2 ; cd /home/ubuntu/yanfwu/bazixuangu/server && \
/home/ubuntu/yanfwu/bazixuangu/.venv/bin/gunicorn app:app \
  --workers 1 --bind 0.0.0.0:5000 --preload --daemon

# 查看是否在跑
ps aux | grep gunicorn | grep -v grep

# 查看实时日志（手动方式日志在前台或 nohup.out；建议改为下节 systemd）
```

> 注意：服务器重启后手动方式不会自动拉起，需重新执行启动命令。推荐配置 1.2。

### 1.2 systemd 方式（推荐，开机自启 + 崩溃自动重启）

```bash
sudo nano /etc/systemd/system/bazi.service
```

内容（已按本服务器路径写好）：

```ini
[Unit]
Description=八字选股 Flask 服务
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/yanfwu/bazixuangu/server
ExecStart=/home/ubuntu/yanfwu/bazixuangu/.venv/bin/gunicorn app:app --workers 1 --bind 0.0.0.0:5000 --preload --timeout 120
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bazi    # 启动并设开机自启
systemctl status bazi               # 查看状态
```

配好 systemd 后，第 1 节所有命令替换为：

```bash
sudo systemctl start bazi      # 启动
sudo systemctl stop bazi       # 停止
sudo systemctl restart bazi    # 重启
journalctl -u bazi -f          # 实时日志
journalctl -u bazi --since today   # 今天全部日志
```

---

## 2. 版本升级 / 发布流程

### 2.1 标准流程（后端 + 前端一起更）

```bash
# ── 服务器上 ──
cd /home/ubuntu/yanfwu/bazixuangu

# 1. 拉代码（当前在 feature 分支；PR 合并 main 后切回 main）
git fetch origin
git checkout main
git pull origin main

# 2. 依赖有变时才需要（requirements.txt 改动时）
.venv/bin/pip install -r server/requirements.txt

# 3. 前端构建（1G 内存机器建议用 2.2 的本地构建方式）
npm run build

# 4. 重启服务
sudo systemctl restart bazi    # 或手动方式 pkill + 启动

# 5. 验证
curl -s http://127.0.0.1:5000/api/health
curl -s "http://127.0.0.1:5000/api/klines?symbol=600519" | head -c 200
```

### 2.2 Web 前端发布（服务器内存不足时，本地构建上传）

```bash
# ── 本地 Windows（PowerShell，项目根目录）──
npm run build
scp -r dist/* ubuntu@服务器IP:/home/ubuntu/yanfwu/bazixuangu/dist/

# ── 服务器上只需重启 ──
sudo systemctl restart bazi
```

### 2.3 APK 发布（走 GitHub Actions）

```bash
# ── 本地，合并 main 后 ──
git tag v0.5.0 && git push origin v0.5.0
# CI 自动 assembleRelease，到 GitHub → Actions 页下载 APK
```

### 2.4 回滚

```bash
cd /home/ubuntu/yanfwu/bazixuangu
git log --oneline -10              # 找到上一个正常版本 commit
git checkout <commit_id>           # 临时切到旧版本
sudo systemctl restart bazi
# 确认正常后：git checkout main && git revert <坏commit> 或等待修复
```

---

## 3. 数据同步运维

### 3.1 cron 定时（交易日 16:05 自动拉）

```bash
crontab -e
# 确保有这一行：
5 16 * * 1-5 cd /home/ubuntu/yanfwu/bazixuangu && .venv/bin/python server/sync_once.py >> logs/sync.log 2>&1
```

### 3.2 手动触发 / 检查

```bash
# 手动拉一次（补数据、测试用）
cd /home/ubuntu/yanfwu/bazixuangu
.venv/bin/python server/sync_once.py

# 强制全量重拉（忽略水位）
.venv/bin/python server/sync_once.py --force

# 看同步日志
tail -50 logs/sync.log

# 检查数据是否最新（看 stock_kline / stock_ma 条数与 ma_trade_date）
.venv/bin/python -c "
import sqlite3
c = sqlite3.connect('data/sequoia_v2.db')
print('spot:', c.execute('SELECT COUNT(*) FROM stock_spot').fetchone()[0])
print('ma:', c.execute('SELECT COUNT(*) FROM stock_ma').fetchone()[0])
print('kline:', c.execute('SELECT COUNT(*) FROM stock_kline').fetchone()[0])
print('ma_trade_date:', c.execute(\"SELECT value FROM sync_meta WHERE key='ma_trade_date'\").fetchone())
"

# Web 界面手动触发
curl -X POST http://127.0.0.1:5000/api/sync
curl -X POST http://127.0.0.1:5000/api/sync/ma
curl -s http://127.0.0.1:5000/api/sync/status
```

### 3.3 数据源机制与日志解读

- **沪深票（~5700 只）走 baostock 子进程**：每 40 只票起一个 `_bs_worker.py`
  子进程，单批 150 秒超时由系统直接杀进程——主进程永远不会被网络阻塞
  卡死；卡住的批次标记失败，下次 sync 自动增量补
- **北交所票（~200 只，baostock 不支持）** 走东财/新浪线程池兜底
- 日志关键行：
  - `拉取日K(baostock) 1200/2760（本批成功 40/40）`：子进程分批正常推进
  - `baostock 子进程 150s 超时，整批 40 只标记失败`：该批网络卡死，
    不影响整体任务，会自动补拉一轮，仍失败等次日 cron
  - spot 同步结果带 `-partial`（如 `同步成功(sina-partial)，共2960只`）：
    所有源数据都不完整（<4000 只），当天只入池部分标的，网络恢复后重跑
- baostock 本身异常时（login 失败等），子进程输出全失败，主进程自动
  重试；服务器首次部署需 `.venv/bin/pip install baostock`

### 3.4 数据没更新的排查顺序

1. `tail logs/sync.log` — cron 是否执行、有无报错
2. `crontab -l` — 任务还在不在
3. 日志显示"数据源全部失败/限流" → 等 10 分钟重跑 `sync_once.py`
4. 交易日历问题：节假日 16:05 cron 也会跑但拉不到新数据，属正常

---

## 4. 数据库维护

```bash
# 备份（建议升级前必做）
cp data/sequoia_v2.db data/sequoia_v2.db.bak.$(date +%Y%m%d)

# 恢复
cp data/sequoia_v2.db.bak.20260922 data/sequoia_v2.db

# 清库重建（K线/均线重拉，spot/名称表保留）
.venv/bin/python -c "
import sqlite3
c = sqlite3.connect('data/sequoia_v2.db')
c.execute('DELETE FROM stock_kline')
c.execute('DELETE FROM stock_ma')
c.execute(\"DELETE FROM sync_meta WHERE key IN ('ma_trade_date','ma_updated_at')\")
c.commit()
"
.venv/bin/python server/sync_once.py   # 重拉

# 磁盘占用
du -sh data/*.db logs/ 
```

---

## 5. 代理配置（GitHub 访问）

国内云服务器直连 GitHub（github.com:443）会超时。两种方案。

### 5.1 临时方案：SSH 反向隧道（Windows 在线时，5 分钟可用）

把 Windows 本地 Clash 端口转发到腾讯云，无需在服务器装代理。适合临时拉代码。

**Windows PowerShell**（保持窗口开着，关了隧道断）：

```powershell
# 假设 Windows Clash 监听 127.0.0.1:7897（按你的实际端口改）
ssh -R 7897:127.0.0.1:7897 ubuntu@你的腾讯云IP
```

**腾讯云另开一个 SSH 终端**：

```bash
# 配置 git 走代理
git config --global http.proxy http://127.0.0.1:7897
git config --global https.proxy http://127.0.0.1:7897

# 验证（200 即通）
curl -x http://127.0.0.1:7897 -sI https://github.com

# 拉代码
cd /home/ubuntu/yanfwu/bazixuangu && git pull
```

取消代理：

```bash
git config --global --unset http.proxy
git config --global --unset https.proxy
```

### 5.2 长期方案：mihomo 本地常驻（推荐，不依赖 Windows）

腾讯云本地跑 mihomo（Clash Meta 开源版），复用 Windows 的订阅配置，开机自启。适合长期开发。

**步骤 1：下载 mihomo**（用 5.1 的临时隧道，或 ghproxy 镜像）

```bash
# 方式 A：用 5.1 已配好的临时代理下载
curl -x http://127.0.0.1:7897 -L -o /tmp/mihomo.gz \
  https://github.com/MetaCubeX/mihomo/releases/download/v1.18.0/mihomo-linux-amd64-v1.18.0.gz

# 方式 B：ghproxy 国内镜像（无需代理，但稳定性不保证）
wget https://ghproxy.com/https://github.com/MetaCubeX/mihomo/releases/download/v1.18.0/mihomo-linux-amd64-v1.18.0.gz -O /tmp/mihomo.gz

# 解压安装
gunzip /tmp/mihomo.gz
chmod +x /tmp/mihomo
sudo mv /tmp/mihomo /usr/local/bin/mihomo
mkdir -p ~/.config/mihomo
```

> 架构非 amd64（如 arm64）请到 mihomo releases 页选对应版本，文件名换 `mihomo-linux-arm64-v1.18.0.gz`。`uname -m` 看架构。

**步骤 2：上传 Windows Clash 配置**

在 Windows 找到 Clash 的 config.yaml（Clash for Windows 一般在 `%USERPROFILE%\.config\clash\`，或在客户端的 profiles 目录；订阅 URL 也可直接用），scp 上传：

```powershell
scp C:\path\to\config.yaml ubuntu@腾讯云IP:~/.config/mihomo/config.yaml
```

> 端口以 config.yaml 里的 `mixed-port`/`port` 字段为准，下文以 7897 为例。如要改端口，编辑 config.yaml 后 `sudo systemctl restart mihomo`。

**步骤 3：systemd 服务（开机自启）**

```bash
sudo tee /etc/systemd/system/mihomo.service > /dev/null <<'EOF'
[Unit]
Description=Mihomo (Clash Meta) Proxy
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/mihomo -d /home/ubuntu/.config/mihomo
Restart=on-failure
User=ubuntu

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mihomo
sleep 2
curl -x http://127.0.0.1:7897 -sI https://github.com  # 验证，200 即通
```

**步骤 4：git 永久走代理**

```bash
git config --global http.proxy http://127.0.0.1:7897
git config --global https.proxy http://127.0.0.1:7897
```

之后 `git pull`/`git push` 自动走代理，无需再开 SSH 隧道。

### 5.3 常用命令

```bash
sudo systemctl restart mihomo   # 重启（改 config.yaml 后必须重启）
sudo systemctl status mihomo     # 状态
journalctl -u mihomo -f          # 实时日志
curl -x http://127.0.0.1:7897 -sI https://github.com   # 验证代理
git config --global --unset http.proxy  # 临时取消 git 代理
```

---

## 6. 常见故障排查

| 现象 | 排查 | 处理 |
|---|---|---|
| 访问 502/拒绝连接 | `ps aux \| grep gunicorn` | 进程没起 → `systemctl start bazi` 或手动启动 |
| `Address already in use` | `sudo lsof -i :5000` | 旧进程残留 → `pkill -f gunicorn` 后重启 |
| 页面空白 | `ls dist/index.html` | dist 没构建/没上传 → 见 2.1/2.2 |
| API 报 ModuleNotFoundError | 确认在 feature 分支且已 pull | `git log --oneline -3` 检查是否含 `3203465` |
| 回测拉不到数据 | `curl "http://127.0.0.1:5000/api/klines?symbol=600519"` | 空 → 跑 `sync_once.py`，再查 stock_kline 条数 |
| 服务器卡死/OOM | `free -h` | build 别在服务器跑（用 2.2）；gunicorn 保持 1 worker |
| 磁盘满 | `df -h` | 清 `logs/`、旧 `*.db.bak.*`、`~/.npm` 缓存 |

---

## 7. 速查卡

```bash
# 启停
sudo systemctl restart bazi

# 看日志
journalctl -u bazi -f

# 拉数据
.venv/bin/python server/sync_once.py

# 健康检查
curl -s http://127.0.0.1:5000/api/health

# 备份
cp data/sequoia_v2.db data/sequoia_v2.db.bak.$(date +%Y%m%d)
```
