# -*- coding: utf-8 -*-
"""
示例场景：东海舟山外海某海上风电送出海缆工程
=============================================
时间基准为“现在”（datetime.now()），保证任何时候启动演示，
都能看到进行中 / 24h 内 / 72h 内 / 更远期 的各级冲突。
背景：9 月 16 日东海伏季休渔结束，大量渔船集中出海作业，
与海缆施工窗口高度重叠——正是本系统的典型应用场景。
"""
from datetime import datetime, timedelta

# 海缆全路由（登陆点 -> 海上风场），lon/lat
CABLE_ROUTE = [
    [122.10, 30.02], [122.28, 30.10], [122.45, 30.22],
    [122.60, 30.38], [122.78, 30.55], [122.95, 30.70],
    [123.10, 30.86],
]


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="minutes")


def build_scenario(now: datetime | None = None) -> dict:
    now = (now or datetime.now()).replace(minute=0, second=0, microsecond=0)
    h = lambda n: now + timedelta(hours=n)

    # ---- 施工窗口：路由段 + 缓冲带 + 时间窗 -------------------------------
    windows = [
        {  # 正在进行：近岸段敷埋，与渔区 F1 冲突（红色）
            "id": "W1", "name": "近岸段敷埋( KP0-KP18 )",
            "contractor": "某海洋工程局", "vessel": "东方缆6",
            "activity": "电缆敷埋(水力冲埋)",
            "path": CABLE_ROUTE[0:3], "buffer_km": 2.0,
            "start": _iso(h(-6)), "end": _iso(h(+30)),
        },
        {  # 30h 后开始：中段敷设，与渔区 F2 冲突（橙色）
            "id": "W2", "name": "中段敷设( KP18-KP42 )",
            "contractor": "某海洋工程局", "vessel": "东方缆6",
            "activity": "电缆敷设",
            "path": CABLE_ROUTE[2:5], "buffer_km": 2.0,
            "start": _iso(h(+30)), "end": _iso(h(+66)),
        },
        {  # 80h 后开始：风场侧登陆，与渔区 F3 冲突（黄色）
            "id": "W3", "name": "风场侧登陆段( KP42-KP60 )",
            "contractor": "某海缆工程公司", "vessel": "启帆9",
            "activity": "登陆段敷设+J型管牵引",
            "path": CABLE_ROUTE[4:7], "buffer_km": 2.5,
            "start": _iso(h(+80)), "end": _iso(h(+116)),
        },
        {  # 对照组：远海维修窗口，与任何渔区都不重叠
            "id": "W4", "name": "备用锚地待命(无冲突)",
            "contractor": "某海缆工程公司", "vessel": "启帆9",
            "activity": "设备检修待命",
            "path": [[123.55, 30.10], [123.70, 30.18]], "buffer_km": 1.5,
            "start": _iso(h(+40)), "end": _iso(h(+64)),
        },
    ]

    # ---- 渔船作业区：多边形/圆形 + 作业时段 -------------------------------
    zones = [
        {  # 与 W1 冲突
            "id": "F1", "name": "舟山近海张网作业区",
            "fleet": "浙舟渔编队", "vessel_count": 46,
            "shape": "polygon",
            "polygon": [[122.18, 30.00], [122.52, 30.06],
                        [122.55, 30.30], [122.24, 30.28]],
            "start": _iso(h(-24)), "end": _iso(h(+96)),
        },
        {  # 与 W2 冲突
            "id": "F2", "name": "中街山拖网渔场",
            "fleet": "浙普渔拖网船组", "vessel_count": 32,
            "shape": "circle", "center": [122.72, 30.47], "radius_km": 14,
            "start": _iso(h(+20)), "end": _iso(h(+120)),
        },
        {  # 与 W3 冲突
            "id": "F3", "name": "外海流刺网作业带",
            "fleet": "浙嵊渔流网队", "vessel_count": 18,
            "shape": "polygon",
            "polygon": [[122.80, 30.62], [123.20, 30.66],
                        [123.22, 30.98], [122.84, 30.94]],
            "start": _iso(h(+72)), "end": _iso(h(+140)),
        },
        {  # 对照组：远离路由，不冲突
            "id": "F4", "name": "南侧围网作业区(无冲突)",
            "fleet": "浙象渔围网队", "vessel_count": 12,
            "shape": "circle", "center": [122.35, 29.72], "radius_km": 10,
            "start": _iso(h(-12)), "end": _iso(h(+72)),
        },
    ]

    # ---- AIS 船位（匀速外推用） -------------------------------------------
    vessels = [
        {"id": "V01", "name": "浙舟渔运0128", "lon": 122.30, "lat": 30.12,
         "speed_kn": 4.5, "course_deg": 65,  "timestamp": _iso(now)},
        {"id": "V02", "name": "浙舟渔03355",  "lon": 122.42, "lat": 30.16,
         "speed_kn": 3.8, "course_deg": 300, "timestamp": _iso(now)},
        {"id": "V03", "name": "浙普渔61102",  "lon": 122.66, "lat": 30.42,
         "speed_kn": 4.2, "course_deg": 20,  "timestamp": _iso(now)},
        {"id": "V04", "name": "浙嵊渔10577",  "lon": 122.95, "lat": 30.78,
         "speed_kn": 3.5, "course_deg": 250, "timestamp": _iso(now)},
        {"id": "V05", "name": "浙象渔运2209", "lon": 122.33, "lat": 29.75,
         "speed_kn": 5.0, "course_deg": 90,  "timestamp": _iso(now)},
        {"id": "V06", "name": "警戒船·海护01", "lon": 122.24, "lat": 30.07,
         "speed_kn": 0.5, "course_deg": 0,   "timestamp": _iso(now),
         "escort": True},
    ]

    return {"now": _iso(now), "cable_route": CABLE_ROUTE,
            "windows": windows, "zones": zones, "vessels": vessels}
