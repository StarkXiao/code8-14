# -*- coding: utf-8 -*-
"""
海底光缆施工与渔船避让协同系统 —— 后端服务
仅依赖 Python 标准库。启动: python3 server.py [--port 8000]

REST API
  GET  /api/overview    场景全量数据 + 冲突 + 双向预警 + 危险船位
  GET  /api/conflicts   冲突列表
  GET  /api/alerts      双向预警报文
  POST /api/windows     新增施工窗口(what-if 推演), 返回重算后的冲突
"""
import json
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import engine
import sample_data

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"

# 内存态场景（演示用；生产可替换为数据库 + AIS/气象报文接入）
SCENARIO = sample_data.build_scenario()


def compute_overview() -> dict:
    now = datetime.now()
    conflicts = engine.detect_conflicts(SCENARIO["windows"],
                                        SCENARIO["zones"], now)
    alerts = engine.build_alerts(conflicts, now)
    vessels_now = engine.vessel_positions(SCENARIO["vessels"], now)
    danger = engine.vessels_in_danger(vessels_now, SCENARIO["windows"], now)
    return {**SCENARIO, "conflicts": conflicts, "alerts": alerts,
            "danger_vessels": danger, "generated_at": now.isoformat(timespec="minutes")}


class Handler(BaseHTTPRequestHandler):
    server_version = "CableGuard/1.0"

    # ---- helpers ----------------------------------------------------------
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, path: Path):
        if not path.is_file() or STATIC not in path.resolve().parents:
            self._send_json({"error": "not found"}, 404)
            return
        ctype = {".html": "text/html; charset=utf-8",
                 ".js": "text/javascript", ".css": "text/css"}.get(
                     path.suffix, "application/octet-stream")
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # 静默访问日志
        pass

    # ---- routes -----------------------------------------------------------
    def do_GET(self):
        route = urlparse(self.path).path.rstrip("/") or "/"
        if route == "/":
            return self._send_static(STATIC / "index.html")
        if route == "/api/overview":
            return self._send_json(compute_overview())
        if route == "/api/conflicts":
            return self._send_json(compute_overview()["conflicts"])
        if route == "/api/alerts":
            return self._send_json(compute_overview()["alerts"])
        if route.startswith("/static/"):
            return self._send_static(STATIC / route[len("/static/"):])
        self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        route = urlparse(self.path).path.rstrip("/")
        if route == "/api/windows":
            try:
                n = int(self.headers.get("Content-Length", 0))
                w = json.loads(self.rfile.read(n) or b"{}")
                assert w["id"] and w["path"] and w["start"] and w["end"]
                w.setdefault("name", w["id"])
                w.setdefault("buffer_km", 2.0)
                w.setdefault("vessel", "未指定")
                w.setdefault("activity", "施工")
                w.setdefault("contractor", "未指定")
                SCENARIO["windows"] = [x for x in SCENARIO["windows"]
                                       if x["id"] != w["id"]] + [w]
                ov = compute_overview()
                return self._send_json({"ok": True, "window": w,
                                        "conflicts": ov["conflicts"],
                                        "alerts": ov["alerts"]})
            except Exception as e:  # noqa: BLE001 - 演示服务, 统一返回 400
                return self._send_json({"ok": False, "error": str(e)}, 400)
        self._send_json({"error": "not found"}, 404)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"海缆施工-渔船避让协同系统已启动: http://localhost:{args.port}")
    print(f"API 示例: curl http://localhost:{args.port}/api/conflicts")
    srv.serve_forever()


if __name__ == "__main__":
    main()
