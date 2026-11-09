# Chrome 图片上传兼容性 Developer 报告

- 角色：Developer
- 日期：2026-11-06（用户时区）
- 分支：`fix/browser-transport-resilience-20261106`
- 范围：前端图片选择、粘贴、拖拽的识别和错误提示；未提交、未部署。

## 根因

文件选择事件原先把 `e.target.files`（Chromium 中可能是会变化的 `FileList`）传入异步处理，再立即清空 `input.value`；同时三个入口都直接依赖 `File.type.startsWith('image/')`。Chrome 对部分本地图片会返回空 MIME，导致合法图片在读取前被过滤并显示“请选择图片文件”。

## 实现

- 新增 `frontend/js/image-input.js`：按 PNG/JPEG/WebP 文件头识别，兼容空 MIME；拒绝伪装扩展名和 HEIC/HEIF/AVIF/SVG 等不支持格式。
- 文件选择、粘贴、拖拽统一走同一识别器。
- 文件选择先复制 `FileList`，再清空控件，避免 Chromium 的 live `FileList` 丢失。
- `data:` URL MIME 统一使用实际文件头识别结果。
- 混合选择时继续添加合法图片，并列出被拒绝的文件名和原因。
- `accept` 收敛为 PNG/JPEG/WebP，并增加中文/英文提示。

## 验证

- `cd frontend && npm test`：16/16 通过，覆盖空 MIME、文件头识别、伪装文件、HEIC、错误 MIME、FileList 快照和文件名错误提示。
- `node --check` 全部前端模块：通过。
- `cd backend && uv run pytest -q`：2/2 通过。
- Python `compileall` 与 `git diff --check`：通过。
- 独立 QA 已复跑 16/16 测试和 Chromium 页面烟测；未重复计费型上游生成请求。

## 限制

Firefox/Edge 的真实 UI 运行环境仍未在当前主机安装；Chromium headless 已验证页面加载和输入辅助模块。生产部署需由主 Agent 按用户授权执行。
