# 浏览器兼容性修复任务

- Git：分支 `fix/browser-transport-resilience-20261106`；保留未跟踪 `AGENTS.md`；不提交。
- Developer：隔离实现通道缓存与网络回退、安装依赖、写自动化测试和报告。
- QA：Developer 完成后独立执行两轮真实 HTTP/浏览器可执行性测试并写报告。
- 部署授权：用户于 2026-11-06 明确要求“请部署上线”；目标为当前运行的 `/root/ByCanvas` systemd 服务，入口 `https://cvs.bingyun.vip`，按现有配置端口 7400、仅监听 `127.0.0.1`。
- 目标文件范围：`frontend/js/api.js`、必要的新前端测试/工具模块、`frontend/package.json`、锁文件；后端仅在真实证据需要时修改。
- 停止条件：测试密钥失效、上游额度/服务不可用、浏览器工具缺失，均记录为阻塞，不伪报通过。
