// conflict.js —— 时空冲突检测
import { pathToPolygon, pointToPath, overlapSeconds } from './geo.js';

export const LEVEL = { none: 'none', warn: 'warn', danger: 'danger' };
export const LEVEL_RANK = { none: 0, warn: 1, danger: 2 };

// 单船接近规则：仅在施工窗口内生效
const SHIP_RULES = [
  { max: 500, level: 'danger', label: '进入施工安全廊道', advice: '立即避让，驶离廊道' },
  { max: 1500, level: 'warn', label: '接近施工安全廊道', advice: '注意瞭望，保持距离并与施工船联系' },
  { max: 3000, level: 'warn', label: '接近施工水域', advice: '关注施工动态，规划绕行路线' },
];

const zoneGeom = new Map(); // `${zoneId}|${projectId}` -> 空间关系

function zoneGeometry(zone, project) {
  const key = `${zone.id}|${project.id}`;
  if (!zoneGeom.has(key)) {
    const routeDist = pathToPolygon(project.path, zone.polygon);
    const corridorDist = pathToPolygon(project.corridor, zone.polygon);
    let geo;
    if (routeDist === 0) geo = 'cross'; // 作业区与航线相交
    else if (corridorDist === 0) geo = 'corridor'; // 落入安全廊道
    else if (routeDist < 1852) geo = 'near'; // 1 海里预警圈
    else geo = 'far';
    zoneGeom.set(key, { geo, routeDist, corridorDist });
  }
  return zoneGeom.get(key);
}

/** 检查一个作业区 × 一个项目在某时刻的窗口冲突 */
function checkZoneWindow(zone, project, zw, pw, now) {
  const g = zoneGeometry(zone, project);
  if (g.geo === 'far') return null;
  // 与施工窗口的重叠
  const winOverlap = overlapSeconds(zw.start, zw.end, pw.start, pw.end);
  if (winOverlap <= 0) return null;

  const wStart = Math.max(zw.start, pw.start);
  const wEnd = Math.min(zw.end, pw.end);
  // 重叠窗口已结束 → 冲突解除
  if (now >= wEnd) return null;

  const active = now >= wStart;
  const msToStart = wStart - now;
  const level =
    g.geo === 'cross'
      ? 'danger'
      : g.geo === 'corridor'
        ? 'danger'
        : 'warn';

  const geoText =
    g.geo === 'cross'
      ? '作业区与光缆路由直接重叠'
      : g.geo === 'corridor'
        ? `作业区边缘距光缆路由仅 ${Math.round(g.routeDist)}m，侵入 ${project.corridorWidth}m 安全廊道`
        : `作业区距光缆路由 ${Math.round(g.routeDist)}m，位于 1 海里预警圈内`;

  return {
    id: `${zone.id}-${project.id}-${pw.start}`,
    kind: 'zone',
    level,
    zoneId: zone.id,
    projectId: project.id,
    geo: g.geo,
    overlapStart: wStart,
    overlapEnd: wEnd,
    overlapSec: winOverlap / 1000,
    active,
    msToStart: active ? 0 : msToStart,
    title: `${zone.name} × ${project.name}`,
    text: `${geoText}；作业窗口 ${fmt(zw.start)}–${fmt(zw.end)} 与施工窗口 ${fmt(pw.start)}–${fmt(pw.end)} 重叠 ${(winOverlap / 3600_000).toFixed(1)} 小时`,
    toConstruction: active
      ? `【致施工方】${zone.name}（${zone.fleet}，${zone.vessels} 艘）正在与施工重叠的水域作业，请减速并加强现场警戒，必要时暂停埋设。联系：${zone.contact}`
      : `【致施工方】${zone.name} 将于 ${fmt(wStart)} 与施工窗口重叠，请提前调整施工计划或协调编队避让。联系：${zone.contact}`,
    toFishing: active
      ? `【致${zone.fleet}】${project.ship} 正在进行「${project.name}」作业，${geoText}，请立即驶出施工水域，保持 VHF 守听。${project.notice}`
      : `【致${zone.fleet}】施工船 ${project.ship} 将于 ${fmt(pw.start)} 在附近水域开展「${project.name}」，请提前调整网位与作业范围。${project.notice}`,
  };
}

/** 单船 × 项目 的动态接近检测（仅施工窗口内/临近窗口） */
function checkVessel(vessel, project, now) {
  if (vessel.mode === 'docked') return null;
  const pos = vessel.pos || (vessel.loop && vessel.loop[vessel.phase ?? 0]);
  if (!pos) return null;
  const r = pointToPath(pos, project.path);
  const inWindow = project.windows.some(w => now >= w.start - 900_000 && now <= w.end); // 提前 15 分钟开始预警
  if (!inWindow) return null;

  const active = project.windows.some(w => now >= w.start && now <= w.end);
  const rule = SHIP_RULES.find(x => r.dist <= x.max);
  if (!rule) return null;

  // 以当前航向估算到达航线时间（简化：距离/速度）
  const speedMs = (vessel.speedKn * 0.5144);
  const etaMin = speedMs > 0.2 ? Math.round(r.dist / speedMs / 60) : null;

  return {
    id: `${vessel.id}-${project.id}`,
    kind: 'vessel',
    level: rule.level,
    vesselId: vessel.id,
    projectId: project.id,
    dist: r.dist,
    mile: r.mile,
    active,
    etaMin,
    title: `${vessel.name} 接近 ${project.ship} 施工水域`,
    text:
      `${vessel.name}（${vessel.type}）距光缆路由 ${Math.round(r.dist)}m，` +
      `${rule.label}${etaMin != null ? `，预计 ${etaMin} 分钟到达` : ''}`,
    toConstruction:
      `【致施工方】${vessel.name}（MMSI ${vessel.mmsi}，航速 ${vessel.speedKn} 节）${rule.label}，` +
      `当前距离 ${Math.round(r.dist)}m${etaMin != null ? `，约 ${etaMin} 分钟到达` : ''}，请通过 ${project.notice.split('/')[0].trim()} 呼叫避让`,
    toFishing:
      `【致${vessel.name}】前方为「${project.name}」水域，施工船 ${project.ship} 正在作业，${rule.advice}，` +
      `当前距路由 ${Math.round(r.dist)}m。${project.notice}`,
  };
}

/** 全量检测，返回 conflicts 与 zone 的最高状态（供地图着色） */
export function detectAll(projects, zones, vessels, now) {
  const conflicts = [];
  const zoneState = {};

  for (const zone of zones) {
    let zMax = 'none';
    for (const project of projects) {
      for (const zw of zone.windows) {
        for (const pw of project.windows) {
          const c = checkZoneWindow(zone, project, zw, pw, now);
          if (c) {
            conflicts.push(c);
            if (LEVEL_RANK[c.level] > LEVEL_RANK[zMax]) zMax = c.level;
          }
        }
      }
    }
    zoneState[zone.id] = zMax;
  }

  const vesselConflicts = [];
  for (const vessel of vessels) {
    for (const project of projects) {
      const c = checkVessel(vessel, project, now);
      if (c) vesselConflicts.push(c);
    }
  }

  return { conflicts, vesselConflicts, zoneState };
}

function fmt(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
