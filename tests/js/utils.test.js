// Chạy: TZ=Asia/Ho_Chi_Minh node --test tests/js/utils.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const U = require(path.join(__dirname, '..', '..', 'static', 'utils.js'));

// ---------- escapeHtml ----------
test('escapeHtml neutralizes HTML/attribute injection', () => {
  assert.equal(U.escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(U.escapeHtml("Bi 5' & 6\""), 'Bi 5&#39; &amp; 6&quot;');
});

test('escapeHtml handles null, undefined and numbers', () => {
  assert.equal(U.escapeHtml(null), '');
  assert.equal(U.escapeHtml(undefined), '');
  assert.equal(U.escapeHtml(0), '0');
  assert.equal(U.escapeHtml(1500.5), '1500.5');
});

// ---------- Ngày theo giờ địa phương ----------
test('toLocalDateStr uses local calendar date, not UTC (05:30 sáng giờ VN)', () => {
  const earlyMorning = new Date(2026, 8, 18, 5, 30); // 18/09/2026 05:30 giờ máy
  assert.equal(U.toLocalDateStr(earlyMorning), '2026-09-18');
});

test('yesterdayStr is the previous local day, including month boundaries', () => {
  assert.equal(U.yesterdayStr(new Date(2026, 8, 18, 5, 30)), '2026-09-17');
  assert.equal(U.yesterdayStr(new Date(2026, 9, 1, 1, 0)), '2026-09-30');
});

test('ca3SuggestedDate suggests the previous day for a morning Ca 3 on today', () => {
  const now = new Date(2026, 8, 18, 5, 30);
  assert.equal(U.ca3SuggestedDate(now, '2026-09-18'), '2026-09-17');
  assert.equal(U.ca3SuggestedDate(now, '2026-09-17'), null);
  assert.equal(U.ca3SuggestedDate(new Date(2026, 8, 18, 22, 10), '2026-09-18'), null);
});

// ---------- Đọc số từ ô nhập ----------
test('parseIntOr keeps 0 and only falls back for empty/invalid input', () => {
  assert.equal(U.parseIntOr('0', 5), 0);
  assert.equal(U.parseIntOr('', 5), 5);
  assert.equal(U.parseIntOr('  ', 5), 5);
  assert.equal(U.parseIntOr('abc', 5), 5);
  assert.equal(U.parseIntOr('12', 5), 12);
});

test('parseFloatOr keeps 0 and decimals', () => {
  assert.equal(U.parseFloatOr('0', 7), 0);
  assert.equal(U.parseFloatOr('12.5', 0), 12.5);
  assert.equal(U.parseFloatOr('', 0), 0);
});

// ---------- Dòng có nội dung ----------
test('rowHasContent ignores default product/customer with no numbers or notes', () => {
  assert.equal(U.rowHasContent([0, 0], ''), false);
  assert.equal(U.rowHasContent(['0', ''], '   '), false);
  assert.equal(U.rowHasContent([0, 5], ''), true);
  assert.equal(U.rowHasContent(['', '12.5'], ''), true);
  assert.equal(U.rowHasContent([0, 0], 'Xếp kho chờ nghiệm thu'), true);
});

test('draftHasContent detects real input only', () => {
  const blank = {
    packaging: [{ product_name: 'D25', customer: 'Molycop', weight_sorted: '', weight_waste: '0', notes: '' }],
    baskets: [{ basket_count: '', total_weight: '', notes: '' }],
    tumbling: [{ m1: '', m2: '', total_weight: '', notes: '' }],
    issues: '', suggestions: ''
  };
  assert.equal(U.draftHasContent(blank), false);
  assert.equal(U.draftHasContent({ ...blank, issues: 'Cầu 2 kêu to' }), true);
  assert.equal(U.draftHasContent({ ...blank, baskets: [{ basket_count: '3', total_weight: '', notes: '' }] }), true);
  assert.equal(U.draftHasContent(null), false);
});

// ---------- Quyết định xử lý form khi đổi ngày/ca ----------
test('switching to an editable existing report loads it from the server', () => {
  for (const formSource of ['blank', 'user', 'draft', 'server']) {
    assert.equal(U.decideFormAction({ exists: true, canEdit: true, hasDraft: false, formSource }), 'load-server');
  }
});

test('data loaded from another report is cleared when switching to a new shift', () => {
  assert.equal(U.decideFormAction({ exists: false, canEdit: false, hasDraft: false, formSource: 'server' }), 'clear');
  assert.equal(U.decideFormAction({ exists: true, canEdit: false, hasDraft: false, formSource: 'server' }), 'clear');
});

test('unsaved typing is kept when only the date/shift selection changes', () => {
  assert.equal(U.decideFormAction({ exists: false, canEdit: false, hasDraft: false, formSource: 'user' }), 'keep');
  assert.equal(U.decideFormAction({ exists: true, canEdit: false, hasDraft: false, formSource: 'user' }), 'keep');
  assert.equal(U.decideFormAction({ exists: false, canEdit: false, hasDraft: false, formSource: 'blank' }), 'keep');
});

test('a saved draft for the target shift is restored', () => {
  assert.equal(U.decideFormAction({ exists: false, canEdit: false, hasDraft: true, formSource: 'server' }), 'restore-draft');
  assert.equal(U.decideFormAction({ exists: false, canEdit: false, hasDraft: true, formSource: 'user' }), 'restore-draft');
});

// ---------- Cảnh báo Excel ----------
test('excelOverflowWarnings lists sections beyond the template row limits', () => {
  const summary = {
    packaging: new Array(6).fill({}),
    baskets: new Array(4).fill({}),
    tumbling: new Array(7).fill({}),
    excel_row_limits: { packaging: 4, baskets: 4, tumbling: 6 }
  };
  const warnings = U.excelOverflowWarnings(summary);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Bao gói.*6.*4/);
  assert.match(warnings[1], /Bi xóc.*7.*6/);
  assert.deepEqual(U.excelOverflowWarnings({ packaging: [] }), []);
});

