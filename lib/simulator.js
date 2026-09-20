// simulator.js —— 渔船/施工船运动模拟（加速时间）
import { destination, bearing } from './geo.js';

export class Simulator {
  constructor(projects, vessels) {
    this.projects = projects;
    this.vessels = vessels.map(v => ({
      ...v,
      loop: v.loop ? v.loop.map(p => ({ ...p })) : null,
      initPhase: v.phase || 0,
      _initPos: v.pos ? { ...v.pos } : null,
      _initHeading: v.heading || 0,
      pos: v.pos ? { ...v.pos } : { ...v.loop[v.phase] },
      heading: v.heading || 0,
      track: [],
    }));
    this.simNow = Date.now();
    this.elapsedMs = 0;
  }

  /** 每 tick 推进 speedX 倍速，dtReal 为真实间隔毫秒 */
  tick(dtReal, speedX) {
    const dtSim = dtReal * speedX;
    this.elapsedMs += dtSim;
    this.simNow = Date.now() + this.elapsedMs;

    for (const v of this.vessels) {
      if (v.mode === 'docked') continue;
      const distM = v.speedKn * 0.5144 * (dtSim / 1000);
      if (distM <= 0) continue;

      if (v.mode === 'loop') {
        this.moveLoop(v, distM);
      } else {
        const next = destination(v.pos, v.heading, distM);
        v.pos = next;
      }

      // 记录尾迹（最多 40 点）
      v.track.push({ ...v.pos, t: this.simNow });
      if (v.track.length > 40) v.track.shift();
    }

    // 施工船位置：窗口内沿航线匀速往返
    for (const p of this.projects) {
      p.shipPos = this.shipPosition(p, this.simNow);
    }

    return this.simNow;
  }

  moveLoop(v, distM) {
    let remain = distM;
    while (remain > 0) {
      const target = v.loop[(v.phase + 1) % v.loop.length];
      const d = haversine(v.pos, target);
      if (d < 5 || remain >= d) {
        v.pos = { ...target };
        v.phase = (v.phase + 1) % v.loop.length;
        remain -= d;
      } else {
        v.heading = bearing(v.pos, target);
        v.pos = destination(v.pos, v.heading, remain);
        remain = 0;
      }
    }
    const tgt = v.loop[(v.phase + 1) % v.loop.length];
    v.heading = bearing(v.pos, tgt);
  }

  shipPosition(p, now) {
    const total = pathLength(p.path);
    const win = p.windows.find(w => now >= w.start && now <= w.end);
    if (!win) return null;
    // 窗口时间内往返一趟
    const dur = win.end - win.start;
    const phase = (now - win.start) / dur;
    const frac = phase % 1 < 0 ? phase % 1 + 1 : phase % 1;
    const mile = (frac < 0.5 ? frac * 2 : (1 - frac) * 2) * total;
    return pointAlong(p.path, mile);
  }

  /** 重置到初始时刻 */
  reset(initialNow) {
    for (const v of this.vessels) {
      v.phase = v.initPhase;
      v.pos = v.loop ? { ...v.loop[v.initPhase] } : { ...v._initPos };
      v.heading = v._initHeading;
      v.track = [];
    }
    this.elapsedMs = initialNow - Date.now();
    this.simNow = initialNow;
    for (const p of this.projects) p.shipPos = null;
  }

  state() {
    return {
      simNow: this.simNow,
      elapsedMin: this.elapsedMs / 60000,
      vessels: this.vessels.map(v => ({
        id: v.id,
        name: v.name,
        mmsi: v.mmsi,
        type: v.type,
        zoneId: v.zoneId,
        mode: v.mode,
        speedKn: v.speedKn,
        heading: Math.round(v.heading),
        pos: v.pos,
        track: v.track,
      })),
      projects: this.projects.map(p => ({ id: p.id, shipPos: p.shipPos || null })),
    };
  }
}

function haversine(a, b) {
  // 与 geo.distance 相同，内联避免循环依赖
  const R = 6371008.8;
  const rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pathLength(path) {
  let s = 0;
  for (let i = 0; i < path.length - 1; i++) s += haversine(path[i], path[i + 1]);
  return s;
}

function pointAlong(path, mile) {
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = haversine(path[i], path[i + 1]);
    if (acc + seg >= mile) {
      const t = seg > 0 ? (mile - acc) / seg : 0;
      return {
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * t,
        lng: path[i].lng + (path[i + 1].lng - path[i].lng) * t,
      };
    }
    acc += seg;
  }
  return { ...path[path.length - 1] };
}
