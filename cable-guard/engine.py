# -*- coding: utf-8 -*-
"""
时空冲突检测引擎
================
将海底光缆施工窗口（路由段 + 安全缓冲带 + 时间窗）与渔船作业区
（多边形/圆形渔区 + 作业时段）做空间与时间双重叠加分析，
命中时生成面向施工侧与渔业侧的双向预警。

仅使用 Python 标准库。距离计算采用以场景中心为原点的
等距圆柱（equirectangular）局部投影，单位 km——在工程海域
（百公里量级）内精度足够。
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import List, Optional, Sequence, Tuple

KM_PER_DEG_LAT = 110.94
KM_PER_DEG_LON_EQUATOR = 111.32

# 预警分级阈值（距冲突开始的提前量）
RED_HOURS = 24      # < 24h   红色·紧急
ORANGE_HOURS = 72   # 24~72h  橙色·警告
                     # > 72h   黄色·提示

Point = Tuple[float, float]  # (lon, lat) 或投影后的 (x, y)


# ---------------------------------------------------------------- 几何基础

class Projector:
    """经纬度 <-> 局部平面坐标(km)"""

    def __init__(self, lon0: float, lat0: float):
        self.lon0 = lon0
        self.lat0 = lat0
        self._cos = math.cos(math.radians(lat0))

    def to_xy(self, lon: float, lat: float) -> Point:
        return ((lon - self.lon0) * KM_PER_DEG_LON_EQUATOR * self._cos,
                (lat - self.lat0) * KM_PER_DEG_LAT)

    def path_xy(self, path: Sequence[Sequence[float]]) -> List[Point]:
        return [self.to_xy(p[0], p[1]) for p in path]


def _pt_seg_dist(p: Point, a: Point, b: Point) -> float:
    """点到线段的最短距离"""
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _segs_intersect(a: Point, b: Point, c: Point, d: Point) -> bool:
    def cross(o, p, q):
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    d1 = cross(c, d, a)
    d2 = cross(c, d, b)
    d3 = cross(a, b, c)
    d4 = cross(a, b, d)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def _seg_seg_dist(a: Point, b: Point, c: Point, d: Point) -> float:
    if _segs_intersect(a, b, c, d):
        return 0.0
    return min(_pt_seg_dist(a, c, d), _pt_seg_dist(b, c, d),
               _pt_seg_dist(c, a, b), _pt_seg_dist(d, a, b))


def point_in_polygon(p: Point, poly: Sequence[Point]) -> bool:
    """射线法"""
    x, y = p
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def dist_path_to_polygon(path: Sequence[Point], poly: Sequence[Point]) -> float:
    """折线到多边形区域的最短距离（相交或包含时为 0）"""
    if any(point_in_polygon(p, poly) for p in path):
        return 0.0
    n = len(poly)
    best = math.inf
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        for j in range(n):
            c, d = poly[j], poly[(j + 1) % n]
            best = min(best, _seg_seg_dist(a, b, c, d))
            if best == 0.0:
                return 0.0
    return best


def dist_path_to_circle(path: Sequence[Point], center: Point, radius_km: float) -> float:
    """折线到圆形区域的最短距离"""
    best = math.inf
    if len(path) == 1:
        best = math.hypot(path[0][0] - center[0], path[0][1] - center[1])
    for i in range(len(path) - 1):
        best = min(best, _pt_seg_dist(center, path[i], path[i + 1]))
    return max(0.0, best - radius_km)


# ---------------------------------------------------------------- 时间工具

def parse_time(s) -> datetime:
    if isinstance(s, datetime):
        return s
    return datetime.fromisoformat(str(s))


def time_overlap(a_start, a_end, b_start, b_end
                 ) -> Optional[Tuple[datetime, datetime]]:
    """返回两时间窗的重叠区间，无重叠返回 None"""
    lo = max(parse_time(a_start), parse_time(b_start))
    hi = min(parse_time(a_end), parse_time(b_end))
    return (lo, hi) if lo < hi else None


# ---------------------------------------------------------------- 冲突检测

def zone_distance_km(window_path_xy: Sequence[Point], zone: dict,
                     proj: Projector) -> float:
    """施工路径到渔区的最短平面距离"""
    if zone.get("shape") == "circle":
        lon, lat = zone["center"]
        return dist_path_to_circle(window_path_xy, proj.to_xy(lon, lat),
                                   zone["radius_km"])
    poly_xy = proj.path_xy(zone["polygon"])
    return dist_path_to_polygon(window_path_xy, poly_xy)


def detect_conflicts(windows: List[dict], zones: List[dict],
                     now: Optional[datetime] = None) -> List[dict]:
    """
    对每个 施工窗口 × 渔区 组合做时空叠加：
      空间：路径到渔区最短距离 <= 安全缓冲带半径
      时间：两窗口存在重叠区间
    返回冲突列表（按冲突开始时间排序），每条含双向预警要素。
    """
    now = now or datetime.now()
    conflicts: List[dict] = []
    # 以全部数据的几何中心为投影原点
    lons, lats = [], []
    for w in windows:
        for p in w["path"]:
            lons.append(p[0]); lats.append(p[1])
    for z in zones:
        pts = z["polygon"] if z.get("shape") != "circle" else [z["center"]]
        for p in pts:
            lons.append(p[0]); lats.append(p[1])
    if not lons:
        return []
    proj = Projector(sum(lons) / len(lons), sum(lats) / len(lats))

    for w in windows:
        path_xy = proj.path_xy(w["path"])
        buf = float(w.get("buffer_km", 2.0))
        for z in zones:
            ov = time_overlap(w["start"], w["end"], z["start"], z["end"])
            if ov is None:
                continue
            dist = zone_distance_km(path_xy, z, proj)
            if dist > buf:
                continue
            t0, t1 = ov
            lead_h = (t0 - now).total_seconds() / 3600.0
            if lead_h < 0:
                level, level_name = "red", "紧急(进行中)"
            elif lead_h < RED_HOURS:
                level, level_name = "red", "紧急"
            elif lead_h < ORANGE_HOURS:
                level, level_name = "orange", "警告"
            else:
                level, level_name = "yellow", "提示"
            conflicts.append({
                "id": f"C-{len(conflicts) + 1:03d}",
                "window_id": w["id"], "window_name": w["name"],
                "vessel": w.get("vessel", ""), "activity": w.get("activity", ""),
                "contractor": w.get("contractor", ""),
                "zone_id": z["id"], "zone_name": z["name"],
                "fleet": z.get("fleet", ""), "vessel_count": z.get("vessel_count", 0),
                "overlap_start": t0.isoformat(timespec="minutes"),
                "overlap_end": t1.isoformat(timespec="minutes"),
                "overlap_hours": round((t1 - t0).total_seconds() / 3600.0, 1),
                "distance_km": round(dist, 2), "buffer_km": buf,
                "lead_hours": round(lead_h, 1),
                "level": level, "level_name": level_name,
            })
    conflicts.sort(key=lambda c: c["overlap_start"])
    return conflicts


def build_alerts(conflicts: List[dict], now: Optional[datetime] = None
                 ) -> List[dict]:
    """由冲突生成双向预警报文：施工侧一条 + 渔业侧一条"""
    now = now or datetime.now()
    alerts: List[dict] = []
    for c in conflicts:
        t0 = parse_time(c["overlap_start"]).strftime("%m-%d %H:%M")
        t1 = parse_time(c["overlap_end"]).strftime("%m-%d %H:%M")
        lead = c["lead_hours"]
        lead_txt = "冲突正在进行" if lead < 0 else f"提前 {lead:.0f} 小时预警"
        base = {"conflict_id": c["id"], "level": c["level"],
                "level_name": c["level_name"], "lead_hours": lead,
                "issued_at": now.isoformat(timespec="minutes")}
        alerts.append({**base, "side": "construction",
                       "to": f'{c["contractor"]} / {c["vessel"]}',
                       "message": (
            f'【避让预警·施工侧】施工窗口「{c["window_name"]}」({c["vessel"]}, '
            f'{c["activity"]})与渔船作业区「{c["zone_name"]}」于 {t0}~{t1} '
            f'存在时空冲突(最近距离 {c["distance_km"]}km, 安全缓冲 '
            f'{c["buffer_km"]}km, 重叠 {c["overlap_hours"]}h)。{lead_txt}。'
            f'建议: ①调整施工时序或局部改道; ②提前发布航行警告并布设警戒船; '
            f'③通过VHF16/渔政频道通报作业计划。')})
        alerts.append({**base, "side": "fishing",
                       "to": f'{c["fleet"]}({c["vessel_count"]}艘)',
                       "message": (
            f'【避让预警·渔业侧】渔区「{c["zone_name"]}」于 {t0}~{t1} '
            f'与海底光缆施工区重叠(施工船: {c["vessel"]}, 作业: {c["activity"]})。'
            f'{lead_txt}。请作业渔船提前驶离该水域, 绕行安全缓冲带外 '
            f'{c["buffer_km"]}km; 注意瞭望施工船及警戒船信号, '
            f'保持VHF16频道守听, 勿在施工区抛锚、拖网。')})
    return alerts


def vessel_positions(vessels: List[dict], at: datetime) -> List[dict]:
    """按 AIS 航速航向推算某时刻的船位（匀速直线外推）"""
    out = []
    for v in vessels:
        t0 = parse_time(v["timestamp"])
        dt_h = (at - t0).total_seconds() / 3600.0
        dist_km = v["speed_kn"] * 1.852 * dt_h
        brg = math.radians(v["course_deg"])
        dlat = dist_km * math.cos(brg) / KM_PER_DEG_LAT
        dlon = (dist_km * math.sin(brg) /
                (KM_PER_DEG_LON_EQUATOR * math.cos(math.radians(v["lat"]))))
        out.append({**v, "lat": round(v["lat"] + dlat, 5),
                    "lon": round(v["lon"] + dlon, 5)})
    return out


def vessels_in_danger(vessels_at: List[dict], windows: List[dict],
                      at: datetime) -> List[str]:
    """当前时刻处于任一在施窗口缓冲带内的船舶 id 列表"""
    active = [w for w in windows
              if parse_time(w["start"]) <= at <= parse_time(w["end"])]
    if not active:
        return []
    lons = [p[0] for w in active for p in w["path"]]
    lats = [p[1] for w in active for p in w["path"]]
    proj = Projector(sum(lons) / len(lons), sum(lats) / len(lats))
    danger = []
    for v in vessels_at:
        p = proj.to_xy(v["lon"], v["lat"])
        for w in active:
            path_xy = proj.path_xy(w["path"])
            d = min(_pt_seg_dist(p, path_xy[i], path_xy[i + 1])
                    for i in range(len(path_xy) - 1))
            if d <= float(w.get("buffer_km", 2.0)):
                danger.append(v["id"])
                break
    return danger
