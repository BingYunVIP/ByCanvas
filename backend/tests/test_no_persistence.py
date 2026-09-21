"""「服务器不留痕」的静态检查。

API Key、会话历史、图片都只应存在于浏览器。这里扫描后端源码，确保没有引入
任何会把用户数据写到磁盘或数据库的调用。以后新增代码若违反，测试会直接失败。
"""
from __future__ import annotations

from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / 'app'

# 任何一项出现在后端源码里，都意味着服务器开始持久化用户数据了
FORBIDDEN = (
    'sqlite3',
    'psycopg',
    'pymysql',
    'pymongo',
    'redis',
    'write_bytes(',
    'write_text(',
    "mode='w'",
    'mode="w"',
    "open(..., 'w'",
    'open(..., "w"',
)


def test_backend_never_persists_user_data():
    offenders: list[str] = []
    for path in sorted(APP_DIR.rglob('*.py')):
        text = path.read_text(encoding='utf-8')
        for token in FORBIDDEN:
            if token in text:
                offenders.append(f'{path.relative_to(APP_DIR)} 含 {token}')

    assert not offenders, '后端不应持久化任何用户数据：\n' + '\n'.join(offenders)
