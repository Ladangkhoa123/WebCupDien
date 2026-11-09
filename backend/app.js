const path = require('node:path');
const express = require('express');
const db = require('./db');
const { classifyMatch } = require('./matching');
const { importOutages, importStations, workbookRows } = require('./import-data');
const { createUpcomingAlerts, refreshOutages } = require('./refresh');

const app = express();
const frontendPath = path.join(__dirname, '..', 'frontend');
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(frontendPath));

function nowIso() {
  return new Date().toISOString();
}

function dateKeyInVietnam(date) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getStation(code) {
  return db.prepare('SELECT * FROM stations WHERE code = ?').get(code);
}

function stationPayload(body) {
  const code = String(body.code || '').trim().toUpperCase();
  const name = String(body.name || '').trim();
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw new Error('Mã trạm chỉ gồm chữ, số, gạch ngang hoặc gạch dưới (2–40 ký tự).');
  if (!name) throw new Error('Tên trạm là bắt buộc.');
  const latitude = body.latitude === '' || body.latitude === null || body.latitude === undefined ? null : Number(body.latitude);
  const longitude = body.longitude === '' || body.longitude === null || body.longitude === undefined ? null : Number(body.longitude);
  if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    throw new Error('Tọa độ không hợp lệ.');
  }
  if ((latitude === null) !== (longitude === null)) throw new Error('Cần nhập đồng thời vĩ độ và kinh độ.');
  return {
    code, name, customer_code: String(body.customer_code || '').trim(),
    province: String(body.province || '').trim(), ward: String(body.ward || '').trim(),
    street: String(body.street || '').trim(), address: String(body.address || '').trim(),
    management_unit: String(body.management_unit || '').trim(), notes: String(body.notes || '').trim(),
    latitude, longitude
  };
}

function buildMatches(outages) {
  const stations = db.prepare('SELECT * FROM stations').all();
  const matches = [];
  for (const outage of outages) {
    for (const station of stations) {
      const match = classifyMatch(station, outage);
      if (match) matches.push({ ...match, station, outage });
    }
  }
  return matches;
}

function getOutages({ includeCancelled = false } = {}) {
  const now = nowIso();
  const upper = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const statusFilter = includeCancelled ? '' : "AND status = 'scheduled'";
  return db.prepare(`
    SELECT * FROM outages WHERE start_at <= ? AND end_at >= ? ${statusFilter}
    ORDER BY start_at ASC
  `).all(upper, now);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, at: nowIso() }));

app.get('/api/summary', (_req, res) => {
  const stations = db.prepare('SELECT COUNT(*) AS count FROM stations').get().count;
  const outages = getOutages();
  const matches = buildMatches(outages);
  const unique = status => new Set(matches.filter(item => item.status === status).map(item => item.station.code)).size;
  const scheduled = new Set(matches.filter(item => ['confirmed', 'area'].includes(item.status)).map(item => item.station.code));
  const today = dateKeyInVietnam(new Date());
  const activeMatches = matches.filter(item => item.status === 'confirmed' && item.outage.start_at <= nowIso() && item.outage.end_at >= nowIso());
  res.json({
    stationCount: stations,
    scheduledCount: scheduled.size,
    todayCount: new Set(matches.filter(item => item.status !== 'not_affected' && item.outage.start_at.slice(0, 10) === today).map(item => item.station.code)).size,
    activeCount: new Set(activeMatches.map(item => item.station.code)).size,
    reviewCount: unique('needs_review'),
    lastCheckedAt: db.prepare("SELECT value FROM app_meta WHERE key = 'last_checked_at'").get()?.value || null,
    lastDataUpdateAt: db.prepare("SELECT value FROM app_meta WHERE key = 'last_data_update_at'").get()?.value || null,
    lastSuccessAt: db.prepare("SELECT value FROM app_meta WHERE key = 'last_success_at'").get()?.value || null,
    publicApiConfigured: Boolean(process.env.EVNSPC_PUBLIC_API_URL)
  });
});

