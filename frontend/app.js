const state = {
  page: 'overview',
  summary: {},
  stations: [],
  outages: [],
  matches: [],
  history: [],
  alerts: [],
  outagePeriod: 'week',
  pendingOutageImport: [],
  map: null
};

const pageTitles = {
  overview: 'Tổng quan',
  stations: 'Danh sách BTS',
  btsOutages: 'Lịch cúp điện BTS',
  outages: 'Lịch cúp điện 7 ngày',
  affected: 'Trạm BTS bị ảnh hưởng',
  map: 'Bản đồ trạm BTS',
  history: 'Lịch sử cập nhật',
  data: 'Quản lý dữ liệu'
};

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const safeExternalUrl = value => {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};
const isQueryableCustomerCode = value => /^[A-Za-z0-9_-]{5,32}$/.test(String(value || ''));
const asDate = value => {
  const text = String(value || '');
  return new Date(/T/.test(text) && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? `${text}+07:00` : text);
};
const localDate = value => value ? asDate(value).toLocaleString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short'
}) : '—';
const localDay = value => value ? asDate(value).toLocaleDateString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit'
}) : '—';
const vietnamDateKey = date => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const periodBounds = period => {
  const today = vietnamDateKey(new Date());
  if (period === 'today') return [today, today];
  if (period !== 'week') return ['', ''];
  const lastDay = new Date(`${today}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() + 6);
  return [today, lastDay.toISOString().slice(0, 10)];
};
const inSelectedPeriod = outage => {
  const [start, end] = periodBounds(state.outagePeriod);
  return !start || (outage.start_at.slice(0, 10) <= end && outage.end_at.slice(0, 10) >= start);
};
const timeOnly = value => value ? asDate(value).toLocaleTimeString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit'
}) : '—';
const matchLabels = {
  confirmed: ['Đã xác nhận', 'badge-confirmed'],
  area: ['Khớp khu vực', 'badge-area'],
  needs_review: ['Cần kiểm tra', 'badge-review'],
  not_affected: ['Không bị ảnh hưởng', 'badge-safe']
};
const matchBadge = status => {
  const [label, css] = matchLabels[status] || ['Chưa có dữ liệu', 'badge-muted'];
  return `<span class="badge ${css}">${label}</span>`;
};
const reviewedMatchBadge = match => {
  if (!match?.reviewed) return matchBadge(match?.status);
  const affected = match.status === 'confirmed';
  return `<span class="badge ${affected ? 'badge-confirmed' : 'badge-safe'}">Đã xác minh: ${affected ? 'Có ảnh hưởng' : 'Không ảnh hưởng'}</span>`;
};

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || payload?.message || `Lỗi HTTP ${response.status}`);
  return payload;
}

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.hidden = true; }, 4200);
}

async function loadData() {
  const [summary, stations, outageResult, history, alerts] = await Promise.all([
    api('/api/summary'),
    api('/api/stations'),
    api('/api/outages'),
    api('/api/history'),
    api('/api/alerts')
  ]);
  state.summary = summary;
  state.stations = stations;
  state.outages = outageResult.outages;
  state.matches = outageResult.matches;
  state.history = history;
  state.alerts = alerts;
  $('#sidebar-state').textContent = 'Dữ liệu cục bộ hoạt động';
  $('#last-updated').textContent = summary.lastDataUpdateAt
    ? `Cập nhật dữ liệu ${localDate(summary.lastDataUpdateAt)}`
    : 'Chưa có dữ liệu lịch';
  $('#notification-dot').hidden = !alerts.some(alert => !alert.read_at);
}

function switchPage(page) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('#page-title').textContent = pageTitles[page];
  $('#alert-drawer').hidden = true;
  renderPage();
}

function pageHeading(title, description, actions = '') {
  return `<div class="page-heading"><div><h2>${title}</h2><p>${description}</p></div><div class="page-actions">${actions}</div></div>`;
}

function renderOverview() {
  const summary = state.summary;
  const metrics = [
    ['Tổng số trạm BTS', summary.stationCount ?? 0, '⌁', '#4be0ab', 'Trạm trong danh sách quản lý'],
    ['Có lịch trong 7 ngày', summary.scheduledCount ?? 0, '◷', '#ffad66', 'Đã xác nhận hoặc khớp khu vực'],
    ['Có lịch hôm nay', summary.todayCount ?? 0, '◉', '#ff7278', 'Bao gồm các trường hợp cần kiểm tra'],
    ['Đang mất điện', summary.activeCount ?? 0, 'ϟ', '#ff7278', 'Đã xác nhận và đang trong khung giờ'],
    ['Cần xác minh', summary.reviewCount ?? 0, '?', '#f2ce62', 'Địa chỉ có dấu hiệu chưa đầy đủ']
  ];
  const metricHtml = metrics.map(([label, value, icon, color, foot]) =>
    `<article class="metric-card" style="--glow:${color}"><div class="metric-top">${label}<span class="metric-icon">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></article>`
  ).join('');
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    const date = new Date();
    date.setDate(date.getDate() + index);
    days.push(date);
  }
  const counts = days.map(date => state.outages.filter(outage => {
    const eventDate = asDate(outage.start_at);
    return eventDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) === date.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  }).length);
  const max = Math.max(...counts, 1);
  const chart = days.map((date, index) => {
    const value = counts[index];
    return `<div class="chart-day"><span class="chart-number">${value || ''}</span><div class="chart-column" style="height:${value ? Math.max(12, value / max * 138) : 2}px"></div><span>${date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' })}</span></div>`;
  }).join('');
  const latest = state.outages.slice(0, 5);
  const outageRows = latest.map(outage => {
    const found = state.matches.find(item => item.outage.id === outage.id);
    return `<tr><td class="cell-primary">${localDay(outage.start_at)}<span class="cell-secondary">${timeOnly(outage.start_at)} – ${timeOnly(outage.end_at)}</span></td><td>${esc(outage.ward || outage.province || 'Đồng Nai')}<span class="cell-secondary">${esc(outage.street || outage.affected_scope)}</span></td><td>${reviewedMatchBadge(found)}</td><td>${esc(outage.source)}</td></tr>`;
  }).join('');
  const missingLocationCount = state.stations.filter(station => !station.ward || !station.street).length;
  const banner = state.outages.length
    ? ''
    : `<div class="inline-alert info"><span>ⓘ</span><div><b>Chưa có dữ liệu lịch cúp điện.</b> Nhập lịch chính thức bằng Excel/CSV trong mục Quản lý dữ liệu. Danh sách BTS đã được nạp; lịch chưa được tạo giả.</div></div>`;
  return `${banner}${pageHeading('Trung tâm giám sát', 'Theo dõi nguồn điện trạm BTS và các lịch ngừng cung cấp điện tại Đồng Nai.', `<button class="button button-secondary" data-action="refresh">↻&nbsp; Cập nhật lịch</button><button class="button button-primary" data-page="data">＋&nbsp; Nhập dữ liệu</button>`)}
    <div class="metric-grid">${metricHtml}</div>
    <div class="two-column">
      <section class="panel"><div class="panel-heading"><div><h3>Lịch ngừng điện · 7 ngày</h3><p class="subtle">Số lịch cúp điện theo ngày từ dữ liệu đã nhập</p></div><button class="button button-muted button-small" data-page="outages">Xem chi tiết&nbsp; →</button></div><div class="panel-body"><div class="chart-area">${chart}</div></div></section>
      <section class="panel"><div class="panel-heading"><div><h3>Tình trạng dữ liệu</h3><p class="subtle">Cập nhật mới nhất và chất lượng địa chỉ</p></div></div><div class="panel-body">
        <div class="source-status"><span class="status-symbol">${summary.sourceError ? '!' : '↻'}</span><div><strong>${summary.sourceError ? 'Lỗi đồng bộ EVNSPC' : summary.automaticSourceConnected ? 'Đã cấu hình API EVNSPC' : 'Chưa kết nối nguồn dữ liệu tự động'}</strong><p>${summary.sourceError ? esc(summary.sourceError) : summary.lastCheckedAt ? `Kiểm tra gần nhất: ${localDate(summary.lastCheckedAt)}` : 'Có thể nhập lịch từ Excel/CSV hoặc mở trang tra cứu EVNSPC.'}</p></div></div>
        <div class="source-status"><span class="status-symbol">⌖</span><div><strong>${missingLocationCount} trạm thiếu phường/xã hoặc đường</strong><p>Cập nhật địa chỉ giúp đối chiếu khu vực chính xác hơn.</p></div></div>
      </div></section>
    </div>
    <section class="panel"><div class="panel-heading"><div><h3>Lịch sắp tới</h3><p class="subtle">Phạm vi gốc được giữ nguyên từ nguồn nhập</p></div><span class="table-summary">${state.outages.length} lịch</span></div><div class="table-wrap">
      ${latest.length ? `<table><thead><tr><th>NGÀY / GIỜ</th><th>KHU VỰC / PHẠM VI</th><th>ĐỐI CHIẾU</th><th>NGUỒN</th></tr></thead><tbody>${outageRows}</tbody></table>` : `<div class="empty-state"><span class="empty-symbol">◷</span>Chưa có lịch trong cửa sổ 7 ngày.<br>Nhập lịch thật bằng Excel/CSV hoặc kiểm tra trang tra cứu EVNSPC.</div>`}
    </div></section>`;
}

