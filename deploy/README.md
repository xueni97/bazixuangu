# 部署说明

本项目（渊海子平八字选股）的部署文件位于 `deploy/` 目录，包括 systemd 单元模板、首次部署脚本和本说明。

## 1. 服务器要求

- 操作系统：Ubuntu / Debian（其它支持 systemd 的 Linux 也可）
- Python 3.11+（含 pip 与 venv 模块）
- Node.js 18+（含 npm）
- 内存：1GB 起步（学生服务器够用）
- 已安装 git
- 对外开放端口 5000（可在 `.env` 中通过 `FLASK_PORT` 修改）

## 2. 首次部署

1. 克隆代码并进入项目根目录：
   `git clone <repo-url> /opt/bazi-stock-app && cd /opt/bazi-stock-app`
2. 执行部署脚本：
   `bash deploy/deploy.sh`
   - 自动完成：复制 `.env.example` 为 `.env`、创建 `.venv`、安装 `server/requirements.txt`、`npm ci && npm run build` 生成 `dist/`、创建 `data/` 与 `logs/` 目录。
   - 如部署路径不是 `/opt/bazi-stock-app`，请 `DEPLOY_DIR=/your/path bash deploy/deploy.sh`。
3. 编辑 `.env`，填写数据库连接、Tushare token、`FLASK_PORT` 等。
4. 安装 systemd 服务：
   `sudo cp deploy/bazi.service /etc/systemd/system/bazi.service`
   `sudo systemctl daemon-reload && sudo systemctl enable --now bazi`
5. 安装定时同步任务：`crontab -e`，加入：
   `0 16 * * 1-5 cd /opt/bazi-stock-app && .venv/bin/python server/sync_once.py >> logs/sync.log 2>&1`

## 3. 常用运维命令

- 查看服务状态：`sudo systemctl status bazi`
- 重启服务：`sudo systemctl restart bazi`
- 实时跟踪日志：`sudo journalctl -u bazi -f`
- 查看最近 100 行日志：`sudo journalctl -u bazi -n 100`
- 查看定时任务：`crontab -l`
- 查看数据同步日志：`tail -f logs/sync.log`

## 4. 更新版本

1. 拉取最新代码：`git pull origin main`
2. 如前端有变更：`npm ci && npm run build`
3. 如依赖有变更：`.venv/bin/pip install -r server/requirements.txt`
4. 重启服务：`sudo systemctl restart bazi`

## 5. 常见问题

- **端口被占用**：编辑 `.env` 中的 `FLASK_PORT`，同步修改 `deploy/bazi.service` 的 `ExecStart` 中 `--bind` 端口，再 `sudo systemctl daemon-reload && sudo systemctl restart bazi`。
- **504 / 网关超时**：gunicorn 默认 worker 超时 30s，长查询场景调高。编辑 `deploy/bazi.service` 的 `ExecStart` 追加 `--timeout 120`，`sudo systemctl daemon-reload && sudo systemctl restart bazi`。
- **数据没拉取**：`tail -f logs/sync.log` 检查报错；确认 `.env` 中 Tushare token 有效、`crontab -l` 中 cron 行存在且路径正确。
