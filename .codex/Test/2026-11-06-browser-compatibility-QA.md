# 浏览器兼容性修复 QA 报告

- 角色：独立 QA
- 日期：2026-11-06（用户时区）
- 分支：`fix/browser-transport-resilience-20261106`
- QA 基线：Developer 完成后，主 Agent 增加显式网络失败标记与“空成功图片响应不重试”修正后的最终工作区；未提交、未部署。
- 计费接口：本轮不重复调用上游生图/视频接口。

## 本 QA 实际执行

| 检查 | 命令/操作 | 状态 | 实际证据 |
|---|---|---|---|
| 前端自动化 | `cd frontend && npm test` | 通过 | 9 tests passed, 0 failed。包含缓存 TTL/隔离、网络/CORS 分类、模型/生图/改图回退、图片 URL 下载失败回退、HTTP 200 空图片不重复请求、multipart 上传、IndexedDB 持久化。 |
| 后端测试 | `cd backend && uv run pytest -q` | 通过 | 2 passed。 |
| 前端依赖 | `cd frontend && npm ls --depth=0` | 通过 | `fake-indexeddb@6.2.5` 已安装。 |
| JavaScript 语法 | `node --check` 检查 `frontend/js/*.js` 和 vendored parser 模块 | 通过 | 全部退出码为 0。 |
| Python 编译 | `cd backend && uv run python -m compileall -q app serve.py ../tools` | 通过 | 命令退出码为 0。 |
| Patch 检查 | `git diff --check` | 通过 | 无空白错误。 |
| 本机真实 HTTP | 临时启动后端 `serve.py 17505 127.0.0.1`，用 HTTP 客户端请求三个端点 | 通过 | `/api/healthz` 200，`/` 200，`/api/openapi.json` 200。临时服务已退出。 |
| IPv4/IPv6 监听 | `cd backend && uv run python serve.py 17506 auto --check` | 通过 | `127.0.0.1` 与 `::1` 都连通，监听结果为 IPv6 双栈。 |
| QA 浏览器可执行性 | 查找 Firefox、Chrome、Chromium、Edge、Playwright | 阻塞 | 本 QA 执行环境没有浏览器可执行程序，无法独立运行浏览器 UI 烟测。 |

## 主 Agent 补充浏览器证据（非本 QA 独立执行）

主 Agent 报告已用 Chromium + Playwright headless 实际打开页面：页面标题正确、健康检查正常、没有 backend-down 横幅；验证了新鲜失败选择 proxy、旧缓存重新探测、新 context 无缓存。Firefox 因缺少 GTK 库无法启动；Edge 不存在。以上是主 Agent 执行结果，不能记作本 QA 的独立执行。

## QA 判断

最终代码的自动化、服务端 HTTP 与双栈监听验证通过。最新修正把回退限定为明确的网络/CORS 错误，避免把 HTTP 200 但响应无图片当成通道问题而重复发起可能计费的生图请求。HTTP 401/502 等状态继续按原错误路径处理。

Chromium headless 主 Agent 烟测补充了真实页面证据；Firefox 和 Edge 的真实 UI 操作仍未完成，Firefox 环境依赖阻塞、Edge 未安装。没有执行生产部署、commit、push 或本轮重复计费请求。
