const db = require('./db');
const { outageFromRow } = require('./import-utils');
const { vietnamDateKey, vietnamLocalDateTime } = require('./time');
const { fetchPublicOutages } = require('../services/outage-source');

let refreshInProgress = false;

function logHistory(status, message) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO update_history (kind, status, message, created_at) VALUES (?, ?, ?, ?)')
    .run('automatic_refresh', status, message, now);
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('last_checked_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(now);
}

function cancelMissingOutages(sourceKeys, fromDate, throughDate) {
  const existing = db.prepare(`
    SELECT id, source_key, affected_scope FROM outages
    WHERE source = 'EVNSPC API' AND status = 'scheduled'
      AND substr(start_at, 1, 10) BETWEEN ? AND ?
  `).all(fromDate, throughDate);
  const cancel = db.prepare("UPDATE outages SET status = 'cancelled', updated_at = ? WHERE id = ?");
  const clearReviews = db.prepare('DELETE FROM match_reviews WHERE outage_id = ?');
  const createAlert = db.prepare('INSERT INTO alerts (kind, message, outage_id, created_at) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  let cancelled = 0;
  db.exec('BEGIN');
  try {
    for (const outage of existing) {
      if (sourceKeys.has(outage.source_key)) continue;
      cancel.run(now, outage.id);
      clearReviews.run(outage.id);
      createAlert.run('cancelled_outage', `Lịch cúp điện đã bị hủy: ${outage.affected_scope}`, outage.id, now);
      cancelled += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return cancelled;
}

async function refreshOutages({ fetchImpl } = {}) {
  if (refreshInProgress) return { ok: false, message: 'Một lần cập nhật đang chạy.' };
  refreshInProgress = true;
  try {
    const records = await fetchPublicOutages(fetchImpl ? { fetchImpl } : undefined);
    const formatted = records.map(record => outageFromRow(record, 'EVNSPC API', record.source_url)).filter(Boolean);
    if (formatted.length !== records.length) throw new Error('API có lịch không đúng định dạng ngày/giờ; dữ liệu cũ được giữ nguyên.');
    let result = { count: 0, added: 0, changed: 0 };
    if (formatted.length) {
      const { importOutages } = require('./import-data');
      result = importOutages(formatted.map(record => ({
        id: record.source_key,
        start_at: record.start_at,
        end_at: record.end_at,
        affected_scope: record.affected_scope,
        province: record.province,
        ward: record.ward,
        street: record.street,
        cause: record.cause,
        utility_unit: record.utility_unit,
        source_url: record.source_url
      })), 'EVNSPC API');
    } else {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO app_meta (key, value) VALUES ('last_success_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(now);
      db.prepare("INSERT INTO app_meta (key, value) VALUES ('last_data_update_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(now);
    }
    const today = vietnamDateKey();
    const throughDate = new Date(`${today}T00:00:00Z`);
    throughDate.setUTCDate(throughDate.getUTCDate() + 6);
    const end = throughDate.toISOString().slice(0, 10);
    const cancelled = cancelMissingOutages(new Set(formatted.map(record => record.source_key)), today, end);
    logHistory('success', `EVNSPC đã đồng bộ ${result.count} lịch trong 7 ngày (${result.added} mới, ${result.changed} thay đổi, ${cancelled} hủy).`);
    return { ok: true, ...result, cancelled };
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Hết thời gian chờ khi truy cập API lịch điện.' : error.message;
    logHistory('error', message);
    return { ok: false, message };
  } finally {
    refreshInProgress = false;
  }
}

function createUpcomingAlerts() {
  const now = new Date();
  const nowLocal = vietnamLocalDateTime(now);
  const soon = vietnamLocalDateTime(new Date(now.getTime() + 60 * 60 * 1000));
  const outages = db.prepare(`
    SELECT id, affected_scope, start_at FROM outages
    WHERE status = 'scheduled' AND start_at > ? AND start_at <= ?
  `).all(nowLocal, soon);
  const add = db.prepare('INSERT INTO alerts (kind, message, outage_id, created_at) VALUES (?, ?, ?, ?)');
  const exists = db.prepare("SELECT 1 FROM alerts WHERE kind = 'upcoming_outage' AND outage_id = ?");
  for (const outage of outages) {
    if (!exists.get(outage.id)) {
      add.run('upcoming_outage', `Sắp đến giờ ngừng điện tại: ${outage.affected_scope}`, outage.id, now.toISOString());
    }
  }
}

module.exports = { createUpcomingAlerts, refreshOutages };
