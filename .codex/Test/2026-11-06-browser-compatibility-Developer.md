# 浏览器兼容性修复 Developer 报告

- 角色：Developer
- 日期：2026-11-06（用户时区）
- 分支：`fix/browser-transport-resilience-20261106`
- 基线：`3991ddc`
- 范围：前端通道缓存、网络失败回退、前端测试依赖；未修改 `AGENTS.md`，未提交、未部署。

## 实现

- 新增 `frontend/js/transport.js`，集中处理 `localStorage` 通道状态。
- 缓存增加 10 分钟 TTL；过期或损坏时重新尝试直连，避免某浏览器永久锁定旧通道。
- 仅把浏览器网络/CORS 失败（`TypeError` 或无 HTTP 响应的 status 0）作为通道失败；401、403、404、5xx 等真实 HTTP 错误继续原样显示，不静默切换。
- `api.js` 的模型列表、生图、改图和聊天现有回退逻辑改用统一判断。
- `frontend/package.json` 增加 `npm test`；测试覆盖缓存隔离、TTL、模型/生图/上传改图回退、HTTP 错误保留，并用 `fake-indexeddb/auto` 烟测设置读写。

## 实际验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 前端单元/集成 | `cd frontend && npm test` | 通过，7/7 |
| fake-indexeddb | 同上，真实 IndexedDB 设置写入/读取 | 通过 |
| JS 语法 | `node --check` 检查全部 `frontend/js/*.js` | 通过 |
| Python 语法 | `cd backend && uv run python -m compileall -q app serve.py ../tools` | 通过 |
| 后端测试 | `cd backend && uv run pytest` | 未执行测试：收集 0 项，pytest 返回 5；仓库没有测试文件 |

## 未执行/限制

- 当前执行环境未安装 Firefox、Chrome 或 Edge，未能做真实三浏览器 UI 烟测。
- 真实上游生图、改图、视频和本机 HTTP 检查在本轮修改前已完成；本轮未重复消耗上游额度。
- 需要 QA 在 Developer 完成后，使用可用浏览器或真实 HTTP 客户端做两轮独立复测。

## 复现与失败证据

- TDD RED：首次执行 `node --test test/transport.test.js` 时因 `frontend/js/transport.js` 尚不存在而失败（模块缺失）；补实现后测试转绿。
- 初次使用系统 `python -m compileall` 因系统没有 `python` 命令未执行；改用项目锁定环境 `uv run python ...` 后通过。
