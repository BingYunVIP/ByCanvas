# ByChat_IMG

<p align="center">
  <img src="frontend/assets/logo.png" alt="ByImage Logo" width="120">
</p>

<p align="center">
  <a href="https://img.bingyun.vip">在线体验：https://img.bingyun.vip</a>
</p>

冰云生图（ByImage）是一个集 AI 对话、图片生成和图片编辑于一体的网页应用。

## 功能

- AI 对话、图片生成与图片编辑
- API Key、图片和对话保存在用户浏览器本地
- 支持多标签页数据同步和刷新恢复
- 支持中文、英文和深色模式
- 前后端同源运行，无需单独构建前端
- systemd 开机自启、失败重启、版本回滚和健康检查

## Linux 部署

支持 Ubuntu 和 Debian。项目可以放在任意可读取目录，包括带空格或中文的路径。

```bash
git clone https://github.com/BingYunVIP/ByChat_IMG.git
cd ByChat_IMG
```

已经进入 root 账号时（命令提示符通常以 `#` 结尾）：

```bash
bash deploy.sh install
```

普通账号且系统安装了 `sudo` 时：

```bash
sudo bash deploy.sh install
```

系统没有 `sudo` 时，先切换到 root，再进入项目目录部署：

```bash
su - root
cd /实际路径/ByChat_IMG
bash deploy.sh install
```

默认监听 `7400` 端口：

```text
http://服务器IP:7400
```

自定义端口或运行用户：

```bash
bash deploy.sh install --port 8000
bash deploy.sh install --user appuser
```

## 服务管理

```bash
bash deploy.sh status
bash deploy.sh logs
bash deploy.sh restart
bash deploy.sh update
bash deploy.sh rollback
bash deploy.sh doctor
bash deploy.sh uninstall
```

以上部署和管理命令需要 root 权限。普通账号可在命令前加 `sudo`；没有 `sudo` 的系统请先使用 `su - root`。

查看全部参数：

```bash
bash deploy.sh help
```

## 本地运行

```bash
bash tools/start_backend.sh
```

然后访问 `http://127.0.0.1:7400`。

## 配置

首次部署会根据 `backend/.env.example` 创建本机配置 `backend/.env`。该文件不会提交到 Git。

网站不设置统一访问密码。每位用户在自己的浏览器中填写上游 API Key，服务器只在当前请求中使用，不保存用户的 API Key、图片或对话。

浏览器数据按协议、域名和端口隔离。更换访问地址后，原地址中的本地数据不会自动迁移。

## 测试

```bash
cd frontend && node --test tests/*.test.mjs
cd ../backend && .venv/bin/python -m pytest -q
cd .. && python3 -m unittest -v tools.tests.test_deploy
```
