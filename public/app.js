/* app.js —— 协同系统前端 */
const LEVEL_COLOR = { danger: '#ff4d4f', warn: '#faad14', safe: '#36c77d' };
let BASE = null;

// ---------- 地图初始化 ----------
const map = L.map('map', { zoomControl: true }).setView([30.33, 122.34], 10);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap &copy; CARTO',
}).addTo(map);

const layers = {
  corridors: [],
  routes: [],
  zones: {},       // zoneId -> L.polygon
  zonePulses: {},  // zoneId -> marker
  zoneLabels: {},
  boats: {},       // vesselId -> { marker, pulse, track }
  ships: {},       // projectId -> marker
};

const boatIcon = alert =>
  L.divIcon({
    className: '',
    html: `<div class="boat-icon boat-fish${alert ? ' boat-alert' : ''}">▲</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

const workIcon = L.divIcon({
  className: '',
  html: `<div class="boat-icon boat-work">◆</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const pulseIcon = level =>
  L.divIcon({
    className: '',
    html: `<div class="${level === 'danger' ? 'pulse-danger' : 'pulse-warn'}" style="width:22px;height:22px"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

function renderBase() {
  // 廊道 + 路由
  for (const p of BASE.projects) {
    const corr = L.polygon(p.corridor, {
      color: '#3b9dff',
      weight: 1,
      dashArray: '5 4',
      fillColor: '#3b9dff',
      fillOpacity: 0.1,
    }).addTo(map);
    layers.corridors.push(corr);

    const route = L.polyline(p.path, {
      color: '#ff4d4f',
      weight: 3,
    }).addTo(map);
    route.bindPopup(projectPopup(p));
    layers.routes.push(route);

    const mid = p.path[Math.floor(p.path.length / 2)];
    L.marker(mid, {
      icon: L.divIcon({
        className: '',
        html: `<div class="ship-label" style="color:#ff9c9e">${p.cable}</div>`,
        iconSize: [0, 0],
      }),
      interactive: false,
    }).addTo(map);
  }

  // 作业区
  for (const z of BASE.zones) {
    const poly = L.polygon(z.polygon, zoneStyle('none')).addTo(map);
    poly.bindPopup(zonePopup(z));
    layers.zones[z.id] = poly;

    const label = L.marker(z.center, {
      icon: L.divIcon({
        className: '',
        html: `<div class="zone-label" style="color:#9fe8c4">${z.name}</div>`,
        iconSize: [0, 0],
      }),
      interactive: false,
    }).addTo(map);
    layers.zoneLabels[z.id] = label;
  }

  const all = [
    ...BASE.projects.flatMap(p => p.path),
    ...BASE.zones.flatMap(z => z.polygon),
  ];
  map.fitBounds(L.latLngBounds(all).pad(0.15));
}

function zoneStyle(level) {
  if (level === 'danger')
    return { color: '#ff4d4f', weight: 2, fillColor: '#ff4d4f', fillOpacity: 0.22 };
  if (level === 'warn')
    return { color: '#faad14', weight: 2, fillColor: '#faad14', fillOpacity: 0.18 };
  return { color: '#36c77d', weight: 1.5, dashArray: '4 4', fillColor: '#36c77d', fillOpacity: 0.07 };
}

function projectPopup(p) {
  const wins = p.windows.map(w => `${hm(w.start)}–${hm(w.end)}`).join('、');
  return `
    <div class="popup-title">${p.name}</div>
    <div><span class="popup-k">光缆编号：</span>${p.cable}</div>
    <div><span class="popup-k">施工单位：</span>${p.owner}</div>
    <div><span class="popup-k">施工船：</span>${p.ship}</div>
    <div><span class="popup-k">施工窗口：</span>${wins}</div>
    <div><span class="popup-k">安全廊道：</span>单侧 ${p.corridorWidth}m</div>
    <div><span class="popup-k">值守：</span>${p.notice}</div>`;
}

function zonePopup(z) {
  const wins = z.windows.map(w => `${hm(w.start)}–${hm(w.end)}`).join('、');
  return `
    <div class="popup-title">${z.name}</div>
    <div><span class="popup-k">作业方式：</span>${z.gear}</div>
    <div><span class="popup-k">所属编队：</span>${z.fleet}（${z.vessels} 艘）</div>
    <div><span class="popup-k">作业窗口：</span>${wins}</div>
    <div><span class="popup-k">联系方式：</span>${z.contact}</div>`;
}

// ---------- 状态渲染 ----------
function renderState(s) {
  renderClock(s);
  renderZones(s);
  renderBoats(s);
  renderShips(s);
  renderAlerts(s);
  renderEvents(s);
  renderNowLine(s.now);
  renderStats(s);
}

function renderClock(s) {
  $('#clock').textContent = hms(s.now);
  $('#elapsed').textContent = `仿真推演 ${Math.round(s.elapsedMin)} 分钟 · ${s.speedX}×`;
}

function renderZones(s) {
  for (const [id, poly] of Object.entries(layers.zones)) {
    const level = s.zoneState[id] || 'none';
    poly.setStyle(zoneStyle(level));

    let pulse = layers.zonePulses[id];
    const z = BASE.zones.find(z => z.id === id);
    if (level !== 'none') {
      if (!pulse) {
        pulse = L.marker(z.center, {
          icon: pulseIcon(level),
          interactive: false,
          zIndexOffset: -100,
        }).addTo(map);
        layers.zonePulses[id] = pulse;
      }
      pulse.setIcon(pulseIcon(level));
    } else if (pulse) {
      map.removeLayer(pulse);
      delete layers.zonePulses[id];
    }
  }
}

function renderBoats(s) {
  const conflictByBoat = new Map();
  for (const c of s.vesselConflicts) {
    const prev = conflictByBoat.get(c.vesselId);
    if (!prev || rank(c.level) > rank(prev.level)) conflictByBoat.set(c.vesselId, c);
  }

  for (const v of s.sim.vessels) {
    const conf = conflictByBoat.get(v.id);
    let g = layers.boats[v.id];
    if (!g) {
      const marker = L.marker(v.pos, { icon: boatIcon(!!conf), zIndexOffset: 200 }).addTo(map);
      marker.bindPopup(boatPopup(v, s));
      const track = L.polyline([], { className: 'track-line', interactive: false }).addTo(map);
      g = { marker, pulse: null, track };
      layers.boats[v.id] = g;
    }
    g.marker.setLatLng(v.pos);
    g.marker.setIcon(boatIcon(!!conf));
    g.marker.setPopupContent(boatPopup(v, s));
    g.track.setLatLngs((v.track || []).map(p => [p.lat, p.lng]));

    if (conf) {
      if (!g.pulse) {
        g.pulse = L.marker(v.pos, { icon: pulseIcon(conf.level), interactive: false }).addTo(map);
      }
      g.pulse.setLatLng(v.pos);
      g.pulse.setIcon(pulseIcon(conf.level));
    } else if (g.pulse) {
      map.removeLayer(g.pulse);
      g.pulse = null;
    }
  }
}

function renderShips(s) {
  for (const ps of s.sim.projects) {
    if (!ps.shipPos) {
      if (layers.ships[ps.id]) {
        map.removeLayer(layers.ships[ps.id]);
        delete layers.ships[ps.id];
      }
      continue;
    }
    const proj = BASE.projects.find(p => p.id === ps.id);
    if (!layers.ships[ps.id]) {
      const m = L.marker(ps.shipPos, { icon: workIcon, zIndexOffset: 300 }).addTo(map);
      m.bindPopup(`<div class="popup-title">${proj.ship}</div><div>${proj.name} 施工中</div>`);
      layers.ships[ps.id] = m;
    }
    layers.ships[ps.id].setLatLng(ps.shipPos);
  }
}

function boatPopup(v, s) {
  const conf = (s.vesselConflicts || []).find(c => c.vesselId === v.id);
  return `
    <div class="popup-title">${v.name}</div>
    <div><span class="popup-k">MMSI：</span>${v.mmsi}</div>
    <div><span class="popup-k">类型：</span>${v.type}</div>
    <div><span class="popup-k">航向/航速：</span>${v.heading}° / ${v.speedKn} 节</div>
    <div><span class="popup-k">状态：</span>${modeText(v.mode)}</div>
    ${conf ? `<div style="color:${LEVEL_COLOR[conf.level]};margin-top:4px">${conf.text}</div>` : '<div style="color:#36c77d;margin-top:4px">附近暂无施工冲突</div>'}`;
}

function modeText(m) {
  return { loop: '作业中（环线拖网）', transit: '航行中', drift: '漂航作业', docked: '在港停泊' }[m] || m;
}

// ---------- 预警卡片 ----------
function renderAlerts(s) {
  const all = [
    ...s.conflicts.map(c => ({ ...c, _t: c.overlapStart })),
    ...s.vesselConflicts.map(c => ({ ...c, _t: s.now })),
  ].sort((a, b) => {
    const r = rank(b.level) - rank(a.level);
    if (r) return r;
    return (a.overlapStart ?? a._t) - (b.overlapStart ?? b._t);
  });

  const box = $('#alertList');
  if (!all.length) {
    box.innerHTML = `<div class="empty"><span class="big">✓</span>当前施工窗口与渔船作业区<br/>暂无时空冲突</div>`;
    return;
  }
  box.innerHTML = all.map(c => {
    const statusBadge = !c.active && c.kind === 'zone'
      ? `<span class="badge upcoming">${Math.round(c.msToStart / 60000)} 分钟后重叠</span>`
      : c.active
        ? `<span class="badge ${c.level}">${c.level === 'danger' ? '正在冲突' : '正在预警'}</span>`
        : `<span class="badge ${c.level}">${c.level === 'danger' ? '动态冲突' : '接近预警'}</span>`;
    const meta =
      c.kind === 'zone'
        ? c.active
          ? `重叠 ${(c.overlapSec / 3600).toFixed(1)}h · 剩余 ${Math.max(0, Math.round((c.overlapEnd - s.now) / 60000))} 分钟`
          : `重叠窗口 ${hm(c.overlapStart)}–${hm(c.overlapEnd)}`
        : `距路由 ${Math.round(c.dist)}m${c.etaMin != null ? ` · 约 ${c.etaMin} 分钟到达` : ''}`;
    return `
      <div class="card ${c.level}">
        <div class="card-head">
          <span class="card-title">${c.title}</span>
          <span>${statusBadge}</span>
        </div>
        <div class="card-text">${c.text}</div>
        <div class="card-msg to-c"><b>📡 施工方预警</b>${c.toConstruction.replace(/^【[^】]*】/, '')}</div>
        <div class="card-msg to-f"><b>🐟 渔船方预警</b>${c.toFishing.replace(/^【[^】]*】/, '')}</div>
        <div class="card-meta"><span>${c.kind === 'zone' ? '作业区 × 施工窗口' : '单船动态接近'}</span><span>${meta}</span></div>
      </div>`;
  }).join('');
}

function renderEvents(s) {
  const box = $('#eventList');
  if (!s.events.length) {
    box.innerHTML = `<div class="empty"><span class="big">🔔</span>暂无预警记录</div>`;
    return;
  }
  const typeMap = {
    raise: ['新增预警', 'danger'],
    escalate: ['预警升级', 'danger'],
    activate: ['冲突开始生效', 'warn'],
    clear: ['预警解除', 'safe'],
  };
  box.innerHTML = s.events
    .map(e => {
      const [label, cls] = typeMap[e.type] || [e.type, 'warn'];
      return `
      <div class="card ${e.type === 'clear' ? 'cleared' : e.level}">
        <div class="card-head">
          <span class="card-title">${e.title}</span>
          <span class="badge ${cls === 'safe' ? 'kind' : cls}">${label}</span>
        </div>
        <div class="card-meta"><span>${hms(e.at)}</span><span>${e.kind === 'vessel' ? '动态接近' : e.kind === 'zone' ? '窗口冲突' : ''}</span></div>
      </div>`;
    })
    .join('');
}

function renderStats(s) {
  const all = [...s.conflicts, ...s.vesselConflicts];
  $('#cntDanger').textContent = all.filter(c => c.level === 'danger' && c.active).length;
  $('#cntWarn').textContent = all.filter(c => !(c.level === 'danger' && c.active)).length;
  $('#cntBoats').textContent = s.sim.vessels.length;
}

// ---------- 时间轴 ----------
const TL_START = 2 * 3600; // 02:00
const TL_END = 24 * 3600; // 24:00
const pct = t => {
  const d = new Date(t);
  const sec = d.getHours() * 3600 + d.getMinutes() * 60;
  return ((sec - TL_START) / (TL_END - TL_START)) * 100;
};

function renderTimeline(base, state) {
  const rows = [];
  for (const p of base.projects) {
    rows.push({
      label: p.ship,
      wins: p.windows.map(w => ({ ...w, cls: 'construction' })),
      conflicts: (state?.conflicts || [])
        .filter(c => c.projectId === p.id)
        .map(c => ({ start: c.overlapStart, end: c.overlapEnd, cls: 'conflict' })),
    });
  }
  for (const z of base.zones) {
    rows.push({
      label: z.name.slice(0, 5),
      wins: z.windows.map(w => ({ ...w, cls: 'fishing' })),
      conflicts: [],
    });
  }

  const html = rows
    .map(
      r => `
    <div class="tl-row">
      <div class="tl-label">${r.label}</div>
      <div class="tl-track">
        ${r.wins
          .map(
            w => `<div class="tl-win ${w.cls}" style="left:${pct(w.start)}%;width:${Math.max(1.2, pct(w.end) - pct(w.start))}%" title="${hm(w.start)}-${hm(w.end)}"></div>`
          )
          .join('')}
        ${r.conflicts
          .map(
            w => `<div class="tl-win ${w.cls}" style="left:${pct(w.start)}%;width:${Math.max(0.8, pct(w.end) - pct(w.start))}%"></div>`
          )
          .join('')}
        <div class="tl-now" data-now style="display:none"></div>
      </div>
    </div>`
    )
    .join('');

  const ticks = [2, 4, 6, 9, 12, 15, 18, 21, 24]
    .map(h => `<span style="left:${((h * 3600 - TL_START) / (TL_END - TL_START)) * 100}%">${h}:00</span>`)
    .join('');

  $('#timelineBox').innerHTML = html + `<div class="tl-axis">${ticks}</div>`;
}

function renderNowLine(now) {
  const x = pct(now);
  document.querySelectorAll('.tl-now').forEach(el => {
    el.style.display = x >= 0 && x <= 100 ? 'block' : 'none';
    el.style.left = `${x}%`;
  });
}

// ---------- 工具 ----------
const $ = s => document.querySelector(s);
const rank = l => ({ danger: 2, warn: 1, none: 0 }[l] || 0);
const pad = n => String(n).padStart(2, '0');
function hm(t) { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function hms(t) { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

// ---------- Tabs / 控件 ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b === btn));
    ['alerts', 'events', 'timeline'].forEach(name => {
      $(`#panel-${name}`).classList.toggle('hidden', name !== btn.dataset.tab);
    });
  };
});

document.querySelectorAll('.speedctl button[data-x]').forEach(btn => {
  btn.onclick = async () => {
    await fetch(`/api/speed?x=${btn.dataset.x}`, { method: 'POST' });
    document.querySelectorAll('.speedctl button[data-x]').forEach(b => b.classList.toggle('on', b === btn));
  };
});

$('#btnReset').onclick = async () => {
  await fetch('/api/reset', { method: 'POST' });
  renderTimeline(BASE, null);
};

// ---------- 启动 ----------
async function main() {
  BASE = await (await fetch('/api/base')).json();
  renderBase();
  renderTimeline(BASE, null);
  const poll = async () => {
    try {
      const s = await (await fetch('/api/state')).json();
      renderState(s);
      const tlPanel = $('#panel-timeline');
      if (!tlPanel.classList.contains('hidden')) renderTimeline(BASE, s);
    } catch (e) {
      console.error(e);
    }
  };
  await poll();
  setInterval(poll, 1500);
}
main();
