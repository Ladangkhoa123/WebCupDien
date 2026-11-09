const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dbPath = path.join(os.tmpdir(), `bts-monitor-test-${process.pid}.sqlite`);
process.env.DB_PATH = dbPath;
delete process.env.EVNSPC_PUBLIC_API_URL;
const db = require('../backend/db');
const app = require('../backend/app');
const { classifyMatch } = require('../backend/matching');
const { excelCellText, stationFromRow } = require('../backend/import-utils');

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
  const homepage = await fetch(`${baseUrl}/`);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /BTS Power Monitor/);
});

test('imports schedules idempotently and reports changes', async () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const makeCsv = (start, end) => [
    'ID lịch,Ngày cúp điện,Giờ bắt đầu,Giờ kết thúc,Phạm vi ảnh hưởng,Phường/xã,Đường bị ảnh hưởng,Lý do',
    `EVN-1,${tomorrow},${start},${end},Đường A - khu phố 1,Phường Tân Hiệp,Đường A,Bảo trì`
  ].join('\r\n');
  const upload = csv => request('/api/import/outages?filename=lich.csv', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv
  });

  const first = await upload(makeCsv('08:00', '10:00'));
  assert.equal(first.response.status, 200);
  assert.deepEqual([first.body.added, first.body.changed], [1, 0]);

  const unchanged = await upload(makeCsv('08:00', '10:00'));
  assert.deepEqual([unchanged.body.added, unchanged.body.changed], [0, 0]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM alerts').get().count, 1);

  const changed = await upload(makeCsv('09:00', '11:00'));
  assert.deepEqual([changed.body.added, changed.body.changed], [0, 1]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM alerts').get().count, 2);

  const matches = await request('/api/affected');
  assert.equal(matches.body.length, 1);
  assert.equal(matches.body[0].status, 'area');
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
  const before = db.prepare("SELECT value FROM app_meta WHERE key = 'last_success_at'").get();
  const { response, body } = await request('/api/refresh', { method: 'POST' });
  assert.equal(response.status, 503);
  assert.match(body.message, /Chưa cấu hình API JSON/);
  assert.equal(body.lastSuccessAt, before?.value || null);
  assert.equal(db.prepare("SELECT status FROM update_history ORDER BY id DESC LIMIT 1").get().status, 'error');
});
