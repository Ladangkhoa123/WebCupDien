function field(record, ...names) {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null && String(record[name]).trim()) return String(record[name]).trim();
  }
  return '';
}

async function fetchPublicOutages({ endpoint = process.env.EVNSPC_PUBLIC_API_URL, fetchImpl = fetch } = {}) {
  const configuredEndpoint = String(endpoint || '').trim();
  if (!configuredEndpoint) {
    throw new Error('Chưa kết nối nguồn dữ liệu tự động. Chỉ đồng bộ khi đã cấu hình API EVNSPC được cấp phép; hãy nhập lịch bằng Excel/CSV.');
  }
  const url = new URL(configuredEndpoint);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('API lịch điện phải sử dụng HTTPS.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`API lịch điện trả về HTTP ${response.status}.`);
  const data = await response.json();
  if (!data || !Array.isArray(data.outages) || data.complete !== true) {
    throw new Error('API phải trả JSON có complete: true và mảng outages để xác định lịch mới, thay đổi hoặc hủy.');
  }
  const records = data.outages.map(item => ({
    id: field(item, 'id', 'eventId'),
    date: field(item, 'date', 'eventDate'),
    startAt: field(item, 'startAt', 'start_at'),
    endAt: field(item, 'endAt', 'end_at'),
    affectedScope: field(item, 'affectedScope', 'affected_scope', 'scope', 'location'),
    province: field(item, 'province') || 'Đồng Nai',
    ward: field(item, 'ward'),
    street: field(item, 'street'),
    utility_unit: field(item, 'utility_unit', 'utilityUnit', 'power_company'),
    cause: field(item, 'cause'),
    source_url: field(item, 'sourceUrl', 'source_url')
  }));
  if (records.some(item => !item.id || !item.startAt || !item.endAt || !item.affectedScope)) {
    throw new Error('Một hoặc nhiều lịch từ API thiếu id, startAt, endAt hoặc affectedScope; dữ liệu cũ được giữ nguyên.');
  }
  return records;
}

module.exports = { fetchPublicOutages };
