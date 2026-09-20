// scenario.js —— 模拟场景：舟山以东海域两条海缆施工 + 三个渔船作业区
import { distance, pointToPath, pathToPolygon, corridor, destination } from './geo.js';

// 以"今天 00:00"为锚点的作业/施工窗口
const day = new Date();
day.setHours(0, 0, 0, 0);
const DAY = day.getTime();
const h = n => DAY + n * 3600_000;

/** 以中心点+半径生成六边形作业区（带轻微不规则度） */
function ring(center, radiusM, irregular = 0.12, seed = 1) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = 60 * i - 30;
    const r = radiusM * (1 + irregular * Math.sin(seed * 7 + i * 2.3));
    pts.push(destination(center, ang, r));
  }
  return pts;
}

// ---------- 海缆施工项目 ----------
const P1_PATH = [
  { lat: 30.455, lng: 122.195 },
  { lat: 30.38, lng: 122.35 },
  { lat: 30.25, lng: 122.45 },
  { lat: 30.11, lng: 122.605 },
];
const P2_PATH = [
  { lat: 30.43, lng: 122.205 },
  { lat: 30.38, lng: 122.35 },
];

export const projects = [
  {
    id: 'P1',
    name: '舟山—洋山 4# 主干光缆埋设',
    cable: 'ZH-OY4',
    owner: '中船海缆工程有限公司',
    ship: '海缆206',
    path: P1_PATH,
    corridorWidth: 500, // 安全廊道单侧 500m
    windows: [
      { start: h(3), end: h(6.5) },
      { start: h(13), end: h(17) },
    ],
    notice: 'VHF 16 频道值守 / 施工前 24h 航行通告',
  },
  {
    id: 'P2',
    name: '岱山支线光缆敷设',
    cable: 'DS-B2',
    owner: '舟山海洋通信建设公司',
    ship: '中天37',
    path: P2_PATH,
    corridorWidth: 500,
    windows: [{ start: h(13.5), end: h(18) }],
    notice: 'VHF 06 频道值守 / 随船警戒艇 2 艘',
  },
].map(p => ({ ...p, corridor: corridor(p.path, p.corridorWidth) }));

// ---------- 渔船作业区 ----------
const Z1_CENTER = { lat: 30.315, lng: 122.402 }; // 压在 P1 航线上
const Z2_CENTER = (() => {
  // P2 航线西北侧约 400m
  const q = {
    lat: P2_PATH[0].lat + (P2_PATH[1].lat - P2_PATH[0].lat) * 0.3,
    lng: P2_PATH[0].lng + (P2_PATH[1].lng - P2_PATH[0].lng) * 0.3,
  };
  const br =
    (Math.atan2(P2_PATH[1].lng - P2_PATH[0].lng, P2_PATH[1].lat - P2_PATH[0].lat) * 180) /
      Math.PI + 90;
  return destination(q, br, 420);
})();

export const zones = [
  {
    id: 'Z1',
    name: '岱衢洋帆张网作业区',
    gear: '帆张网',
    fleet: '浙岱渔运 02 编队',
    vessels: 18,
    contact: 'VHF 08 频道 / 编队指挥 138-0580-2166',
    center: Z1_CENTER,
    polygon: ring(Z1_CENTER, 2300, 0.15, 1),
    windows: [{ start: h(4), end: h(9) }],
  },
  {
    id: 'Z2',
    name: '灰鳖洋拖网作业区',
    gear: '单拖拖网',
    fleet: '浙定渔 31 编队',
    vessels: 11,
    contact: 'VHF 10 频道 / 编队指挥 139-0580-7321',
    center: Z2_CENTER,
    polygon: ring(Z2_CENTER, 1500, 0.1, 3),
    windows: [{ start: h(12), end: h(16.5) }],
  },
  {
    id: 'Z3',
    name: '双合门流刺网作业区',
    gear: '流刺网',
    fleet: '岱山渔 07 编队',
    vessels: 7,
    contact: 'VHF 09 频道 / 编队指挥 137-0580-9042',
    center: { lat: 30.56, lng: 122.06 },
    polygon: ring({ lat: 30.56, lng: 122.06 }, 2600, 0.14, 7),
    windows: [{ start: h(20), end: h(24) }],
  },
];

// ---------- 渔船 ----------
// B1 环线中心取 Z1 内距 P1 路由约 40m 的点，900m 环线作业会反复穿越路由
const b1Center = destination(Z1_CENTER, 315, 1000);
const b1Loop = ring(b1Center, 900, 0.05, 11);
export const vessels = [
  {
    id: 'B1',
    name: '浙岱渔运 02218',
    mmsi: '413362818',
    type: '帆张网渔船',
    zoneId: 'Z1',
    mode: 'loop',
    loop: b1Loop,
    phase: 2,
    speedKn: 3.8,
    heading: 0,
  },
  {
    id: 'B2',
    name: '浙定渔 31067',
    mmsi: '413371067',
    type: '单拖渔船',
    zoneId: 'Z2',
    mode: 'transit',
    pos: { lat: 30.438, lng: 122.196 },
    heading: 132, // 正朝 P2 航线接近
    speedKn: 6.2,
  },
  {
    id: 'B3',
    name: '浙岱渔 07103',
    mmsi: '413690103',
    type: '流刺网渔船',
    zoneId: null,
    mode: 'drift',
    pos: { lat: 30.205, lng: 122.51 },
    heading: 35,
    speedKn: 1.4,
  },
  {
    id: 'B4',
    name: '浙岱渔运 02455',
    mmsi: '413362455',
    type: '渔运船（补给）',
    zoneId: 'Z1',
    mode: 'docked',
    pos: { lat: 30.228, lng: 122.092 },
    heading: 0,
    speedKn: 0,
  },
  {
    id: 'B5',
    name: '浙普渔 68029',
    mmsi: '413680029',
    type: '桁杆拖虾船',
    zoneId: null,
    mode: 'transit',
    pos: { lat: 29.96, lng: 122.42 },
    heading: 46,
    speedKn: 12,
  },
];

// ---------- 自检：打印关键空间关系 ----------
export function selfCheck() {
  const lines = [];
  for (const z of zones) {
    for (const p of projects) {
      const d = pathToPolygon(p.path, z.polygon);
      const dc = pathToPolygon(p.corridor, z.polygon);
      lines.push(
        `${z.id} vs ${p.id}: 航线距离=${d === 0 ? '穿越' : Math.round(d) + 'm'} ` +
          `廊道(${p.corridorWidth}m)距离=${dc === 0 ? '相交' : Math.round(dc) + 'm'}`
      );
    }
  }
  for (const v of vessels) {
    if (v.mode === 'docked') continue;
    for (const p of projects) {
      const r = pointToPath(v.mode === 'loop' ? v.loop[v.phase] : v.pos, p.path);
      if (r.dist < 3000)
        lines.push(`${v.name} 距 ${p.id} 航线 ${Math.round(r.dist)}m（里程 ${Math.round(r.mile)}m）`);
    }
  }
  return lines;
}

export const SIM = { tickMs: 1500, speedX: 30 };
