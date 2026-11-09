# Chrome 图片上传兼容性任务

- Git：沿用 `fix/browser-transport-resilience-20261106`，保留 `AGENTS.md`，不提交。
- Developer：实现统一图片识别与明确提示，添加自动化测试和 Developer 报告。
- QA：Developer 完成后独立复跑测试、Chromium 文件选择/拖拽烟测和公网静态资源检查，写 QA 报告。
- 目标文件：`frontend/js/app.js`、新增前端图片识别 helper/测试、必要翻译；不扩大到上游协议。
- 停止条件：无法在浏览器读取文件字节、依赖安装失败或真实入口不可用时，记录阻塞而不伪报通过。
