// VICO Production Reporting System - Frontend Logic

const {
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
} = window.VicoUtils;

// Phải trùng với auth.MUST_CHANGE_PASSWORD_DETAIL phía máy chủ
const MUST_CHANGE_PASSWORD_DETAIL = 'Bạn cần đổi mật khẩu trước khi tiếp tục sử dụng hệ thống';
// Máy chủ cho phép nộp báo cáo trước tối đa 1 ngày
const MAX_REPORT_DAYS_AHEAD = 1;

document.addEventListener('DOMContentLoaded', async () => {
  // --- AUTH GUARD ---
  let currentUser = null;
  try {
    const meRes = await fetch('/api/auth/me');
    if (!meRes.ok) {
      window.location.href = 'login.html';
      return;
    }
    currentUser = await meRes.json();
  } catch (e) {
    window.location.href = 'login.html';
    return;
  }

  // Elements
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const reportDateInput = document.getElementById('reportDate');
  const shiftNumSelect = document.getElementById('shiftNum');
  const shiftLeaderInput = document.getElementById('shiftLeader');
  const startTimeInput = document.getElementById('startTime');
  const endTimeInput = document.getElementById('endTime');
  const currentDateDisplay = document.getElementById('currentDateDisplay');
  const staffTotalInput = document.getElementById('staffTotal');
  const staffPresentInput = document.getElementById('staffPresent');
  const leavePermittedInput = document.getElementById('leavePermitted');
  const leaveRotatingInput = document.getElementById('leaveRotating');
  const leaveRotatingNamesInput = document.getElementById('leaveRotatingNames');
  const leaveUnpermittedInput = document.getElementById('leaveUnpermitted');

  const containerPackaging = document.getElementById('containerPackaging');
  const containerBaskets = document.getElementById('containerBaskets');
  const containerTumbling = document.getElementById('containerTumbling');

  const btnAddPackagingRow = document.getElementById('btnAddPackagingRow');
  const btnAddPackagingBottom = document.getElementById('btnAddPackagingBottom');
  const btnAddBasketRow = document.getElementById('btnAddBasketRow');
  const btnAddBasketBottom = document.getElementById('btnAddBasketBottom');
  const btnAddTumblingRow = document.getElementById('btnAddTumblingRow');
  const btnAddTumblingBottom = document.getElementById('btnAddTumblingBottom');
  const shiftReportForm = document.getElementById('shiftReportForm');
  const btnResetForm = document.getElementById('btnResetForm');
  const btnSubmitReport = document.getElementById('btnSubmitReport');
  const btnSubmitText = btnSubmitReport.querySelector('.btn-text');
  const btnSubmitSubtext = btnSubmitReport.querySelector('.btn-subtext');
  const btnDeleteShift = document.getElementById('btnDeleteShift');

  const shiftStatusBanner = document.getElementById('shiftStatusBanner');
  const btnDateToday = document.getElementById('btnDateToday');
  const btnDateYesterday = document.getElementById('btnDateYesterday');
  const btnClonePrevious = document.getElementById('btnClonePrevious');
  const autoSaveIndicator = document.getElementById('autoSaveIndicator');
  const autoSaveText = document.getElementById('autoSaveText');

  const summaryDateInput = document.getElementById('summaryDate');
  const btnLoadSummary = document.getElementById('btnLoadSummary');
  const btnExportExcel = document.getElementById('btnExportExcel');
  const btnSyncMaster = document.getElementById('btnSyncMaster');
  const shiftsBadgesContainer = document.getElementById('shiftsBadgesContainer');
  const summaryResultsContainer = document.getElementById('summaryResultsContainer');

  const tbodyHistory = document.getElementById('tbodyHistory');
  const btnRefreshHistory = document.getElementById('btnRefreshHistory');

  const passwordModal = document.getElementById('passwordModal');
  const passwordModalHint = document.getElementById('passwordModalHint');
  const changePasswordForm = document.getElementById('changePasswordForm');
  const currentPasswordInput = document.getElementById('currentPassword');
  const newPasswordSelfInput = document.getElementById('newPasswordSelf');
  const confirmPasswordSelfInput = document.getElementById('confirmPasswordSelf');
  const passwordModalError = document.getElementById('passwordModalError');
  const passwordModalErrorText = document.getElementById('passwordModalErrorText');
  const btnPasswordCancel = document.getElementById('btnPasswordCancel');
  const btnPasswordSave = document.getElementById('btnPasswordSave');
  const btnChangePassword = document.getElementById('btnChangePassword');

  // --- TRẠNG THÁI FORM & NHÁP ---
  // Khai báo sớm vì nút Đăng xuất / apiFetch có thể dùng tới trong lúc chờ đổi mật khẩu bắt buộc.
  // formSource: 'blank' | 'user' (đang gõ báo cáo mới) | 'draft' (nháp đã phục hồi) | 'server' (báo cáo đã nộp)
  let formSource = 'blank';
  // Ngày/ca mà nội dung form hiện tại thuộc về (dùng làm khóa lưu nháp)
  let activeSelection = { date: '', shift: '' };
  let autoSaveTimer = null;
  // Kết quả kiểm tra trạng thái ca gần nhất: { phase: 'checking'|'ready'|'error', date, shift, exists, canEdit, ... }
  let shiftStatus = null;
  // Đang gửi/xóa báo cáo: mọi cập nhật giao diện phải giữ nút gửi bị khóa
  let isSaving = false;
  let recheckAfterSave = false;
  let cloneBusy = false;
  // Nội dung form ngay sau khi nạp báo cáo đã nộp (để biết người dùng đã sửa gì hay chưa)
  let serverSnapshot = null;
  // Các biến dưới đây có thể được dùng ngay trong lúc chờ đổi mật khẩu bắt buộc -> khai báo sớm
  let statusRequestSeq = 0;
  let summaryRequestSeq = 0;
  let toastTimer = null;
  let invalidScrollPending = false;
  let sessionExpiredHandled = false;
  const DRAFT_KEY_PREFIX = 'vico_draft_';
  // Nội dung đang sửa của báo cáo ĐÃ NỘP, chỉ lưu khi phiên đăng nhập hết hạn giữa chừng
  const EDIT_KEY_PREFIX = 'vico_edit_';

  // --- API HELPER ---
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function apiFetch(url, options = {}) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      throw new ApiError(friendlyHttpError(0, null), 0);
    }
    if (res.status === 401) {
      handleSessionExpired();
      throw new ApiError('Chưa đăng nhập', 401);
    }
    if (!res.ok) {
      let data = null;
      try {
        data = parseJsonOrNull(await res.text());
      } catch (e) {
        data = null;
      }
      if (res.status === 403 && data && data.detail === MUST_CHANGE_PASSWORD_DETAIL) {
        openPasswordModal(true);
      }
      throw new ApiError(friendlyHttpError(res.status, data), res.status);
    }
    return res;
  }

  function reportError(err) {
    // 401 đã được xử lý (chuyển về trang đăng nhập) trong apiFetch
    if (err && err.status === 401) return;
    alert('Lỗi: ' + (err && err.message ? err.message : err));
  }

  function handleSessionExpired() {
    if (sessionExpiredHandled) return;
    sessionExpiredHandled = true;
    let note = '';
    if (formSource === 'server') {
      const result = saveServerEditsBackup();
      if (result === 'saved') {
        note = '\n\nNội dung bạn đang sửa trong báo cáo đã nộp CHƯA được lưu lên máy chủ, nhưng đã được giữ tạm trên máy này. ' +
          'Sau khi đăng nhập lại, mở đúng ngày/ca đó để khôi phục rồi bấm CẬP NHẬT BÁO CÁO CA.';
      } else if (result === 'failed') {
        note = '\n\nKhông lưu tạm được nội dung đang sửa trên máy này (trình duyệt chặn bộ nhớ). Vui lòng ghi lại số liệu trước khi đăng nhập lại.';
      }
    } else if (autoSaveTimer || formSource !== 'blank') {
      flushDraftNow();
      const draft = readDraft(activeSelection.date, activeSelection.shift);
      if (draftHasContent(draft)) {
        note = ' (dữ liệu đang nhập dở đã được lưu nháp trên máy này).';
      } else if (draftHasContent(collectDraft())) {
        note = '\n\nKhông lưu nháp được trên máy này (trình duyệt chặn bộ nhớ). Vui lòng ghi lại số liệu trước khi đăng nhập lại.';
      }
    }
    alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại' + (note.startsWith(' ') ? note : '.' + note));
    window.location.href = 'login.html';
  }

  // --- ĐỔI MẬT KHẨU ---
  let passwordModalForced = false;
  let passwordModalOpen = false;
  let onPasswordChanged = null;
  let focusBeforeModal = null;

  function setBackgroundInert(inert) {
    [document.querySelector('.app-header'), document.querySelector('.tab-nav'),
      document.querySelector('.main-content'), document.getElementById('toastNotification')].forEach(el => {
      if (!el) return;
      el.inert = inert;
      if (inert) el.setAttribute('aria-hidden', 'true');
      else el.removeAttribute('aria-hidden');
    });
  }

  function showPasswordError(msg) {
    passwordModalErrorText.textContent = msg;
    passwordModalError.style.display = 'flex';
  }

  function openPasswordModal(forced) {
    if (passwordModalOpen) {
      // Không bao giờ "hạ cấp" hộp thoại bắt buộc thành hộp thoại có nút Hủy
      if (forced && !passwordModalForced) {
        passwordModalForced = true;
        applyPasswordModalMode();
      }
      return;
    }
    passwordModalForced = forced;
    focusBeforeModal = document.activeElement;
    applyPasswordModalMode();
    changePasswordForm.reset();
    passwordModalError.style.display = 'none';
    passwordModal.style.display = 'flex';
    passwordModalOpen = true;
    setBackgroundInert(true);
    currentPasswordInput.focus();
  }

  function applyPasswordModalMode() {
    passwordModalHint.textContent = passwordModalForced
      ? 'Tài khoản của bạn đang dùng mật khẩu tạm. Vui lòng đặt mật khẩu mới để tiếp tục sử dụng hệ thống.'
      : 'Nhập mật khẩu hiện tại và mật khẩu mới (ít nhất 6 ký tự).';
    btnPasswordCancel.textContent = passwordModalForced ? 'Đăng xuất' : 'Hủy';
  }

  function closePasswordModal() {
    passwordModal.style.display = 'none';
    passwordModalOpen = false;
    passwordModalForced = false;
    setBackgroundInert(false);
    if (focusBeforeModal && document.contains(focusBeforeModal) && focusBeforeModal.focus) {
      focusBeforeModal.focus();
    }
    focusBeforeModal = null;
  }

  passwordModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!passwordModalForced) closePasswordModal();
      return;
    }
    if (e.key !== 'Tab') return;
    // Giữ focus trong hộp thoại
    const focusables = [...passwordModal.querySelectorAll('input, button, select, textarea, a[href]')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!passwordModal.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  });

  // Focus lọt ra ngoài (trình duyệt không hỗ trợ inert) -> đưa về hộp thoại
  document.addEventListener('focusin', (e) => {
    if (passwordModalOpen && !passwordModal.contains(e.target)) {
      currentPasswordInput.focus();
    }
  });

  btnPasswordCancel.addEventListener('click', async () => {
    if (passwordModalForced) {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {
        // vẫn chuyển về trang đăng nhập
      }
      window.location.href = 'login.html';
      return;
    }
    closePasswordModal();
  });

  changePasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    passwordModalError.style.display = 'none';
    if (newPasswordSelfInput.value !== confirmPasswordSelfInput.value) {
      showPasswordError('Mật khẩu mới nhập lại không khớp');
      return;
    }
    btnPasswordSave.disabled = true;
    try {
      let res;
      try {
        res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            current_password: currentPasswordInput.value,
            new_password: newPasswordSelfInput.value
          })
        });
      } catch (err) {
        showPasswordError(friendlyHttpError(0, null));
        return;
      }
      if (res.status === 401) {
        window.location.href = 'login.html';
        return;
      }
      let data = null;
      try {
        data = parseJsonOrNull(await res.text());
      } catch (err) {
        data = null;
      }
      if (!res.ok) {
        showPasswordError(friendlyHttpError(res.status, data));
        return;
      }
      currentUser.must_change_password = false;
      closePasswordModal();
      showToast('Đã đổi mật khẩu thành công!');
      if (onPasswordChanged) {
        const callback = onPasswordChanged;
        onPasswordChanged = null;
        callback();
      }
    } finally {
      btnPasswordSave.disabled = false;
    }
  });

  btnChangePassword.addEventListener('click', () => {
    // Đang mở (nhất là hộp thoại bắt buộc): bỏ qua
    if (passwordModalOpen) return;
    openPasswordModal(false);
  });

  // --- APPLY CURRENT USER TO UI ---
  shiftLeaderInput.value = currentUser.full_name;

  const userStatusBox = document.getElementById('userStatusBox');
  const currentUserName = document.getElementById('currentUserName');
  const btnLogout = document.getElementById('btnLogout');
  userStatusBox.style.display = 'flex';
  currentUserName.textContent = `${currentUser.full_name} (${currentUser.role === 'admin' ? 'Admin' : 'Ca trưởng'})`;
  btnLogout.addEventListener('click', async () => {
    flushDraftNow();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      // vẫn chuyển về trang đăng nhập
    }
    window.location.href = 'login.html';
  });

  // Tài khoản dùng mật khẩu tạm: bắt buộc đổi trước khi dùng các chức năng khác
  if (currentUser.must_change_password) {
    await new Promise(resolve => {
      onPasswordChanged = resolve;
      openPasswordModal(true);
    });
  }

  // --- NGÀY HÔM NAY (tự cập nhật khi qua nửa đêm) ---
  const todayStr = () => toLocalDateStr(new Date());
  let knownToday = todayStr();

  function applyTodayToUi() {
    currentDateDisplay.textContent = `Hôm nay: ${formatDateDisplay(knownToday)}`;
    const now = new Date();
    reportDateInput.max = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + MAX_REPORT_DAYS_AHEAD));
  }

  reportDateInput.value = knownToday;
  summaryDateInput.value = knownToday;
  applyTodayToUi();

  const btnTabSummaryEl = document.getElementById('btnTabSummary');
  const btnTabHistoryEl = document.getElementById('btnTabHistory');
  const btnTabAdmin = document.getElementById('btnTabAdmin');
  if (currentUser.role !== 'admin') {
    btnTabSummaryEl.style.display = 'none';
    btnTabHistoryEl.style.display = 'none';
  } else {
    btnTabAdmin.style.display = 'flex';
  }

  let presets = {
    products: ["D25", "D40", "D60"],
    customers: ["Molycop", "Nhập TQ", "Khô dầu", "VICO"],
    steel_grades: ["CR18", "18", "CR20", "B2"],
    shift_hours: {
      1: { start: "6h", end: "14h" },
      2: { start: "14h", end: "22h" },
      3: { start: "22h", end: "6h" }
    }
  };

  function populateDatalists(data) {
    const pList = document.getElementById('presetProducts');
    const cList = document.getElementById('presetCustomers');
    const sList = document.getElementById('presetSteelGrades');
    if (pList && data && data.products) {
      pList.innerHTML = data.products.map(p => `<option value="${escapeHtml(p)}">`).join('');
    }
    if (cList && data && data.customers) {
      cList.innerHTML = data.customers.map(c => `<option value="${escapeHtml(c)}">`).join('');
    }
    if (sList && data && data.steel_grades) {
      sList.innerHTML = data.steel_grades.map(s => `<option value="${escapeHtml(s)}">`).join('');
    }
  }

  // Fetch presets from API
  async function loadUserPresets() {
    try {
      const res = await fetch('/api/presets');
      if (res.ok) {
        presets = await res.json();
        populateDatalists(presets);
      }
    } catch (e) {
      console.warn("Could not load presets from server, using defaults", e);
    }
  }
  await loadUserPresets();

  // Set default hours for Ca 1
  updateShiftHours();

  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');

      if (targetId === 'summary-tab') {
        loadSummary();
      } else if (targetId === 'history-tab') {
        loadHistory();
        initAndLoadAnalytics();
      } else if (targetId === 'admin-tab') {
        loadUsers();
        loadAdminPresets();
      }
    });
  });

  function updateQuickDateChips() {
    const curVal = reportDateInput.value;
    btnDateToday.classList.toggle('active', curVal === todayStr());
    btnDateYesterday.classList.toggle('active', curVal === yesterdayStr(new Date()));
  }

  function refreshToday() {
    const now = new Date();
    const newToday = toLocalDateStr(now);
    if (newToday === knownToday) return;
    const previousToday = knownToday;
    knownToday = newToday;
    applyTodayToUi();

    const summaryTabActive = document.getElementById('summary-tab').classList.contains('active');
    if (summaryDateInput.value === previousToday && !summaryTabActive) {
      summaryDateInput.value = newToday;
    }

    const moved = isSaving ? null : rolloverReportDate({
      reportDate: reportDateInput.value, previousToday, now, formSource, shift: shiftNumSelect.value
    });
    if (moved) {
      reportDateInput.value = moved;
      checkCurrentShiftStatus();
      return;
    }
    updateQuickDateChips();
    if (reportDateInput.value === previousToday && formSource !== 'blank') {
      showToast(`Đã sang ngày mới (${formatDateDisplay(newToday)}). Kiểm tra lại ngày báo cáo trước khi gửi.`);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshToday();
  });
  window.addEventListener('focus', refreshToday);
  window.addEventListener('pageshow', refreshToday);
  setInterval(refreshToday, 30 * 1000);

  function updateShiftHours() {
    const shift = shiftNumSelect.value;
    if (presets.shift_hours && presets.shift_hours[shift]) {
      startTimeInput.value = presets.shift_hours[shift].start;
      endTimeInput.value = presets.shift_hours[shift].end;
    }
  }

  function checkSmartCa3Suggestion(selectedShift) {
    if (selectedShift !== '3') return;
    const suggested = ca3SuggestedDate(new Date(), reportDateInput.value);
    if (suggested && confirm(`Bạn đang chọn Ca 3 vào buổi sáng.\nTheo quy định phân xưởng, Ca 3 (22:00 đêm qua - 06:00 sáng nay) được tính theo ngày bắt đầu (${formatDateDisplay(suggested)}).\n\nBạn có muốn tự động chọn ngày ${formatDateDisplay(suggested)} không?`)) {
      reportDateInput.value = suggested;
    }
  }

  shiftNumSelect.addEventListener('change', () => {
    renderSubmitButton();
    updateShiftHours();
    checkSmartCa3Suggestion(shiftNumSelect.value);
    checkCurrentShiftStatus();
  });

  // Giá trị ngày thay đổi (kể cả khi đang gõ dở) -> khóa nút gửi ngay
  reportDateInput.addEventListener('input', renderSubmitButton);
  reportDateInput.addEventListener('change', () => {
    checkCurrentShiftStatus();
  });

  function selectQuickDate(getValue) {
    // Có thể vừa qua nửa đêm mà trang chưa biết (điện thoại không phát sự kiện focus)
    refreshToday();
    const value = getValue();
    // Bấm lại chip đang chọn: không nạp lại báo cáo (tránh mất phần đang sửa)
    if (reportDateInput.value === value) {
      updateQuickDateChips();
      return;
    }
    reportDateInput.value = value;
    checkCurrentShiftStatus();
  }

  btnDateToday.addEventListener('click', () => selectQuickDate(todayStr));
  btnDateYesterday.addEventListener('click', () => selectQuickDate(() => yesterdayStr(new Date())));

  // --- NHÁP (LOCAL STORAGE) ---
  activeSelection = { date: reportDateInput.value, shift: shiftNumSelect.value };


  function getDraftKey(dateVal, shiftVal) {
    return `${DRAFT_KEY_PREFIX}${currentUser.username}_${dateVal}_ca${shiftVal}`;
  }

  function getEditKey(dateVal, shiftVal) {
    return `${EDIT_KEY_PREFIX}${currentUser.username}_${dateVal}_ca${shiftVal}`;
  }

  function triggerAutoSave(e) {
    if (e && (e.target === reportDateInput || e.target === shiftNumSelect)) return;
    if (formSource === 'server') return; // đang sửa báo cáo đã nộp: không lưu nháp
    if (formSource === 'blank') formSource = 'user';

    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      saveDraftToLocalStorage(activeSelection.date, activeSelection.shift);
    }, 600);
  }

  function cancelPendingAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }

  function flushDraftNow() {
    if (autoSaveTimer) {
      cancelPendingAutoSave();
      saveDraftToLocalStorage(activeSelection.date, activeSelection.shift);
    }
  }

  function collectDraft() {
    const draft = {
      saved_at: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      safety_production: document.getElementById('safetyProduction').checked,
      safety_ppe: document.getElementById('safetyPpe').checked,
      safety_equip: document.getElementById('safetyEquip').checked,
      start_time: startTimeInput.value,
      end_time: endTimeInput.value,
      staff_total: staffTotalInput.value,
      staff_present: staffPresentInput.value,
      leave_permitted: leavePermittedInput.value,
      leave_permitted_names: document.getElementById('leavePermittedNames').value,
      leave_rotating: leaveRotatingInput.value,
      leave_rotating_names: leaveRotatingNamesInput.value,
      leave_unpermitted: leaveUnpermittedInput.value,
      leave_unpermitted_names: document.getElementById('leaveUnpermittedNames').value,
      issues: document.getElementById('shiftIssues').value,
      suggestions: document.getElementById('shiftSuggestions').value,
      shift_tasks: document.getElementById('shiftTasks').value,
      packaging: [],
      baskets: [],
      tumbling: []
    };

    containerPackaging.querySelectorAll('.entry-card').forEach(card => {
      draft.packaging.push({
        product_name: card.querySelector('.pkg-product').value,
        customer: card.querySelector('.pkg-customer').value,
        weight_sorted: card.querySelector('.pkg-sorted').value,
        weight_waste: card.querySelector('.pkg-waste').value,
        notes: card.querySelector('.pkg-notes').value
      });
    });

    containerBaskets.querySelectorAll('.entry-card').forEach(card => {
      draft.baskets.push({
        product_name: card.querySelector('.bsk-product').value,
        customer: card.querySelector('.bsk-customer').value,
        steel_grade: card.querySelector('.bsk-steel').value,
        basket_count: card.querySelector('.bsk-count').value,
        basket_from: card.querySelector('.bsk-from').value,
        basket_to: card.querySelector('.bsk-to').value,
        total_weight: card.querySelector('.bsk-weight').value,
        notes: card.querySelector('.bsk-notes').value
      });
    });

    containerTumbling.querySelectorAll('.entry-card').forEach(card => {
      draft.tumbling.push({
        product_name: card.querySelector('.tmb-product').value,
        customer: card.querySelector('.tmb-customer').value,
        m1: card.querySelector('.tmb-m1').value,
        m2: card.querySelector('.tmb-m2').value,
        total_weight: card.querySelector('.tmb-weight').value,
        notes: card.querySelector('.tmb-notes').value
      });
    });
    return draft;
  }

  function saveDraftToLocalStorage(dateVal, shiftVal) {
    if (formSource === 'server' || !dateVal || !shiftVal) return;
    const draft = collectDraft();
    try {
      if (!draftHasContent(draft)) {
        localStorage.removeItem(getDraftKey(dateVal, shiftVal));
        return;
      }
      localStorage.setItem(getDraftKey(dateVal, shiftVal), JSON.stringify(draft));
      autoSaveIndicator.style.display = 'inline-flex';
      autoSaveText.textContent = `Đã lưu nháp (${draft.saved_at})`;
    } catch (e) {
      console.warn('Lỗi lưu nháp localStorage:', e);
    }
  }

  function readStoredJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('Lỗi đọc localStorage:', e);
      return null;
    }
  }

  function removeStored(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // localStorage có thể bị chặn (chế độ ẩn danh)
    }
  }

  function readDraft(dateVal, shiftVal) {
    return readStoredJson(getDraftKey(dateVal, shiftVal));
  }

  function clearCurrentDraft(dateVal, shiftVal) {
    removeStored(getDraftKey(dateVal, shiftVal));
    autoSaveIndicator.style.display = 'none';
  }

  function saveServerEditsBackup() {
    const { date, shift } = activeSelection;
    if (!date || !shift) return 'unchanged';
    const current = collectDraft();
    if (serverSnapshot && sameFormContent(serverSnapshot, current)) return 'unchanged';
    try {
      localStorage.setItem(getEditKey(date, shift), JSON.stringify(current));
      return 'saved';
    } catch (e) {
      return 'failed';
    }
  }

  // Báo cáo đã nộp vừa được nạp, nhưng máy này còn nội dung chưa lưu cho đúng ngày/ca đó
  // (sửa dở khi phiên hết hạn, hoặc nháp nhập dở trong khi báo cáo đã được nộp từ nơi khác)
  function offerLocalEditsRestore(dateVal, shiftVal) {
    const editBackup = readStoredJson(getEditKey(dateVal, shiftVal));
    const draft = readDraft(dateVal, shiftVal);
    const candidate = editBackup || (draftHasContent(draft) ? draft : null);
    if (!candidate) return;

    const label = `Ca ${shiftVal} ngày ${formatDateDisplay(dateVal)}`;
    const savedAt = candidate.saved_at ? ` (lưu lúc ${candidate.saved_at})` : '';
    const message = editBackup
      ? `Máy này còn giữ nội dung bạn đang sửa cho báo cáo ${label}${savedAt} nhưng chưa kịp lưu lên máy chủ vì phiên đăng nhập hết hạn.\n\n` +
        'Bấm OK để khôi phục nội dung đó (sau đó bấm CẬP NHẬT BÁO CÁO CA để lưu).\nBấm Hủy để bỏ nội dung đó và giữ báo cáo đã nộp.'
      : `${label} đã có báo cáo trên máy chủ, nhưng máy này còn nội dung nhập dở chưa gửi${savedAt}.\n\n` +
        'Bấm OK để thay nội dung đang hiển thị bằng nội dung nhập dở (sau đó bấm CẬP NHẬT BÁO CÁO CA để lưu).\nBấm Hủy để bỏ nội dung nhập dở và giữ báo cáo đã nộp.';
    const accept = confirm(message);
    removeStored(getEditKey(dateVal, shiftVal));
    removeStored(getDraftKey(dateVal, shiftVal));
    if (accept) {
      populateFormWithShiftData(candidate);
      formSource = 'server';
      showToast('Đã khôi phục nội dung chưa lưu. Bấm CẬP NHẬT BÁO CÁO CA để lưu lên máy chủ.');
    }
  }

  // --- POPULATE FORM WITH SHIFT / DRAFT DATA ---
  function populateFormWithShiftData(data) {
    if (data.safety_production !== undefined) {
      document.getElementById('safetyProduction').checked = !!data.safety_production;
    }
    if (data.safety_ppe !== undefined) {
      document.getElementById('safetyPpe').checked = !!data.safety_ppe;
    }
    if (data.safety_equip !== undefined) {
      document.getElementById('safetyEquip').checked = !!data.safety_equip;
    }
    if (data.start_time) startTimeInput.value = data.start_time;
    if (data.end_time) endTimeInput.value = data.end_time;
    const fieldMap = {
      staffTotal: 'staff_total',
      staffPresent: 'staff_present',
      leavePermitted: 'leave_permitted',
      leavePermittedNames: 'leave_permitted_names',
      leaveRotating: 'leave_rotating',
      leaveRotatingNames: 'leave_rotating_names',
      leaveUnpermitted: 'leave_unpermitted',
      leaveUnpermittedNames: 'leave_unpermitted_names',
      shiftIssues: 'issues',
      shiftSuggestions: 'suggestions',
      shiftTasks: 'shift_tasks'
    };
    Object.keys(fieldMap).forEach(id => {
      const value = data[fieldMap[id]];
      if (value !== undefined) {
        document.getElementById(id).value = value === null ? '' : value;
      }
    });

    containerPackaging.innerHTML = '';
    if (data.packaging && data.packaging.length > 0) {
      data.packaging.forEach(item => addPackagingCard(item));
    } else {
      addPackagingCard();
    }

    containerBaskets.innerHTML = '';
    if (data.baskets && data.baskets.length > 0) {
      data.baskets.forEach(item => addBasketCard(item));
    } else {
      addBasketCard();
    }

    containerTumbling.innerHTML = '';
    if (data.tumbling && data.tumbling.length > 0) {
      data.tumbling.forEach(item => addTumblingCard(item));
    } else {
      addTumblingCard();
    }
    updateAttendanceValidity();
  }

  // Xóa trắng nội dung báo cáo nhưng giữ nguyên ngày/ca đang chọn
  function resetFormToBlank() {
    const dateVal = reportDateInput.value;
    const shiftVal = shiftNumSelect.value;
    shiftReportForm.reset();
    reportDateInput.value = dateVal;
    shiftNumSelect.value = shiftVal;
    shiftLeaderInput.value = currentUser.full_name;
    updateShiftHours();
    containerPackaging.innerHTML = '';
    containerBaskets.innerHTML = '';
    containerTumbling.innerHTML = '';
    addPackagingCard();
    addBasketCard();
    addTumblingCard();
    formSource = 'blank';
    serverSnapshot = null;
    updateAttendanceValidity();
  }

  // --- CHẤM CÔNG: kiểm tra giống máy chủ ---
  function updateAttendanceValidity() {
    const staffTotal = parseIntOr(staffTotalInput.value, 5);
    const values = {
      staffTotal,
      staffPresent: parseIntOr(staffPresentInput.value, staffTotal),
      leavePermitted: parseIntOr(leavePermittedInput.value, 0),
      leaveRotating: parseIntOr(leaveRotatingInput.value, 0),
      leaveUnpermitted: parseIntOr(leaveUnpermittedInput.value, 0)
    };
    const maxValue = String(Math.max(0, Math.min(staffTotal, 1000)));
    staffPresentInput.max = maxValue;
    leavePermittedInput.max = maxValue;
    leaveRotatingInput.max = maxValue;
    leaveUnpermittedInput.max = maxValue;
    const problem = attendanceProblem(values);
    staffPresentInput.setCustomValidity(problem && problem.field === 'staffPresent' ? problem.message : '');
    leavePermittedInput.setCustomValidity(problem && problem.field === 'leavePermitted' ? problem.message : '');
    leaveRotatingInput.setCustomValidity(problem && problem.field === 'leaveRotating' ? problem.message : '');
  }

  [staffTotalInput, staffPresentInput, leavePermittedInput, leaveRotatingInput, leaveUnpermittedInput].forEach(input => {
    input.addEventListener('input', updateAttendanceValidity);
  });

  // --- NÚT GỬI BÁO CÁO & TRẠNG THÁI CA ---
  function currentSubmitState(saving = isSaving) {
    return submitState({
      saving,
      status: shiftStatus,
      current: { date: reportDateInput.value, shift: shiftNumSelect.value },
      active: activeSelection
    });
  }

  function renderSubmitButton() {
    const state = currentSubmitState();
    const view = submitButtonView(state.mode, shiftStatus && shiftStatus.leader);
    btnSubmitReport.disabled = view.disabled;
    btnSubmitText.textContent = view.text;
    btnSubmitSubtext.textContent = view.subtext;

    const canDelete = currentUser.role === 'admin' && currentSubmitState(false).mode === 'update';
    btnDeleteShift.style.display = canDelete ? '' : 'none';
    btnDeleteShift.disabled = isSaving;

    // Không cho đổi ngày/ca trong lúc đang lưu
    [reportDateInput, shiftNumSelect, btnDateToday, btnDateYesterday, btnResetForm].forEach(el => {
      el.disabled = isSaving;
    });
    btnClonePrevious.disabled = isSaving || cloneBusy;
  }

  function renderShiftStatus() {
    const st = shiftStatus;
    shiftStatusBanner.innerHTML = '';
    if (!st || st.phase === 'checking') {
      shiftStatusBanner.style.display = 'none';
    } else if (st.phase === 'error') {
      shiftStatusBanner.style.display = 'flex';
      shiftStatusBanner.className = 'shift-status-banner warning';
      shiftStatusBanner.innerHTML = `
        <div class="banner-icon">⚠️</div>
        <div class="banner-content">
          <div class="banner-title">Chưa kiểm tra được trạng thái Ca ${escapeHtml(st.shift)} ngày ${escapeHtml(formatDateDisplay(st.date))}</div>
          <div class="banner-desc">${escapeHtml(st.message || '')} Nút gửi báo cáo tạm khóa để tránh ghi nhầm vào báo cáo khác.</div>
          <button type="button" class="btn btn-sm btn-outline banner-action" id="btnRetryStatus">🔄 Thử lại</button>
        </div>
      `;
      shiftStatusBanner.querySelector('#btnRetryStatus').addEventListener('click', () => checkCurrentShiftStatus());
    } else if (st.exists && st.canEdit) {
      const updatedText = st.updatedAt ? `, cập nhật lần cuối lúc ${escapeHtml(st.updatedAt)}` : '';
      shiftStatusBanner.style.display = 'flex';
      shiftStatusBanner.className = 'shift-status-banner info';
      shiftStatusBanner.innerHTML = `
        <div class="banner-icon">📝</div>
        <div class="banner-content">
          <div class="banner-title">Ca ${escapeHtml(st.shift)} ngày ${escapeHtml(formatDateDisplay(st.date))} đã có báo cáo (${escapeHtml(st.leader)})</div>
          <div class="banner-desc">Đã tự động nạp dữ liệu nộp lúc ${escapeHtml(st.createdAt)}${updatedText}. Bạn có thể chỉnh sửa và bấm <strong>CẬP NHẬT BÁO CÁO CA</strong> bên dưới.</div>
        </div>
      `;
    } else if (st.exists) {
      shiftStatusBanner.style.display = 'flex';
      shiftStatusBanner.className = 'shift-status-banner warning';
      shiftStatusBanner.innerHTML = `
        <div class="banner-icon">🔒</div>
        <div class="banner-content">
          <div class="banner-title">Báo cáo Ca ${escapeHtml(st.shift)} ngày ${escapeHtml(formatDateDisplay(st.date))} đã được nộp bởi ${escapeHtml(st.leader)}</div>
          <div class="banner-desc">Bạn không có quyền chỉnh sửa báo cáo do ca trưởng khác tạo. Chỉ Quản trị viên hoặc chính Trưởng ca đó mới có thể chỉnh sửa.</div>
        </div>
      `;
    } else {
      shiftStatusBanner.style.display = 'none';
    }
    renderSubmitButton();
  }

  // --- CHECK SHIFT STATUS (EXISTS / EDITABLE / LOCKED / NEW) ---
  async function checkCurrentShiftStatus() {
    const dateVal = reportDateInput.value;
    const shiftVal = shiftNumSelect.value;
    updateQuickDateChips();
    if (isSaving) {
      recheckAfterSave = true;
      renderSubmitButton();
      return;
    }

    const seq = ++statusRequestSeq;
    if (!dateVal || !shiftVal) {
      shiftStatus = { phase: 'error', date: dateVal, shift: shiftVal, message: 'Vui lòng chọn ngày báo cáo.' };
      renderShiftStatus();
      return;
    }

    flushDraftNow();
    // Khóa nút gửi ngay: banner/nút cũ thuộc lựa chọn trước, không còn đúng nữa
    shiftStatus = { phase: 'checking', date: dateVal, shift: shiftVal };
    renderShiftStatus();

    let statusData;
    try {
      const res = await apiFetch(`/api/shifts/check-status?date=${encodeURIComponent(dateVal)}&shift_num=${encodeURIComponent(shiftVal)}`);
      statusData = await res.json();
    } catch (err) {
      if (seq !== statusRequestSeq || err.status === 401) return;
      console.warn('Lỗi kiểm tra trạng thái ca:', err);
      shiftStatus = { phase: 'error', date: dateVal, shift: shiftVal, message: err.message };
      renderShiftStatus();
      showToast('Không kiểm tra được trạng thái ca: ' + err.message);
      return;
    }
    // Người dùng đã đổi sang ngày/ca khác trong lúc chờ -> bỏ kết quả cũ
    if (seq !== statusRequestSeq) return;

    const previous = activeSelection;
    const draft = statusData.exists ? null : readDraft(dateVal, shiftVal);
    const action = decideFormAction({
      exists: statusData.exists,
      canEdit: !!statusData.can_edit,
      hasDraft: draftHasContent(draft),
      formSource
    });

    if (action === 'load-server') {
      populateFormWithShiftData(statusData.shift_data);
      formSource = 'server';
      serverSnapshot = collectDraft();
      autoSaveIndicator.style.display = 'none';
      activeSelection = { date: dateVal, shift: shiftVal };
    } else if (action === 'restore-draft') {
      populateFormWithShiftData(draft);
      formSource = 'draft';
      autoSaveIndicator.style.display = 'inline-flex';
      autoSaveText.textContent = `Đã phục hồi nháp (${draft.saved_at || ''})`;
      activeSelection = { date: dateVal, shift: shiftVal };
    } else if (action === 'clear') {
      resetFormToBlank();
      autoSaveIndicator.style.display = 'none';
      activeSelection = { date: dateVal, shift: shiftVal };
    } else if (statusData.exists) {
      // Ca đã bị người khác nộp: giữ nguyên nội dung đang gõ (nháp vẫn thuộc ngày/ca cũ)
    } else if (formSource !== 'blank' && (previous.date !== dateVal || previous.shift !== shiftVal)) {
      // Người dùng chỉ sửa lại ngày/ca đã chọn: nội dung đang gõ đi theo lựa chọn mới
      clearCurrentDraft(previous.date, previous.shift);
      activeSelection = { date: dateVal, shift: shiftVal };
      saveDraftToLocalStorage(dateVal, shiftVal);
    } else {
      activeSelection = { date: dateVal, shift: shiftVal };
    }

    shiftStatus = {
      phase: 'ready',
      date: dateVal,
      shift: shiftVal,
      exists: !!statusData.exists,
      canEdit: !!statusData.can_edit,
      leader: statusData.shift_leader,
      createdAt: statusData.created_at,
      updatedAt: statusData.updated_at
    };
    renderShiftStatus();

    if (action === 'load-server') {
      offerLocalEditsRestore(dateVal, shiftVal);
    }
  }

  window.addEventListener('online', () => {
    if (shiftStatus && shiftStatus.phase === 'error') checkCurrentShiftStatus();
  });

  // --- DYNAMIC CARD MANAGEMENT (MOBILE-FIRST) ---

  function updateCardIndexes() {
    containerPackaging.querySelectorAll('.entry-card').forEach((card, i) => {
      card.querySelector('.card-title-text').textContent = `Sản phẩm #${i + 1}`;
    });
    containerBaskets.querySelectorAll('.entry-card').forEach((card, i) => {
      card.querySelector('.card-title-text').textContent = `Giỏ bi #${i + 1}`;
    });
    containerTumbling.querySelectorAll('.entry-card').forEach((card, i) => {
      card.querySelector('.card-title-text').textContent = `Mẻ xóc #${i + 1}`;
    });
  }

  function attachRemoveHandler(card, container) {
    card.querySelector('.btn-remove-card').addEventListener('click', () => {
      if (container.children.length > 1 || confirm('Xóa mục này?')) {
        card.remove();
        updateCardIndexes();
        triggerAutoSave();
      }
    });
  }

  function numberAttr(value) {
    return value === null || value === undefined ? '' : escapeHtml(value);
  }

  // 1. Packaging Card (Bao gói sản phẩm)
  function addPackagingCard(data = {}) {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `
      <div class="entry-card-header">
        <div class="entry-card-title">
          <span class="card-icon">📦</span>
          <span class="card-title-text">Sản phẩm bao gói</span>
        </div>
        <button type="button" class="btn-remove-card" title="Xóa mục này">
          <span>Xóa</span> ✕
        </button>
      </div>
      <div class="entry-card-body">
        <div class="grid grid-2">
          <div class="form-group">
            <label>Tên Sản Phẩm <span class="req">*</span></label>
            <input type="text" class="pkg-product input-lg" list="presetProducts" value="${escapeHtml(data.product_name || (presets.products && presets.products[0]) || 'D25')}" placeholder="VD: D25" maxlength="100" enterkeyhint="next">
          </div>
          <div class="form-group">
            <label>Khách Hàng <span class="req">*</span></label>
            <input type="text" class="pkg-customer input-lg" list="presetCustomers" value="${escapeHtml(data.customer || (presets.customers && presets.customers[0]) || 'Molycop')}" placeholder="VD: Molycop" maxlength="100" enterkeyhint="next">
          </div>
        </div>

        <div class="grid grid-2 mt-2">
          <div class="form-group">
            <label>Khối Lượng Phân Loại (Kg)</label>
            <input type="number" class="pkg-sorted input-lg input-highlight" value="${escapeHtml(data.weight_sorted || '')}" placeholder="0" min="0" max="10000000" step="any" inputmode="decimal" enterkeyhint="next">
          </div>
          <div class="form-group">
            <label>Khối Lượng Hủy (Kg)</label>
            <input type="number" class="pkg-waste input-lg input-highlight" value="${numberAttr(data.weight_waste)}" placeholder="0" min="0" max="10000000" step="any" inputmode="decimal" enterkeyhint="next">
          </div>
        </div>

        <div class="calc-box mt-2">
          <span class="calc-title">Tỉ Lệ Hủy Tự Tính:</span>
          <span class="rate-badge pkg-rate">-</span>
        </div>

        <div class="form-group mt-2">
          <label>Ghi Chú</label>
          <input type="text" class="pkg-notes" value="${escapeHtml(data.notes)}" placeholder="VD: Nhặt bi lỗi, xếp kho chờ nghiệm thu..." maxlength="2000" enterkeyhint="next">
        </div>
      </div>
    `;

    const sortedInput = card.querySelector('.pkg-sorted');
    const wasteInput = card.querySelector('.pkg-waste');
    const rateBadge = card.querySelector('.pkg-rate');

    function updateRate() {
      const sorted = parseFloatOr(sortedInput.value, 0);
      const waste = parseFloatOr(wasteInput.value, 0);
      if (sorted > 0) {
        const rate = (waste / sorted) * 100;
        rateBadge.textContent = `${rate.toFixed(2)}%`;
        rateBadge.className = 'rate-badge pkg-rate ' + (rate > 2 ? 'bad' : (rate > 1 ? 'warn' : 'good'));
      } else {
        rateBadge.textContent = '-';
        rateBadge.className = 'rate-badge pkg-rate';
      }
    }

    sortedInput.addEventListener('input', updateRate);
    wasteInput.addEventListener('input', updateRate);
    updateRate();

    attachRemoveHandler(card, containerPackaging);
    containerPackaging.appendChild(card);
    updateCardIndexes();
  }

  // 2. Basket Card (Số lượng giỏ bi ra sau tôi)
  function addBasketCard(data = {}) {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `
      <div class="entry-card-header">
        <div class="entry-card-title">
          <span class="card-icon">🛒</span>
          <span class="card-title-text">Giỏ bi sau tôi</span>
        </div>
        <button type="button" class="btn-remove-card" title="Xóa mục này">
          <span>Xóa</span> ✕
        </button>
      </div>
      <div class="entry-card-body">
        <div class="grid grid-2">
          <div class="form-group">
            <label>Tên Sản Phẩm <span class="req">*</span></label>
            <input type="text" class="bsk-product input-lg" list="presetProducts" value="${escapeHtml(data.product_name || (presets.products && presets.products[0]) || 'D25')}" placeholder="VD: D25" maxlength="100" enterkeyhint="next">
          </div>
          <div class="form-group">
            <label>Khách Hàng <span class="req">*</span></label>
            <input type="text" class="bsk-customer input-lg" list="presetCustomers" value="${escapeHtml(data.customer || (presets.customers && presets.customers[0]) || 'Molycop')}" placeholder="VD: Molycop" maxlength="100" enterkeyhint="next">
          </div>
        </div>

        <div class="grid grid-2 mt-2">
          <div class="form-group">
            <label>Mác Thép</label>
            <input type="text" class="bsk-steel input-lg" list="presetSteelGrades" value="${escapeHtml(data.steel_grade || (presets.steel_grades && presets.steel_grades[0]) || 'CR18')}" placeholder="VD: CR18" maxlength="100" enterkeyhint="next">
          </div>
          <div class="form-group">
            <label>Tổng Số Giỏ</label>
            <input type="number" class="bsk-count input-lg input-highlight" value="${escapeHtml(data.basket_count || '')}" placeholder="0" min="0" max="100000" step="any" inputmode="decimal" enterkeyhint="next">
          </div>
        </div>

        <div class="grid grid-2 mt-2">
          <div class="form-group">
            <label>Từ Giỏ Số</label>
            <input type="number" class="bsk-from input-lg" value="${numberAttr(data.from_val || data.basket_from)}" placeholder="VD: 1" min="0" max="100000" step="1" inputmode="numeric" enterkeyhint="next">
          </div>
          <div class="form-group">
            <label>Đến Giỏ Số</label>
            <input type="number" class="bsk-to input-lg" value="${numberAttr(data.to_val || data.basket_to)}" placeholder="VD: 5" min="0" max="100000" step="1" inputmode="numeric" enterkeyhint="next">
          </div>
        </div>

        <div class="calc-box mt-2">
          <span class="calc-title">Tổng Khối Lượng (tự nhân 350 Kg/giỏ):</span>
          <div class="weight-input-group">
            <input type="number" class="bsk-weight input-lg input-highlight" value="${numberAttr(data.total_weight)}" placeholder="Tự tính" min="0" max="10000000" step="any" inputmode="decimal" enterkeyhint="next">
            <span class="unit-text">Kg</span>
          </div>
        </div>

        <div class="form-group mt-2">
          <label>Ghi Chú</label>
          <input type="text" class="bsk-notes" value="${escapeHtml(data.notes)}" placeholder="Ghi chú thêm (nếu có)" maxlength="2000" enterkeyhint="next">
        </div>
      </div>
    `;

    const countInput = card.querySelector('.bsk-count');
    const weightInput = card.querySelector('.bsk-weight');
    // Khối lượng đã được nhập tay (khác số giỏ x 350) -> giữ nguyên khi đổi số giỏ
    if (basketWeightIsManual(data.basket_count, data.total_weight)) {
      weightInput.dataset.manual = 'true';
    }

    countInput.addEventListener('input', () => {
      if (weightInput.dataset.manual) return;
      const count = parseFloatOr(countInput.value, 0);
      // Xóa số giỏ thì xóa luôn khối lượng tự tính, tránh lưu khối lượng cũ với 0 giỏ
      weightInput.value = count > 0 ? count * 350 : '';
    });

    weightInput.addEventListener('input', () => {
      weightInput.dataset.manual = weightInput.value.trim() ? "true" : "";
    });

    attachRemoveHandler(card, containerBaskets);
    containerBaskets.appendChild(card);
    updateCardIndexes();
  }

  // 3. Tumbling Card (Số mẻ bi xóc)
  function addTumblingCard(data = {}) {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.innerHTML = `
      <div class="entry-card-header">
        <div class="entry-card-title">
          <span class="card-icon">⚙️</span>
          <span class="card-title-text">Mẻ bi xóc</span>
        </div>
        <button type="button" class="btn-remove-card" title="Xóa mục này">
          <span>Xóa</span> ✕
        </button>
      </div>
      <div class="entry-card-body">
        <div class="grid grid-2">
          <div class="form-group">
            <label>Tên Sản Phẩm <span class="req">*</span></label>
            <input type="text" class="tmb-product input-lg" list="presetProducts" value="${escapeHtml(data.product_name || (presets.products && presets.products[0]) || 'D25')}" placeholder="VD: D25" maxlength="100" enterkeyhint="next">
          </div>
          <div class="form-group">
            <label>Khách Hàng <span class="req">*</span></label>
            <input type="text" class="tmb-customer input-lg" list="presetCustomers" value="${escapeHtml(data.customer || (presets.customers && presets.customers[0]) || 'Molycop')}" placeholder="VD: Molycop" maxlength="100" enterkeyhint="next">
          </div>
        </div>

        <div class="grid grid-2 mt-2">
          <div class="form-group">
            <label>Máy Xóc 1 (Lượt)</label>
            <input type="number" class="tmb-m1 input-lg input-highlight" value="${numberAttr(data.m1)}" placeholder="0" min="0" max="100000" step="any" inputmode="decimal" enterkeyhint="next">
          </div>
          <div class="form-group">
            <label>Máy Xóc 2 (Lượt)</label>
            <input type="number" class="tmb-m2 input-lg input-highlight" value="${numberAttr(data.m2)}" placeholder="0" min="0" max="100000" step="any" inputmode="decimal" enterkeyhint="next">
          </div>
        </div>

        <div class="grid grid-2 mt-2">
          <div class="form-group">
            <label>Tổng Khối Lượng (Kg)</label>
            <input type="number" class="tmb-weight input-lg input-highlight" value="${escapeHtml(data.total_weight || '')}" placeholder="0" min="0" max="10000000" step="any" inputmode="decimal" enterkeyhint="next">
          </div>
          <div class="form-group">
            <label>Ghi Chú (Khô dầu...)</label>
            <input type="text" class="tmb-notes input-lg" value="${escapeHtml(data.notes)}" placeholder="VD: Khô dầu..." maxlength="2000" enterkeyhint="next">
          </div>
        </div>
      </div>
    `;

    attachRemoveHandler(card, containerTumbling);
    containerTumbling.appendChild(card);
    updateCardIndexes();
  }

  // Add initial cards
  addPackagingCard();
  addBasketCard();
  addTumblingCard();

  btnAddPackagingRow.addEventListener('click', () => addPackagingCard());
  btnAddPackagingBottom.addEventListener('click', () => addPackagingCard());

  btnAddBasketRow.addEventListener('click', () => addBasketCard());
  btnAddBasketBottom.addEventListener('click', () => addBasketCard());

  btnAddTumblingRow.addEventListener('click', () => addTumblingCard());
  btnAddTumblingBottom.addEventListener('click', () => addTumblingCard());

  // Sao chép danh mục (tên SP / khách hàng / mác thép) từ ca gần nhất.
  // Không xóa các dòng đã nhập số liệu, không chép ghi chú.
  const CLONE_SECTIONS = [
    {
      container: containerPackaging, key: 'packaging', fields: ['product_name', 'customer'], add: item => addPackagingCard(item),
      read: card => ({
        product_name: card.querySelector('.pkg-product').value,
        customer: card.querySelector('.pkg-customer').value,
        hasContent: rowHasContent([card.querySelector('.pkg-sorted').value, card.querySelector('.pkg-waste').value],
          card.querySelector('.pkg-notes').value)
      })
    },
    {
      container: containerBaskets, key: 'baskets', fields: ['product_name', 'customer', 'steel_grade'], add: item => addBasketCard(item),
      read: card => ({
        product_name: card.querySelector('.bsk-product').value,
        customer: card.querySelector('.bsk-customer').value,
        steel_grade: card.querySelector('.bsk-steel').value,
        hasContent: rowHasContent([
          card.querySelector('.bsk-count').value,
          card.querySelector('.bsk-from').value,
          card.querySelector('.bsk-to').value,
          card.querySelector('.bsk-weight').value
        ], card.querySelector('.bsk-notes').value)
      })
    },
    {
      container: containerTumbling, key: 'tumbling', fields: ['product_name', 'customer'], add: item => addTumblingCard(item),
      read: card => ({
        product_name: card.querySelector('.tmb-product').value,
        customer: card.querySelector('.tmb-customer').value,
        hasContent: rowHasContent([card.querySelector('.tmb-m1').value, card.querySelector('.tmb-m2').value,
          card.querySelector('.tmb-weight').value], card.querySelector('.tmb-notes').value)
      })
    }
  ];

  btnClonePrevious.addEventListener('click', async () => {
    if (cloneBusy || isSaving) return;
    cloneBusy = true;
    renderSubmitButton();
    btnClonePrevious.textContent = '⏳ Đang sao chép...';
    try {
      const res = await apiFetch('/api/shifts/previous-template');
      const data = await res.json();
      if (!data.found) {
        showToast('Chưa có ca nào trước đó để sao chép!');
        return;
      }

      let keptRows = 0;
      CLONE_SECTIONS.forEach(section => {
        const cards = [...section.container.querySelectorAll('.entry-card')];
        const plan = planTemplateMerge(cards.map(section.read), data[section.key] || [], section.fields);
        cards.forEach((card, i) => {
          if (!plan.keep.includes(i)) card.remove();
        });
        if ((data[section.key] || []).length > 0) keptRows += plan.keep.length;
        plan.add.forEach(item => section.add(item));
        if (section.container.children.length === 0) section.add();
      });
      updateCardIndexes();

      showToast(`✅ Đã sao chép danh mục từ ${data.from_shift}!` +
        (keptRows > 0 ? ` (giữ nguyên ${keptRows} dòng đã nhập số liệu)` : ''));
      triggerAutoSave();
    } catch (err) {
      if (err.status !== 401) showToast('Lỗi: ' + err.message);
    } finally {
      cloneBusy = false;
      btnClonePrevious.textContent = '📋 Sao chép từ ca trước';
      renderSubmitButton();
    }
  });

  // Auto-save draft on any user input
  shiftReportForm.addEventListener('input', triggerAutoSave);

  // Enter/"Go" trong ô nhập một dòng: không gửi cả báo cáo, chuyển sang ô kế tiếp
  shiftReportForm.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return; // textarea xuống dòng, nút bấm vẫn hoạt động
    if (['submit', 'button', 'reset', 'image'].includes(target.type)) return;
    e.preventDefault();
    focusNextField(target);
  });

  function focusNextField(from) {
    const fields = [...shiftReportForm.querySelectorAll('input, select, textarea')]
      .filter(el => !el.disabled && !el.readOnly && el.type !== 'hidden' && el.offsetParent !== null);
    const next = fields[fields.indexOf(from) + 1];
    if (!next) {
      from.blur();
      return;
    }
    next.focus();
    if (next instanceof HTMLInputElement && ['text', 'number'].includes(next.type)) {
      try {
        next.select();
      } catch (err) {
        // một số loại ô không hỗ trợ select()
      }
    }
  }

  // Trình duyệt cuộn tới ô lỗi: đảm bảo ô không bị thanh tiêu đề dính trên cùng che mất
  shiftReportForm.addEventListener('invalid', (e) => {
    if (invalidScrollPending) return;
    invalidScrollPending = true;
    const field = e.target;
    setTimeout(() => {
      invalidScrollPending = false;
      const coveredBottom = [document.querySelector('.app-header'), document.querySelector('.tab-nav')]
        .filter(el => el && ['sticky', 'fixed'].includes(getComputedStyle(el).position))
        .reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), 0);
      const rect = field.getBoundingClientRect();
      if (rect.top < coveredBottom + 8 || rect.bottom > window.innerHeight) {
        window.scrollBy(0, rect.top - coveredBottom - 16);
      }
    }, 50);
  }, true);

  // Initial check on load
  renderShiftStatus();
  checkCurrentShiftStatus();

  // --- SUBMIT REPORT FORM ---
  shiftReportForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSaving) return;

    const state = currentSubmitState();
    if (!state.canSubmit) {
      if (state.mode === 'locked') {
        showToast('Bạn không có quyền sửa báo cáo ca này.');
      } else if (state.mode === 'error') {
        showToast('Chưa kiểm tra được trạng thái ca. Bấm "Thử lại" rồi gửi lại.');
      } else {
        showToast('Đang kiểm tra trạng thái ca, vui lòng đợi rồi bấm gửi lại.');
        const checkingCurrent = shiftStatus && shiftStatus.phase === 'checking' &&
          shiftStatus.date === reportDateInput.value && shiftStatus.shift === shiftNumSelect.value;
        if (!checkingCurrent) checkCurrentShiftStatus();
      }
      return;
    }

    updateAttendanceValidity();
    if (!shiftReportForm.checkValidity()) {
      shiftReportForm.reportValidity();
      return;
    }

    const reportDate = reportDateInput.value;
    const shiftNum = parseInt(shiftNumSelect.value, 10);

    const packaging = [];
    containerPackaging.querySelectorAll('.entry-card').forEach(card => {
      const sortedRaw = card.querySelector('.pkg-sorted').value;
      const wasteRaw = card.querySelector('.pkg-waste').value;
      const notes = card.querySelector('.pkg-notes').value.trim();
      if (!rowHasContent([sortedRaw, wasteRaw], notes)) return;
      packaging.push({
        product_name: card.querySelector('.pkg-product').value.trim(),
        customer: card.querySelector('.pkg-customer').value.trim(),
        weight_sorted: parseFloatOr(sortedRaw, 0),
        weight_waste: parseFloatOr(wasteRaw, 0),
        notes: notes
      });
    });

    const baskets = [];
    containerBaskets.querySelectorAll('.entry-card').forEach(card => {
      const countRaw = card.querySelector('.bsk-count').value;
      const weightRaw = card.querySelector('.bsk-weight').value;
      const notes = card.querySelector('.bsk-notes').value.trim();
      if (!rowHasContent([countRaw, weightRaw], notes)) return;
      const count = parseFloatOr(countRaw, 0);
      const weight = parseFloatOr(weightRaw, null);
      baskets.push({
        product_name: card.querySelector('.bsk-product').value.trim(),
        customer: card.querySelector('.bsk-customer').value.trim(),
        steel_grade: card.querySelector('.bsk-steel').value.trim(),
        basket_count: count,
        from_val: card.querySelector('.bsk-from').value.trim(),
        to_val: card.querySelector('.bsk-to').value.trim(),
        total_weight: weight === null ? count * 350 : weight,
        notes: notes
      });
    });

    const tumbling = [];
    containerTumbling.querySelectorAll('.entry-card').forEach(card => {
      const m1Raw = card.querySelector('.tmb-m1').value;
      const m2Raw = card.querySelector('.tmb-m2').value;
      const weightRaw = card.querySelector('.tmb-weight').value;
      const notes = card.querySelector('.tmb-notes').value.trim();
      if (!rowHasContent([m1Raw, m2Raw, weightRaw], notes)) return;
      tumbling.push({
        product_name: card.querySelector('.tmb-product').value.trim(),
        customer: card.querySelector('.tmb-customer').value.trim(),
        m1: parseFloatOr(m1Raw, 0),
        m2: parseFloatOr(m2Raw, 0),
        total_weight: parseFloatOr(weightRaw, 0),
        notes: notes
      });
    });

    const staffTotal = parseIntOr(staffTotalInput.value, 5);
    const payload = {
      report_date: reportDate,
      shift_num: shiftNum,
      safety_production: document.getElementById('safetyProduction').checked,
      safety_ppe: document.getElementById('safetyPpe').checked,
      safety_equip: document.getElementById('safetyEquip').checked,
      staff_total: staffTotal,
      // Ô "Có mặt" để trống thì coi như đủ sĩ số; nhập 0 thì giữ đúng 0
      staff_present: parseIntOr(staffPresentInput.value, staffTotal),
      leave_permitted: parseIntOr(leavePermittedInput.value, 0),
      leave_permitted_names: document.getElementById('leavePermittedNames').value.trim(),
      leave_rotating: parseIntOr(leaveRotatingInput.value, 0),
      leave_rotating_names: leaveRotatingNamesInput.value.trim(),
      leave_unpermitted: parseIntOr(leaveUnpermittedInput.value, 0),
      leave_unpermitted_names: document.getElementById('leaveUnpermittedNames').value.trim(),
      issues: document.getElementById('shiftIssues').value.trim(),
      suggestions: document.getElementById('shiftSuggestions').value.trim(),
      shift_tasks: document.getElementById('shiftTasks').value.trim(),
      start_time: startTimeInput.value.trim(),
      end_time: endTimeInput.value.trim(),
      packaging: packaging,
      baskets: baskets,
      tumbling: tumbling,
      // Máy chủ từ chối nếu trạng thái thực tế khác với lúc kiểm tra (tránh ghi đè / nộp trùng)
      expected_mode: state.expectedMode
    };

    isSaving = true;
    renderSubmitButton();
    let saved = false;
    let failure = null;
    try {
      const res = await apiFetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      saved = true;
      showToast(data.message || 'Lưu báo cáo thành công!');
      cancelPendingAutoSave();
      clearCurrentDraft(reportDate, shiftNum);
      removeStored(getEditKey(reportDate, shiftNum));
      formSource = 'server';
    } catch (err) {
      failure = err;
    } finally {
      isSaving = false;
    }
    const selectionChangedWhileSaving = recheckAfterSave;
    recheckAfterSave = false;

    if (failure) {
      if (failure.status === 401) return; // đã chuyển về trang đăng nhập
      reportError(failure);
      if (failure.status === 403 || failure.status === 409 || selectionChangedWhileSaving) {
        // Trạng thái ca đã thay đổi (người khác nộp / báo cáo bị xóa): kiểm tra lại
        await checkCurrentShiftStatus();
      } else {
        renderSubmitButton();
      }
      return;
    }

    if (saved) {
      await checkCurrentShiftStatus();
      if (currentUser.role === 'admin') {
        setTimeout(() => {
          summaryDateInput.value = reportDate;
          document.getElementById('btnTabSummary').click();
        }, 1200);
      } else {
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 500);
      }
    }
  });

  // --- ADMIN: XÓA BÁO CÁO CA NỘP NHẦM ---
  btnDeleteShift.addEventListener('click', async () => {
    if (isSaving || currentUser.role !== 'admin' || currentSubmitState().mode !== 'update') return;
    const { date, shift } = activeSelection;
    const leader = shiftStatus && shiftStatus.leader ? ` của ${shiftStatus.leader}` : '';
    if (!confirm(`Xóa báo cáo Ca ${shift} ngày ${formatDateDisplay(date)}${leader}?\n\nToàn bộ số liệu của ca này sẽ bị xóa khỏi hệ thống và không thể khôi phục.`)) {
      return;
    }
    isSaving = true;
    renderSubmitButton();
    let failure = null;
    try {
      const res = await apiFetch(`/api/shifts?date=${encodeURIComponent(date)}&shift_num=${encodeURIComponent(shift)}`, { method: 'DELETE' });
      const data = await res.json();
      cancelPendingAutoSave();
      removeStored(getEditKey(date, shift));
      // Nội dung đang hiển thị là của báo cáo vừa xóa -> sẽ được xóa trắng khi kiểm tra lại
      formSource = 'server';
      showToast(data.message || 'Đã xóa báo cáo ca.');
    } catch (err) {
      failure = err;
    } finally {
      isSaving = false;
      recheckAfterSave = false;
    }
    if (failure) {
      if (failure.status === 401) return;
      reportError(failure);
    }
    await checkCurrentShiftStatus();
  });

  btnResetForm.addEventListener('click', () => {
    if (isSaving) return;
    if (confirm('Bạn có chắc chắn muốn làm mới toàn bộ form?')) {
      cancelPendingAutoSave();
      clearCurrentDraft(activeSelection.date, activeSelection.shift);
      reportDateInput.value = todayStr();
      shiftNumSelect.value = '1';
      resetFormToBlank();
      checkCurrentShiftStatus();
    }
  });

  // --- TAB 2: SUMMARY & EXCEL EXPORT ---
  btnLoadSummary.addEventListener('click', loadSummary);
  summaryDateInput.addEventListener('change', loadSummary);

  async function loadSummary() {
    const selDate = summaryDateInput.value;
    const seq = ++summaryRequestSeq;
    if (!selDate) return;

    shiftsBadgesContainer.innerHTML = '';
    summaryResultsContainer.innerHTML = `<div style="text-align: center; padding: 2rem;">Đang tải dữ liệu tổng hợp ngày ${escapeHtml(formatDateDisplay(selDate))}...</div>`;

    try {
      const res = await apiFetch(`/api/daily-summary?date=${encodeURIComponent(selDate)}`);
      const data = await res.json();
      // Một lần tải khác (ngày khác) đã bắt đầu sau lần này -> bỏ kết quả cũ
      if (seq !== summaryRequestSeq) return;

      renderShiftsProgress(data.submitted_shifts || []);
      renderSummaryResults(data);
    } catch (err) {
      if (seq !== summaryRequestSeq || err.status === 401) return;
      shiftsBadgesContainer.innerHTML = '';
      summaryResultsContainer.innerHTML = `<div class="card" style="color: var(--danger);">Lỗi tải dữ liệu ngày ${escapeHtml(formatDateDisplay(selDate))}: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderShiftsProgress(submittedShifts) {
    shiftsBadgesContainer.innerHTML = '';
    for (let s = 1; s <= 3; s++) {
      const isDone = submittedShifts.includes(s);
      const badge = document.createElement('div');
      badge.className = `shift-badge ${isDone ? 'submitted' : 'pending'}`;
      badge.innerHTML = `
        <span>${isDone ? '✓' : '○'}</span>
        <span>Ca ${s}: ${isDone ? 'Đã Nộp' : 'Chờ Nộp'}</span>
      `;
      shiftsBadgesContainer.appendChild(badge);
    }
  }

  function formatNumber(value) {
    return escapeHtml(formatQuantity(value));
  }

  function summaryDateHeading(reportDate) {
    return `<div class="summary-date-heading">📅 Số liệu tổng hợp ngày <strong>${escapeHtml(formatDateDisplay(reportDate))}</strong></div>`;
  }

  function renderSummaryResults(data) {
    if (!data.submitted_shifts || data.submitted_shifts.length === 0) {
      summaryResultsContainer.innerHTML = `
        ${summaryDateHeading(data.report_date)}
        <div class="card" style="text-align: center; padding: 3rem 1rem;">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📋</div>
          <h3 style="color: var(--slate-700);">Chưa có ca nào nộp báo cáo cho ngày ${escapeHtml(formatDateDisplay(data.report_date))}</h3>
          <p style="color: var(--slate-600); margin-top: 0.5rem;">Hãy dùng Tab "Ca Trưởng Nhập Báo Cáo" để gửi báo cáo của Ca 1, 2 hoặc 3.</p>
        </div>
      `;
      return;
    }

    let totalSorted = 0;
    let totalWaste = 0;
    (data.packaging || []).forEach(p => {
      totalSorted += p.weight_sorted || 0;
      totalWaste += p.weight_waste || 0;
    });
    const avgWasteRate = totalSorted > 0 ? (totalWaste / totalSorted) * 100 : 0;

    let totalBaskets = 0;
    let totalBasketWeight = 0;
    (data.baskets || []).forEach(b => {
      totalBaskets += b.basket_count || 0;
      totalBasketWeight += b.total_weight || 0;
    });

    let totalTumblingRuns = 0;
    let totalTumblingWeight = 0;
    (data.tumbling || []).forEach(t => {
      totalTumblingRuns += (t.m1 || 0) + (t.m2 || 0);
      totalTumblingWeight += t.total_weight || 0;
    });

    const attendance = data.attendance || {};
    const warnings = excelOverflowWarnings(data);
    const warningHtml = warnings.length > 0 ? `
      <div class="shift-status-banner warning">
        <div class="banner-icon">⚠️</div>
        <div class="banner-content">
          <div class="banner-title">Lưu ý khi xuất Excel</div>
          ${warnings.map(w => `<div class="banner-desc">${escapeHtml(w)}</div>`).join('')}
        </div>
      </div>
    ` : '';

    const html = `
      ${summaryDateHeading(data.report_date)}
      ${warningHtml}
      <!-- KPIS -->
      <div class="summary-kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">Tổng KL Phân Loại</div>
          <div class="kpi-value">${formatNumber(totalSorted)}<span class="kpi-unit">Kg</span></div>
          <div class="kpi-sub">Khoảng ${escapeHtml((totalSorted / 1000).toFixed(1))} tấn</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Tỉ Lệ Hủy Bình Quân</div>
          <div class="kpi-value" style="color: ${avgWasteRate > 2 ? 'var(--danger)' : 'var(--success)'};">${escapeHtml(avgWasteRate.toFixed(2))}%</div>
          <div class="kpi-sub">Tổng hủy: ${formatNumber(totalWaste)} Kg</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Tổng Bi Ra Sau Tôi</div>
          <div class="kpi-value">${formatNumber(totalBaskets)}<span class="kpi-unit">Giỏ</span></div>
          <div class="kpi-sub">${formatNumber(totalBasketWeight)} Kg</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Tổng Mẻ Bi Xóc</div>
          <div class="kpi-value">${formatNumber(totalTumblingRuns)}<span class="kpi-unit">Lượt</span></div>
          <div class="kpi-sub">${formatNumber(totalTumblingWeight)} Kg</div>
        </div>
      </div>

      <!-- CHẤM CÔNG CỘNG DỒN -->
      <div class="card">
        <div class="section-header">
          <span class="section-num">✓</span>
          <h2>Chấm Công Toàn Phân Xưởng</h2>
        </div>
        <div class="grid grid-3">
          <div><strong>Sĩ số:</strong> <span class="summary-val">${formatNumber(attendance.total_staff)}</span> người</div>
          <div><strong>Có mặt:</strong> <span class="summary-val">${formatNumber(attendance.present)}</span> người</div>
          <div><strong>Vắng mặt:</strong> <span class="summary-val">${formatNumber(absentCount(attendance.total_staff, attendance.present))}</span> người</div>
        </div>
        <div class="mt-2" style="font-size: 0.9rem; color: var(--slate-700); line-height: 1.6;">
          <div><strong>Nghỉ phép:</strong> <span class="summary-val">${escapeHtml(attendance.leave_notes)}</span></div>
          <div><strong>Nghỉ luân phiên:</strong> <span class="summary-val">${attendance.leave_rotating ? `${formatNumber(attendance.leave_rotating)} người (${escapeHtml(attendance.rotating_notes)})` : escapeHtml(attendance.rotating_notes || 'Ko')}</span></div>
          <div><strong>Nghỉ không phép:</strong> <span class="summary-val">${escapeHtml(attendance.unpermitted)}</span></div>
        </div>
      </div>

      <!-- BAO GÓI SẢN PHẨM CỘNG DỒN -->
      <div class="card">
        <div class="section-header">
          <span class="section-num">1</span>
          <h2>Bao Gói Sản Phẩm (Đã Cộng Dồn Giữa Các Ca)</h2>
        </div>
        <div class="table-responsive">
          <table class="data-table summary-table">
            <thead>
              <tr>
                <th>Tên SP</th>
                <th>Khách Hàng</th>
                <th>Tổng KL Phân Loại (Kg)</th>
                <th>Tổng KL Hủy (Kg)</th>
                <th>Tỉ Lệ Hủy (%)</th>
                <th>Ghi Chú</th>
              </tr>
            </thead>
            <tbody>
              ${(data.packaging || []).length > 0 ? (data.packaging || []).map(p => {
                const rate = p.weight_sorted > 0 ? (p.weight_waste / p.weight_sorted) * 100 : 0;
                return `
                  <tr>
                    <td><strong>${escapeHtml(p.product_name)}</strong></td>
                    <td>${escapeHtml(p.customer)}</td>
                    <td>${formatNumber(p.weight_sorted)}</td>
                    <td>${formatNumber(p.weight_waste)}</td>
                    <td><span class="rate-badge ${rate > 2 ? 'bad' : 'good'}">${escapeHtml(rate.toFixed(2))}%</span></td>
                    <td>${escapeHtml(p.notes)}</td>
                  </tr>
                `;
              }).join('') : '<tr><td colspan="6" style="text-align: center; color: var(--slate-600);">Không có số liệu</td></tr>'}
            </tbody>
          </table>
        </div>
        ${(data.packaging_notes || []).length > 0 ? `
          <div class="mt-2" style="font-size: 0.9rem; color: var(--slate-700);">
            ${(data.packaging_notes || []).map(n => `<div>${escapeHtml(n)}</div>`).join('')}
          </div>
        ` : ''}
      </div>

      <!-- GIỎ BI SAU TÔI CỘNG DỒN -->
      <div class="card">
        <div class="section-header">
          <span class="section-num">2</span>
          <h2>Số Lượng Giỏ Bi Ra Sau Tôi (Cộng Dồn)</h2>
        </div>
        <div class="table-responsive">
          <table class="data-table summary-table">
            <thead>
              <tr>
                <th>Tên SP</th>
                <th>Khách Hàng</th>
                <th>Mác Thép</th>
                <th>Tổng Số Giỏ</th>
                <th>Từ Giỏ - Đến Giỏ</th>
                <th>Tổng Khối Lượng (Kg)</th>
                <th>Ghi Chú</th>
              </tr>
            </thead>
            <tbody>
              ${(data.baskets || []).length > 0 ? (data.baskets || []).map(b => `
                <tr>
                  <td><strong>${escapeHtml(b.product_name)}</strong></td>
                  <td>${escapeHtml(b.customer)}</td>
                  <td>${escapeHtml(b.steel_grade)}</td>
                  <td><strong>${formatNumber(b.basket_count)}</strong></td>
                  <td>${b.from_val && b.to_val ? escapeHtml(String(b.from_val)) + ' → ' + escapeHtml(String(b.to_val)) : '-'}</td>
                  <td>${formatNumber(b.total_weight)}</td>
                  <td>${escapeHtml(b.notes)}</td>
                </tr>
              `).join('') : '<tr><td colspan="7" style="text-align: center; color: var(--slate-600);">Không có số liệu</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- MẺ BI XÓC CỘNG DỒN -->
      <div class="card">
        <div class="section-header">
          <span class="section-num">3</span>
          <h2>Số Mẻ Bi Xóc (Cộng Dồn Máy 1 & Máy 2)</h2>
        </div>
        <div class="table-responsive">
          <table class="data-table summary-table">
            <thead>
              <tr>
                <th>Tên SP</th>
                <th>Khách Hàng</th>
                <th>Máy Xóc 1 (Lượt)</th>
                <th>Máy Xóc 2 (Lượt)</th>
                <th>Tổng KL (Kg)</th>
                <th>Ghi Chú</th>
              </tr>
            </thead>
            <tbody>
              ${(() => {
                const items = data.tumbling || [];
                if (items.length === 0) {
                  return '<tr><td colspan="6" style="text-align: center; color: var(--slate-600);">Không có số liệu</td></tr>';
                }
                const rows = [];
                let i = 0;
                while (i < items.length) {
                  const t = items[i];
                  let span = 1;
                  if (t.product_name) {
                    while (i + span < items.length && items[i + span].product_name === t.product_name && items[i + span].customer === t.customer) {
                      span++;
                    }
                  }
                  for (let k = 0; k < span; k++) {
                    const rowItem = items[i + k];
                    const m1Text = rowItem.m1 ? formatNumber(rowItem.m1) : '-';
                    const m2Text = rowItem.m2 ? formatNumber(rowItem.m2) : '-';
                    const wtText = formatNumber(rowItem.total_weight);
                    if (k === 0) {
                      rows.push(`
                        <tr>
                          <td ${span > 1 ? `rowspan="${span}" style="vertical-align: middle; text-align: center;"` : ''}><strong>${escapeHtml(t.product_name)}</strong></td>
                          <td ${span > 1 ? `rowspan="${span}" style="vertical-align: middle; text-align: center;"` : ''}>${escapeHtml(t.customer)}</td>
                          <td>${m1Text}</td>
                          <td>${m2Text}</td>
                          <td><strong>${wtText}</strong></td>
                          <td>${escapeHtml(rowItem.notes || '')}</td>
                        </tr>
                      `);
                    } else {
                      rows.push(`
                        <tr>
                          <td>${m1Text}</td>
                          <td>${m2Text}</td>
                          <td><strong>${wtText}</strong></td>
                          <td>${escapeHtml(rowItem.notes || '')}</td>
                        </tr>
                      `);
                    }
                  }
                  i += span;
                }
                return rows.join('');
              })()}
            </tbody>
          </table>
        </div>
      </div>

      <!-- SỰ CỐ TỔNG HỢP -->
      <div class="card">
        <div class="section-header">
          <span class="section-num">⚠️</span>
          <h2>Sự Cố Thiết Bị & Đề Xuất Trong Toàn Ngày</h2>
        </div>
        <div>
          <h4 style="color: var(--danger); margin-bottom: 0.5rem;">Danh Sách Sự Cố:</h4>
          ${(data.issues && data.issues.length > 0) ? `
            <ul style="padding-left: 1.5rem; line-height: 1.8;">
              ${data.issues.map(iss => `<li class="summary-val">${escapeHtml(iss)}</li>`).join('')}
            </ul>
          ` : '<p style="color: var(--success); font-weight: 500;">✓ Toàn ngày không có sự cố thiết bị.</p>'}
        </div>
        <div class="mt-2" style="border-top: 1px solid var(--slate-200); padding-top: 0.75rem;">
          <strong>Yêu cầu - Đề xuất:</strong> <span class="summary-val">${escapeHtml(data.suggestions || 'KO')}</span>
        </div>
      </div>

      <!-- XÁC NHẬN & CHỮ KÝ -->
      <div class="card" style="margin-top: 1rem;">
        <div style="display: flex; justify-content: space-around; align-items: flex-start; text-align: center; padding: 1rem 0;">
          <div style="flex: 1; max-width: 250px;">
            <div style="font-weight: 700; color: var(--slate-700); margin-bottom: 0.5rem; text-transform: uppercase;">GĐ Nhà Máy</div>
            <div style="height: 85px; display: flex; align-items: center; justify-content: center;">
              <img src="/signature_gd.png" alt="Chữ ký GĐ Nhà máy" style="max-height: 80px; max-width: 140px; object-fit: contain;">
            </div>
            <div style="font-size: 0.85rem; color: var(--slate-500); margin-top: 0.25rem;">(Đã ký)</div>
          </div>
          <div style="flex: 1; max-width: 250px;">
            <div style="font-weight: 700; color: var(--slate-700); margin-bottom: 0.5rem; text-transform: uppercase;">Người Báo Cáo</div>
            <div style="height: 85px; display: flex; align-items: flex-end; justify-content: center; font-weight: 600; color: var(--slate-800); padding-bottom: 8px;">
              ${escapeHtml(data.reporter_name || 'Ngọc Quang')}
            </div>
            <div style="font-size: 0.85rem; color: var(--slate-500); margin-top: 0.25rem;">(Báo cáo tổng hợp)</div>
          </div>
        </div>
      </div>
    `;

    summaryResultsContainer.innerHTML = html;
  }

  // TẢI FILE EXCEL (dùng fetch để báo lỗi ngay trên trang thay vì mở trang JSON)
  btnExportExcel.addEventListener('click', async () => {
    const selDate = summaryDateInput.value;
    if (!selDate) return;

    const originalHtml = btnExportExcel.innerHTML;
    btnExportExcel.disabled = true;
    btnExportExcel.textContent = 'Đang tạo file Excel...';
    try {
      const res = await apiFetch(`/api/export-excel?date=${encodeURIComponent(selDate)}`);
      const blob = await res.blob();
      const filename = filenameFromContentDisposition(
        res.headers.get('Content-Disposition'),
        `BAO_CAO_TONG_HOP_${selDate.replace(/-/g, '')}.xlsx`
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      reportError(err);
    } finally {
      btnExportExcel.disabled = false;
      btnExportExcel.innerHTML = originalHtml;
    }
  });

  // ĐỒNG BỘ VÀO FILE TỔNG HỢP GỐC
  btnSyncMaster.addEventListener('click', async () => {
    const selDate = summaryDateInput.value;
    if (!selDate) return;

    if (!confirm(`Bạn có muốn đồng bộ số liệu ngày ${formatDateDisplay(selDate)} vào file BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx gốc không?\n\n(Hệ thống sẽ tự động sao lưu 1 bản trước khi ghi).`)) {
      return;
    }

    const originalHtml = btnSyncMaster.innerHTML;
    try {
      btnSyncMaster.disabled = true;
      btnSyncMaster.textContent = 'Đang đồng bộ...';

      const res = await apiFetch(`/api/sync-to-master?date=${encodeURIComponent(selDate)}`, { method: 'POST' });
      const data = await res.json();

      showToast(`Đã ghi sheet [${data.sheet_name}] vào file tổng hợp thành công!`);
      alert(`Thành công!\n- Đã đồng bộ vào Sheet: ${data.sheet_name}\n- File sao lưu an toàn tại: ${data.backup_file}`);
    } catch (err) {
      reportError(err);
    } finally {
      btnSyncMaster.disabled = false;
      btnSyncMaster.innerHTML = originalHtml;
    }
  });

  // --- TAB 3: HISTORY ---
  btnRefreshHistory.addEventListener('click', loadHistory);

  async function loadHistory() {
    try {
      const res = await apiFetch('/api/history');
      const items = await res.json();
      tbodyHistory.innerHTML = '';

      if (!items || items.length === 0) {
        tbodyHistory.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem;">Chưa có dữ liệu lịch sử nào.</td></tr>';
        return;
      }

      items.forEach(it => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${escapeHtml(formatDateDisplay(it.report_date))}</strong></td>
          <td><span class="rate-badge ${it.shift_count === 3 ? 'good' : 'warn'}">${escapeHtml(it.shift_count)} / 3 ca</span></td>
          <td>Ca: ${escapeHtml(it.shifts)}</td>
          <td>${escapeHtml(it.leaders)}</td>
          <td>
            <button class="btn btn-sm btn-outline btn-view-date">Xem & Xuất Excel</button>
          </td>
        `;

        tr.querySelector('.btn-view-date').addEventListener('click', () => {
          summaryDateInput.value = it.report_date;
          document.getElementById('btnTabSummary').click();
        });

        tbodyHistory.appendChild(tr);
      });
    } catch (err) {
      if (err.status === 401) return;
      tbodyHistory.innerHTML = `<tr><td colspan="5" style="color: var(--danger);">Lỗi tải lịch sử: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // --- TAB 4: ADMIN USER MANAGEMENT ---
  const tbodyUsers = document.getElementById('tbodyUsers');
  const createUserForm = document.getElementById('createUserForm');

  createUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      username: document.getElementById('newUsername').value.trim(),
      full_name: document.getElementById('newFullName').value.trim(),
      password: document.getElementById('newPassword').value,
      role: document.getElementById('newRole').value
    };
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('Đã tạo tài khoản! Người dùng sẽ phải đổi mật khẩu khi đăng nhập lần đầu.');
      createUserForm.reset();
      loadUsers();
    } catch (err) {
      reportError(err);
    }
  });

  async function loadUsers() {
    try {
      const res = await apiFetch('/api/admin/users');
      const users = await res.json();
      tbodyUsers.innerHTML = '';
      users.forEach(u => {
        const isSelf = u.username === currentUser.username;
        let statusBadge = `<span class="rate-badge ${u.active ? 'good' : 'bad'}">${u.active ? 'Đang hoạt động' : 'Đã khóa'}</span>`;
        if (u.active && u.must_change_password) {
          statusBadge += ' <span class="rate-badge warn">Chờ đổi mật khẩu</span>';
        }
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(u.username)}</td>
          <td>${escapeHtml(u.full_name)}${isSelf ? ' <em>(bạn)</em>' : ''}</td>
          <td>${u.role === 'admin' ? 'Admin' : 'Ca trưởng'}</td>
          <td>${statusBadge}</td>
          <td>
            ${isSelf ? '' : `<button class="btn btn-sm btn-outline btn-toggle-active">${u.active ? 'Khóa' : 'Mở khóa'}</button>`}
            <button class="btn btn-sm btn-outline btn-reset-password">Đổi mật khẩu</button>
          </td>
        `;
        const btnToggle = tr.querySelector('.btn-toggle-active');
        if (btnToggle) {
          btnToggle.addEventListener('click', async () => {
            try {
              await apiFetch(`/api/admin/users/${u.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: !u.active })
              });
              loadUsers();
            } catch (err) {
              reportError(err);
            }
          });
        }
        tr.querySelector('.btn-reset-password').addEventListener('click', async () => {
          if (isSelf) {
            openPasswordModal(false);
            return;
          }
          const newPassword = prompt(`Nhập mật khẩu tạm mới cho ${u.full_name} (ít nhất 6 ký tự).\nNgười dùng sẽ phải đổi lại khi đăng nhập.`);
          if (!newPassword) return;
          try {
            await apiFetch(`/api/admin/users/${u.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: newPassword })
            });
            showToast('Đã đặt mật khẩu tạm mới!');
            loadUsers();
          } catch (err) {
            reportError(err);
          }
        });
        tbodyUsers.appendChild(tr);
      });
    } catch (err) {
      if (err.status === 401) return;
      tbodyUsers.innerHTML = `<tr><td colspan="5" style="color: var(--danger);">Lỗi tải danh sách: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // ================= ADMIN: PRESETS (MASTER DATA) MANAGEMENT =================
  const createPresetForm = document.getElementById('createPresetForm');
  const btnRefreshPresets = document.getElementById('btnRefreshPresets');
  const listPresetProducts = document.getElementById('listPresetProducts');
  const listPresetCustomers = document.getElementById('listPresetCustomers');
  const listPresetSteelGrades = document.getElementById('listPresetSteelGrades');

  if (btnRefreshPresets) {
    btnRefreshPresets.addEventListener('click', loadAdminPresets);
  }

  if (createPresetForm) {
    createPresetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const category = document.getElementById('newPresetCategory').value;
      const name = document.getElementById('newPresetName').value.trim();
      const sort_order = parseInt(document.getElementById('newPresetOrder').value, 10) || 0;
      if (!name) return;

      try {
        await apiFetch('/api/admin/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, name, sort_order }),
        });
        document.getElementById('newPresetName').value = '';
        showToast(`Đã thêm "${name}" vào danh mục!`);
        await loadAdminPresets();
        await loadUserPresets();
      } catch (err) {
        reportError(err);
      }
    });
  }

  async function loadAdminPresets() {
    if (!listPresetProducts) return;
    try {
      const res = await apiFetch('/api/admin/presets');
      const items = await res.json();

      listPresetProducts.innerHTML = '';
      listPresetCustomers.innerHTML = '';
      listPresetSteelGrades.innerHTML = '';

      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'preset-item' + (item.active ? '' : ' inactive');
        div.innerHTML = `
          <span class="preset-name">${escapeHtml(item.name)}</span>
          <div class="preset-actions">
            <button class="btn-toggle-preset" title="${item.active ? 'Ẩn khỏi gợi ý' : 'Hiện lại gợi ý'}">${item.active ? 'Ẩn' : 'Bật'}</button>
            <button class="btn-del-preset" title="Xóa mục này">✕</button>
          </div>
        `;

        div.querySelector('.btn-toggle-preset').addEventListener('click', async () => {
          try {
            await apiFetch(`/api/admin/presets/${item.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ active: !item.active }),
            });
            await loadAdminPresets();
            await loadUserPresets();
          } catch (err) {
            reportError(err);
          }
        });

        div.querySelector('.btn-del-preset').addEventListener('click', async () => {
          if (!confirm(`Bạn có chắc muốn xóa "${item.name}" khỏi danh mục?`)) return;
          try {
            await apiFetch(`/api/admin/presets/${item.id}`, { method: 'DELETE' });
            showToast(`Đã xóa "${item.name}"`);
            await loadAdminPresets();
            await loadUserPresets();
          } catch (err) {
            reportError(err);
          }
        });

        if (item.category === 'product') {
          listPresetProducts.appendChild(div);
        } else if (item.category === 'customer') {
          listPresetCustomers.appendChild(div);
        } else if (item.category === 'steel_grade') {
          listPresetSteelGrades.appendChild(div);
        }
      });
    } catch (err) {
      if (err.status === 401) return;
      console.error('Lỗi tải danh mục admin:', err);
    }
  }

  // ================= ADMIN: BACKUP & DOWNLOAD MASTER EXCEL =================
  const btnDownloadDbBackup = document.getElementById('btnDownloadDbBackup');
  const btnDownloadMasterExcel = document.getElementById('btnDownloadMasterExcel');

  if (btnDownloadDbBackup) {
    btnDownloadDbBackup.addEventListener('click', async () => {
      const orig = btnDownloadDbBackup.innerHTML;
      btnDownloadDbBackup.disabled = true;
      btnDownloadDbBackup.textContent = 'Đang nén dữ liệu...';
      try {
        const res = await apiFetch('/api/admin/backup-db');
        const blob = await res.blob();
        const filename = filenameFromContentDisposition(
          res.headers.get('Content-Disposition'),
          `vico_production_backup_${todayStr().replace(/-/g, '')}.db`
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        showToast('Tải bản sao lưu database thành công!');
      } catch (err) {
        reportError(err);
      } finally {
        btnDownloadDbBackup.disabled = false;
        btnDownloadDbBackup.innerHTML = orig;
      }
    });
  }

  if (btnDownloadMasterExcel) {
    btnDownloadMasterExcel.addEventListener('click', async () => {
      const orig = btnDownloadMasterExcel.innerHTML;
      btnDownloadMasterExcel.disabled = true;
      btnDownloadMasterExcel.textContent = 'Đang tải file...';
      try {
        const res = await apiFetch('/api/admin/download-master-excel');
        const blob = await res.blob();
        const filename = filenameFromContentDisposition(
          res.headers.get('Content-Disposition'),
          'BAO_CAO_TONG_HOP_HANG_NGAY.xlsx'
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        showToast('Tải file Excel tổng hợp gốc thành công!');
      } catch (err) {
        reportError(err);
      } finally {
        btnDownloadMasterExcel.disabled = false;
        btnDownloadMasterExcel.innerHTML = orig;
      }
    });
  }

  // ================= TAB 3: ANALYTICS & CHARTS =================
  const statStartDate = document.getElementById('statStartDate');
  const statEndDate = document.getElementById('statEndDate');
  const btnLoadAnalytics = document.getElementById('btnLoadAnalytics');
  const btnStat7Days = document.getElementById('btnStat7Days');
  const btnStat30Days = document.getElementById('btnStat30Days');
  const btnStatThisMonth = document.getElementById('btnStatThisMonth');

  let chartDailyTrendInstance = null;
  let chartByProductInstance = null;
  let chartByShiftInstance = null;

  function setDateRangeLastNDays(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    if (statStartDate && statEndDate) {
      statStartDate.value = start.toISOString().split('T')[0];
      statEndDate.value = end.toISOString().split('T')[0];
    }
  }

  function setDateRangeThisMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    if (statStartDate && statEndDate) {
      statStartDate.value = start.toISOString().split('T')[0];
      statEndDate.value = now.toISOString().split('T')[0];
    }
  }

  if (btnStat7Days) {
    btnStat7Days.addEventListener('click', () => {
      btnStat7Days.classList.add('active');
      if (btnStat30Days) btnStat30Days.classList.remove('active');
      if (btnStatThisMonth) btnStatThisMonth.classList.remove('active');
      setDateRangeLastNDays(7);
      loadAnalytics();
    });
  }

  if (btnStat30Days) {
    btnStat30Days.addEventListener('click', () => {
      if (btnStat7Days) btnStat7Days.classList.remove('active');
      btnStat30Days.classList.add('active');
      if (btnStatThisMonth) btnStatThisMonth.classList.remove('active');
      setDateRangeLastNDays(30);
      loadAnalytics();
    });
  }

  if (btnStatThisMonth) {
    btnStatThisMonth.addEventListener('click', () => {
      if (btnStat7Days) btnStat7Days.classList.remove('active');
      if (btnStat30Days) btnStat30Days.classList.remove('active');
      btnStatThisMonth.classList.add('active');
      setDateRangeThisMonth();
      loadAnalytics();
    });
  }

  if (btnLoadAnalytics) {
    btnLoadAnalytics.addEventListener('click', () => {
      if (btnStat7Days) btnStat7Days.classList.remove('active');
      if (btnStat30Days) btnStat30Days.classList.remove('active');
      if (btnStatThisMonth) btnStatThisMonth.classList.remove('active');
      loadAnalytics();
    });
  }

  function initAndLoadAnalytics() {
    if (!statStartDate || !statEndDate) return;
    if (!statStartDate.value || !statEndDate.value) {
      setDateRangeLastNDays(7);
    }
    loadAnalytics();
  }

  async function loadAnalytics() {
    if (!statStartDate || !statEndDate) return;
    const start = statStartDate.value;
    const end = statEndDate.value;
    if (!start || !end) {
      alert('Vui lòng chọn cả Ngày bắt đầu và Ngày kết thúc');
      return;
    }

    try {
      const res = await apiFetch(`/api/period-summary?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`);
      const data = await res.json();
      renderAnalytics(data);
    } catch (err) {
      if (err.status === 401) return;
      reportError(err);
    }
  }

  function renderAnalytics(data) {
    // 1. Update KPI cards
    const pkg = data.packaging || {};
    const bsk = data.baskets || {};
    const att = data.attendance || {};

    const elSorted = document.getElementById('kpiTotalSorted');
    const elSortedTon = document.getElementById('kpiTotalSortedTon');
    const elWaste = document.getElementById('kpiWasteRate');
    const elWasteKg = document.getElementById('kpiTotalWaste');
    const elBaskets = document.getElementById('kpiTotalBaskets');
    const elBskWeight = document.getElementById('kpiBasketWeight');
    const elAttRate = document.getElementById('kpiAttendanceRate');
    const elShiftsCount = document.getElementById('kpiShiftsCount');

    if (elSorted) elSorted.textContent = `${formatNumber(pkg.total_sorted || 0)} Kg`;
    if (elSortedTon) elSortedTon.textContent = `${((pkg.total_sorted || 0) / 1000).toFixed(2)} tấn`;
    if (elWaste) {
      const rate = pkg.waste_rate || 0;
      elWaste.textContent = `${rate}%`;
      elWaste.className = 'kpi-value ' + (rate > 2 ? 'text-danger' : (rate > 1 ? 'text-warn' : 'text-success'));
    }
    if (elWasteKg) elWasteKg.textContent = `Hủy: ${formatNumber(pkg.total_waste || 0)} Kg`;
    if (elBaskets) elBaskets.textContent = `${formatNumber(bsk.total_baskets || 0)} giỏ`;
    if (elBskWeight) elBskWeight.textContent = `${((bsk.total_weight || 0) / 1000).toFixed(2)} tấn`;
    if (elAttRate) elAttRate.textContent = `${att.attendance_rate || 0}%`;
    if (elShiftsCount) elShiftsCount.textContent = `${att.total_shifts || 0} ca (${att.total_days || 0} ngày)`;

    // 2. Render Charts if Chart is available
    if (typeof Chart === 'undefined') {
      console.warn('Chart.js chưa sẵn sàng.');
      return;
    }

    renderDailyTrendChart(data.daily_series || []);
    renderByProductChart(pkg.by_product || []);
    renderByShiftChart(data.by_shift || {});
  }

  function renderDailyTrendChart(series) {
    const canvas = document.getElementById('chartDailyTrend');
    if (!canvas) return;
    if (chartDailyTrendInstance) {
      chartDailyTrendInstance.destroy();
      chartDailyTrendInstance = null;
    }

    const labels = series.map(s => formatDateDisplay(s.date));
    const sortedData = series.map(s => s.sorted_weight);
    const wasteRates = series.map(s => s.waste_rate);

    chartDailyTrendInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            type: 'line',
            label: 'Tỉ lệ phế phẩm (%)',
            data: wasteRates,
            borderColor: '#ea580c',
            backgroundColor: '#ea580c',
            borderWidth: 2.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#ea580c',
            tension: 0.25,
            spanGaps: true,
            yAxisID: 'y1',
            order: 1,
          },
          {
            type: 'bar',
            label: 'Sản lượng phân loại (Kg)',
            data: sortedData,
            backgroundColor: 'rgba(37, 99, 235, 0.75)',
            borderColor: '#2563eb',
            borderWidth: 1,
            borderRadius: 4,
            maxBarThickness: 45,
            categoryPercentage: 0.7,
            barPercentage: 0.85,
            yAxisID: 'y',
            order: 2,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { display: false }
          },
          y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Khối lượng (Kg)' },
            beginAtZero: true,
            ticks: {
              callback: function(val) {
                return Number(val).toLocaleString('vi-VN');
              }
            }
          },
          y1: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Tỉ lệ hủy (%)' },
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: {
              callback: function(val) {
                return Number(val).toFixed(1).replace('.', ',') + '%';
              }
            }
          }
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const label = ctx.dataset.label || '';
                const val = ctx.parsed.y;
                if (ctx.dataset.yAxisID === 'y1') {
                  if (val === null || val === undefined || isNaN(val)) {
                    return `${label}: Không có ca`;
                  }
                  return `${label}: ${Number(val).toFixed(2).replace('.', ',')}%`;
                }
                return `${label}: ${Number(val || 0).toLocaleString('vi-VN')} Kg`;
              }
            }
          }
        }
      }
    });
  }

  function renderByProductChart(byProduct) {
    const canvas = document.getElementById('chartByProduct');
    if (!canvas) return;
    if (chartByProductInstance) {
      chartByProductInstance.destroy();
      chartByProductInstance = null;
    }

    const labels = byProduct.slice(0, 6).map(p => p.product_name);
    const dataVals = byProduct.slice(0, 6).map(p => p.sorted_weight);
    const colors = [
      '#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#059669', '#d97706'
    ];

    chartByProductInstance = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['Chưa có số liệu'],
        datasets: [{
          data: dataVals.length ? dataVals : [0],
          backgroundColor: colors.slice(0, labels.length || 1),
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${Number(ctx.parsed || 0).toLocaleString('vi-VN')} Kg`
            }
          }
        }
      }
    });
  }

  function renderByShiftChart(byShift) {
    const canvas = document.getElementById('chartByShift');
    if (!canvas) return;
    if (chartByShiftInstance) {
      chartByShiftInstance.destroy();
      chartByShiftInstance = null;
    }

    chartByShiftInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Ca 1', 'Ca 2', 'Ca 3'],
        datasets: [{
          label: 'Sản lượng (Kg)',
          data: [byShift.shift_1 || 0, byShift.shift_2 || 0, byShift.shift_3 || 0],
          backgroundColor: [
            'rgba(37, 99, 235, 0.8)',
            'rgba(14, 165, 233, 0.8)',
            'rgba(99, 102, 241, 0.8)'
          ],
          borderColor: ['#2563eb', '#0ea5e9', '#6366f1'],
          borderWidth: 1,
          borderRadius: 4,
          maxBarThickness: 50
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Kg' },
            ticks: {
              callback: function(val) {
                return Number(val).toLocaleString('vi-VN');
              }
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.parsed.y || 0).toLocaleString('vi-VN')} Kg`
            }
          }
        }
      }
    });
  }

  // UTILITIES
  function formatDateDisplay(dStr) {
    if (!dStr) return '';
    const parts = dStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dStr;
  }

  function showToast(msg) {
    const toast = document.getElementById('toastNotification');
    const toastMessage = document.getElementById('toastMessage');
    toastMessage.textContent = msg;
    // Thông báo mới thay thế thông báo cũ: hủy hẹn giờ ẩn của thông báo trước
    clearTimeout(toastTimer);
    toast.classList.add('show');
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      toastTimer = null;
    }, 3500);
  }
});
