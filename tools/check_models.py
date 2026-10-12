#!/usr/bin/env python3
"""把上游每一个模型都真打一遍，记录原始响应（全模型体检）。

用途：排查「某个模型是不是真的坏了」。不看模型列表、不做推断，逐个发真实请求：
  聊天模型 → chat/completions + responses
  图像模型 → images/generations；若上游回「Images API is not supported」（Gemini 系
             就是这样），自动改测 chat/completions（图片以内联 data URL 返回）
  视频模型 → videos/generations 提交 → 轮询 → 下载内容
原始响应全部落进 /tmp/probe_all_models_result.json，方便贴给上游服务商。

用法（在 backend 目录下跑，借它的 venv 拿 httpx）：
  cd backend && .venv/bin/python ../tools/check_models.py <api_key> [base_url]


不做任何假设：每个模型都发真实请求，成功就报成功，失败就把上游原文贴出来。
"""
from __future__ import annotations

import base64
import json
import re
import sys
import time
from urllib.parse import urlparse

import httpx

BASE = sys.argv[2] if len(sys.argv) > 2 else "https://api.bingyun.vip/v1"
KEY = sys.argv[1]
H = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

# 上游明确说"这个平台不支持图像接口"时的原文片段（Gemini 系走 chat 出图）。
IMAGES_API_UNSUPPORTED = "Images API is not supported"
DATA_URL_RE = re.compile(r"data:(image/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)")

EVIDENCE: list[dict] = []
LINES: list[str] = []


def say(line: str) -> None:
    print(line, flush=True)
    LINES.append(line)


def raw_of(r: httpx.Response, limit: int = 600) -> str:
    try:
        j = r.json()
        return json.dumps(j, ensure_ascii=False)[:limit]
    except Exception:
        return r.text[:limit]


def err_of(r: httpx.Response) -> str:
    try:
        j = r.json()
    except Exception:
        return f"HTTP {r.status_code}: {r.text[:300]}"
    e = j.get("error") if isinstance(j, dict) else None
    if isinstance(e, dict):
        msg = e.get("message") or e.get("code") or json.dumps(e, ensure_ascii=False)
    elif e:
        msg = str(e)
    else:
        msg = j.get("message") if isinstance(j, dict) else None
    return f"HTTP {r.status_code}: {msg or json.dumps(j, ensure_ascii=False)[:300]}"


def extract_images(text: str) -> list[tuple[str, int]]:
    """从响应文本里抠出所有内联 data URL 图片，返回 [(mime, 字节数), ...]。"""
    out: list[tuple[str, int]] = []
    for mime, encoded in DATA_URL_RE.findall(text or ""):
        try:
            raw = base64.b64decode(re.sub(r"\s+", "", encoded) + "=" * (-len(encoded) % 4))
            out.append((mime, len(raw)))
        except Exception:
            out.append((mime, -1))
    return out


def rec(model: str, kind: str, test: str, ok: bool, detail: str, elapsed: float,
        request_body: dict, response_raw: str) -> None:
    EVIDENCE.append({
        "model": model, "kind": kind, "test": test, "ok": ok,
        "detail": detail, "elapsed_s": round(elapsed, 2),
        "request": request_body, "response": response_raw,
    })
    say(f"[{'OK  ' if ok else 'FAIL'}] {model:<32} {test:<20} {elapsed:6.1f}s  {detail}")


def post(path: str, body: dict, timeout: float = 120.0) -> tuple[httpx.Response, float]:
    t0 = time.time()
    r = httpx.post(f"{BASE}/{path}", json=body, headers=H, timeout=timeout)
    return r, time.time() - t0


# ---------- 聊天模型 ----------
def test_chat(mid: str) -> None:
    body = {"model": mid, "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
            "max_tokens": 8}
    try:
        r, el = post("chat/completions", body)
        ok = r.status_code == 200 and bool((r.json() or {}).get("choices"))
        rec(mid, "chat", "chat/completions", ok, "" if ok else err_of(r), el, body, raw_of(r))
    except Exception as exc:
        rec(mid, "chat", "chat/completions", False, f"{type(exc).__name__}: {exc}", 0, body, "")


def test_responses(mid: str) -> None:
    body = {"model": mid, "input": "Reply with exactly: OK"}
    try:
        r, el = post("responses", body, timeout=180)
        ok = r.status_code == 200
        rec(mid, "chat", "responses", ok, "" if ok else err_of(r), el, body, raw_of(r))
    except Exception as exc:
        rec(mid, "chat", "responses", False, f"{type(exc).__name__}: {exc}", 0, body, "")


# ---------- 生图模型 ----------
def test_chat_image(mid: str) -> None:
    """Gemini 系的出图接口：图片以内联 data URL 塞在助手消息里。"""
    body = {"model": mid, "messages": [{"role": "user",
            "content": "Generate an image: a solid red circle centered on a white background."}]}
    try:
        r, el = post("chat/completions", body, timeout=300)
        if r.status_code != 200:
            rec(mid, "image", "chat/completions", False, err_of(r), el, body, raw_of(r))
            return
        imgs = extract_images(r.text)
        ok = bool(imgs)
        detail = (f"拿到 {len(imgs)} 张图 {[(m, f'{n/1024:.0f}KB') for m, n in imgs]}"
                  if ok else "200 但响应里没有图片 data URL")
        rec(mid, "image", "chat/completions", ok, detail, el, body, raw_of(r))
    except Exception as exc:
        rec(mid, "image", "chat/completions", False, f"{type(exc).__name__}: {exc}", 0, body, "")


