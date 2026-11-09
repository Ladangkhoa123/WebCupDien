const path = require('node:path');
const db = require('./db');
const { csvRows, outageFromRow, stationFromRow } = require('./import-utils');

function parseRecords(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value])));
}

function importStations(rows, source = 'Excel') {
  const activeRows = parseRecords(rows).filter(row => Object.values(row).some(value => String(value ?? '').trim()));
  const records = activeRows.map(stationFromRow).filter(Boolean);
  if (records.length !== activeRows.length) {
    throw new Error(`${activeRows.length - records.length} dòng có dữ liệu thiếu mã trạm hoặc tên trạm; không có dữ liệu nào được nhập.`);
  }
  if (!records.length) throw new Error('Không tìm thấy mã trạm hợp lệ trong tệp.');
  const now = new Date().toISOString();
  const getExisting = db.prepare('SELECT name, province, ward, street, address FROM stations WHERE code = ?');
  const deleteReviews = db.prepare('DELETE FROM match_reviews WHERE station_code = ?');
  const upsert = db.prepare(`
    INSERT INTO stations (code, name, customer_code, province, ward, street, address, management_unit, notes, latitude, longitude, raw_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name=excluded.name, customer_code=excluded.customer_code, province=excluded.province, ward=excluded.ward, street=excluded.street,
      address=excluded.address, management_unit=excluded.management_unit, notes=excluded.notes,
      latitude=excluded.latitude, longitude=excluded.longitude, raw_json=excluded.raw_json, updated_at=excluded.updated_at
  `);
  db.exec('BEGIN');
  try {
    for (const station of records) {
      const previous = getExisting.get(station.code);
      if (previous && ['name', 'province', 'ward', 'street', 'address'].some(key => previous[key] !== station[key])) {
        deleteReviews.run(station.code);
      }
      upsert.run(station.code, station.name, station.customer_code, station.province, station.ward, station.street, station.address,
        station.management_unit, station.notes, station.latitude, station.longitude, station.raw_json, now, now);
    }
    db.prepare('INSERT INTO update_history (kind, status, message, created_at) VALUES (?, ?, ?, ?)')
      .run('stations_import', 'success', `${records.length} trạm được nhập từ ${source}.`, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return records.length;
}

function importOutages(rows, source = 'Excel', sourceUrl = '') {
  const activeRows = rows.filter(row => Object.values(row).some(value => String(value ?? '').trim()));
  const records = activeRows.map(row => outageFromRow(row, source, sourceUrl)).filter(Boolean);
  if (records.length !== activeRows.length) {
    throw new Error(`${activeRows.length - records.length} dòng lịch không hợp lệ; cần ngày, giờ bắt đầu/kết thúc và phạm vi ảnh hưởng. Không có dữ liệu nào được nhập.`);
  }
  if (!records.length) throw new Error('Không tìm thấy lịch hợp lệ. Cần có ngày, giờ bắt đầu/kết thúc và phạm vi ảnh hưởng.');
  if (new Set(records.map(record => record.source_key)).size !== records.length) {
    throw new Error('Tệp có nhiều lịch trùng ID hoặc cùng địa điểm/thời gian; hãy tách hoặc sửa các dòng trước khi nhập. Không có dữ liệu nào được nhập.');
  }
  const now = new Date().toISOString();
  const getExisting = db.prepare('SELECT * FROM outages WHERE source_key = ?');
  const upsert = db.prepare(`
    INSERT INTO outages (source_key, start_at, end_at, affected_scope, province, ward, street, cause, utility_unit, source, source_url, status, raw_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      start_at=excluded.start_at, end_at=excluded.end_at, affected_scope=excluded.affected_scope,
      province=excluded.province, ward=excluded.ward, street=excluded.street, cause=excluded.cause,
      utility_unit=excluded.utility_unit, source=excluded.source, source_url=excluded.source_url, status='scheduled',
      raw_json=excluded.raw_json, updated_at=excluded.updated_at
  `);
  let added = 0;
  let changed = 0;
  const alertTypes = [];
  const deleteReviews = db.prepare('DELETE FROM match_reviews WHERE outage_id = ?');
  db.exec('BEGIN');
  try {
    for (const record of records) {
      const previous = getExisting.get(record.source_key);
      const matchDetailsChanged = previous && (
        previous.start_at !== record.start_at ||
        previous.end_at !== record.end_at ||
        previous.affected_scope !== record.affected_scope ||
        previous.province !== record.province ||
        previous.ward !== record.ward ||
        previous.street !== record.street
      );
      if (!previous) {
        added += 1;
        alertTypes.push([record.source_key, 'new_outage', record.affected_scope]);
      } else if (previous.start_at !== record.start_at || previous.end_at !== record.end_at ||
        previous.affected_scope !== record.affected_scope || previous.province !== record.province || previous.cause !== record.cause ||
        previous.ward !== record.ward || previous.street !== record.street ||
        previous.utility_unit !== record.utility_unit) {
        changed += 1;
        alertTypes.push([record.source_key, 'changed_outage', record.affected_scope]);
      }
      if (matchDetailsChanged) deleteReviews.run(previous.id);
      upsert.run(record.source_key, record.start_at, record.end_at, record.affected_scope, record.province,
        record.ward, record.street, record.cause, record.utility_unit, record.source, record.source_url, record.raw_json, now, now);
    }
    const createAlert = db.prepare('INSERT INTO alerts (kind, message, outage_id, created_at) VALUES (?, ?, ?, ?)');
    const getId = db.prepare('SELECT id FROM outages WHERE source_key = ?');
    for (const [sourceKey, kind, scope] of alertTypes) {
      const outage = getId.get(sourceKey);
      createAlert.run(kind, `${kind === 'new_outage' ? 'Lịch cúp điện mới' : 'Lịch cúp điện đã thay đổi'}: ${scope}`, outage.id, now);
    }
    db.prepare('INSERT INTO update_history (kind, status, message, created_at) VALUES (?, ?, ?, ?)')
      .run('outages_import', 'success', `${records.length} lịch đã nhập (${added} mới, ${changed} thay đổi) từ ${source}.`, now);
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('last_data_update_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(now);
    if (source === 'EVNSPC API') {
      db.prepare("INSERT INTO app_meta (key, value) VALUES ('last_success_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(now);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { count: records.length, added, changed };
}

async function workbookRows(buffer, filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.csv') {
    return csvRows(buffer.toString('utf8'));
  }
  if (extension !== '.xlsx') throw new Error('Chỉ hỗ trợ tệp .xlsx và .csv.');
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error('Workbook không có sheet hoặc dữ liệu.');
  const headers = sheet.getRow(1).values.slice(1).map(value => String(value || '').trim());
  if (headers.every(header => !header)) throw new Error('Không tìm thấy tiêu đề cột trong dòng đầu tiên.');
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    headers.forEach((header, index) => {
      if (header) record[header] = row.getCell(index + 1).value;
    });
    if (Object.values(record).some(value => String(value ?? '').trim())) rows.push(record);
  });
  return rows;
}

function previewOutages(rows) {
  const valid = [];
  const invalid = [];
  const seenKeys = new Set();
  rows.forEach((row, index) => {
    if (!Object.values(row).some(value => String(value ?? '').trim())) return;
    const record = outageFromRow(row, 'Excel/CSV');
    if (!record) {
      invalid.push({ row: index + 2, message: 'Thiếu địa điểm/phạm vi, ngày hoặc giờ không hợp lệ.' });
      return;
    }
    if (seenKeys.has(record.source_key)) {
      invalid.push({ row: index + 2, message: 'ID lịch bị trùng với một dòng khác trong tệp.' });
      return;
    }
    seenKeys.add(record.source_key);
    valid.push({
      id: record.source_key,
      date: record.start_at.slice(0, 10),
      start_at: record.start_at,
      end_at: record.end_at,
      affected_scope: record.affected_scope,
      province: record.province,
      ward: record.ward,
      street: record.street,
      utility_unit: record.utility_unit,
      cause: record.cause,
      source_url: record.source_url
    });
  });
  if (!valid.length && !invalid.length) throw new Error('Tệp không có dòng lịch nào để xem trước.');
  return { records: valid, invalid };
}

module.exports = { importOutages, importStations, previewOutages, workbookRows };
