# 浏览器兼容性修复部署记录

- 用户授权：2026-11-06 明确要求部署上线。
- 目标：当前主机 `/root/ByCanvas`，systemd 服务 `bycanvas-backend`，监听 `127.0.0.1:7400`；公开入口 `https://cvs.bingyun.vip`。
- 代码分支：`fix/browser-transport-resilience-20261106`，基线 `3991ddc`；本次未提交。
- 数据备份：本项目只在浏览器保存会话和图片，服务端不持有业务数据库；不适用数据库备份。
- 切换方法：运行仓库自带 `ByCanvas.sh install --yes`，按已保存服务配置安装依赖并重启 systemd 服务。
- 回退：若部署后健康检查失败，保留当前文件与日志，使用 Git 将本次变更逐项恢复到基线后重跑验证，再通过 `ByCanvas.sh install --yes` 重启；不执行 reset/checkout 等破坏性 Git 命令。
- 部署时间：2026-11-06 10:43（主机日志时间；用户时区日期为 2026-11-06）。
- 执行：`bash ByCanvas.sh install --yes`，脚本退出码 0；复用既有 `.venv`，沿用 `backend/.env`，重写既有 systemd unit 并重启 `bycanvas-backend`。
- 服务：`systemctl is-active` 返回 `active`，`is-enabled` 返回 `enabled`；监听 `127.0.0.1:7400`。
- 本机健康：`http://127.0.0.1:7400/api/healthz` HTTP 200，返回 `ok=true`。
- 公网入口：`https://cvs.bingyun.vip/` HTTP 200，页面标题为「冰云画布 - 支持图片和视频」。公网 `/api/healthz` HTTP 200；`/js/transport.js` HTTP 200 且返回新模块内容。
- 数据库备份：不适用，当前架构没有服务端业务数据库；会话与图片保存在浏览器。
- 回退：保持工作区变更和 Git 历史不变；若发现线上问题，先按当前 diff 逐项反向修复并验证，再运行 `bash ByCanvas.sh install --yes` 恢复服务。当前未执行回退。
- 后续：Firefox 与 Edge 的真实浏览器验收仍未完成；Chromium headless 页面烟测通过。用户可在 Firefox/Edge 分别访问线上入口并操作获取模型、上传参考图、生成图片/视频，出现问题时提供脱敏控制台错误和 Network 请求状态。
- 缓存处理：首次部署后发现 CDN 对无参数 `api.js` 仍可返回旧缓存；已给 `api.js` 与 `transport.js` 增加 `?v=20261106-transport1` 版本参数，并再次运行 `bash ByCanvas.sh install --yes`。复核公网首页包含版本化脚本，版本化 `api.js`/`transport.js` 和 `/api/healthz` 均 HTTP 200。
- 图片上传部署：2026-11-06 再次执行 `bash ByCanvas.sh install --yes`，加入版本化 `image-input.js` 与 `app.js` 查询参数，避免 CDN 使用旧上传逻辑。公网首页、版本化模块和 `/api/healthz` 均 HTTP 200；Chromium 线上烟测页面加载正常，accept 列表包含 PNG/JPEG/WebP。
