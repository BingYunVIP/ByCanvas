# 图片上传兼容性 QA 报告

- 角色：独立 QA
- 日期：2026-11-06（用户时区）
- 分支：`fix/browser-transport-resilience-20261106`
- 范围：Chrome 图片选择、MIME 识别、FileList 快照、现有回归测试；未部署、未提交。

## 实际验证

| 检查 | 命令/操作 | 状态 | 证据 |
|---|---|---|---|
| 前端自动化 | `cd frontend && npm test` | 通过 | 16 tests passed, 0 failed；含空 MIME PNG、WebP、伪装文件、HEIC、FileList 快照和既有传输回退测试。 |
| 后端测试 | `cd backend && .venv/bin/python -m pytest -q` | 通过 | 2 passed。直接从仓库根目录运行会因项目 `pythonpath` 设计失败；按项目目录命令执行通过。 |
| JS 语法 | `node --check frontend/js/*.js` 及 vendor parser | 通过 | 全部退出码 0。 |
| Python 编译 | `backend/.venv/bin/python -m compileall -q backend/app backend/serve.py backend/tests` | 通过 | 退出码 0。 |
| Patch 检查 | `git diff --check` | 通过 | 无空白错误。 |
| 真实 Chromium 公网烟测 | Playwright Chromium 打开 `https://cvs.bingyun.vip/?transport=proxy` | 通过 | 页面标题为「冰云画布 - 支持图片和视频」；线上 `accept` 包含 PNG/JPEG/WebP。 |
| Chrome 空 MIME 文件识别 | Chromium 页面中构造 `File(..., 'chrome-empty-mime.png', {type: ''})`，调用线上 `image-input.js` | 通过 | 返回 `{ok:true,mime:'image/png'}`。 |
| FileList 清空回归 | 真实页面使用 helper 对 live-like FileList 快照后清空原列表 | 通过 | 快照仍保留 1 个文件及原文件名。 |
| Firefox/Edge | 执行环境浏览器 | 阻塞 | Firefox 缺少 GTK 运行库，Edge 未安装；未伪报通过。 |
| 计费上游生成 | 生图/视频 | 未执行 | 本轮不重复消耗额度；上传识别不需要调用上游。 |

## 结论

图片识别和 Chromium 真实页面验证通过。当前改动覆盖 Chrome 空 MIME 与清空 `input.value` 导致 live `FileList` 失效这两个根因。Firefox/Edge UI 仍需在具备相应浏览器的环境验收。
