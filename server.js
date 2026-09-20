// server.js —— 协同系统后端：场景数据 / 模拟推演 / 冲突检测 / 双向预警事件
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projects, zones, vessels, SIM } from './lib/scenario.js';
import { detectAll } from './lib/conflict.js';
import { Simulator } from './lib/simulator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// 仿真起点：今天 02:30（覆盖 03:00 早窗口 → 18:00 下午窗口）
const day = new Date();
day.setHours(2, 30, 0, 0);
const sim = new Simulator(projects, vessels);
sim.simNow = day.getTime();
sim.elapsedMs = sim.simNow - Date.now();

let speedX = 60;
const events = []; // 预警事件日志（最新在前）
const activeMap = new Map(); // 活跃预警 id -> {level, status}

function pushEvent(ev) {
  events.unshift(ev);
  if (events.length > 80) events.pop();
}

/** 每 tick 检测并生成预警事件（新增 / 升级 / 降级 / 解除） */
function evaluate(now) {
  const { conflicts, vesselConflicts, zoneState } = detectAll(projects, zones, sim.vessels, now);
  const current = new Map();

  const register = (c, kind) => {
    current.set(c.id, c);
    const prev = activeMap.get(c.id);
    if (!prev) {
      activeMap.set(c.id, { level: c.level, status: c.active ? 'active' : 'upcoming', title: c.title });
      pushEvent({
        id: `${c.id}-${now}`,
        at: now,
        type: 'raise',
        kind,
        refId: c.id,
        level: c.level,
        active: c.active,
        title: c.title,
        toConstruction: c.toConstruction,
        toFishing: c.toFishing,
      });
    } else if (prev.level !== c.level) {
      activeMap.set(c.id, { ...prev, level: c.level, title: c.title });
      pushEvent({
        id: `${c.id}-${now}`,
        at: now,
        type: 'escalate',
        kind,
        refId: c.id,
        level: c.level,
        active: c.active,
        title: c.title,
        toConstruction: c.toConstruction,
        toFishing: c.toFishing,
      });
    } else if (prev.status === 'upcoming' && c.active) {
      activeMap.set(c.id, { ...prev, status: 'active', title: c.title });
      pushEvent({
        id: `${c.id}-${now}`,
        at: now,
        type: 'activate',
        kind,
        refId: c.id,
        level: c.level,
        active: true,
        title: c.title,
        toConstruction: c.toConstruction,
        toFishing: c.toFishing,
      });
    }
  };

  conflicts.forEach(c => register(c, 'zone'));
  vesselConflicts.forEach(c => register(c, 'vessel'));

  // 解除：上一 tick 存在、本 tick 消失
  for (const [id, prev] of [...activeMap.entries()]) {
    if (!current.has(id)) {
      activeMap.delete(id);
      pushEvent({
        id: `${id}-${now}`,
        at: now,
        type: 'clear',
        level: 'none',
        title: `预警解除：${prev.title}`,
        toConstruction: '冲突已消除，恢复正常施工。',
        toFishing: '已驶出冲突水域，注意后续航行安全。',
      });
    }
  }

  return { conflicts, vesselConflicts, zoneState };
}

let lastTick = Date.now();
setInterval(() => {
  const nowReal = Date.now();
  const dt = nowReal - lastTick;
  lastTick = nowReal;
  sim.tick(dt, speedX);
  evaluate(sim.simNow);
}, SIM.tickMs);

// 初始评估一次
evaluate(sim.simNow);

// ---------- 静态数据（构造一次，供前端渲染） ----------
const baseData = {
  projects: projects.map(p => ({
    id: p.id,
    name: p.name,
    cable: p.cable,
    owner: p.owner,
    ship: p.ship,
    path: p.path,
    corridor: p.corridor,
    corridorWidth: p.corridorWidth,
    windows: p.windows,
    notice: p.notice,
  })),
  zones: zones.map(z => ({
    id: z.id,
    name: z.name,
    gear: z.gear,
    fleet: z.fleet,
    vessels: z.vessels,
    contact: z.contact,
    center: z.center,
    polygon: z.polygon,
    windows: z.windows,
  })),
};

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const api = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === '/api/base') return api(200, baseData);

  if (url.pathname === '/api/state') {
    const now = sim.simNow;
    const { conflicts, vesselConflicts, zoneState } = detectAll(projects, zones, sim.vessels, now);
    return api(200, {
      now,
      elapsedMin: sim.elapsedMs / 60000,
      speedX,
      sim: sim.state(),
      conflicts,
      vesselConflicts,
      zoneState,
      events: events.slice(0, 30),
    });
  }

  if (url.pathname === '/api/events') return api(200, { now: sim.simNow, events });

  if (url.pathname === '/api/speed' && req.method === 'POST') {
    const x = Number(url.searchParams.get('x'));
    if ([15, 60, 300, 900].includes(x)) {
      speedX = x;
      return api(200, { ok: true, speedX });
    }
    return api(400, { ok: false });
  }

  if (url.pathname === '/api/reset' && req.method === 'POST') {
    sim.reset(day.getTime());
    activeMap.clear();
    events.length = 0;
    evaluate(sim.simNow);
    return api(200, { ok: true, now: sim.simNow });
  }

  // 静态文件
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const publicDir = path.join(__dirname, 'public');
  const fp = path.join(publicDir, file);
  if (!fp.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(fp, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`海底光缆施工与渔船避让协同系统 → http://localhost:${PORT}`);
});