def test_image(mid: str) -> None:
    """先试 OpenAI 图像接口；上游说不支持时自动改测 chat 出图（Gemini 系）。"""
    body = {"model": mid, "prompt": "a solid red circle on a white background"}
    try:
        r, el = post("images/generations", body, timeout=300)
    except Exception as exc:
        rec(mid, "image", "images/generations", False, f"{type(exc).__name__}: {exc}", 0, body, "")
        return

    if r.status_code == 200:
        data = (r.json() or {}).get("data")
        ok = bool(data)
        detail = "" if ok else "200 但 data 为空"
        if ok:
            detail = f"返回 {len(data)} 张，字段={sorted(data[0].keys())}"
        rec(mid, "image", "images/generations", ok, detail, el, body, raw_of(r, 300))
        return

    detail = err_of(r)
    rec(mid, "image", "images/generations", False, detail, el, body, raw_of(r, 300))
    if IMAGES_API_UNSUPPORTED in detail:
        say(f"       ↑ 上游不支持图像接口，改测 chat/completions 出图")
        test_chat_image(mid)


# ---------- 视频模型 ----------
def test_video(mid: str) -> None:
    body = {"model": mid, "prompt": "a red ball rolling on grass", "duration": 5}
    try:
        r, el = post("videos/generations", body, timeout=180)
        if r.status_code != 200:
            rec(mid, "video", "videos/generations", False, err_of(r), el, body, raw_of(r))
            return
        rid = str((r.json() or {}).get("request_id") or "").strip()
        if not rid:
            rec(mid, "video", "videos/generations", False, "提交成功但没返回 request_id",
                el, body, raw_of(r))
            return
        say(f"       {mid}: 已提交 request_id={rid}，开始轮询…")
        deadline = time.time() + 300
        last = {}
        while time.time() < deadline:
            g = httpx.get(f"{BASE}/videos/{rid}", headers=H, timeout=60)
            last = g.json() if g.status_code == 200 else {"http": g.status_code}
            st = str(last.get("status") or "").lower()
            if st == "done":
                break
            if st in ("failed", "expired", "cancelled", "canceled"):
                rec(mid, "video", "videos/generations", False,
                    f"任务状态 {st}：{json.dumps(last, ensure_ascii=False)[:200]}",
                    el, body, raw_of(r))
                return
            time.sleep(5)
        # 下载内容
        content_url = None
        v = last.get("video") if isinstance(last, dict) else None
        if isinstance(v, dict):
            content_url = v.get("url")
        if not content_url:
            content_url = f"{BASE}/videos/{rid}/content"
        if content_url.startswith("/"):
            parsed = urlparse(BASE)
            content_url = f"{parsed.scheme}://{parsed.netloc}" + content_url
        d = httpx.get(content_url, headers=H, timeout=180)
        ok = d.status_code == 200 and d.content[:4] not in (b"",) and d.content.lstrip()[:1] not in (b"{", b"[", b"<")
        size = len(d.content) if d.status_code == 200 else 0
        detail = (f"状态={last.get('status')} 下载 {size/1e6:.2f} MB，magic={d.content[4:8]!r}"
                  if ok else f"取内容失败 HTTP {d.status_code}: {d.text[:200]}")
        rec(mid, "video", "videos/generations", ok, detail, el,
            body, json.dumps(last, ensure_ascii=False)[:400])
    except Exception as exc:
        rec(mid, "video", "videos/generations", False, f"{type(exc).__name__}: {exc}", 0, body, "")


def main() -> None:
    say(f"上游: {BASE}")
    say("=" * 96)
    r = httpx.get(f"{BASE}/models", headers=H, timeout=30)
    say(f"GET /models → HTTP {r.status_code}")
    if r.status_code != 200:
        say(raw_of(r))
        return
    items = r.json().get("data") or []
    ids = [m["id"] for m in items if isinstance(m, dict) and m.get("id")]
    say(f"共 {len(ids)} 个模型: {ids}")
    say("=" * 96)

    for mid in ids:
        low = mid.lower()
        if "video" in low:
            test_video(mid)
        elif "image" in low or "nano-banana" in low:
            test_image(mid)
        else:
            test_chat(mid)
            test_responses(mid)

    say("=" * 96)
    # 同一个模型可能有多个测试项（如 image 先试 images/generations 再试 chat），
    # 只要有一项通过就算这个模型可用。
    by_model: dict[str, bool] = {}
    for e in EVIDENCE:
        by_model[e["model"]] = by_model.get(e["model"], False) or e["ok"]
    okn = sum(1 for v in by_model.values() if v)
    say(f"模型 {len(by_model)} 个：可用 {okn}，不可用 {len(by_model) - okn}"
        f"（共 {len(EVIDENCE)} 项测试）")
    say("不可用清单：")
    for model_id, usable in by_model.items():
        if not usable:
            fails = [e for e in EVIDENCE if e["model"] == model_id and not e["ok"]]
            say(f"  ✗ {model_id} → {fails[0]['detail'] if fails else '未知'}")

    with open("/tmp/probe_all_models_result.json", "w") as f:
        json.dump(EVIDENCE, f, ensure_ascii=False, indent=2)
    say("原始证据已写入 /tmp/probe_all_models_result.json")


if __name__ == "__main__":
    main()
