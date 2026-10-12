# ByCanvas

<p align="center">
  <img src="frontend/assets/logo.png" alt="ByCanvas" width="120">
</p>

<p align="center">
  <a href="https://cvs.bingyun.vip">https://cvs.bingyun.vip</a>
</p>

## 功能

- AI 对话：流式输出，支持推理过程折叠
- 图片生成：文生图
- 图片编辑：上传参考图改图
- 视频生成：文生视频
- 模型列表每次请求实时从上游拉取；推理档位、能否看图、视频时长与清晰度自动同步
- 提示词支持 Markdown 排版
- 支持中文、英文和深色模式
- 前后端同源运行，无需单独构建前端
- API Key、对话、图片、视频只保存在浏览器本地，服务器不落盘

## 部署

支持 Ubuntu / Debian 等 Linux 发行版，不使用 Docker。

```bash
git clone https://github.com/BingYunVIP/ByCanvas.git
cd ByCanvas
sudo bash ByCanvas.sh
```

脚本依次完成：检查系统环境 → 安装缺失的工具（python3、python3-venv、curl、uv）→
询问是否创建系统服务（默认 Y，systemd 开机自启 + 失败自启 + 后台常驻）→
打印启动日志 → 输出访问地址。

默认监听 7400 端口：

```text
http://服务器IP:7400
```

自定义端口或运行用户：

```bash
sudo bash ByCanvas.sh install --port 8000 --user appuser
```

### 服务管理

```bash
sudo bash ByCanvas.sh status      # 运行状态
sudo bash ByCanvas.sh logs        # 查看日志
sudo bash ByCanvas.sh restart     # 重启
sudo bash ByCanvas.sh stop        # 停止
sudo bash ByCanvas.sh uninstall   # 停止并移除系统服务
sudo bash ByCanvas.sh doctor      # 只做环境体检，不改动系统
bash ByCanvas.sh help             # 查看全部参数
```

### 日志

部署脚本的日志按 `[环境]` `[依赖]` `[服务]` `[启动]` `[访问]` 分类，同时写入
`.deploy/deploy-YYYYMMDD.log`。

后端日志按链路分类（`[视频]` `[生图]` `[聊天]` `[模型]` `[体检]` `[服务]` `[启动]`），
问题行带 `[WARN]` / `[ERROR]` 前缀：

```bash
sudo journalctl -u bycanvas-backend -f                                # 全量
sudo journalctl -u bycanvas-backend -f | grep '\[视频\]'               # 只看某条链路
sudo journalctl -u bycanvas-backend -f | grep -E '\[(WARN|ERROR)\]'   # 只看问题行
```
