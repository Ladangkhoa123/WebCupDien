const crypto = require('node:crypto');

const normalizeHeader = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function findValue(record, aliases) {
  const entries = Object.entries(record);
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    const entry = entries.find(([header]) => normalizeHeader(header) === key);
    if (entry && entry[1] !== undefined && entry[1] !== null && String(entry[1]).trim() !== '') {
      return entry[1];
    }
  }
  return '';
}

function stableKey(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function excelCellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value.error) return String(value.error).trim();
  if (typeof value === 'object' && value.result !== undefined) return excelCellText(value.result);
  if (typeof value === 'object' && value.text) return String(value.text).trim();
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(value => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('Tệp CSV không có dòng dữ liệu.');
  const headers = rows[0].map(value => value.trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function stationFromRow(row) {
  const code = excelCellText(findValue(row, ['Mã trạm BTS', 'Mã BTS', 'Mã trạm', 'ten_csht', 'code', 'station code']));
  const alias = excelCellText(findValue(row, ['Tên trạm BTS', 'Tên trạm', 'Ten goi nho', 'name', 'station name']));
  const unit = excelCellText(findValue(row, ['Đơn vị quản lý', 'Management unit', 'tramvt']));
  const name = alias && alias !== '#N/A' ? alias : unit;
  if (!code || !name || code === '#N/A' || name === '#N/A') return null;

  const latitudeValue = findValue(row, ['latitude', 'lat', 'vĩ độ']);
  const longitudeValue = findValue(row, ['longitude', 'long', 'lon', 'kinh độ']);
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  const raw = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, excelCellText(value)]));
  const customerCode = excelCellText(findValue(row, ['Mã khách hàng', 'Mã KH', 'Mã công tơ', 'ma_dienke', 'customer_code']));
  const details = [
    'Nhập từ danh sách BTS.',
    raw['Ten gợi nhớ'] === '#N/A' ? 'Tên gợi nhớ không có trong tệp nguồn.' : '',
    'Tệp nguồn không cung cấp đầy đủ phường/xã và tên đường.'
  ].filter(Boolean);

  return {
    code,
    name,
    customer_code: customerCode === '#N/A' ? '' : customerCode,
    province: excelCellText(findValue(row, ['Tỉnh/thành phố', 'Tỉnh', 'province'])) || 'Đồng Nai',
    ward: excelCellText(findValue(row, ['Phường/xã', 'Phường', 'Xã', 'ward'])),
    street: excelCellText(findValue(row, ['Tên đường', 'Đường', 'street'])),
    address: excelCellText(findValue(row, ['Địa chỉ chi tiết', 'Địa chỉ', 'address'])),
    management_unit: unit,
    notes: excelCellText(findValue(row, ['Ghi chú', 'notes'])) || details.join(' '),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    raw_json: JSON.stringify(raw)
  };
}

function datePart(value) {
  if (value instanceof Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(value);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  if (typeof value === 'number') {
    if (value > 0 && value < 1) return '';
    if (value >= 1 && value < 2958466) {
      const excelDate = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
      return excelDate.toISOString().slice(0, 10);
    }
  }
  const text = excelCellText(value);
  if (!text) return '';
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const parsed = new Date(`${iso[1]}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso[1]) return iso[1];
  }
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const parsed = new Date(`${normalized}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized) return normalized;
  }
  return '';
}

function timePart(value) {
  if (value instanceof Date) return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  if (typeof value === 'number' && value >= 0 && value < 2958466) {
    const total = Math.floor((value % 1) * 24 * 60);
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  const text = excelCellText(value);
  const match = text.match(/(?:T|\s)?(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function outageFromRow(row, source, sourceUrl = '') {
  const startRaw = findValue(row, ['Bắt đầu', 'Thời gian bắt đầu', 'Thời gian ngừng điện', 'Giờ bắt đầu', 'Giờ cắt điện', 'Thời điểm bắt đầu', 'start_at', 'startAt']);
  const endRaw = findValue(row, ['Kết thúc', 'Thời gian kết thúc', 'Thời gian có điện lại', 'Giờ kết thúc', 'Giờ đóng điện', 'Giờ có điện lại', 'Thời điểm kết thúc', 'end_at', 'endAt']);
  const dateRaw = findValue(row, ['Ngày cúp điện', 'Ngày mất điện', 'Ngày ngừng điện', 'Ngày thực hiện', 'Ngày', 'date', 'event_date']);
  const day = datePart(dateRaw) || datePart(startRaw);
  const startTime = timePart(startRaw);
  const endDateRaw = findValue(row, ['Ngày kết thúc', 'end_date']);
  const endValueDay = endRaw instanceof Date && endRaw.getUTCFullYear() <= 1900 ? '' : datePart(endRaw);
  let endDay = datePart(endDateRaw) || endValueDay || day;
  const endTime = timePart(endRaw) || '';
  if (day && endDay === day && startTime && endTime && endTime < startTime) {
    const nextDay = new Date(`${day}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    endDay = nextDay.toISOString().slice(0, 10);
  }
  const startAt = `${day}T${startTime}`;
  const endAt = `${endDay}T${endTime}`;
  const location = excelCellText(findValue(row, ['Địa điểm', 'Địa điểm bị ảnh hưởng', 'Địa điểm ngừng điện', 'Khu vực mất điện', 'Khu vực', 'Địa bàn', 'Vị trí', 'location', 'area']));
  const scope = excelCellText(findValue(row, ['Phạm vi ảnh hưởng', 'Khu vực ảnh hưởng', 'Phạm vi', 'affected_scope', 'affectedScope'])) || location;
  if (!day || !endTime || !scope || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) || endAt <= startAt) {
    return null;
  }
  const record = {
    start_at: startAt,
    end_at: endAt,
    affected_scope: scope,
    province: excelCellText(findValue(row, ['Tỉnh/thành phố', 'Tỉnh', 'province'])) || 'Đồng Nai',
    ward: excelCellText(findValue(row, ['Phường/xã', 'Phường, xã', 'Phường xã', 'Phường', 'Xã', 'ward', 'commune'])),
    street: excelCellText(findValue(row, ['Đường bị ảnh hưởng', 'Tên đường', 'Tuyến đường', 'Đường', 'street', 'road'])),
    cause: excelCellText(findValue(row, ['Lý do', 'Nguyên nhân', 'Lý do ngừng cung cấp điện', 'Lý do cúp điện', 'cause', 'reason'])),
    source,
    source_url: excelCellText(findValue(row, ['Nguồn dữ liệu', 'source_url'])) || sourceUrl,
    utility_unit: excelCellText(findValue(row, ['Đơn vị điện lực', 'Điện lực', 'Công ty điện lực', 'Đơn vị quản lý điện', 'utility_unit', 'utility unit', 'power company'])),
    raw_json: JSON.stringify(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, excelCellText(value)])))
  };
  record.source_key = excelCellText(findValue(row, ['ID lịch', 'Mã lịch', 'event_id', 'source_id', 'id'])) ||
    stableKey(JSON.stringify([record.province, record.utility_unit, record.start_at, record.ward, record.street, record.affected_scope]));
  return record;
}

module.exports = { csvRows, excelCellText, outageFromRow, stationFromRow };