function stationRows(stations) {
  return stations.map(station => `<tr>
    <td class="code">${esc(station.code)}</td>
    <td class="station-name"><span class="cell-primary">${esc(station.name)}</span><span class="cell-secondary">${esc(station.address || station.street || 'Chưa có địa chỉ chi tiết')}</span></td>
    <td>${station.customer_code ? `<span class="${isQueryableCustomerCode(station.customer_code) ? 'code' : 'muted'}">${esc(station.customer_code)}</span>${isQueryableCustomerCode(station.customer_code) ? '' : '<span class="cell-secondary">Cần xác minh mã</span>'}` : '<span class="muted">Chưa có</span>'}</td>
    <td>${esc(station.ward || '—')}<span class="cell-secondary">${esc(station.province || 'Đồng Nai')}</span></td>
    <td>${esc(station.street || '—')}</td>
    <td>${station.latitude != null && station.longitude != null ? `${Number(station.latitude).toFixed(5)}, ${Number(station.longitude).toFixed(5)}` : '—'}</td>
    <td>${esc(station.management_unit || '—')}</td>
    <td class="nowrap">${isQueryableCustomerCode(station.customer_code) ? `<button class="button button-muted button-small" data-action="copy-customer" data-customer-code="${esc(station.customer_code)}">Sao chép</button> <a class="button button-secondary button-small" href="https://www.cskh.evnspc.vn/TraCuu/LichNgungGiamCungCapDien" target="_blank" rel="noopener noreferrer">Tra cứu ↗</a> ` : ''}<button class="button button-muted button-small" data-action="edit-station" data-code="${esc(station.code)}">Sửa</button> <button class="button button-danger button-small" data-action="delete-station" data-code="${esc(station.code)}">Xóa</button></td>
  </tr>`).join('');
}

function renderStations() {
  const wards = [...new Set(state.stations.map(item => item.ward).filter(Boolean))].sort();
  return `${pageHeading('Danh sách trạm BTS', `${state.stations.length} trạm trong danh sách quản lý.`, `<button class="button button-secondary" data-action="import-stations">⇧&nbsp; Nhập Excel/CSV</button><button class="button button-primary" data-action="add-station">＋&nbsp; Thêm trạm</button>`)}
    <div class="filters"><input class="search-box" id="station-search" placeholder="Tìm mã trạm, tên, địa chỉ..." value="${esc($('#station-search')?.value || '')}"><select class="filter-select" id="station-ward-filter"><option value="">Tất cả phường/xã</option>${wards.map(ward => `<option value="${esc(ward)}">${esc(ward)}</option>`).join('')}</select><button class="button button-muted button-small" data-action="export-stations">Tải CSV</button></div>
    <section class="panel"><div class="panel-heading"><div><h3>Danh mục trạm</h3><p class="subtle">Tra mã KH thủ công trên EVNSPC; hệ thống không tự gửi truy vấn.</p></div><span class="table-summary" id="station-count">${state.stations.length} trạm</span></div><div class="table-wrap"><table><thead><tr><th>MÃ BTS</th><th>TÊN TRẠM</th><th>MÃ KH / CÔNG TƠ</th><th>PHƯỜNG / TỈNH</th><th>ĐƯỜNG</th><th>TỌA ĐỘ</th><th>ĐƠN VỊ QUẢN LÝ</th><th>THAO TÁC</th></tr></thead><tbody id="station-rows">${stationRows(state.stations)}</tbody></table>${state.stations.length ? '' : '<div class="empty-state">Chưa có trạm. Hãy nhập workbook BTS.</div>'}</div></section>`;
}

