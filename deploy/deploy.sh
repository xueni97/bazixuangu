#!/usr/bin/env bash
# 首次部署脚本。在项目根目录运行: bash deploy/deploy.sh
# 可用环境变量:
#   DEPLOY_DIR  部署根目录，默认 /opt/bazi-stock-app (用于 cron 行的绝对路径)
#   PYTHON      Python 解释器，默认 python3
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/bazi-stock-app}"
PYTHON="${PYTHON:-python3}"

echo "==> DEPLOY_DIR=$DEPLOY_DIR"
echo "==> PYTHON=$PYTHON"
echo

# 1. .env
if [ -f .env ]; then
  echo "[1/6] 检测到 .env，跳过"
else
  echo "[1/6] 未检测到 .env，从 .env.example 复制"
  cp .env.example .env
  echo "     请稍后编辑 .env (数据库 / Tushare token / FLASK_PORT 等)"
fi

# 2. 虚拟环境
echo "[2/6] 创建 Python 虚拟环境 .venv"
"$PYTHON" -m venv .venv

# 3. 安装依赖
echo "[3/6] 安装 server/requirements.txt 到 .venv"
.venv/bin/pip install -r server/requirements.txt

# 4. 构建前端
echo "[4/6] 构建前端 dist/ (npm ci + npm run build)"
npm ci
npm run build

# 5. 数据/日志目录
echo "[5/6] 创建 data/ 和 logs/ 目录"
mkdir -p data logs

# 6. 后续手动步骤
cat <<EOF
[6/6] 自动步骤完成。请手动完成以下配置:

  (a) 安装 systemd 服务:
      sudo cp deploy/bazi.service /etc/systemd/system/bazi.service
      # 按实际安装路径编辑 WorkingDirectory / EnvironmentFile / ExecStart
      sudo systemctl daemon-reload
      sudo systemctl enable --now bazi

  (b) 编辑 .env (数据库、Tushare token、FLASK_PORT 等)

  (c) 安装定时同步任务: crontab -e，加入下面一行
      (每个交易日 16:00 执行 server/sync_once.py，日志写入 logs/sync.log):
      0 16 * * 1-5 cd $DEPLOY_DIR && .venv/bin/python server/sync_once.py >> logs/sync.log 2>&1

  完成后服务监听 0.0.0.0:5000，浏览器访问 http://<服务器IP>:5000 验证。
EOF
