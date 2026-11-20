// VICO Production Reporting System - Pure helpers (dùng chung cho trình duyệt và test Node)
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.VicoUtils = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  // Luôn dùng khi chèn dữ liệu người dùng vào innerHTML / thuộc tính HTML
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // YYYY-MM-DD theo giờ của máy (không dùng toISOString vì đó là giờ UTC)
  function toLocalDateStr(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function yesterdayStr(now) {
    return toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  }

  // Ca 3 (22h - 6h) tính theo ngày bắt đầu ca: chọn Ca 3 vào buổi sáng với ngày hôm nay
  // thì gợi ý chuyển sang ngày hôm qua.
  function ca3SuggestedDate(now, selectedDate) {
    if (now.getHours() < 12 && selectedDate === toLocalDateStr(now)) {
      return yesterdayStr(now);
    }
    return null;
  }

  function parseIntOr(value, fallback) {
    const text = String(value === null || value === undefined ? '' : value).trim();
    const n = parseInt(text, 10);
    return Number.isNaN(n) ? fallback : n;
  }

  function parseFloatOr(value, fallback) {
    const text = String(value === null || value === undefined ? '' : value).trim();
    const n = parseFloat(text);
    return Number.isNaN(n) ? fallback : n;
  }

  // Giống quy tắc phía máy chủ: chỉ lưu dòng có số liệu > 0 hoặc có ghi chú
  function rowHasContent(numbers, notes) {
    return numbers.some(n => parseFloatOr(n, 0) > 0) || String(notes || '').trim().length > 0;
  }

  const ATTENDANCE_DEFAULTS = { staff_total: 5, staff_present: 5, leave_permitted: 0, leave_rotating: 0, leave_unpermitted: 0 };

  function draftHasContent(draft) {
    if (!draft) return false;
    const packaging = (draft.packaging || []).some(p => rowHasContent([p.weight_sorted, p.weight_waste], p.notes));
    const baskets = (draft.baskets || []).some(b => rowHasContent([b.basket_count, b.total_weight, b.basket_from, b.basket_to, b.from_val, b.to_val], b.notes));
    const tumbling = (draft.tumbling || []).some(t => rowHasContent([t.m1, t.m2, t.total_weight], t.notes));
    const texts = String(draft.issues || '').trim() || String(draft.suggestions || '').trim();
    // Chấm công khác mặc định / có tên người nghỉ / bỏ tích an toàn cũng là dữ liệu cần giữ
    const attendance = Object.keys(ATTENDANCE_DEFAULTS).some(key =>
      draft[key] !== undefined && parseIntOr(draft[key], ATTENDANCE_DEFAULTS[key]) !== ATTENDANCE_DEFAULTS[key]);
    const names = String(draft.leave_permitted_names || '').trim() ||
                  String(draft.leave_rotating_names || '').trim() ||
                  String(draft.leave_unpermitted_names || '').trim();
    const safety = draft.safety_production === false || draft.safety_ppe === false || draft.safety_equip === false;
    return packaging || baskets || tumbling || Boolean(texts) || attendance || Boolean(names) || safety;
  }

  function sameFormContent(a, b) {
    if (!a || !b) return false;
    const strip = obj => JSON.stringify({ ...obj, saved_at: undefined });
    return strip(a) === strip(b);
  }

  /**
   * Quyết định làm gì với nội dung form khi người dùng đổi ngày/ca.
   * formSource: 'blank' | 'user' (đang gõ báo cáo mới) | 'draft' (nháp đã phục hồi) | 'server' (nạp từ báo cáo đã nộp)
   * Trả về: 'load-server' | 'restore-draft' | 'clear' | 'keep'
   */
  function decideFormAction({ exists, canEdit, hasDraft, formSource }) {
    if (exists && canEdit) return 'load-server';
    if (!exists && hasDraft) return 'restore-draft';
    // Số liệu của một báo cáo đã nộp không được "mang sang" ca khác -> tránh nộp trùng
    return formSource === 'server' ? 'clear' : 'keep';
  }

  /**
   * Nút gửi báo cáo chỉ được bấm khi lần kiểm tra trạng thái ca gần nhất THÀNH CÔNG và đúng với
   * ngày/ca đang chọn, nội dung form cũng thuộc ngày/ca đó, và không có yêu cầu lưu đang chạy.
   * status: { phase: 'checking' | 'ready' | 'error', date, shift, exists, canEdit }
   * Trả về { mode: 'saving'|'checking'|'error'|'locked'|'update'|'new', canSubmit, expectedMode }
   */
  function submitState({ saving, status, current, active }) {
    const result = (mode, expectedMode = null) => ({ mode, canSubmit: expectedMode !== null, expectedMode });
    if (saving) return result('saving');
    const matches = Boolean(status && current && status.date === current.date &&
      String(status.shift) === String(current.shift));
    if (!matches || status.phase === 'checking') return result('checking');
    if (status.phase !== 'ready') return result('error');
    if (status.exists && !status.canEdit) return result('locked');
    const contentMatches = Boolean(active && active.date === current.date && String(active.shift) === String(current.shift));
    if (!contentMatches) return result('checking');
    return status.exists ? result('update', 'update') : result('new', 'create');
  }

  function submitButtonView(mode, leaderName) {
    switch (mode) {
      case 'saving':
        return { disabled: true, text: 'Đang Lưu...', subtext: '(Vui lòng đợi)' };
      case 'checking':
        return { disabled: true, text: 'ĐANG KIỂM TRA...', subtext: '(Đang kiểm tra trạng thái ca)' };
      case 'error':
        return { disabled: true, text: 'CHƯA KIỂM TRA ĐƯỢC CA', subtext: '(Bấm "Thử lại" ở khung thông báo phía trên)' };
      case 'locked':
        return { disabled: true, text: 'KHÔNG CÓ QUYỀN SỬA', subtext: `(Đã nộp bởi ${leaderName || 'ca trưởng khác'})` };
      case 'update':
        return { disabled: false, text: 'CẬP NHẬT BÁO CÁO CA', subtext: '(Lưu các thay đổi mới)' };
      default:
        return { disabled: false, text: 'GỬI BÁO CÁO CA', subtext: '(Lưu và tự động tổng hợp)' };
    }
  }

  function normKey(value) {
    return String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  }

  /**
   * Sao chép danh mục từ ca trước mà không làm mất số liệu đang nhập:
   * giữ các dòng đã có dữ liệu, bỏ các dòng trống, thêm các dòng mẫu chưa có (chỉ lấy keyFields).
   * existing: [{...keyFields, hasContent}] -> { keep: [chỉ số dòng giữ lại], add: [dòng mẫu cần thêm] }
   */
  function planTemplateMerge(existing, template, keyFields) {
    const rows = existing || [];
    if (!template || template.length === 0) {
      return { keep: rows.map((_, i) => i), add: [] };
    }
    const keyOf = row => JSON.stringify(keyFields.map(f => normKey(row[f])));
    const keep = [];
    const seen = new Set();
    rows.forEach((row, i) => {
      if (row.hasContent) {
        keep.push(i);
        seen.add(keyOf(row));
      }
    });
    const add = [];
    template.forEach(row => {
      const key = keyOf(row);
      if (seen.has(key)) return;
      seen.add(key);
      const copy = {};
      keyFields.forEach(f => { copy[f] = row[f] === null || row[f] === undefined ? '' : row[f]; });
      add.push(copy);
    });
    return { keep, add };
  }

  const KG_PER_BASKET = 350;

  // Khối lượng giỏ khác "số giỏ x 350" nghĩa là người dùng đã tự nhập -> không tự tính đè lên
  function basketWeightIsManual(count, weight) {
    const w = parseFloatOr(weight, null);
    if (w === null) return false;
    const expected = parseFloatOr(count, 0) * KG_PER_BASKET;
    return Math.abs(w - expected) > 1e-6;
  }

  function formatQuantity(value, locale) {
    const n = Number(value);
    if (value === null || value === undefined || !Number.isFinite(n)) return '0';
    const rounded = Math.round(n * 100) / 100;
    return (rounded === 0 ? 0 : rounded).toLocaleString(locale, { maximumFractionDigits: 2 });
  }

  function absentCount(total, present) {
    return Math.max(0, (Number(total) || 0) - (Number(present) || 0));
  }

  // Cùng quy tắc với máy chủ (ShiftReportModel.check_attendance)
  function attendanceProblem({ staffTotal, staffPresent, leavePermitted, leaveRotating, leaveUnpermitted }) {
    if (staffPresent > staffTotal) {
      return {
        field: 'staffPresent',
        message: `Số người có mặt (${staffPresent}) không được lớn hơn tổng sĩ số (${staffTotal})`
      };
    }
    const onLeave = (leavePermitted || 0) + (leaveRotating || 0) + (leaveUnpermitted || 0);
    if (onLeave > staffTotal) {
      return {
        field: 'leavePermitted',
        message: `Tổng số người nghỉ (có phép + luân phiên + không phép = ${onLeave}) không được lớn hơn tổng sĩ số (${staffTotal})`
      };
    }
    return null;
  }

  /**
   * Trang để mở qua đêm: nếu form chưa nhập gì và đang để ngày "hôm nay" cũ thì chuyển sang ngày mới.
   * Ca 3 buổi sáng vẫn thuộc ngày bắt đầu ca nên giữ nguyên. Trả về ngày mới hoặc null.
   */
  function rolloverReportDate({ reportDate, previousToday, now, formSource, shift }) {
    const newToday = toLocalDateStr(now);
    if (newToday === previousToday || formSource !== 'blank' || reportDate !== previousToday) return null;
    if (String(shift) === '3' && ca3SuggestedDate(now, newToday) === previousToday) return null;
    return newToday;
  }

  function parseJsonOrNull(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function friendlyHttpError(status, data) {
    if (data && typeof data.detail === 'string' && data.detail) return data.detail;
    if (!status) return 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.';
    if (status >= 500) {
      return `Máy chủ đang gặp sự cố hoặc tạm thời không phản hồi (mã lỗi ${status}). Vui lòng thử lại sau ít phút.`;
    }
    return `Yêu cầu không thành công (mã lỗi ${status}). Vui lòng thử lại.`;
  }

  const SECTION_LABELS = { packaging: 'Bao gói sản phẩm', baskets: 'Giỏ bi sau tôi', tumbling: 'Bi xóc' };

  function excelOverflowWarnings(summary) {
    const limits = (summary && summary.excel_row_limits) || {};
    const warnings = [];
    Object.keys(SECTION_LABELS).forEach(key => {
      const count = ((summary && summary[key]) || []).length;
      const limit = limits[key];
      if (limit && count > limit) {
        warnings.push(`${SECTION_LABELS[key]}: có ${count} dòng nhưng mẫu Excel chỉ có ${limit} dòng. ` +
          `Các dòng từ thứ ${limit} trở đi sẽ được gộp thành dòng "Khác" trong file Excel.`);
      }
    });
    return warnings;
  }

  function filenameFromContentDisposition(header, fallback) {
    if (!header) return fallback;
    const utf8 = /filename\*=(?:utf-8|UTF-8)''([^;]+)/.exec(header);
    if (utf8) {
      try {
        return decodeURIComponent(utf8[1].trim());
      } catch (e) {
        // bỏ qua, thử dạng thường
      }
    }
    const plain = /filename="?([^";]+)"?/.exec(header);
    return plain ? plain[1] : fallback;
  }

  return {
    escapeHtml,
    toLocalDateStr,
    yesterdayStr,
    ca3SuggestedDate,
    parseIntOr,
    parseFloatOr,
    rowHasContent,
    draftHasContent,
    decideFormAction,
    excelOverflowWarnings,
    filenameFromContentDisposition,
    sameFormContent,
    submitState,
    submitButtonView,
    planTemplateMerge,
    basketWeightIsManual,
    formatQuantity,
    absentCount,
    attendanceProblem,
    rolloverReportDate,
    parseJsonOrNull,
    friendlyHttpError
  };
});