function outageTableRows(outages, matches) {
  return outages.map(outage => {
    const found = matches.find(item => item.outage.id === outage.id);
    const sourceUrl = safeExternalUrl(outage.source_url);
    const source = sourceUrl
      ? `<a class="source-url" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(outage.source)}</a>`
      : esc(outage.source);
    return `<tr>
      <td class="code">${esc(found?.station.code || '—')}<span class="cell-secondary">${esc(found?.station.name || 'Chưa ghép trạm')}${found?.station.customer_code ? ` · KH ${esc(found.station.customer_code)}` : ''}</span></td>
      <td>${esc(outage.ward || outage.province || 'Đồng Nai')}</td>
      <td title="${esc(outage.affected_scope)}">${esc(outage.street || outage.affected_scope)}</td>
      <td class="nowrap">${localDay(outage.start_at)}</td><td class="nowrap">${timeOnly(outage.start_at)}</td><td class="nowrap">${timeOnly(outage.end_at)}</td>
      <td>${esc(outage.cause || '—')}</td><td>${reviewedMatchBadge(found)}</td>
      <td>${source}</td>
    </tr>`;
  }).join('');
}

function renderOutages() {
  const wards = [...new Set([...state.stations.map(item => item.ward), ...state.outages.map(item => item.ward)].filter(Boolean))].sort();
  const days = [...new Set(state.outages.map(item => item.start_at.slice(0, 10)))].sort();
  const filtered = state.outages.filter(outage => {
    const date = $('#outage-date')?.value || '';
    const ward = $('#outage-ward')?.value || '';
    const code = ($('#outage-code')?.value || '').trim().toLowerCase();
    const outageMatchesCode = !code || state.matches.some(item => item.outage.id === outage.id &&
      [item.station.code, item.station.customer_code].some(value => String(value || '').toLowerCase().includes(code)));
    return inSelectedPeriod(outage) && (!date || outage.start_at.slice(0, 10) === date) &&
      (!ward || outage.ward === ward) && outageMatchesCode;
  });
  const periodActions = `<button class="button ${state.outagePeriod === 'today' ? 'button-primary' : 'button-secondary'}" data-action="show-period" data-period="today">Xem hôm nay</button><button class="button ${state.outagePeriod === 'week' ? 'button-primary' : 'button-secondary'}" data-action="show-period" data-period="week">Xem 7 ngày</button><button class="button button-secondary" data-action="add-outage">＋&nbsp; Nhập lịch thủ công</button><button class="button button-muted" data-page="data">⇧&nbsp; Nhập file</button>`;
  return `${pageHeading('Lịch cúp điện · 7 ngày', 'Cập nhật nguồn lịch được phép, rồi lọc các lịch và trạm khớp theo thời gian. Mã khách hàng chỉ dùng để tìm trong dữ liệu đã có.', `${periodActions}<button class="button button-muted" data-page="data">⇧&nbsp; Nhập lịch</button>`)}
    ${state.outages.length ? '' : '<div class="inline-alert info"><span>ⓘ</span><div>Chưa có lịch chính thức được nhập cho 7 ngày tới. Không có dữ liệu lịch giả.</div></div>'}
    <div class="filters"><span class="filter-label">Lọc theo</span><select id="outage-date" class="filter-select"><option value="">Tất cả ngày</option>${days.map(day => `<option value="${esc(day)}">${new Date(`${day}T00:00:00+07:00`).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</option>`).join('')}</select><select id="outage-ward" class="filter-select"><option value="">Tất cả phường/xã</option>${wards.map(ward => `<option value="${esc(ward)}">${esc(ward)}</option>`).join('')}</select><input id="outage-code" class="filter-input" placeholder="Mã BTS / mã khách hàng"><span class="table-summary" id="outage-count">${filtered.length} dòng</span></div>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>MÃ BTS / TÊN TRẠM</th><th>KHU VỰC</th><th>ĐƯỜNG / PHẠM VI BỊ ẢNH HƯỞNG</th><th>NGÀY</th><th>BẮT ĐẦU</th><th>KẾT THÚC DỰ KIẾN</th><th>LÝ DO</th><th>MỨC ĐỘ XÁC NHẬN</th><th>NGUỒN DỮ LIỆU</th></tr></thead><tbody id="outage-rows">${outageTableRows(filtered, state.matches)}</tbody></table>${filtered.length ? '' : '<div class="empty-state">Không có lịch khớp bộ lọc hoặc chưa có lịch được nhập.</div>'}</div></section>`;
}

function renderAffected() {
  const filtered = state.matches.filter(item => {
    const status = $('#match-filter')?.value || '';
    const ward = $('#affected-ward')?.value || '';
    const code = ($('#affected-code')?.value || '').trim().toLowerCase();
    return inSelectedPeriod(item.outage) && (!status || item.status === status) && (!ward || item.station.ward === ward) &&
      (!code || [item.station.code, item.station.customer_code].some(value => String(value || '').toLowerCase().includes(code)));
  });
  const wards = [...new Set(state.stations.map(item => item.ward).filter(Boolean))].sort();
  const rows = filtered.map(item => `<tr>
    <td class="code">${esc(item.station.code)}<span class="cell-secondary">Mã KH: ${esc(item.station.customer_code || 'Chưa có')}</span></td><td class="cell-primary">${esc(item.station.name)}</td>
    <td>${esc(item.station.ward || item.outage.ward || '—')}</td>
    <td title="${esc(item.outage.affected_scope)}">${esc(item.outage.affected_scope)}</td>
    <td class="nowrap">${localDay(item.outage.start_at)}<span class="cell-secondary">${timeOnly(item.outage.start_at)}–${timeOnly(item.outage.end_at)}</span></td>
    <td>${matchBadge(item.status)}<span class="cell-secondary">${esc(item.reason)}</span></td><td>${esc(item.outage.source)}</td>
  </tr>`).join('');
  const periodActions = `<button class="button ${state.outagePeriod === 'today' ? 'button-primary' : 'button-secondary'}" data-action="show-period" data-period="today">Xem hôm nay</button><button class="button ${state.outagePeriod === 'week' ? 'button-primary' : 'button-secondary'}" data-action="show-period" data-period="week">Xem 7 ngày</button><button class="button button-secondary" data-action="add-outage">＋&nbsp; Nhập lịch thủ công</button>`;
  return `${pageHeading('Trạm BTS bị ảnh hưởng', 'Cập nhật nguồn lịch được phép và lọc trạm theo ngày/tuần; tìm được cả bằng mã BTS hoặc mã khách hàng. Tên đường trùng riêng lẻ không phải xác nhận.', periodActions)}
    ${!state.outages.length ? '<div class="inline-alert info"><span>ⓘ</span><div>Chưa có lịch để đối chiếu. Nhập dữ liệu từ nguồn EVNSPC trước khi kết luận trạm bị ảnh hưởng.</div></div>' : ''}
    <div class="filters"><select id="match-filter" class="filter-select"><option value="">Tất cả mức độ</option><option value="confirmed">Đã xác nhận</option><option value="area">Khớp khu vực</option><option value="needs_review">Cần kiểm tra</option><option value="not_affected">Không bị ảnh hưởng</option></select><select id="affected-ward" class="filter-select"><option value="">Tất cả phường/xã</option>${wards.map(ward => `<option value="${esc(ward)}">${esc(ward)}</option>`).join('')}</select><input id="affected-code" class="filter-input" placeholder="Mã BTS / mã khách hàng"><span class="table-summary" id="affected-count">${filtered.length} kết quả</span></div>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>MÃ BTS</th><th>TÊN TRẠM</th><th>KHU VỰC</th><th>PHẠM VI NGUYÊN VĂN</th><th>THỜI GIAN</th><th>ĐỐI CHIẾU</th><th>NGUỒN</th></tr></thead><tbody id="affected-rows">${rows}</tbody></table>${filtered.length ? '' : `<div class="empty-state">${state.outages.length ? 'Chưa có trạm nào đủ thông tin để ghép với các lịch hiện tại.' : 'Chưa có dữ liệu lịch cúp điện.'}</div>`}</div></section>`;
}

function btsOutageItems() {
  const date = $('#bts-outage-date')?.value || '';
  const ward = $('#bts-outage-ward')?.value || '';
  const stationQuery = ($('#bts-outage-station')?.value || '').trim().toLocaleLowerCase('vi');
  const streetQuery = ($('#bts-outage-street')?.value || '').trim().toLocaleLowerCase('vi');
  return state.matches.filter(item => {
    if (item.status === 'not_affected' && !item.reviewed) return false;
    const street = item.outage.street || item.station.street || item.outage.affected_scope;
    const stationText = [item.station.code, item.station.name, item.station.address, item.station.ward]
      .join(' ').toLocaleLowerCase('vi');
    return (!date || item.outage.start_at.slice(0, 10) === date) &&
      (!ward || item.station.ward === ward || item.outage.ward === ward) &&
      (!stationQuery || stationText.includes(stationQuery)) &&
      (!streetQuery || street.toLocaleLowerCase('vi').includes(streetQuery));
  }).sort((left, right) => left.outage.start_at.localeCompare(right.outage.start_at));
}

function btsOutageCard(item) {
  const safe = item.status === 'not_affected' && item.reviewed;
  const risky = ['confirmed', 'area'].includes(item.status);
  const address = item.station.address || [item.station.ward, item.station.street].filter(Boolean).join(', ');
  const street = item.outage.street || item.station.street || item.outage.affected_scope;
  const updatedAt = item.outage.updated_at ? new Date(item.outage.updated_at) : null;
  const fresh = updatedAt && Date.now() - updatedAt.getTime() < 24 * 60 * 60 * 1000;
  const statusLabel = safe ? 'Đã xác minh: Không ảnh hưởng'
    : item.reviewed ? 'Đã xác minh: Có ảnh hưởng'
      : risky ? 'Có nguy cơ' : 'Cần xác minh';
  const statusClass = safe ? 'bts-status-safe' : risky ? 'bts-status-risk' : 'bts-status-review';
  return `<article class="bts-outage-card">
    <div class="bts-card-heading"><div><h4>${esc(item.station.name)}</h4><span class="bts-card-code">${esc(item.station.code)}</span></div><span class="bts-status ${statusClass}">${statusLabel}</span></div>
    ${address ? `<p class="bts-card-address">${esc(address)}</p>` : ''}
    <p class="bts-card-street">${esc(street)}</p>
    <p class="bts-card-time"><span aria-hidden="true">🗓</span><span>${esc(localDay(item.outage.start_at))}</span></p>
    <p class="bts-card-time"><span aria-hidden="true">⏰</span><span>${esc(timeOnly(item.outage.start_at))} – ${esc(timeOnly(item.outage.end_at))}</span></p>
    <p class="bts-card-meta">${esc(item.outage.utility_unit || 'Điện lực Đồng Nai')} · ${esc(item.outage.cause || 'Lý do chưa nêu')}</p>
    <p class="bts-card-meta">${fresh ? 'Dữ liệu mới' : 'Dữ liệu cũ'} · ${esc(localDate(item.outage.updated_at))}</p>
    <p class="bts-card-scope">Phạm vi: ${esc(item.outage.affected_scope)}</p>
    <div class="bts-review-actions">
      <button class="button button-muted button-small" data-action="review-match" data-outage-id="${item.outage.id}" data-station-code="${esc(item.station.code)}" data-review="confirmed">${item.reviewed && item.status === 'confirmed' ? 'Đã xác nhận ảnh hưởng' : 'Xác nhận có ảnh hưởng'}</button>
      <button class="button button-muted button-small" data-action="review-match" data-outage-id="${item.outage.id}" data-station-code="${esc(item.station.code)}" data-review="not_affected">${item.reviewed && item.status === 'not_affected' ? 'Đã xác nhận an toàn' : 'Xác nhận không ảnh hưởng'}</button>
    </div>
  </article>`;
}

function updateBtsOutageList() {
  const items = btsOutageItems();
  const list = $('#bts-outage-list');
  if (!list) return;
  list.innerHTML = items.map(btsOutageCard).join('') ||
    '<div class="bts-empty">Không có lịch khớp bộ lọc trong 7 ngày tới.</div>';
  $('#bts-outage-count').textContent = `${items.length} lịch`;
}

function renderBtsOutages() {
  const relevantMatches = state.matches.filter(item => item.status !== 'not_affected' || item.reviewed);
  const matchedStations = new Set(relevantMatches.map(item => item.station.code));
  const potentialStations = new Set(state.matches.filter(item => item.status !== 'not_affected')
    .map(item => item.station.code));
  const safeCount = state.outages.length
    ? state.stations.filter(station => station.ward && (station.street || station.address) && !potentialStations.has(station.code)).length
    : 0;
  const unknownCount = state.outages.length
    ? state.stations.filter(station => !matchedStations.has(station.code) && (!station.ward || (!station.street && !station.address))).length
    : state.stations.length;
  const riskCount = new Set(relevantMatches.filter(item => ['confirmed', 'area'].includes(item.status))
    .map(item => item.station.code)).size;
  const reviewCount = new Set(relevantMatches.filter(item => ['needs_review', 'area'].includes(item.status) && !item.reviewed)
    .map(item => item.station.code)).size;
  const wards = [...new Set([...state.stations.map(item => item.ward), ...state.outages.map(item => item.ward)].filter(Boolean))].sort();
  const days = [...new Set(state.outages.map(item => item.start_at.slice(0, 10)))].sort();
  const updated = state.summary.lastDataUpdateAt;
  const automaticSourceStatus = state.summary.automaticSourceConnected
    ? 'Đã cấu hình API EVNSPC; trạng thái đồng bộ hiển thị theo kết quả thực tế.'
    : 'Chưa kết nối nguồn dữ liệu tự động';
  return `<section class="bts-outage-page">
    <header class="bts-outage-header"><h2>LỊCH CÚP ĐIỆN BTS</h2><span class="bts-province">Đồng Nai</span></header>
    <div class="bts-actions">
      <button class="button button-secondary" data-action="import-outages">Nhập lịch Excel/CSV</button>
      <a class="button button-muted" href="/api/templates/outages.xlsx" download>Tải mẫu Excel</a>
      <button class="button button-muted" data-page="history">Xem lịch sử cập nhật</button>
      <button class="button button-secondary bts-refresh" data-action="refresh">↻ Đồng bộ dữ liệu</button>
      <a class="button button-muted" href="https://cskh.evnspc.vn/TraCuu/LichNgungGiamCungCapDien" target="_blank" rel="noopener noreferrer">Mở trang EVNSPC ↗</a>
    </div>
    <div class="inline-alert info"><span>ⓘ</span><div>${automaticSourceStatus}</div></div>
    ${state.summary.sourceError ? `<div class="inline-alert error"><span>!</span><div>Không lấy được lịch mới từ EVNSPC: ${esc(state.summary.sourceError)} Dữ liệu lịch cũ vẫn được giữ nguyên.</div></div>` : ''}
    ${!state.outages.length ? '<div class="inline-alert info"><span>ⓘ</span><div>Chưa có lịch trong dữ liệu. Nhập lịch từ nguồn chính thức bằng Excel/CSV; hệ thống không tạo lịch giả.</div></div>' : ''}
    <div class="bts-summary-grid">
      <article class="bts-summary-card bts-summary-risk"><strong>${state.outages.length ? String(riskCount).padStart(2, '0') : '—'}</strong><span>Trạm có nguy cơ ảnh hưởng</span></article>
      <article class="bts-summary-card bts-summary-review"><strong>${state.outages.length ? String(reviewCount).padStart(2, '0') : '—'}</strong><span>Trạm cần xác minh</span></article>
    </div>
    <div class="bts-list-heading"><h3>Lịch ngừng điện sắp tới</h3><span><b id="bts-outage-count">0 lịch</b> · ${updated ? `Cập nhật ${esc(localDate(updated))}` : 'Chưa có lần cập nhật thành công'}</span></div>
    <div class="bts-outage-filters">
      <select id="bts-outage-date" aria-label="Lọc theo ngày"><option value="">Tất cả ngày</option>${days.map(day => `<option value="${esc(day)}">${new Date(`${day}T00:00:00+07:00`).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</option>`).join('')}</select>
      <select id="bts-outage-ward" aria-label="Lọc theo phường xã"><option value="">Tất cả phường/xã</option>${wards.map(ward => `<option value="${esc(ward)}">${esc(ward)}</option>`).join('')}</select>
      <input id="bts-outage-station" aria-label="Lọc theo tên trạm" placeholder="Tên trạm BTS">
      <input id="bts-outage-street" aria-label="Lọc theo tuyến đường" placeholder="Tuyến đường">
    </div>
    <div class="bts-outage-list" id="bts-outage-list"></div>
    ${state.outages.length
      ? `<div class="bts-safe-note"><span class="bts-status bts-status-safe">Chưa phát hiện lịch ảnh hưởng</span><span>${safeCount} trạm đủ địa chỉ chưa có lịch khớp; ${unknownCount} trạm thiếu địa chỉ để đối chiếu chắc chắn.</span></div>`
      : '<div class="bts-safe-note"><span class="bts-status bts-status-unknown">Chưa có dữ liệu</span><span>Chưa thể xác định trạm an toàn nếu chưa có lịch nguồn.</span></div>'}
    <footer class="bts-outage-footer">Nguồn dữ liệu: ${state.summary.lastDataUpdateAt ? 'đã nhập vào hệ thống' : 'chưa có lịch được nhập'} · Kiểm tra đồng bộ gần nhất: ${state.summary.lastCheckedAt ? esc(localDate(state.summary.lastCheckedAt)) : 'Chưa kiểm tra'}. Kết quả đối chiếu cần nhân viên xác minh.</footer>
  </section>`;
}

function renderMap() {
  const mapped = state.stations.filter(station => station.latitude != null && station.longitude != null);
  return `${pageHeading('Bản đồ trạm BTS', `${mapped.length}/${state.stations.length} trạm có tọa độ GPS. Lớp bản đồ nền sử dụng OpenStreetMap.`, '')}
    <section class="panel"><div class="panel-heading"><div><h3>Vị trí trạm</h3><p class="subtle">Màu cam/đỏ chỉ trạng thái đối chiếu, không phải dữ liệu đo điện thực tế</p></div><span class="table-summary">${mapped.length} điểm</span></div><div id="station-map"></div><div class="map-legend"><span><i class="legend-dot" style="background:#4be0ab"></i>Chưa có lịch khớp</span><span><i class="legend-dot" style="background:#ffad66"></i>Khớp khu vực / cần xác minh</span><span><i class="legend-dot" style="background:#ff7278"></i>Đã xác nhận</span></div></section>`;
}

function renderHistory() {
  const rows = state.history.map(item => `<div class="history-row"><span class="history-time">${localDate(item.created_at)}</span><b class="${item.status === 'success' ? 'status-success' : 'status-error'}">${item.status === 'success' ? 'Thành công' : 'Lỗi'}</b><span class="history-message">${esc(item.message)}</span></div>`).join('');
  return `${pageHeading('Lịch sử cập nhật', 'Nhật ký nhập trạm, cập nhật lịch và kết quả đồng bộ.', `<button class="button button-secondary" data-action="refresh">↻&nbsp; Kiểm tra nguồn</button>`)}
    <section class="panel"><div class="panel-heading"><div><h3>Hoạt động gần đây</h3><p class="subtle">Tối đa 200 sự kiện mới nhất</p></div><span class="table-summary">${state.history.length} sự kiện</span></div><div class="history-list">${rows || '<div class="empty-state">Chưa ghi nhận hoạt động.</div>'}</div></section>`;
}

function renderData() {
  const summary = state.summary;
  const statusText = summary.sourceError
    ? `Lần tra cứu gần nhất bị lỗi: ${summary.sourceError}`
    : summary.automaticSourceConnected
      ? 'Đã cấu hình URL API EVNSPC; chưa có lần đồng bộ thành công được ghi nhận.'
      : 'Chưa kết nối nguồn dữ liệu tự động';
  return `${pageHeading('Quản lý dữ liệu', 'Nhập danh sách BTS và lịch ngừng cung cấp điện; dữ liệu được lưu bền vững trong SQLite.', '')}
    <div class="data-grid">
      <article class="source-card"><span class="badge badge-safe">DANH SÁCH BTS</span><h3>Nhập hoặc cập nhật danh mục trạm</h3><p>Hỗ trợ .xlsx (ExcelJS) và .csv. Dùng mã trạm để cập nhật bản ghi hiện có; trạm không có trong tệp không bị xóa. Nhận diện các cột <code>ten_csht</code>, <code>Ten gợi nhớ</code>, <code>latitude</code>, <code>longitude</code> trong workbook BTS_BH.</p><p><b>${state.stations.length}</b> trạm đang lưu.</p><button class="button button-primary" data-action="import-stations">Chọn Excel/CSV</button></article>
      <article class="source-card"><span class="badge badge-area">LỊCH CÚP ĐIỆN</span><h3>Nhập lịch nguồn điện</h3><p>Không cần API để lưu lịch: nhập từng lịch theo thông báo chính thức hoặc tải file Excel/CSV. Giữ nguyên phạm vi gốc để nhân viên xác minh; nhập thủ công chỉ thêm/cập nhật lịch đó, không tự hủy lịch khác.</p><p>${state.outages.length} lịch hiện có trong 7 ngày.</p><button class="button button-primary" data-action="add-outage">Nhập lịch thủ công</button><button class="button button-secondary" data-action="import-outages">Chọn file lịch</button></article>
      <article class="source-card"><span class="badge ${summary.sourceError ? 'badge-muted' : summary.automaticSourceConnected ? 'badge-area' : 'badge-muted'}">${summary.sourceError ? 'LỖI LẦN ĐỒNG BỘ TRƯỚC' : summary.automaticSourceConnected ? 'ĐÃ CẤU HÌNH API' : 'CHƯA KẾT NỐI TỰ ĐỘNG'}</span><h3>Nguồn chính thức / đồng bộ tự động</h3><p>${esc(statusText)}</p><a class="source-url" href="https://cskh.evnspc.vn/TraCuu/LichNgungGiamCungCapDien" target="_blank" rel="noopener noreferrer">Trang tra cứu EVNSPC ↗</a><a class="source-url" href="https://pcdongnai.evnspc.vn/" target="_blank" rel="noopener noreferrer">Công ty Điện lực Đồng Nai ↗</a><p>Kiểm tra gần nhất: ${summary.lastCheckedAt ? localDate(summary.lastCheckedAt) : 'Chưa kiểm tra'}<br>Đồng bộ EVNSPC thành công: ${summary.lastSuccessAt ? localDate(summary.lastSuccessAt) : 'Chưa có'}<br>Cập nhật dữ liệu: ${summary.lastDataUpdateAt ? localDate(summary.lastDataUpdateAt) : 'Chưa có'}</p><button class="button button-secondary" data-action="refresh">↻&nbsp; Đồng bộ dữ liệu</button></article>
      <article class="source-card"><span class="badge badge-muted">MẪU DỮ LIỆU</span><h3>Cấu trúc tệp lịch</h3><p>Tiêu đề gợi ý: <code>Địa điểm</code>, <code>Ngày cúp điện</code>, <code>Giờ bắt đầu</code>, <code>Giờ kết thúc</code>, <code>Phạm vi ảnh hưởng</code>, <code>Phường/xã</code>, <code>Đường bị ảnh hưởng</code>, <code>Đơn vị điện lực</code>, <code>Lý do</code>. Hỗ trợ ngày DD/MM/YYYY và ISO; giờ HH:mm.</p><a class="button button-muted" href="/api/templates/outages.xlsx" download>Tải mẫu Excel</a></article>
    </div>
    <div class="inline-alert info" style="margin-top:15px"><span>ⓘ</span><div>Đồng bộ tự động chỉ hoạt động với API JSON EVNSPC được cấp phép, cấu hình bằng <code>EVNSPC_PUBLIC_API_URL</code>. Nếu chưa có API, hãy nhập lịch thật từ file; lỗi đồng bộ không xóa dữ liệu cũ.</div></div>`;
}

function renderPage() {
  const renderer = {
    overview: renderOverview, stations: renderStations, btsOutages: renderBtsOutages, outages: renderOutages,
    affected: renderAffected, map: renderMap, history: renderHistory, data: renderData
  }[state.page] || renderOverview;
  $('#page-content').innerHTML = renderer();
  if (state.page === 'map') initializeMap();
  if (state.page === 'btsOutages') updateBtsOutageList();
}

function initializeMap() {
  const mapElement = $('#station-map');
  if (!mapElement) return;
  if (!window.L) {
    mapElement.innerHTML = '<div class="empty-state">Không tải được thư viện bản đồ. Kiểm tra kết nối Internet.</div>';
    return;
  }
  const mapped = state.stations.filter(station => station.latitude != null && station.longitude != null);
  const center = mapped.length ? [Number(mapped[0].latitude), Number(mapped[0].longitude)] : [10.95, 106.85];
  state.map?.remove();
  const map = L.map(mapElement).setView(center, mapped.length ? 11 : 9);
  state.map = map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  const bounds = [];
  mapped.forEach(station => {
    const matches = state.matches.filter(item => item.station.code === station.code);
    const status = matches.some(item => item.status === 'confirmed') ? 'confirmed' :
      matches.some(item => item.status === 'area') ? 'area' :
      matches.some(item => item.status === 'needs_review') ? 'needs_review' : '';
    const color = status === 'confirmed' ? '#ff7278' : status ? '#ffad66' : '#4be0ab';
    const marker = L.circleMarker([Number(station.latitude), Number(station.longitude)], {
      radius: 6, color, fillColor: color, fillOpacity: .8, weight: 1.5
    }).addTo(map);
    const popup = document.createElement('div');
    const title = document.createElement('b');
    title.textContent = `${station.code} · ${station.name}`;
    const info = document.createElement('div');
    info.textContent = [station.ward, station.street, station.address].filter(Boolean).join(', ') || 'Chưa có địa chỉ chi tiết';
    popup.append(title, info);
    marker.bindPopup(popup);
    bounds.push([Number(station.latitude), Number(station.longitude)]);
  });
  if (bounds.length > 1) map.fitBounds(bounds, { padding: [20, 20] });
  setTimeout(() => map.invalidateSize(), 50);
}

function updateStationTable() {
  const query = ($('#station-search')?.value || '').toLocaleLowerCase('vi');
  const ward = $('#station-ward-filter')?.value || '';
  const filtered = state.stations.filter(station => (!ward || station.ward === ward) &&
    [station.code, station.customer_code, station.name, station.address, station.street, station.ward].some(value => String(value || '').toLocaleLowerCase('vi').includes(query)));
  $('#station-rows').innerHTML = stationRows(filtered) || '<tr><td colspan="8" class="empty-state">Không tìm thấy trạm phù hợp.</td></tr>';
  $('#station-count').textContent = `${filtered.length} / ${state.stations.length} trạm`;
}

function updateOutageTable() {
  const date = $('#outage-date')?.value || '';
  const ward = $('#outage-ward')?.value || '';
  const code = ($('#outage-code')?.value || '').trim().toLowerCase();
  const filtered = state.outages.filter(outage => inSelectedPeriod(outage) && (!date || outage.start_at.slice(0, 10) === date) && (!ward || outage.ward === ward) &&
    (!code || state.matches.some(item => item.outage.id === outage.id &&
      [item.station.code, item.station.customer_code].some(value => String(value || '').toLowerCase().includes(code)))));
  $('#outage-rows').innerHTML = outageTableRows(filtered, state.matches) || '<tr><td colspan="9" class="empty-state">Không có lịch phù hợp.</td></tr>';
  $('#outage-count').textContent = `${filtered.length} dòng`;
}

function updateAffectedTable() {
  const status = $('#match-filter')?.value || '';
  const ward = $('#affected-ward')?.value || '';
  const code = ($('#affected-code')?.value || '').trim().toLowerCase();
  const filtered = state.matches.filter(item => inSelectedPeriod(item.outage) && (!status || item.status === status) && (!ward || item.station.ward === ward) &&
    (!code || [item.station.code, item.station.customer_code].some(value => String(value || '').toLowerCase().includes(code))));
  const rows = filtered.map(item => `<tr><td class="code">${esc(item.station.code)}</td><td class="cell-primary">${esc(item.station.name)}</td><td>${esc(item.station.ward || item.outage.ward || '—')}</td><td title="${esc(item.outage.affected_scope)}">${esc(item.outage.street || item.outage.affected_scope)}</td><td class="nowrap">${localDay(item.outage.start_at)}<span class="cell-secondary">${timeOnly(item.outage.start_at)}–${timeOnly(item.outage.end_at)}</span></td><td>${reviewedMatchBadge(item)}<span class="cell-secondary">${esc(item.reason)}</span><div class="bts-review-actions"><button class="button button-muted button-small" data-action="review-match" data-outage-id="${item.outage.id}" data-station-code="${esc(item.station.code)}" data-review="confirmed">Xác nhận ảnh hưởng</button><button class="button button-muted button-small" data-action="review-match" data-outage-id="${item.outage.id}" data-station-code="${esc(item.station.code)}" data-review="not_affected">Xác nhận không ảnh hưởng</button></div></td><td>${esc(item.outage.source)}</td></tr>`).join('');
  $('#affected-rows').innerHTML = rows || '<tr><td colspan="7" class="empty-state">Chưa có trạm nào đủ thông tin để ghép với lịch hiện tại.</td></tr>';
  $('#affected-count').textContent = `${filtered.length} kết quả`;
}

function openStationDialog(station = null) {
  const form = $('#station-form');
  form.reset();
  form.elements.code.disabled = Boolean(station);
  $('#station-dialog-title').textContent = station ? 'Cập nhật trạm BTS' : 'Thêm trạm BTS';
  if (station) Object.entries(station).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value ?? '';
  });
  else form.elements.province.value = 'Đồng Nai';
  $('#station-dialog').showModal();
}