// ---------- Tên file tải về ----------
test('filenameFromContentDisposition reads plain and UTF-8 filenames', () => {
  assert.equal(U.filenameFromContentDisposition('attachment; filename="BAO_CAO_TONG_HOP_20260917.xlsx"', 'x.xlsx'),
    'BAO_CAO_TONG_HOP_20260917.xlsx');
  assert.equal(U.filenameFromContentDisposition("attachment; filename*=utf-8''B%C3%81O_C%C3%81O.xlsx", 'x.xlsx'), 'BÁO_CÁO.xlsx');
  assert.equal(U.filenameFromContentDisposition(null, 'x.xlsx'), 'x.xlsx');
});

// ---------- F10: nháp chỉ có chấm công ----------
test('draftHasContent counts attendance changes and leave names', () => {
  const blank = {
    packaging: [], baskets: [], tumbling: [], issues: '', suggestions: '',
    staff_total: '5', staff_present: '5', leave_permitted: '0', leave_permitted_names: '',
    leave_unpermitted: '0', leave_unpermitted_names: '', safety_ppe: true, safety_equip: true
  };
  assert.equal(U.draftHasContent(blank), false);
  assert.equal(U.draftHasContent({ ...blank, staff_total: '' }), false);
  assert.equal(U.draftHasContent({ ...blank, staff_total: '7' }), true);
  assert.equal(U.draftHasContent({ ...blank, staff_present: '4' }), true);
  assert.equal(U.draftHasContent({ ...blank, leave_permitted: '1' }), true);
  assert.equal(U.draftHasContent({ ...blank, leave_unpermitted: '2' }), true);
  assert.equal(U.draftHasContent({ ...blank, leave_permitted_names: 'Hợi' }), true);
  assert.equal(U.draftHasContent({ ...blank, leave_unpermitted_names: '  Đồng ' }), true);
  assert.equal(U.draftHasContent({ ...blank, leave_unpermitted_names: '   ' }), false);
  assert.equal(U.draftHasContent({ ...blank, safety_ppe: false }), true);
  assert.equal(U.draftHasContent({ ...blank, safety_equip: false }), true);
});

// ---------- F1 / F8: chỉ cho gửi khi trạng thái ca đã kiểm tra khớp lựa chọn hiện tại ----------
const cur = { date: '2026-09-17', shift: '2' };
const ready = (extra) => ({ phase: 'ready', date: '2026-09-17', shift: '2', exists: false, canEdit: false, ...extra });

test('submitState: new report only after a matching successful status check', () => {
  assert.deepEqual(U.submitState({ saving: false, status: ready(), current: cur, active: cur }),
    { mode: 'new', canSubmit: true, expectedMode: 'create' });
  assert.deepEqual(U.submitState({ saving: false, status: ready({ exists: true, canEdit: true }), current: cur, active: cur }),
    { mode: 'update', canSubmit: true, expectedMode: 'update' });
  assert.deepEqual(U.submitState({ saving: false, status: ready({ exists: true, canEdit: false }), current: cur, active: { date: 'x', shift: '1' } }),
    { mode: 'locked', canSubmit: false, expectedMode: null });
});

