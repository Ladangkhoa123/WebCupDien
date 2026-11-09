function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsPhrase(haystack, needle) {
  const text = normalize(haystack);
  const phrase = normalize(needle);
  return Boolean(phrase && (` ${text} `).includes(` ${phrase} `));
}

function classifyMatch(station, outage) {
  const scope = outage.affected_scope || '';
  const code = String(station.code || '').trim();
  const codeMatch = code && new RegExp(`(^|[^a-z0-9])${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(scope);
  if (codeMatch) {
    return { status: 'confirmed', reason: `Phạm vi ghi rõ mã trạm ${code}.` };
  }

  const outageWard = outage.ward || (station.ward && containsPhrase(scope, station.ward) ? station.ward : '');
  const outageStreet = outage.street || '';
  const sameWard = Boolean(station.ward && outageWard && normalize(station.ward) === normalize(outageWard));
  const sameStreet = Boolean(station.street && outageStreet && normalize(station.street) === normalize(outageStreet));
  const scopeHasStreet = Boolean(station.street && containsPhrase(scope, station.street));

  if (station.ward && outageWard && normalize(station.ward) !== normalize(outageWard)) {
    return { status: 'not_affected', reason: 'Phường/xã được ghi trong thông báo khác với địa chỉ trạm.' };
  }
  if (sameWard && (sameStreet || scopeHasStreet)) {
    return { status: 'area', reason: 'Trùng phường/xã và tuyến đường; chưa đủ căn cứ xác nhận chính xác vị trí trạm.' };
  }
  if (sameWard || (station.street && scopeHasStreet)) {
    return { status: 'needs_review', reason: 'Có thông tin địa bàn trùng khớp nhưng phạm vi chi tiết chưa đủ để kết luận.' };
  }

  const stationLabel = station.name || '';
  if (stationLabel && containsPhrase(scope, stationLabel)) {
    return { status: 'needs_review', reason: 'Thông báo có nhắc tên gợi nhớ của trạm; cần nhân viên xác minh.' };
  }

  return null;
}

module.exports = { classifyMatch, normalize };