function openOutageDialog() {
  const form = $('#outage-form');
  form.reset();
  form.elements.date.value = vietnamDateKey(new Date());
  $('#outage-dialog').showModal();
}

async function importFile(kind) {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.xlsx,.csv';
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      if (kind === 'outages') {
        const preview = await api(`/api/import/outages/preview?filename=${encodeURIComponent(file.name)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file
        });
        state.pendingOutageImport = preview.records;
        const visibleRecords = preview.records.slice(0, 100);
        $('#import-preview-content').innerHTML = `
          <p>${preview.records.length} dòng hợp lệ, ${preview.invalid.length} dòng lỗi. Chưa có dữ liệu nào được ghi.</p>
          ${preview.records.length ? `<div class="table-wrap preview-table"><table><thead><tr><th>Ngày / giờ</th><th>Địa điểm / phạm vi</th><th>Đường</th><th>Phường/xã</th><th>Điện lực</th><th>Lý do</th></tr></thead><tbody>${visibleRecords.map(item => `<tr><td>${esc(localDay(item.start_at))}<span class="cell-secondary">${esc(timeOnly(item.start_at))}–${esc(timeOnly(item.end_at))}</span></td><td>${esc(item.affected_scope)}</td><td>${esc(item.street || '—')}</td><td>${esc(item.ward || '—')}</td><td>${esc(item.utility_unit || '—')}</td><td>${esc(item.cause || '—')}</td></tr>`).join('')}</tbody></table></div>${preview.records.length > visibleRecords.length ? `<p class="subtle">Hiển thị 100/${preview.records.length} dòng hợp lệ; xác nhận sẽ nhập toàn bộ.</p>` : ''}` : ''}
          ${preview.invalid.length ? `<h3>Dòng cần sửa</h3><ul>${preview.invalid.slice(0, 100).map(item => `<li>Dòng ${item.row}: ${esc(item.message)}</li>`).join('')}${preview.invalid.length > 100 ? `<li>... và ${preview.invalid.length - 100} dòng lỗi khác.</li>` : ''}</ul>` : ''}`;
        $('#confirm-outage-import').disabled = !preview.records.length;
        $('#import-preview-dialog').showModal();
        return;
      }
      const result = await api(`/api/import/${kind}?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file
      });
      await loadData();
      renderPage();
      toast(`Đã nhập/cập nhật ${result.count} trạm.`);
    } catch (error) {
      toast(error.message, true);
    }
  }, { once: true });
  picker.click();
}