app.get('/api/stations', (req, res) => {
  const search = String(req.query.q || '').trim();
  const ward = String(req.query.ward || '').trim();
  const params = [];
  let sql = 'SELECT * FROM stations WHERE 1=1';
  if (search) {
    sql += ' AND (code LIKE ? OR customer_code LIKE ? OR name LIKE ? OR address LIKE ? OR street LIKE ? OR ward LIKE ?)';
    params.push(...Array(6).fill(`%${search}%`));
  }
  if (ward) {
    sql += ' AND ward = ?';
    params.push(ward);
  }
  sql += ' ORDER BY code';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/stations', (req, res) => {
  try {
    const station = stationPayload(req.body);
    const now = nowIso();
    db.prepare(`
      INSERT INTO stations (code, name, customer_code, province, ward, street, address, management_unit, notes, latitude, longitude, raw_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
    `).run(station.code, station.name, station.customer_code, station.province, station.ward, station.street, station.address,
      station.management_unit, station.notes, station.latitude, station.longitude, now, now);
    db.prepare('INSERT INTO update_history (kind, status, message, created_at) VALUES (?, ?, ?, ?)')
      .run('station_change', 'success', `Đã thêm trạm ${station.code}.`, now);
    res.status(201).json(getStation(station.code));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/stations/:code', (req, res) => {
  try {
    const previous = getStation(req.params.code);
    if (!previous) return res.status(404).json({ error: 'Không tìm thấy trạm.' });
    const station = stationPayload({ ...req.body, code: req.params.code });
    const now = nowIso();
    db.prepare(`
      UPDATE stations SET name=?, customer_code=?, province=?, ward=?, street=?, address=?, management_unit=?, notes=?,
        latitude=?, longitude=?, updated_at=? WHERE code=?
    `).run(station.name, station.customer_code, station.province, station.ward, station.street, station.address, station.management_unit,
      station.notes, station.latitude, station.longitude, now, station.code);
    db.prepare('INSERT INTO update_history (kind, status, message, created_at) VALUES (?, ?, ?, ?)')
      .run('station_change', 'success', `Đã cập nhật trạm ${station.code}.`, now);
    return res.json(getStation(station.code));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.delete('/api/stations/:code', (req, res) => {
  const result = db.prepare('DELETE FROM stations WHERE code = ?').run(req.params.code);
  if (!result.changes) return res.status(404).json({ error: 'Không tìm thấy trạm.' });
  db.prepare('INSERT INTO update_history (kind, status, message, created_at) VALUES (?, ?, ?, ?)')
    .run('station_change', 'success', `Đã xóa trạm ${req.params.code}.`, nowIso());
  return res.status(204).end();
});

app.post('/api/import/stations', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const filename = String(req.query.filename || 'stations.xlsx');
    const rows = await workbookRows(req.body, filename);
    const count = importStations(rows, filename);
    res.json({ count });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/outages', (_req, res) => {
  const outages = getOutages();
  res.json({ outages, matches: buildMatches(outages) });
});

app.get('/api/affected', (_req, res) => {
  const outages = getOutages();
  res.json(buildMatches(outages));
});

app.post('/api/import/outages', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const filename = String(req.query.filename || 'outages.xlsx');
    const rows = await workbookRows(req.body, filename);
    res.json(importOutages(rows, filename));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/refresh', async (_req, res) => {
  const result = await refreshOutages();
  if (!result.ok) return res.status(503).json({ ...result, lastSuccessAt: db.prepare("SELECT value FROM app_meta WHERE key='last_success_at'").get()?.value || null });
  return res.json(result);
});

app.get('/api/history', (_req, res) => {
  res.json(db.prepare('SELECT * FROM update_history ORDER BY id DESC LIMIT 200').all());
});

app.get('/api/alerts', (_req, res) => {
  createUpcomingAlerts();
  res.json(db.prepare(`
    SELECT alerts.*, outages.start_at, outages.affected_scope
    FROM alerts LEFT JOIN outages ON alerts.outage_id = outages.id
    ORDER BY alerts.id DESC LIMIT 100
  `).all());
});

app.post('/api/alerts/:id/read', (req, res) => {
  const result = db.prepare('UPDATE alerts SET read_at = ? WHERE id = ?').run(nowIso(), req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Không tìm thấy cảnh báo.' });
  return res.status(204).end();
});

app.get('*path', (_req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Lỗi máy chủ nội bộ.' });
});

module.exports = app;
