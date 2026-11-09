const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const ExcelJS = require('exceljs');

const dbPath = path.join(os.tmpdir(), `bts-monitor-test-${process.pid}.sqlite`);
process.env.DB_PATH = dbPath;
delete process.env.EVNSPC_PUBLIC_API_URL;
const db = require('../backend/db');
const app = require('../backend/app');
const { classifyMatch } = require('../backend/matching');
const { excelCellText, outageFromRow, stationFromRow } = require('../backend/import-utils');
const { refreshOutages } = require('../backend/refresh');
const { vietnamLocalDateTime } = require('../backend/time');
const { fetchPublicOutages } = require('../services/outage-source');

let server;
let baseUrl;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

async function request(url, options) {
  const response = await fetch(`${baseUrl}${url}`, options);
  return { response, body: response.status === 204 ? null : await response.json() };
}

test('imports BTS workbook columns and persists station records', async () => {
  const csv = [
    'STT,tramvt,ten_csht,Ten gợi nhớ,ma_dienke,Phường/xã,Tên đường,latitude,longitude',
    '1,TKT Tam Hiệp,BHO001,Trạm An Bình,PK01000120491,Phường Tân Hiệp,Đường A,10.92825,106.85294'
  ].join('\r\n');
  const { response, body } = await request('/api/import/stations?filename=BTS_BH.csv', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv
  });
  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  const stations = await request('/api/stations');
  assert.equal(stations.body[0].code, 'BHO001');
  assert.equal(stations.body[0].name, 'Trạm An Bình');
  assert.equal(stations.body[0].customer_code, 'PK01000120491');
  assert.equal(stations.body[0].management_unit, 'TKT Tam Hiệp');
  assert.equal(stations.body[0].latitude, 10.92825);
  const summary = await request('/api/summary');
  assert.equal(summary.body.stationCount, 1);
  assert.equal(summary.body.lastSuccessAt, null);
  assert.equal(summary.body.automaticSourceConnected, false);
  const homepage = await fetch(`${baseUrl}/`);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /BTS Power Monitor/);
});