test('submitState: refuses while checking, after errors, or when the check is for other inputs', () => {
  const allowed = (s) => U.submitState(s).canSubmit;
  assert.equal(U.submitState({ saving: false, status: { phase: 'checking', date: cur.date, shift: cur.shift }, current: cur, active: cur }).mode, 'checking');
  assert.equal(U.submitState({ saving: false, status: { phase: 'error', date: cur.date, shift: cur.shift }, current: cur, active: cur }).mode, 'error');
  assert.equal(allowed({ saving: false, status: { phase: 'error', date: cur.date, shift: cur.shift }, current: cur, active: cur }), false);
  // kết quả kiểm tra cũ của ngày/ca khác
  assert.equal(U.submitState({ saving: false, status: ready({ shift: '1' }), current: cur, active: cur }).mode, 'checking');
  assert.equal(allowed({ saving: false, status: ready({ date: '2026-09-16', exists: true, canEdit: true }), current: cur, active: cur }), false);
  // nội dung form còn thuộc lựa chọn cũ
  assert.equal(allowed({ saving: false, status: ready(), current: cur, active: { date: cur.date, shift: '1' } }), false);
  assert.equal(allowed({ saving: false, status: null, current: cur, active: cur }), false);
});

test('submitState: saving wins over everything', () => {
  assert.deepEqual(U.submitState({ saving: true, status: ready(), current: cur, active: cur }),
    { mode: 'saving', canSubmit: false, expectedMode: null });
});

test('submitButtonView: only new/update are enabled', () => {
  for (const mode of ['saving', 'checking', 'error', 'locked']) {
    assert.equal(U.submitButtonView(mode).disabled, true, mode);
  }
  assert.equal(U.submitButtonView('checking').text, 'ĐANG KIỂM TRA...');
  assert.equal(U.submitButtonView('new').disabled, false);
  assert.equal(U.submitButtonView('new').text, 'GỬI BÁO CÁO CA');
  assert.equal(U.submitButtonView('update').text, 'CẬP NHẬT BÁO CÁO CA');
  assert.match(U.submitButtonView('locked', 'Hải').subtext, /Hải/);
});

// ---------- F3 / F4: sao chép danh mục ca trước ----------
test('planTemplateMerge keeps rows with data, replaces empty rows, copies only key fields', () => {
  const existing = [
    { product_name: 'D25', customer: 'Molycop', hasContent: true },
    { product_name: 'D25', customer: 'Molycop', hasContent: false },
    { product_name: 'D60', customer: 'VICO', hasContent: true }
  ];
  const template = [
    { product_name: 'D40', customer: 'Nhập TQ', notes: 'ghi chú của người khác' },
    { product_name: 'd60 ', customer: 'vico', notes: '' },
    { product_name: 'D40', customer: 'Nhập TQ' }
  ];
  const plan = U.planTemplateMerge(existing, template, ['product_name', 'customer']);
  assert.deepEqual(plan.keep, [0, 2]);
  assert.deepEqual(plan.add, [{ product_name: 'D40', customer: 'Nhập TQ' }]);
});

test('planTemplateMerge leaves the section alone when the template is empty', () => {
  const existing = [{ product_name: 'D25', customer: 'Molycop', hasContent: false }];
  assert.deepEqual(U.planTemplateMerge(existing, [], ['product_name', 'customer']), { keep: [0], add: [] });
});

test('planTemplateMerge fills a blank form with the template', () => {
  const existing = [{ product_name: 'D25', customer: 'Molycop', steel_grade: 'CR18', hasContent: false }];
  const template = [{ product_name: 'D25', customer: 'Molycop', steel_grade: 'CR20', notes: 'x' }];
  assert.deepEqual(U.planTemplateMerge(existing, template, ['product_name', 'customer', 'steel_grade']),
    { keep: [], add: [{ product_name: 'D25', customer: 'Molycop', steel_grade: 'CR20' }] });
});

// ---------- F13: khối lượng giỏ nhập tay ----------
test('basketWeightIsManual detects weights that differ from count x 350', () => {
  assert.equal(U.basketWeightIsManual('4', '1400'), false);
  assert.equal(U.basketWeightIsManual(4, 1400), false);
  assert.equal(U.basketWeightIsManual('2.5', '875'), false);
  assert.equal(U.basketWeightIsManual('4', '1500'), true);
  assert.equal(U.basketWeightIsManual('', '1500'), true);
  assert.equal(U.basketWeightIsManual('4', ''), false);
  assert.equal(U.basketWeightIsManual('4', null), false);
  assert.equal(U.basketWeightIsManual(0, 0), false);
});

