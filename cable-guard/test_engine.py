# -*- coding: utf-8 -*-
"""引擎单元测试: python3 test_engine.py"""
from datetime import datetime, timedelta

import engine
import sample_data

NOW = datetime(2026, 9, 20, 8, 0)
H = lambda n: (NOW + timedelta(hours=n)).isoformat(timespec="minutes")


def t(name, cond):
    assert cond, f"FAIL: {name}"
    print(f"  ok - {name}")


# ---- 几何 -----------------------------------------------------------------
proj = engine.Projector(122.0, 30.0)
sq = [(0, 0), (10, 0), (10, 10), (0, 10)]  # 投影平面上的正方形(km)
t("点在多边形内", engine.point_in_polygon((5, 5), sq))
t("点在多边形外", not engine.point_in_polygon((15, 5), sq))
t("折线穿多边形距离为0",
  engine.dist_path_to_polygon([(-5, 5), (15, 5)], sq) == 0.0)
t("折线远离多边形距离>0",
  engine.dist_path_to_polygon([(20, 5), (30, 5)], sq) > 0)
d = engine.dist_path_to_circle([(0, 10), (0, 20)], (0, 0), 5)
t("圆区距离=最近点-半径", abs(d - 5.0) < 1e-6)

# ---- 时间 -----------------------------------------------------------------
t("时间窗重叠", engine.time_overlap(H(0), H(10), H(5), H(15)) is not None)
t("时间窗不相交", engine.time_overlap(H(0), H(10), H(11), H(15)) is None)

# ---- 冲突检测 --------------------------------------------------------------
win = [{"id": "W", "name": "w", "path": [[122.0, 30.0], [122.2, 30.1]],
        "buffer_km": 2.0, "start": H(10), "end": H(20)}]
zone_hit = [{"id": "Z", "name": "z", "shape": "polygon",
             "polygon": [[122.05, 29.95], [122.15, 29.95],
                         [122.15, 30.15], [122.05, 30.15]],
             "start": H(0), "end": H(30)}]
zone_miss_space = [{"id": "Z2", "name": "z2", "shape": "circle",
                    "center": [123.5, 30.0], "radius_km": 5,
                    "start": H(0), "end": H(30)}]
zone_miss_time = [{"id": "Z3", "name": "z3", "shape": "polygon",
                   "polygon": [[122.05, 29.95], [122.15, 29.95],
                               [122.15, 30.15], [122.05, 30.15]],
                   "start": H(100), "end": H(130)}]

c = engine.detect_conflicts(win, zone_hit, NOW)
t("空间+时间均重叠 -> 冲突", len(c) == 1 and c[0]["window_id"] == "W")
t("冲突级别为紧急(<24h)", c[0]["level"] == "red")
t("仅空间重叠 -> 不冲突",
  engine.detect_conflicts(win, zone_miss_time, NOW) == [])
t("仅时间重叠 -> 不冲突",
  engine.detect_conflicts(win, zone_miss_space, NOW) == [])

far = [dict(win[0], start=H(100), end=H(120))]
zfar = [dict(zone_hit[0], start=H(0), end=H(200))]
c2 = engine.detect_conflicts(far, zfar, NOW)
t("提前>72h -> 黄色提示", c2 and c2[0]["level"] == "yellow")

# ---- 双向预警 --------------------------------------------------------------
alerts = engine.build_alerts(c, NOW)
t("一次冲突产生两条预警(施工侧+渔业侧)", len(alerts) == 2)
t("预警面向双方", {a["side"] for a in alerts} == {"construction", "fishing"})
t("预警含避让要素", "缓冲" in alerts[1]["message"] and "VHF16" in alerts[1]["message"])

# ---- 场景自检 --------------------------------------------------------------
sc = sample_data.build_scenario(NOW)
cc = engine.detect_conflicts(sc["windows"], sc["zones"], NOW)
# 相邻施工段的路由接头落入相邻渔区, 引擎应检出全部 5 起跨段重叠
pairs = {(x["window_id"], x["zone_id"]) for x in cc}
t("示例场景检出 5 起冲突(含跨段重叠)", len(cc) == 5)
t("冲突对齐全", pairs == {("W1", "F1"), ("W2", "F1"), ("W2", "F2"),
                          ("W3", "F2"), ("W3", "F3")})
t("三级预警齐全(红/橙/黄)",
  {x["level"] for x in cc} == {"red", "orange", "yellow"})
t("对照窗口 W4 无冲突", all(x["window_id"] != "W4" for x in cc))
t("对照渔区 F4 无冲突", all(x["zone_id"] != "F4" for x in cc))
t("冲突按开始时间排序",
  [x["overlap_start"] for x in cc] == sorted(x["overlap_start"] for x in cc))

vp = engine.vessel_positions(sc["vessels"], NOW + timedelta(hours=10))
t("AIS 船位外推", all("lon" in v and "lat" in v for v in vp))
dg = engine.vessels_in_danger(
    engine.vessel_positions(sc["vessels"], NOW + timedelta(hours=2)),
    sc["windows"], NOW + timedelta(hours=2))
t("缓冲带内船舶识别(警戒船海护01在W1带内)", "V06" in dg)

print("\n全部测试通过 ✅")