function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function refreshNow(period = '') {
  if (period === 'today' || period === 'week') {
    state.outagePeriod = period;
    const dateFilter = $('#outage-date');
    if (dateFilter) dateFilter.value = '';
  }
  toast(period ? `Đang cập nhật nguồn lịch cho ${period === 'today' ? 'hôm nay' : 'tuần này'}...` : 'Đang kiểm tra nguồn lịch...');
  try {
    const result = await api('/api/refresh', { method: 'POST' });
    await loadData();
    renderPage();
    toast(`Đã cập nhật ${result.count} lịch (${result.added} mới, ${result.changed} thay đổi, ${result.cancelled} hủy).`);
  } catch (error) {
    let message = error.message;
    try {
      await loadData();
    } catch (loadError) {
      message += ` Không tải lại được trạng thái: ${loadError.message}`;
    }
    renderPage();
    toast(message, true);
  }
}

async function confirmOutageImport() {
  if (!state.pendingOutageImport.length) return;
  try {
    const result = await api('/api/import/outages/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: state.pendingOutageImport })
    });
    $('#import-preview-dialog').close();
    state.pendingOutageImport = [];
    await loadData();
    renderPage();
    toast(`Đã nhập ${result.count} lịch (${result.added} mới, ${result.changed} thay đổi).`);
  } catch (error) {
    toast(error.message, true);
  }
}

