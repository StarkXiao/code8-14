// geo.js —— 经纬度地理计算（等距圆柱投影近似，适用于近岸小范围，零依赖）
// 约定：坐标点 = { lat, lng }，单位：米、度、米/秒

const R = 6371008.8; // 地球平均半径

const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;

/** 两点大圆距离（米），haversine */
export function distance(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** a -> b 的方位角（度，0~360，正北为 0） */
export function bearing(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** 从 a 出发沿方位角走 dist 米后的点 */
export function destination(a, brng, dist) {
  const d = dist / R;
  const br = toRad(brng);
  const lat1 = toRad(a.lat);
  const lng1 = toRad(a.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

// ---- 平面近似（局部坐标：东向 x、北向 y，单位米）----

export function toLocal(origin, p) {
  return {
    x: toRad(p.lng - origin.lng) * R * Math.cos(toRad(origin.lat)),
    y: toRad(p.lat - origin.lat) * R,
  };
}

export function toLatLng(origin, xy) {
  return {
    lat: origin.lat + toDeg(xy.y / R),
    lng: origin.lng + toDeg(xy.x / (R * Math.cos(toRad(origin.lat)))),
  };
}

/** 点到折线路径距离（米），同时返回最近点及沿线里程 */
export function pointToPath(p, path) {
  let min = Infinity;
  let nearest = path[0];
  let mile = 0;
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = distance(a, b);
    const proj = projectOnSegment(p, a, b);
    if (proj.dist < min) {
      min = proj.dist;
      nearest = proj.point;
      mile = acc + (segLen > 0 ? proj.t * segLen : 0);
    }
    acc += segLen;
  }
  return { dist: min, point: nearest, mile };
}

function projectOnSegment(p, a, b) {
  const pa = { x: p.lat - a.lat, y: p.lng - a.lng };
  const ab = { x: b.lat - a.lat, y: b.lng - a.lng };
  const len2 = ab.x * ab.x + ab.y * ab.y;
  let t = len2 > 0 ? (pa.x * ab.x + pa.y * ab.y) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = { lat: a.lat + t * ab.x, lng: a.lng + t * ab.y };
  return { t, point: q, dist: distance(p, q) };
}

/** 射线法判断点是否在多边形内 */
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng,
      yi = poly[i].lat;
    const xj = poly[j].lng,
      yj = poly[j].lat;
    const intersect =
      yi > p.lat !== yj > p.lat &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 线段是否与多边形相交（含端点在内部的情况） */
export function segmentIntersectsPolygon(a, b, poly) {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentsIntersect(a, b, poly[j], poly[i])) return true;
  }
  return false;
}

function orient(a, b, c) {
  return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
}

function onSegment(a, b, c) {
  return (
    Math.min(a.lng, b.lng) - 1e-12 <= c.lng &&
    c.lng <= Math.max(a.lng, b.lng) + 1e-12 &&
    Math.min(a.lat, b.lat) - 1e-12 <= c.lat &&
    c.lat <= Math.max(a.lat, b.lat) + 1e-12
  );
}

export function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

/** 折线到多边形的最小距离（米）：0 表示相交；否则取折线上顶点/插值的近似最近距离 */
export function pathToPolygon(path, poly) {
  if (path.some(p => pointInPolygon(p, poly))) return 0;
  for (let i = 0; i < path.length - 1; i++) {
    if (segmentIntersectsPolygon(path[i], path[i + 1], poly)) return 0;
  }
  let min = Infinity;
  // 加密采样折线，估算缓冲廊道与多边形的最近距离
  for (let i = 0; i < path.length - 1; i++) {
    const len = distance(path[i], path[i + 1]);
    const steps = Math.max(2, Math.ceil(len / 100));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const q = {
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * t,
        lng: path[i].lng + (path[i + 1].lng - path[i].lng) * t,
      };
      const d = pointToPolygon(q, poly);
      if (d < min) min = d;
    }
  }
  return min;
}

export function pointToPolygon(p, poly) {
  if (pointInPolygon(p, poly)) return 0;
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    min = Math.min(min, projectOnSegment(p, poly[i], poly[(i + 1) % poly.length]).dist);
  }
  return min;
}

/**
 * 生成路径两侧偏移 widthM 米的廊道多边形（闭合环形）
 * 采用局部平面投影，路径首点为原点
 */
export function corridor(path, widthM) {
  if (path.length < 2) return path.map(p => ({ ...p }));
  const origin = path[0];
  const pts = path.map(p => toLocal(origin, p));

  // 各顶点法线（用相邻线段方向平均）
  const left = [];
  for (let i = 0; i < pts.length; i++) {
    let nx, ny;
    if (i === 0) {
      nx = -(pts[1].y - pts[0].y);
      ny = pts[1].x - pts[0].x;
    } else if (i === pts.length - 1) {
      nx = -(pts[i].y - pts[i - 1].y);
      ny = pts[i].x - pts[i - 1].x;
    } else {
      const d1 = normalize({ x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y });
      const d2 = normalize({ x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y });
      const d = normalize({ x: d1.x + d2.x, y: d1.y + d2.y });
      nx = -d.y;
      ny = d.x;
    }
    const n = normalize({ x: nx, y: ny });
    left.push({
      l: { x: pts[i].x + n.x * widthM, y: pts[i].y + n.y * widthM },
      r: { x: pts[i].x - n.x * widthM, y: pts[i].y - n.y * widthM },
    });
  }

  const ring = [
    ...left.map(o => o.l),
    ...left
      .slice()
      .reverse()
      .map(o => o.r),
  ];
  return ring.map(p => toLatLng(origin, p));
}

function normalize(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

/** 时间窗是否与 [start,end] 重叠，返回重叠秒数 */
export function overlapSeconds(start, end, winStart, winEnd) {
  const s = Math.max(start, winStart);
  const e = Math.min(end, winEnd);
  return Math.max(0, (e - s) / 1000);
}