// ---------- F14 / F20: hiển thị số ----------
test('formatQuantity rounds float artifacts', () => {
  assert.equal(U.formatQuantity(3.3000000000000003, 'en-US'), '3.3');
  assert.equal(U.formatQuantity(0.1 + 0.2, 'en-US'), '0.3');
  assert.equal(U.formatQuantity(1234.5678, 'en-US'), '1,234.57');
  assert.equal(U.formatQuantity(null, 'en-US'), '0');
  assert.equal(U.formatQuantity('abc', 'en-US'), '0');
  assert.equal(U.formatQuantity(-0.0001, 'en-US'), '0');
});

test('absentCount never goes negative', () => {
  assert.equal(U.absentCount(5, 7), 0);
  assert.equal(U.absentCount(15, 12), 3);
  assert.equal(U.absentCount(undefined, 3), 0);
});

// ---------- F9 / #9: ràng buộc chấm công phía trình duyệt ----------
test('attendanceProblem mirrors server rules', () => {
  assert.equal(U.attendanceProblem({ staffTotal: 5, staffPresent: 5, leavePermitted: 0, leaveUnpermitted: 0 }), null);
  assert.equal(U.attendanceProblem({ staffTotal: 6, staffPresent: 4, leavePermitted: 1, leaveUnpermitted: 1 }), null);
  const present = U.attendanceProblem({ staffTotal: 5, staffPresent: 7, leavePermitted: 0, leaveUnpermitted: 0 });
  assert.equal(present.field, 'staffPresent');
  assert.match(present.message, /có mặt \(7\).*sĩ số \(5\)/i);
  const leave = U.attendanceProblem({ staffTotal: 5, staffPresent: 2, leavePermitted: 3, leaveUnpermitted: 3 });
  assert.equal(leave.field, 'leavePermitted');
  assert.match(leave.message, /nghỉ/i);
});

// ---------- F16: sang ngày mới khi trang còn mở ----------
test('rolloverReportDate moves an untouched form to the new day only', () => {
  const now = new Date(2026, 8, 18, 6, 5);
  const base = { reportDate: '2026-09-17', previousToday: '2026-09-17', now, formSource: 'blank', shift: '1' };
  assert.equal(U.rolloverReportDate(base), '2026-09-18');
  assert.equal(U.rolloverReportDate({ ...base, formSource: 'user' }), null);
  assert.equal(U.rolloverReportDate({ ...base, reportDate: '2026-09-10' }), null);
  assert.equal(U.rolloverReportDate({ ...base, previousToday: '2026-09-18' }), null);
  // Ca 3 buổi sáng thuộc ngày bắt đầu ca -> giữ ngày cũ
  assert.equal(U.rolloverReportDate({ ...base, shift: '3' }), null);
  assert.equal(U.rolloverReportDate({ ...base, shift: '3', now: new Date(2026, 8, 18, 13, 0) }), '2026-09-18');
});

// ---------- F17: lỗi không phải JSON ----------
test('friendlyHttpError uses the server detail or a Vietnamese fallback', () => {
  assert.equal(U.friendlyHttpError(401, { detail: 'Sai tên đăng nhập hoặc mật khẩu' }), 'Sai tên đăng nhập hoặc mật khẩu');
  assert.match(U.friendlyHttpError(502, null), /máy chủ.*502/i);
  assert.match(U.friendlyHttpError(0, null), /kết nối/i);
  assert.match(U.friendlyHttpError(404, { detail: ['x'] }), /404/);
  assert.doesNotMatch(U.friendlyHttpError(502, null), /Unexpected token/);
});

test('parseJsonOrNull tolerates HTML bodies', () => {
  assert.equal(U.parseJsonOrNull('<html>Bad Gateway</html>'), null);
  assert.equal(U.parseJsonOrNull(''), null);
  assert.deepEqual(U.parseJsonOrNull('{"detail":"x"}'), { detail: 'x' });
});

// ---------- F2: so sánh nội dung form ----------
test('sameFormContent ignores saved_at', () => {
  const a = { saved_at: '10:00:00', issues: 'x', packaging: [{ weight_sorted: '1' }] };
  assert.equal(U.sameFormContent(a, { ...a, saved_at: '11:00:00' }), true);
  assert.equal(U.sameFormContent(a, { ...a, issues: 'y' }), false);
  assert.equal(U.sameFormContent(null, a), false);
});