function toggleAlerts() {
  const drawer = $('#alert-drawer');
  if (!drawer.hidden) {
    drawer.hidden = true;
    return;
  }
  drawer.innerHTML = `<div class="alert-title">Cảnh báo (${state.alerts.filter(alert => !alert.read_at).length} chưa đọc)</div>${state.alerts.length ? state.alerts.map(alert => `<div class="alert-item" data-alert-id="${alert.id}">${esc(alert.message)}<time>${localDate(alert.created_at)}</time></div>`).join('') : '<div class="alert-item">Chưa có cảnh báo.</div>'}`;
  drawer.hidden = false;
}

document.addEventListener('click', async event => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) {
    event.preventDefault();
    switchPage(pageButton.dataset.page);
    return;
  }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const { action, code } = actionButton.dataset;
    if (action === 'add-station') openStationDialog();
    if (action === 'edit-station') openStationDialog(state.stations.find(item => item.code === code));
    if (action === 'delete-station' && confirm(`Xóa trạm ${code}?`)) {
      try {
        await api(`/api/stations/${encodeURIComponent(code)}`, { method: 'DELETE' });
        await loadData(); renderPage(); toast(`Đã xóa trạm ${code}.`);
      } catch (error) { toast(error.message, true); }
    }
    if (action === 'import-stations') importFile('stations');
    if (action === 'import-outages') importFile('outages');
    if (action === 'refresh') refreshNow();
    if (action === 'show-period') {
      state.outagePeriod = actionButton.dataset.period;
      const dateFilter = $('#outage-date');
      if (dateFilter) dateFilter.value = '';
      renderPage();
    }
    if (action === 'add-outage') openOutageDialog();
    if (action === 'confirm-outage-import') await confirmOutageImport();
    if (action === 'review-match') {
      try {
        await api(`/api/matches/${encodeURIComponent(actionButton.dataset.outageId)}/${encodeURIComponent(actionButton.dataset.stationCode)}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: actionButton.dataset.review })
        });
        await loadData();
        renderPage();
        toast(actionButton.dataset.review === 'confirmed'
          ? 'Đã lưu xác minh: có ảnh hưởng.'
          : 'Đã lưu xác minh: không bị ảnh hưởng.');
      } catch (error) { toast(error.message, true); }
    }
    if (action === 'copy-customer') {
      try {
        await navigator.clipboard.writeText(actionButton.dataset.customerCode);
        toast('Đã sao chép mã khách hàng. Dán mã vào trang tra cứu EVNSPC.');
      } catch {
        toast('Không sao chép được mã. Hãy sao chép trực tiếp từ cột Mã KH.', true);
      }
    }
    if (action === 'export-stations') downloadCsv('danh-sach-bts.csv',
      ['Mã trạm BTS', 'Tên trạm BTS', 'Mã khách hàng', 'Tỉnh/thành phố', 'Phường/xã', 'Tên đường', 'Địa chỉ chi tiết', 'Đơn vị quản lý', 'Ghi chú', 'Vĩ độ', 'Kinh độ'],
      state.stations.map(item => [item.code, item.name, item.customer_code, item.province, item.ward, item.street, item.address, item.management_unit, item.notes, item.latitude, item.longitude]));
    return;
  }
  const closeDialog = event.target.closest('[data-close-dialog]');
  if (closeDialog) closeDialog.closest('dialog').close();
  const alertItem = event.target.closest('[data-alert-id]');
  if (alertItem) {
    try {
      await api(`/api/alerts/${alertItem.dataset.alertId}/read`, { method: 'POST' });
      await loadData(); toggleAlerts();
    } catch (error) { toast(error.message, true); }
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'station-search') updateStationTable();
  if (event.target.id === 'outage-code') updateOutageTable();
  if (event.target.id === 'affected-code') updateAffectedTable();
  if (['bts-outage-station', 'bts-outage-street'].includes(event.target.id)) updateBtsOutageList();
});
document.addEventListener('change', event => {
  if (event.target.id === 'station-ward-filter') updateStationTable();
  if (['outage-date', 'outage-ward'].includes(event.target.id)) updateOutageTable();
  if (['match-filter', 'affected-ward'].includes(event.target.id)) updateAffectedTable();
  if (['bts-outage-date', 'bts-outage-ward'].includes(event.target.id)) updateBtsOutageList();
});
$('#alerts-button').addEventListener('click', toggleAlerts);
$('#station-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const isEdit = form.elements.code.disabled;
  try {
    await api(isEdit ? `/api/stations/${encodeURIComponent(form.elements.code.value)}` : '/api/stations', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values)
    });
    $('#station-dialog').close();
    await loadData(); renderPage(); toast(isEdit ? 'Đã cập nhật trạm.' : 'Đã thêm trạm.');
  } catch (error) { toast(error.message, true); }
});

$('#outage-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const result = await api('/api/outages/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values)
    });
    $('#outage-dialog').close();
    await loadData();
    renderPage();
    toast(`Đã lưu lịch (${result.added} mới, ${result.changed} cập nhật).`);
  } catch (error) { toast(error.message, true); }
});

loadData().then(renderPage).catch(error => {
  $('#sidebar-state').textContent = 'Không kết nối được máy chủ';
  $('#page-content').innerHTML = `<div class="inline-alert error"><span>!</span><div>Không tải được dữ liệu: ${esc(error.message)}. Hãy kiểm tra Backend có đang chạy không.</div></div>`;
});