test('previews CSV without writing and only imports after confirmation', async () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const makeCsv = (start, end) => [
    'ID lịch,Ngày cúp điện,Giờ bắt đầu,Giờ kết thúc,Địa điểm,Phường/xã,Đường bị ảnh hưởng,Đơn vị điện lực,Lý do',
    `EVN-1,${tomorrow},${start},${end},Đường A - khu phố 1,Phường Tân Hiệp,Đường A,Điện lực Trấn Biên,Bảo trì`
  ].join('\r\n');
  const preview = csv => request('/api/import/outages/preview?filename=lich.csv', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv
  });

  const firstPreview = await preview(makeCsv('08:00', '10:00'));
  assert.equal(firstPreview.response.status, 200);
  assert.equal(firstPreview.body.records.length, 1);
  assert.equal(firstPreview.body.records[0].utility_unit, 'Điện lực Trấn Biên');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM outages').get().count, 0);

  const first = await request('/api/import/outages/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: firstPreview.body.records })
  });
  assert.equal(first.response.status, 200);
  assert.deepEqual([first.body.added, first.body.changed], [1, 0]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM alerts').get().count, 1);

  const changedPreview = await preview(makeCsv('09:00', '11:00'));
  const changed = await request('/api/import/outages/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: changedPreview.body.records })
  });
  assert.deepEqual([changed.body.added, changed.body.changed], [0, 1]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM alerts').get().count, 2);

  const matches = await request('/api/affected');
  assert.equal(matches.body.length, 1);
  assert.equal(matches.body[0].status, 'area');
  const reviewed = await request(`/api/matches/${matches.body[0].outage.id}/BHO001/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'confirmed', note: 'Đã gọi điện lực xác nhận' })
  });
  assert.equal(reviewed.response.status, 200);
  const refreshedMatches = await request('/api/affected');
  assert.equal(refreshedMatches.body[0].status, 'confirmed');
  assert.equal(refreshedMatches.body[0].reviewed, true);

  const revisedPreview = await preview(makeCsv('10:00', '11:00'));
  await request('/api/import/outages/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: revisedPreview.body.records })
  });
  let currentMatches = await request('/api/affected');
  assert.equal(currentMatches.body[0].status, 'area');
  assert.equal(currentMatches.body[0].reviewed, false);

  const station = (await request('/api/stations')).body[0];
  await request('/api/stations/BHO001', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...station, ward: 'Phường Tam Hiệp' })
  });
  currentMatches = await request('/api/affected');
  assert.equal(currentMatches.body[0].status, 'not_affected');
  assert.equal(currentMatches.body[0].reviewed, false);
});

test('previews XLSX schedules and serves a real Excel template', async () => {
  const templateResponse = await fetch(`${baseUrl}/api/templates/outages.xlsx`);
  assert.equal(templateResponse.status, 200);
  assert.match(templateResponse.headers.get('content-type'), /spreadsheetml/);
  const templateWorkbook = new ExcelJS.Workbook();
  await templateWorkbook.xlsx.load(Buffer.from(await templateResponse.arrayBuffer()));
  assert.equal(templateWorkbook.worksheets[0].getRow(1).getCell(1).text, 'ID lịch');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Lịch cúp điện');
  sheet.addRow(['Ngày cúp điện', 'Giờ bắt đầu', 'Giờ kết thúc', 'Địa điểm', 'Đường', 'Phường/xã', 'Đơn vị điện lực', 'Lý do']);
  sheet.addRow([new Date(Date.now() + 2 * 86400000), new Date(Date.UTC(1899, 11, 30, 8)), new Date(Date.UTC(1899, 11, 30, 10)), 'Khu phố 1', 'Đường A', 'Phường Tân Hiệp', 'Điện lực Trấn Biên', 'Bảo trì']);
  sheet.getCell('B2').numFmt = 'hh:mm';
  sheet.getCell('C2').numFmt = 'hh:mm';
  const beforeCount = db.prepare('SELECT COUNT(*) AS count FROM outages').get().count;
  const { response, body } = await request('/api/import/outages/preview?filename=lich.xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(await workbook.xlsx.writeBuffer())
  });
  assert.equal(response.status, 200);
  assert.equal(body.records.length, 1);
  assert.equal(body.records[0].affected_scope, 'Khu phố 1');
  assert.equal(body.records[0].street, 'Đường A');
  assert.equal(body.records[0].utility_unit, 'Điện lực Trấn Biên');
  assert.equal(body.records[0].start_at.endsWith('T08:00'), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM outages').get().count, beforeCount);
});

test('accepts only a configured, complete JSON source contract', async () => {
  await assert.rejects(fetchPublicOutages(), /Chưa kết nối nguồn dữ liệu tự động/);
  const records = await fetchPublicOutages({
    endpoint: 'https://api.example.test/outages',
    fetchImpl: async () => new Response(JSON.stringify({
      complete: true,
      outages: [{
        id: 'api-1', date: '2026-12-01', startAt: '2026-12-01T08:00',
        endAt: '2026-12-01T10:00', affectedScope: 'Phường Tân Hiệp'
      }]
    }), { headers: { 'content-type': 'application/json' } })
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'api-1');
  await assert.rejects(fetchPublicOutages({
    endpoint: 'https://api.example.test/outages',
    fetchImpl: async () => new Response(JSON.stringify({ complete: false, outages: [] }))
  }), /complete: true/);
});

test('validates imported dates and recognizes overnight schedules', () => {
  const overnight = outageFromRow({
    'Ngày cúp điện': '01/12/2026',
    'Giờ bắt đầu': '23:00',
    'Giờ kết thúc': '01:00',
    'Địa điểm': 'Khu phố 1'
  }, 'Excel/CSV');
  assert.equal(overnight.start_at, '2026-12-01T23:00');
  assert.equal(overnight.end_at, '2026-12-02T01:00');
  assert.equal(outageFromRow({
    'Ngày cúp điện': '31/02/2026',
    'Giờ bắt đầu': '08:00',
    'Giờ kết thúc': '10:00',
    'Địa điểm': 'Khu phố 1'
  }, 'Excel/CSV'), null);
  assert.equal(outageFromRow({
    'Ngày cúp điện': '2026-02-31',
    'Giờ bắt đầu': '08:00',
    'Giờ kết thúc': '10:00',
    'Địa điểm': 'Khu phố 1'
  }, 'Excel/CSV'), null);
  const sameAreaLater = outageFromRow({
    'Ngày cúp điện': '01/12/2026',
    'Giờ bắt đầu': '14:00',
    'Giờ kết thúc': '16:00',
    'Địa điểm': 'Khu phố 1'
  }, 'Excel/CSV');
  assert.notEqual(overnight.source_key, sameAreaLater.source_key);
  const excelSerial = outageFromRow({
    'Ngày cúp điện': 46357,
    'Giờ bắt đầu': 46357.5,
    'Giờ kết thúc': 46357.75,
    'Địa điểm': 'Khu phố 1'
  }, 'Excel/CSV');
  assert.equal(excelSerial.start_at.endsWith('T12:00'), true);
});

test('creates a manual outage without requiring a public API', async () => {
  const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { response, body } = await request('/api/outages/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date,
      start_at: '08:00',
      end_at: '12:00',
      affected_scope: 'Thông báo kiểm thử - khu phố 1',
      province: 'Đồng Nai',
      ward: 'Phường Tân Hiệp',
      street: 'Đường A',
      cause: 'Bảo trì'
    })
  });
  assert.equal(response.status, 201);
  assert.deepEqual([body.count, body.added, body.changed], [1, 1, 0]);
  const outage = db.prepare("SELECT source, affected_scope FROM outages WHERE affected_scope = ?")
    .get('Thông báo kiểm thử - khu phố 1');
  assert.equal(outage.source, 'Nhập thủ công');
  assert.equal(outage.affected_scope, 'Thông báo kiểm thử - khu phố 1');
});

test('filters expired schedules using Vietnam local time', async () => {
  const start = vietnamLocalDateTime(new Date(Date.now() - 3 * 60 * 60 * 1000));
  const end = vietnamLocalDateTime(new Date(Date.now() - 2 * 60 * 60 * 1000));
  await request('/api/outages/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: start.slice(0, 10),
      end_date: end.slice(0, 10),
      start_at: start.slice(11, 16),
      end_at: end.slice(11, 16),
      affected_scope: 'Lịch kiểm tra đã kết thúc',
      province: 'Đồng Nai'
    })
  });
  const result = await request('/api/outages');
  assert.equal(result.body.outages.some(item => item.affected_scope === 'Lịch kiểm tra đã kết thúc'), false);
});

test('does not claim a matching road proves impact', () => {
  const station = { code: 'BHO001', name: 'Trạm An Bình', ward: 'Phường Tân Hiệp', street: 'Đường A' };
  const sameRoadDifferentWard = {
    affected_scope: 'Đường A', ward: 'Phường Tam Hiệp', street: 'Đường A'
  };
  assert.equal(classifyMatch(station, sameRoadDifferentWard).status, 'not_affected');
  assert.equal(classifyMatch(station, { affected_scope: 'Mất điện BHO001' }).status, 'confirmed');
});

test('handles Excel formula errors without exposing object strings as station names', () => {
  const station = stationFromRow({
    tramvt: 'TKT Biên Hòa',
    ten_csht: 'BHO099',
    'Ten gợi nhớ': { formula: 'VLOOKUP(...)', result: { error: '#N/A' } },
    latitude: 10.9,
    longitude: 106.8
  });
  assert.equal(excelCellText({ formula: 'VLOOKUP(...)', result: { error: '#N/A' } }), '#N/A');
  assert.equal(station.name, 'TKT Biên Hòa');
  assert.match(station.notes, /Tên gợi nhớ không có/);
});

test('failed source refresh retains the last successful timestamp', async () => {
  const lastSuccessAt = '2026-01-01T00:00:00.000Z';
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('last_success_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(lastSuccessAt);
  const outagesBefore = db.prepare('SELECT COUNT(*) AS count FROM outages').get().count;
  const lastDataUpdateBefore = db.prepare("SELECT value FROM app_meta WHERE key = 'last_data_update_at'").get()?.value || null;
  const result = await refreshOutages();
  assert.equal(result.ok, false);
  assert.match(result.message, /Chưa kết nối nguồn dữ liệu tự động/);
  assert.equal(db.prepare("SELECT status FROM update_history ORDER BY id DESC LIMIT 1").get().status, 'error');
  assert.equal(db.prepare("SELECT value FROM app_meta WHERE key = 'last_success_at'").get()?.value, lastSuccessAt);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM outages').get().count, outagesBefore);
  assert.equal(db.prepare("SELECT value FROM app_meta WHERE key = 'last_data_update_at'").get()?.value || null, lastDataUpdateBefore);
  const response = await request('/api/refresh', { method: 'POST' });
  assert.equal(response.response.status, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.lastSuccessAt, lastSuccessAt);
});
