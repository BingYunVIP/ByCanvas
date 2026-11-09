# 当前进度

更新时间：2026-11-09（用户时区）

## Chrome 图片上传兼容性

- 阶段：修复已于 2026-11-06 部署；用户于 2026-11-09 明确授权本地 commit 和 push。
- 已确认根因：三个上传入口直接以 `File.type` 过滤，空 MIME 文件在读取前即被丢弃。
- 已确认方案：统一 helper、文件头验证、常见空 MIME 图片兼容、非图/HEIC 明确提示。
- 当前验证：2026-11-09 前端 16/16、后端 2/2；JavaScript/Python 语法与 diff 检查通过，线上健康检查正常。
- 相关记录：[需求](Require/2026-11-06-image-upload.md)、[任务](Task/2026-11-06-image-upload.md)。

## 浏览器兼容性修复

- 阶段：已部署，待用户在 Firefox/Edge 验收；代码在 `fix/browser-transport-resilience-20261106`，未提交。
- 已完成：安装 `pytest` 与 `fake-indexeddb`；新增有期限的浏览器本地传输缓存、网络/CORS 回退判定和自动化测试；修复空图片响应被误判为网络错误并重复请求的边界。
- 当前验证：2026-11-09 前端 16/16、后端 2/2；JS/Python 语法与 diff 检查通过。此前 Chromium 页面烟测通过，本轮线上 HTTP 健康检查通过。
- 限制：Firefox 缺少 GTK 运行库，Edge 未安装；无法声称 Firefox/Edge 实际 UI 已验证。没有重复调用计费型生成接口。
- 部署：2026-11-06 执行 `bash ByCanvas.sh install --yes` 成功并在发现 CDN 旧缓存后再次部署；systemd active/enabled，本机与公网健康、版本化首页脚本、新传输模块均 HTTP 200。数据库备份不适用（无服务端业务数据库）。
- 图片上传：已部署 `image-input.js?v=20261106-image-upload1` 与 `app.js?v=20261106-image-upload1`；公网资源和 Chromium 烟测通过。
- Git 交付：用户已授权 commit 和 push；随本次提交保存修复、测试和文档，推送当前修复分支。实际提交及推送结果以 Git 历史和远程分支为准。
- 待验收：用户在 Firefox/Edge 的实际页面操作。
- 相关记录：[需求](Require/2026-11-06-browser-compatibility.md)、[任务](Task/2026-11-06-browser-compatibility.md)、[Developer 测试](Test/2026-11-06-browser-compatibility-Developer.md)、[QA 测试](Test/2026-11-06-browser-compatibility-QA.md)。
