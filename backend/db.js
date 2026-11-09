const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const defaultPath = path.join(__dirname, '..', 'database', 'bts.sqlite');
const dbPath = process.env.DB_PATH || defaultPath;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS stations (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    customer_code TEXT NOT NULL DEFAULT '',
    province TEXT NOT NULL DEFAULT '',
    ward TEXT NOT NULL DEFAULT '',
    street TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    management_unit TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    latitude REAL,
    longitude REAL,
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL UNIQUE,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    affected_scope TEXT NOT NULL,
    province TEXT NOT NULL DEFAULT '',
    ward TEXT NOT NULL DEFAULT '',
    street TEXT NOT NULL DEFAULT '',
    cause TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled',
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS update_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    outage_id INTEGER REFERENCES outages(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_outages_time ON outages(start_at, end_at);
  CREATE INDEX IF NOT EXISTS idx_history_created ON update_history(created_at);
  CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
`);

const stationColumns = new Set(db.prepare('PRAGMA table_info(stations)').all().map(column => column.name));
if (!stationColumns.has('customer_code')) {
  db.exec("ALTER TABLE stations ADD COLUMN customer_code TEXT NOT NULL DEFAULT ''");
}
db.exec(`
  UPDATE stations
  SET customer_code = COALESCE(json_extract(raw_json, '$.ma_dienke'), '')
  WHERE customer_code = '' AND json_valid(raw_json)
`);

module.exports = db;
