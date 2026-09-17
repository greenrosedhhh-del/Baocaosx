// VICO Production Reporting System - Frontend Logic

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
  const btnSubmitText = btnSubmitReport ? btnSubmitReport.querySelector('.btn-text') : null;
  const btnSubmitSubtext = btnSubmitReport ? btnSubmitReport.querySelector('.btn-subtext') : null;

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

  // Today's default date (YYYY-MM-DD)
  const today = new Date().toISOString().split('T')[0];
  reportDateInput.value = today;
  summaryDateInput.value = today;
  currentDateDisplay.textContent = `Hôm nay: ${formatDateDisplay(today)}`;

  // --- APPLY CURRENT USER TO UI ---
  shiftLeaderInput.value = currentUser.full_name;

  const userStatusBox = document.getElementById('userStatusBox');
  const currentUserName = document.getElementById('currentUserName');
  const btnLogout = document.getElementById('btnLogout');
  userStatusBox.style.display = 'flex';
  currentUserName.textContent = `${currentUser.full_name} (${currentUser.role === 'admin' ? 'Admin' : 'Ca trưởng'})`;
  btnLogout.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = 'login.html';
  });

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
    leaders: ["Trọng", "Hải", "Tân", "Quang"],
    products: ["D25", "D40", "D60"],
    customers: ["Molycop", "Nhập TQ", "Khô dầu", "VICO"],
    steel_grades: ["CR18", "18", "CR20", "B2"],
    shift_hours: {
      1: { start: "6h", end: "14h" },
      2: { start: "14h", end: "22h" },
      3: { start: "22h", end: "6h" }
    }
  };

  // Fetch presets from API
  try {
    const res = await fetch('/api/presets');
    if (res.ok) {
      presets = await res.json();
    }
  } catch (e) {
    console.warn("Could not load presets from server, using defaults", e);
  }

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
      } else if (targetId === 'admin-tab') {
        loadUsers();
      }
    });
  });

  function getYesterdayDateStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  function updateQuickDateChips() {
    const curVal = reportDateInput.value;
    const yestVal = getYesterdayDateStr();
    if (btnDateToday) btnDateToday.classList.toggle('active', curVal === today);
    if (btnDateYesterday) btnDateYesterday.classList.toggle('active', curVal === yestVal);
  }

  function updateShiftHours() {
    const shift = shiftNumSelect.value;
    if (presets.shift_hours && presets.shift_hours[shift]) {
      startTimeInput.value = presets.shift_hours[shift].start;
      endTimeInput.value = presets.shift_hours[shift].end;
    }
  }

  function checkSmartCa3Suggestion(selectedShift) {
    if (selectedShift === '3') {
      const curHour = new Date().getHours();
      const yestDate = getYesterdayDateStr();
      if (curHour < 12 && reportDateInput.value === today) {
        if (confirm(`Bạn đang chọn Ca 3 vào buổi sáng.\nTheo quy định phân xưởng, Ca 3 (22:00 đêm qua - 06:00 sáng nay) được tính theo ngày bắt đầu (${formatDateDisplay(yestDate)}).\n\nBạn có muốn tự động chọn ngày ${formatDateDisplay(yestDate)} không?`)) {
          reportDateInput.value = yestDate;
        }
      }
    }
  }

  shiftNumSelect.addEventListener('change', () => {
    updateShiftHours();
    checkSmartCa3Suggestion(shiftNumSelect.value);
    checkCurrentShiftStatus();
  });

  reportDateInput.addEventListener('change', () => {
    checkCurrentShiftStatus();
  });

  if (btnDateToday) {
    btnDateToday.addEventListener('click', () => {
      reportDateInput.value = today;
      checkCurrentShiftStatus();
    });
  }

  if (btnDateYesterday) {
    btnDateYesterday.addEventListener('click', () => {
      reportDateInput.value = getYesterdayDateStr();
      checkCurrentShiftStatus();
    });
  }

  // --- DRAFT AUTOSAVE LOGIC (LOCAL STORAGE) ---
  const DRAFT_KEY_PREFIX = 'vico_draft_';

  function getDraftKey(dateVal, shiftVal) {
    const u = currentUser ? currentUser.username : 'user';
    return `${DRAFT_KEY_PREFIX}${u}_${dateVal}_ca${shiftVal}`;
  }

  let autoSaveTimer = null;
  function triggerAutoSave() {
    if (isCheckingStatus) return;
    const dateVal = reportDateInput.value;
    const shiftVal = shiftNumSelect.value;
    if (!dateVal || !shiftVal) return;

    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      saveDraftToLocalStorage(dateVal, shiftVal);
    }, 600);
  }

  function saveDraftToLocalStorage(dateVal, shiftVal) {
    if (!shiftReportForm) return;
    const draft = {
      saved_at: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      safety_ppe: document.getElementById('safetyPpe') ? document.getElementById('safetyPpe').checked : true,
      safety_equip: document.getElementById('safetyEquip') ? document.getElementById('safetyEquip').checked : true,
      start_time: startTimeInput.value,
      end_time: endTimeInput.value,
      staff_total: document.getElementById('staffTotal') ? document.getElementById('staffTotal').value : 5,
      staff_present: document.getElementById('staffPresent') ? document.getElementById('staffPresent').value : 5,
      leave_permitted: document.getElementById('leavePermitted') ? document.getElementById('leavePermitted').value : 0,
      leave_permitted_names: document.getElementById('leavePermittedNames') ? document.getElementById('leavePermittedNames').value : '',
      leave_unpermitted: document.getElementById('leaveUnpermitted') ? document.getElementById('leaveUnpermitted').value : 0,
      leave_unpermitted_names: document.getElementById('leaveUnpermittedNames') ? document.getElementById('leaveUnpermittedNames').value : '',
      issues: document.getElementById('shiftIssues') ? document.getElementById('shiftIssues').value : '',
      suggestions: document.getElementById('shiftSuggestions') ? document.getElementById('shiftSuggestions').value : '',
      packaging: [],
      baskets: [],
      tumbling: []
    };

    containerPackaging.querySelectorAll('.entry-card').forEach(card => {
      draft.packaging.push({
        product_name: card.querySelector('.pkg-product') ? card.querySelector('.pkg-product').value : '',
        customer: card.querySelector('.pkg-customer') ? card.querySelector('.pkg-customer').value : '',
        weight_sorted: card.querySelector('.pkg-sorted') ? card.querySelector('.pkg-sorted').value : '',
        weight_waste: card.querySelector('.pkg-waste') ? card.querySelector('.pkg-waste').value : '',
        notes: card.querySelector('.pkg-notes') ? card.querySelector('.pkg-notes').value : ''
      });
    });

    containerBaskets.querySelectorAll('.entry-card').forEach(card => {
      draft.baskets.push({
        product_name: card.querySelector('.bsk-product') ? card.querySelector('.bsk-product').value : '',
        customer: card.querySelector('.bsk-customer') ? card.querySelector('.bsk-customer').value : '',
        steel_grade: card.querySelector('.bsk-steel') ? card.querySelector('.bsk-steel').value : '',
        basket_count: card.querySelector('.bsk-count') ? card.querySelector('.bsk-count').value : '',
        total_weight: card.querySelector('.bsk-weight') ? card.querySelector('.bsk-weight').value : '',
        notes: card.querySelector('.bsk-notes') ? card.querySelector('.bsk-notes').value : ''
      });
    });

    containerTumbling.querySelectorAll('.entry-card').forEach(card => {
      draft.tumbling.push({
        product_name: card.querySelector('.tmb-product') ? card.querySelector('.tmb-product').value : '',
        customer: card.querySelector('.tmb-customer') ? card.querySelector('.tmb-customer').value : '',
        m1: card.querySelector('.tmb-m1') ? card.querySelector('.tmb-m1').value : '',
        m2: card.querySelector('.tmb-m2') ? card.querySelector('.tmb-m2').value : '',
        total_weight: card.querySelector('.tmb-weight') ? card.querySelector('.tmb-weight').value : '',
        notes: card.querySelector('.tmb-notes') ? card.querySelector('.tmb-notes').value : ''
      });
    });

    try {
      localStorage.setItem(getDraftKey(dateVal, shiftVal), JSON.stringify(draft));
      if (autoSaveIndicator) {
        autoSaveIndicator.style.display = 'inline-flex';
        if (autoSaveText) autoSaveText.textContent = `Đã lưu nháp (${draft.saved_at})`;
      }
    } catch (e) {
      console.warn('Lỗi lưu nháp localStorage:', e);
    }
  }

  function checkAndRestoreDraft(dateVal, shiftVal) {
    try {
      const raw = localStorage.getItem(getDraftKey(dateVal, shiftVal));
      if (!raw) return;
      const draft = JSON.parse(raw);
      const hasContent = (draft.packaging && draft.packaging.some(p => p.weight_sorted || p.weight_waste)) ||
                         (draft.baskets && draft.baskets.some(b => b.basket_count)) ||
                         (draft.tumbling && draft.tumbling.some(t => t.m1 || t.m2 || t.total_weight)) ||
                         (draft.issues && draft.issues.length > 0) ||
                         (draft.suggestions && draft.suggestions.length > 0);
      if (hasContent) {
        populateFormWithShiftData(draft);
        if (autoSaveIndicator) {
          autoSaveIndicator.style.display = 'inline-flex';
          if (autoSaveText) autoSaveText.textContent = `Đã phục hồi nháp (${draft.saved_at || ''})`;
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc nháp localStorage:', e);
    }
  }

  function clearCurrentDraft(dateVal, shiftVal) {
    try {
      localStorage.removeItem(getDraftKey(dateVal, shiftVal));
      if (autoSaveIndicator) {
        autoSaveIndicator.style.display = 'none';
      }
    } catch (e) {}
  }

  // --- POPULATE FORM WITH SHIFT / DRAFT DATA ---
  function populateFormWithShiftData(data) {
    if (data.safety_ppe !== undefined && document.getElementById('safetyPpe')) {
      document.getElementById('safetyPpe').checked = !!data.safety_ppe;
    }
    if (data.safety_equip !== undefined && document.getElementById('safetyEquip')) {
      document.getElementById('safetyEquip').checked = !!data.safety_equip;
    }
    if (data.start_time) startTimeInput.value = data.start_time;
    if (data.end_time) endTimeInput.value = data.end_time;
    if (data.staff_total !== undefined && document.getElementById('staffTotal')) {
      document.getElementById('staffTotal').value = data.staff_total;
    }
    if (data.staff_present !== undefined && document.getElementById('staffPresent')) {
      document.getElementById('staffPresent').value = data.staff_present;
    }
    if (data.leave_permitted !== undefined && document.getElementById('leavePermitted')) {
      document.getElementById('leavePermitted').value = data.leave_permitted;
    }
    if (data.leave_permitted_names !== undefined && document.getElementById('leavePermittedNames')) {
      document.getElementById('leavePermittedNames').value = data.leave_permitted_names || '';
    }
    if (data.leave_unpermitted !== undefined && document.getElementById('leaveUnpermitted')) {
      document.getElementById('leaveUnpermitted').value = data.leave_unpermitted;
    }
    if (data.leave_unpermitted_names !== undefined && document.getElementById('leaveUnpermittedNames')) {
      document.getElementById('leaveUnpermittedNames').value = data.leave_unpermitted_names || '';
    }
    if (data.issues !== undefined && document.getElementById('shiftIssues')) {
      document.getElementById('shiftIssues').value = data.issues || '';
    }
    if (data.suggestions !== undefined && document.getElementById('shiftSuggestions')) {
      document.getElementById('shiftSuggestions').value = data.suggestions || '';
    }

    // Packaging
    containerPackaging.innerHTML = '';
    if (data.packaging && data.packaging.length > 0) {
      data.packaging.forEach(item => addPackagingCard(item));
    } else {
      addPackagingCard();
    }

    // Baskets
    containerBaskets.innerHTML = '';
    if (data.baskets && data.baskets.length > 0) {
      data.baskets.forEach(item => addBasketCard(item));
    } else {
      addBasketCard();
    }

    // Tumbling
    containerTumbling.innerHTML = '';
    if (data.tumbling && data.tumbling.length > 0) {
      data.tumbling.forEach(item => addTumblingCard(item));
    } else {
      addTumblingCard();
    }
  }

  // --- CHECK SHIFT STATUS (EXISTS / EDITABLE / LOCKED / NEW) ---
  let isCheckingStatus = false;
  async function checkCurrentShiftStatus() {
    const dateVal = reportDateInput.value;
    const shiftVal = parseInt(shiftNumSelect.value, 10);
    if (!dateVal || !shiftVal) return;

    updateQuickDateChips();

    try {
      isCheckingStatus = true;
      const res = await fetch(`/api/shifts/check-status?date=${dateVal}&shift_num=${shiftVal}`);
      if (!res.ok) return;
      const statusData = await res.json();

      if (statusData.exists) {
        if (statusData.can_edit) {
          shiftStatusBanner.style.display = 'flex';
          shiftStatusBanner.className = 'shift-status-banner info';
          shiftStatusBanner.innerHTML = `
            <div class="banner-icon">📝</div>
            <div class="banner-content">
              <div class="banner-title">Ca ${shiftVal} ngày ${formatDateDisplay(dateVal)} đã có báo cáo (${statusData.shift_leader})</div>
              <div class="banner-desc">Đã tự động nạp dữ liệu nộp lúc ${statusData.created_at}. Bạn có thể chỉnh sửa và bấm <strong>CẬP NHẬT BÁO CÁO CA</strong> bên dưới.</div>
            </div>
          `;
          if (btnSubmitReport) {
            btnSubmitReport.disabled = false;
            if (btnSubmitText) btnSubmitText.textContent = 'CẬP NHẬT BÁO CÁO CA';
            if (btnSubmitSubtext) btnSubmitSubtext.textContent = '(Lưu các thay đổi mới)';
          }
          if (statusData.shift_data) {
            populateFormWithShiftData(statusData.shift_data);
          }
        } else {
          shiftStatusBanner.style.display = 'flex';
          shiftStatusBanner.className = 'shift-status-banner warning';
          shiftStatusBanner.innerHTML = `
            <div class="banner-icon">🔒</div>
            <div class="banner-content">
              <div class="banner-title">Báo cáo Ca ${shiftVal} ngày ${formatDateDisplay(dateVal)} đã được nộp bởi ${statusData.shift_leader}</div>
              <div class="banner-desc">Bạn không có quyền chỉnh sửa báo cáo do ca trưởng khác tạo. Chỉ Quản trị viên hoặc chính Trưởng ca đó mới có thể chỉnh sửa.</div>
            </div>
          `;
          if (btnSubmitReport) {
            btnSubmitReport.disabled = true;
            if (btnSubmitText) btnSubmitText.textContent = 'KHÔNG CÓ QUYỀN SỬA';
            if (btnSubmitSubtext) btnSubmitSubtext.textContent = `(Đã nộp bởi ${statusData.shift_leader})`;
          }
        }
      } else {
        shiftStatusBanner.style.display = 'none';
        if (btnSubmitReport) {
          btnSubmitReport.disabled = false;
          if (btnSubmitText) btnSubmitText.textContent = 'GỬI BÁO CÁO CA';
          if (btnSubmitSubtext) btnSubmitSubtext.textContent = '(Lưu và tự động tổng hợp)';
        }
        checkAndRestoreDraft(dateVal, shiftVal);
      }
    } catch (err) {
      console.warn('Lỗi kiểm tra trạng thái ca:', err);
    } finally {
      isCheckingStatus = false;
    }
  }

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
            <input type="text" class="pkg-product input-lg" value="${data.product_name || 'D25'}" list="prodList" placeholder="VD: D25">
          </div>
          <div class="form-group">
            <label>Khách Hàng <span class="req">*</span></label>
            <input type="text" class="pkg-customer input-lg" value="${data.customer || 'Molycop'}" list="custList" placeholder="VD: Molycop">
          </div>
        </div>

        <div class="grid grid-2 mt-2">
          <div class="form-group">
            <label>Khối Lượng Phân Loại (Kg)</label>
            <input type="number" class="pkg-sorted input-lg input-highlight" value="${data.weight_sorted || ''}" placeholder="0" min="0" step="any" inputmode="numeric">
          </div>
          <div class="form-group">
            <label>Khối Lượng Hủy (Kg)</label>
            <input type="number" class="pkg-waste input-lg input-highlight" value="${data.weight_waste !== undefined ? data.weight_waste : ''}" placeholder="0" min="0" step="any" inputmode="numeric">
          </div>
        </div>

        <div class="calc-box mt-2">
          <span class="calc-title">Tỉ Lệ Hủy Tự Tính:</span>
          <span class="rate-badge pkg-rate">-</span>
        </div>

        <div class="form-group mt-2">
          <label>Ghi Chú</label>
          <input type="text" class="pkg-notes" value="${data.notes || ''}" placeholder="VD: Nhặt bi lỗi, xếp kho chờ nghiệm thu...">
        </div>
      </div>
    `;

    const sortedInput = card.querySelector('.pkg-sorted');
    const wasteInput = card.querySelector('.pkg-waste');
    const rateBadge = card.querySelector('.pkg-rate');

    function updateRate() {
      const sorted = parseFloat(sortedInput.value) || 0;
      const waste = parseFloat(wasteInput.value) || 0;
      if (sorted > 0) {
        const rate = (waste / sorted) * 100;
        rateBadge.textContent = `${rate.toFixed(2)}%`;
        rateBadge.className = 'rate-badge ' + (rate > 2 ? 'bad' : (rate > 1 ? 'warn' : 'good'));
      } else {
        rateBadge.textContent = '-';
        rateBadge.className = 'rate-badge';
      }
    }

    sortedInput.addEventListener('input', updateRate);
    wasteInput.addEventListener('input', updateRate);
    updateRate();

    card.querySelector('.btn-remove-card').addEventListener('click', () => {
      if (containerPackaging.children.length > 1 || confirm('Xóa mục này?')) {
        card.remove();
        updateCardIndexes();
      }
    });

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
            <input type="text" class="bsk-product input-lg" value="${data.product_name || 'D25'}" list="prodList" placeholder="VD: D25">
          </div>
          <div class="form-group">
            <label>Khách Hàng <span class="req">*</span></label>
            <input type="text" class="bsk-customer input-lg" value="${data.customer || 'Molycop'}" list="custList" placeholder="VD: Molycop">
          </div>
        </div>

        <div class="grid grid-2 mt-2">
          <div class="form-group">
            <label>Mác Thép</label>
            <input type="text" class="bsk-steel input-lg" value="${data.steel_grade || 'CR18'}" list="steelList" placeholder="VD: CR18">
          </div>
          <div class="form-group">
            <label>Tổng Số Giỏ</label>
            <input type="number" class="bsk-count input-lg input-highlight" value="${data.basket_count || ''}" placeholder="0" min="0" step="any" inputmode="numeric">
          </div>
        </div>

        <div class="calc-box mt-2">
          <span class="calc-title">Tổng Khối Lượng (tự nhân 350 Kg/giỏ):</span>
          <div class="weight-input-group">
            <input type="number" class="bsk-weight input-lg input-highlight" value="${data.total_weight || ''}" placeholder="Tự tính">
            <span class="unit-text">Kg</span>
          </div>
        </div>

        <div class="form-group mt-2">
          <label>Ghi Chú</label>
          <input type="text" class="bsk-notes" value="${data.notes || ''}" placeholder="Ghi chú thêm (nếu có)">
        </div>
      </div>
    `;

    const countInput = card.querySelector('.bsk-count');
    const weightInput = card.querySelector('.bsk-weight');

    countInput.addEventListener('input', () => {
      const count = parseFloat(countInput.value) || 0;
      if (count > 0 && !weightInput.dataset.manual) {
        weightInput.value = count * 350;
      }
    });

    weightInput.addEventListener('input', () => {
      weightInput.dataset.manual = "true";
    });

    card.querySelector('.btn-remove-card').addEventListener('click', () => {
      if (containerBaskets.children.length > 1 || confirm('Xóa mục này?')) {
        card.remove();
        updateCardIndexes();
      }
    });

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
            <input type="text" class="tmb-product input-lg" value="${data.product_name || 'D25'}" list="prodList" placeholder="VD: D25">
          </div>
          <div class="form-group">
            <label>Khách Hàng <span class="req">*</span></label>
            <input type="text" class="tmb-customer input-lg" value="${data.customer || 'Molycop'}" list="custList" placeholder="VD: Molycop">
          </div>
        </div>

        <div class="grid grid-2 mt-2">
          <div class="form-group">
            <label>Máy Xóc 1 (Lượt)</label>
            <input type="number" class="tmb-m1 input-lg input-highlight" value="${data.m1 !== undefined ? data.m1 : ''}" placeholder="0" min="0" step="any" inputmode="numeric">
          </div>
          <div class="form-group">
            <label>Máy Xóc 2 (Lượt)</label>
            <input type="number" class="tmb-m2 input-lg input-highlight" value="${data.m2 !== undefined ? data.m2 : ''}" placeholder="0" min="0" step="any" inputmode="numeric">
          </div>
        </div>

        <div class="grid grid-2 mt-2">
          <div class="form-group">
            <label>Tổng Khối Lượng (Kg)</label>
            <input type="number" class="tmb-weight input-lg input-highlight" value="${data.total_weight || ''}" placeholder="0" min="0" step="any" inputmode="numeric">
          </div>
          <div class="form-group">
            <label>Ghi Chú (Khô dầu...)</label>
            <input type="text" class="tmb-notes input-lg" value="${data.notes || ''}" placeholder="VD: Khô dầu...">
          </div>
        </div>
      </div>
    `;

    card.querySelector('.btn-remove-card').addEventListener('click', () => {
      if (containerTumbling.children.length > 1 || confirm('Xóa mục này?')) {
        card.remove();
        updateCardIndexes();
      }
    });

    containerTumbling.appendChild(card);
    updateCardIndexes();
  }

  // Add initial cards
  addPackagingCard();
  addBasketCard();
  addTumblingCard();

  btnAddPackagingRow.addEventListener('click', () => addPackagingCard());
  if (btnAddPackagingBottom) btnAddPackagingBottom.addEventListener('click', () => addPackagingCard());

  btnAddBasketRow.addEventListener('click', () => addBasketCard());
  if (btnAddBasketBottom) btnAddBasketBottom.addEventListener('click', () => addBasketCard());

  btnAddTumblingRow.addEventListener('click', () => addTumblingCard());
  if (btnAddTumblingBottom) btnAddTumblingBottom.addEventListener('click', () => addTumblingCard());

  // Clone template from previous shift
  if (btnClonePrevious) {
    btnClonePrevious.addEventListener('click', async () => {
      try {
        btnClonePrevious.disabled = true;
        btnClonePrevious.innerHTML = '⏳ Đang sao chép...';

        const res = await fetch('/api/shifts/previous-template');
        if (!res.ok) {
          showToast('Không thể lấy dữ liệu ca trước');
          return;
        }
        const data = await res.json();
        if (!data.found) {
          showToast('Chưa có ca nào trước đó để sao chép!');
          return;
        }

        if (data.packaging && data.packaging.length > 0) {
          containerPackaging.innerHTML = '';
          data.packaging.forEach(item => {
            addPackagingCard({
              product_name: item.product_name,
              customer: item.customer,
              notes: item.notes || ''
            });
          });
        }

        if (data.baskets && data.baskets.length > 0) {
          containerBaskets.innerHTML = '';
          data.baskets.forEach(item => {
            addBasketCard({
              product_name: item.product_name,
              customer: item.customer,
              steel_grade: item.steel_grade || 'CR18',
              notes: item.notes || ''
            });
          });
        }

        if (data.tumbling && data.tumbling.length > 0) {
          containerTumbling.innerHTML = '';
          data.tumbling.forEach(item => {
            addTumblingCard({
              product_name: item.product_name,
              customer: item.customer,
              notes: item.notes || ''
            });
          });
        }

        showToast(`✅ Đã sao chép danh mục từ ${data.from_shift}!`);
        triggerAutoSave();
      } catch (err) {
        showToast('Lỗi: ' + err.message);
      } finally {
        btnClonePrevious.disabled = false;
        btnClonePrevious.innerHTML = '📋 Sao chép từ ca trước';
      }
    });
  }

  // Auto-save draft on any user input
  shiftReportForm.addEventListener('input', triggerAutoSave);

  // Initial check on load
  checkCurrentShiftStatus();

  // --- SUBMIT REPORT FORM ---
  shiftReportForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const reportDate = reportDateInput.value;
    const shiftNum = parseInt(shiftNumSelect.value, 10);

    if (!reportDate) {
      showToast("Vui lòng chọn ngày báo cáo!");
      return;
    }

    // Gather packaging items from cards
    const packaging = [];
    containerPackaging.querySelectorAll('.entry-card').forEach(card => {
      const pName = card.querySelector('.pkg-product').value.trim();
      const cName = card.querySelector('.pkg-customer').value.trim();
      const sVal = parseFloat(card.querySelector('.pkg-sorted').value) || 0;
      const wVal = parseFloat(card.querySelector('.pkg-waste').value) || 0;
      const notes = card.querySelector('.pkg-notes').value.trim();
      if (pName || cName || sVal > 0) {
        packaging.push({
          product_name: pName,
          customer: cName,
          weight_sorted: sVal,
          weight_waste: wVal,
          notes: notes
        });
      }
    });

    // Gather basket items from cards
    const baskets = [];
    containerBaskets.querySelectorAll('.entry-card').forEach(card => {
      const pName = card.querySelector('.bsk-product').value.trim();
      const cName = card.querySelector('.bsk-customer').value.trim();
      const steel = card.querySelector('.bsk-steel').value.trim();
      const count = parseFloat(card.querySelector('.bsk-count').value) || 0;
      const weight = parseFloat(card.querySelector('.bsk-weight').value) || (count * 350);
      const notes = card.querySelector('.bsk-notes').value.trim();
      if (pName || cName || count > 0) {
        baskets.push({
          product_name: pName,
          customer: cName,
          steel_grade: steel,
          basket_count: count,
          total_weight: weight,
          notes: notes
        });
      }
    });

    // Gather tumbling items from cards
    const tumbling = [];
    containerTumbling.querySelectorAll('.entry-card').forEach(card => {
      const pName = card.querySelector('.tmb-product').value.trim();
      const cName = card.querySelector('.tmb-customer').value.trim();
      const m1 = parseFloat(card.querySelector('.tmb-m1').value) || 0;
      const m2 = parseFloat(card.querySelector('.tmb-m2').value) || 0;
      const weight = parseFloat(card.querySelector('.tmb-weight').value) || 0;
      const notes = card.querySelector('.tmb-notes').value.trim();
      if (pName || cName || m1 > 0 || m2 > 0 || weight > 0) {
        tumbling.push({
          product_name: pName,
          customer: cName,
          m1: m1,
          m2: m2,
          total_weight: weight,
          notes: notes
        });
      }
    });

    const payload = {
      report_date: reportDate,
      shift_num: shiftNum,
      safety_ppe: document.getElementById('safetyPpe').checked,
      safety_equip: document.getElementById('safetyEquip').checked,
      staff_total: parseInt(document.getElementById('staffTotal').value, 10) || 5,
      staff_present: parseInt(document.getElementById('staffPresent').value, 10) || 5,
      leave_permitted: parseInt(document.getElementById('leavePermitted').value, 10) || 0,
      leave_permitted_names: document.getElementById('leavePermittedNames').value.trim(),
      leave_unpermitted: parseInt(document.getElementById('leaveUnpermitted').value, 10) || 0,
      leave_unpermitted_names: document.getElementById('leaveUnpermittedNames').value.trim(),
      issues: document.getElementById('shiftIssues').value.trim(),
      suggestions: document.getElementById('shiftSuggestions').value.trim(),
      start_time: startTimeInput.value.trim(),
      end_time: endTimeInput.value.trim(),
      packaging: packaging,
      baskets: baskets,
      tumbling: tumbling
    };

    try {
      const btnSubmit = document.getElementById('btnSubmitReport');
      btnSubmit.disabled = true;
      btnSubmit.querySelector('.btn-text').textContent = 'Đang Lưu...';

      const res = await fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Lưu báo cáo thành công!');
        clearCurrentDraft(reportDate, shiftNum);
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
      } else {
        alert('Lỗi: ' + (data.detail || 'Không thể lưu báo cáo'));
      }
    } catch (err) {
      alert('Lỗi kết nối máy chủ: ' + err.message);
    } finally {
      const btnSubmit = document.getElementById('btnSubmitReport');
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  btnResetForm.addEventListener('click', () => {
    if (confirm('Bạn có chắc chắn muốn làm mới toàn bộ form?')) {
      clearCurrentDraft(reportDateInput.value, shiftNumSelect.value);
      shiftReportForm.reset();
      reportDateInput.value = today;
      shiftLeaderInput.value = currentUser.full_name;
      updateShiftHours();
      containerPackaging.innerHTML = '';
      containerBaskets.innerHTML = '';
      containerTumbling.innerHTML = '';
      addPackagingCard();
      addBasketCard();
      addTumblingCard();
      checkCurrentShiftStatus();
    }
  });

  // --- TAB 2: SUMMARY & EXCEL EXPORT ---
  btnLoadSummary.addEventListener('click', loadSummary);

  async function loadSummary() {
    const selDate = summaryDateInput.value;
    if (!selDate) return;

    summaryResultsContainer.innerHTML = '<div style="text-align: center; padding: 2rem;">Đang tải dữ liệu tổng hợp...</div>';

    try {
      const res = await fetch(`/api/daily-summary?date=${selDate}`);
      const data = await res.json();

      renderShiftsProgress(data.submitted_shifts || []);
      renderSummaryResults(data);
    } catch (err) {
      summaryResultsContainer.innerHTML = `<div class="card" style="color: red;">Lỗi tải dữ liệu: ${err.message}</div>`;
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

  function renderSummaryResults(data) {
    if (!data.submitted_shifts || data.submitted_shifts.length === 0) {
      summaryResultsContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 3rem 1rem;">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📋</div>
          <h3 style="color: var(--slate-700);">Chưa có ca nào nộp báo cáo cho ngày ${formatDateDisplay(data.report_date)}</h3>
          <p style="color: var(--slate-600); margin-top: 0.5rem;">Hãy dùng Tab "Ca Trưởng Nhập Báo Cáo" để gửi báo cáo của Ca 1, 2 hoặc 3.</p>
        </div>
      `;
      return;
    }

    // Compute totals
    let totalSorted = 0;
    let totalWaste = 0;
    (data.packaging || []).forEach(p => {
      totalSorted += p.weight_sorted || 0;
      totalWaste += p.weight_waste || 0;
    });
    const avgWasteRate = totalSorted > 0 ? ((totalWaste / totalSorted) * 100).toFixed(2) : 0;

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

    let html = `
      <!-- KPIS -->
      <div class="summary-kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">Tổng KL Phân Loại</div>
          <div class="kpi-value">${totalSorted.toLocaleString()}<span class="kpi-unit">Kg</span></div>
          <div class="kpi-sub">Khoảng ${(totalSorted / 1000).toFixed(1)} tấn</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Tỉ Lệ Hủy Bình Quân</div>
          <div class="kpi-value" style="color: ${avgWasteRate > 2 ? 'var(--danger)' : 'var(--success)'};">${avgWasteRate}%</div>
          <div class="kpi-sub">Tổng hủy: ${totalWaste.toLocaleString()} Kg</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Tổng Bi Ra Sau Tôi</div>
          <div class="kpi-value">${totalBaskets}<span class="kpi-unit">Giỏ</span></div>
          <div class="kpi-sub">${totalBasketWeight.toLocaleString()} Kg</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Tổng Mẻ Bi Xóc</div>
          <div class="kpi-value">${totalTumblingRuns}<span class="kpi-unit">Lượt</span></div>
          <div class="kpi-sub">${totalTumblingWeight.toLocaleString()} Kg</div>
        </div>
      </div>

      <!-- CHẤM CÔNG CỘNG DỒN -->
      <div class="card">
        <div class="section-header">
          <span class="section-num">✓</span>
          <h2>Chấm Công Toàn Phân Xưởng</h2>
        </div>
        <div class="grid grid-3">
          <div><strong>Sĩ số:</strong> ${data.attendance.total_staff} người</div>
          <div><strong>Có mặt:</strong> ${data.attendance.present} người</div>
          <div><strong>Vắng mặt:</strong> ${data.attendance.total_staff - data.attendance.present} người</div>
        </div>
        <div class="mt-2" style="font-size: 0.9rem; color: var(--slate-700);">
          <div><strong>Nghỉ phép:</strong> ${data.attendance.leave_notes}</div>
          <div><strong>Nghỉ không phép:</strong> ${data.attendance.unpermitted}</div>
        </div>
      </div>

      <!-- BAO GÓI SẢN PHẨM CỘNG DỒN -->
      <div class="card">
        <div class="section-header">
          <span class="section-num">1</span>
          <h2>Bao Gói Sản Phẩm (Đã Cộng Dồn Giữa Các Ca)</h2>
        </div>
        <div class="table-responsive">
          <table class="data-table">
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
              ${(data.packaging || []).map(p => {
                const rate = p.weight_sorted > 0 ? ((p.weight_waste / p.weight_sorted) * 100).toFixed(2) : 0;
                return `
                  <tr>
                    <td><strong>${p.product_name}</strong></td>
                    <td>${p.customer}</td>
                    <td>${(p.weight_sorted || 0).toLocaleString()}</td>
                    <td>${(p.weight_waste || 0).toLocaleString()}</td>
                    <td><span class="rate-badge ${rate > 2 ? 'bad' : 'good'}">${rate}%</span></td>
                    <td>${p.notes || ''}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- GIỎ BI SAU TÔI CỘNG DỒN -->
      <div class="card">
        <div class="section-header">
          <span class="section-num">2</span>
          <h2>Số Lượng Giỏ Bi Ra Sau Tôi (Cộng Dồn)</h2>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tên SP</th>
                <th>Khách Hàng</th>
                <th>Mác Thép</th>
                <th>Tổng Số Giỏ</th>
                <th>Tổng Khối Lượng (Kg)</th>
                <th>Ghi Chú</th>
              </tr>
            </thead>
            <tbody>
              ${(data.baskets || []).length > 0 ? (data.baskets || []).map(b => `
                <tr>
                  <td><strong>${b.product_name}</strong></td>
                  <td>${b.customer}</td>
                  <td>${b.steel_grade}</td>
                  <td><strong>${b.basket_count}</strong></td>
                  <td>${(b.total_weight || 0).toLocaleString()}</td>
                  <td>${b.notes || ''}</td>
                </tr>
              `).join('') : '<tr><td colspan="6" style="text-align: center; color: var(--slate-600);">Không có số liệu</td></tr>'}
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
          <table class="data-table">
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
              ${(data.tumbling || []).length > 0 ? (data.tumbling || []).map(t => `
                <tr>
                  <td><strong>${t.product_name}</strong></td>
                  <td>${t.customer}</td>
                  <td>${t.m1 || 0}</td>
                  <td>${t.m2 || 0}</td>
                  <td><strong>${(t.total_weight || 0).toLocaleString()}</strong></td>
                  <td>${t.notes || ''}</td>
                </tr>
              `).join('') : '<tr><td colspan="6" style="text-align: center; color: var(--slate-600);">Không có số liệu</td></tr>'}
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
            <ul style="padding-left: 1.5rem; color: var(--slate-800); line-height: 1.8;">
              ${data.issues.map(iss => `<li>${iss}</li>`).join('')}
            </ul>
          ` : '<p style="color: var(--success); font-weight: 500;">✓ Toàn ngày không có sự cố thiết bị.</p>'}
        </div>
        <div class="mt-2" style="border-top: 1px solid var(--slate-200); padding-top: 0.75rem;">
          <strong>Yêu cầu - Đề xuất:</strong> ${data.suggestions || 'KO'}
        </div>
      </div>
    `;

    summaryResultsContainer.innerHTML = html;
  }

  // TẢI FILE EXCEL
  btnExportExcel.addEventListener('click', () => {
    const selDate = summaryDateInput.value;
    if (!selDate) return;
    window.location.href = `/api/export-excel?date=${selDate}`;
  });

  // ĐỒNG BỘ VÀO FILE TỔNG HỢP GỐC
  btnSyncMaster.addEventListener('click', async () => {
    const selDate = summaryDateInput.value;
    if (!selDate) return;

    if (!confirm(`Bạn có muốn đồng bộ số liệu ngày ${formatDateDisplay(selDate)} vào file BÁO CÁO TỔNG HỢP HÀNG NGÀY.xlsx gốc không?\n\n(Hệ thống sẽ tự động sao lưu 1 bản trước khi ghi).`)) {
      return;
    }

    try {
      btnSyncMaster.disabled = true;
      btnSyncMaster.innerHTML = 'Đang đồng bộ...';

      const res = await fetch(`/api/sync-to-master?date=${selDate}`, { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        showToast(`Đã ghi sheet [${data.sheet_name}] vào file tổng hợp thành công!`);
        alert(`Thành công!\n- Đã đồng bộ vào Sheet: ${data.sheet_name}\n- File sao lưu an toàn tại: ${data.backup_file}`);
      } else {
        alert('Lỗi: ' + (data.detail || 'Không thể đồng bộ'));
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    } finally {
      btnSyncMaster.disabled = false;
      btnSyncMaster.innerHTML = '<span class="icon">🔄</span> Đồng Bộ Vào File Báo Cáo Tổng Hợp Gốc';
    }
  });

  // --- TAB 3: HISTORY ---
  btnRefreshHistory.addEventListener('click', loadHistory);

  async function loadHistory() {
    try {
      const res = await fetch('/api/history');
      const items = await res.json();
      tbodyHistory.innerHTML = '';

      if (!items || items.length === 0) {
        tbodyHistory.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem;">Chưa có dữ liệu lịch sử nào.</td></tr>';
        return;
      }

      items.forEach(it => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${formatDateDisplay(it.report_date)}</strong></td>
          <td><span class="rate-badge ${it.shift_count === 3 ? 'good' : 'warn'}">${it.shift_count} / 3 ca</span></td>
          <td>Ca: ${it.shifts}</td>
          <td>${it.leaders}</td>
          <td>
            <button class="btn btn-sm btn-outline btn-view-date" data-date="${it.report_date}">Xem & Xuất Excel</button>
          </td>
        `;

        tr.querySelector('.btn-view-date').addEventListener('click', () => {
          summaryDateInput.value = it.report_date;
          document.getElementById('btnTabSummary').click();
        });

        tbodyHistory.appendChild(tr);
      });
    } catch (e) {
      tbodyHistory.innerHTML = `<tr><td colspan="5" style="color:red;">Lỗi tải lịch sử: ${e.message}</td></tr>`;
    }
  }

  // --- TAB 4: ADMIN USER MANAGEMENT ---
  const tbodyUsers = document.getElementById('tbodyUsers');
  const createUserForm = document.getElementById('createUserForm');

  if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        username: document.getElementById('newUsername').value.trim(),
        full_name: document.getElementById('newFullName').value.trim(),
        password: document.getElementById('newPassword').value,
        role: document.getElementById('newRole').value
      };
      try {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Đã tạo tài khoản mới!');
          createUserForm.reset();
          loadUsers();
        } else {
          alert('Lỗi: ' + (data.detail || 'Không thể tạo tài khoản'));
        }
      } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
      }
    });
  }

  async function loadUsers() {
    try {
      const res = await fetch('/api/admin/users');
      const users = await res.json();
      tbodyUsers.innerHTML = '';
      users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${u.username}</td>
          <td>${u.full_name}</td>
          <td>${u.role === 'admin' ? 'Admin' : 'Ca trưởng'}</td>
          <td><span class="rate-badge ${u.active ? 'good' : 'bad'}">${u.active ? 'Đang hoạt động' : 'Đã khóa'}</span></td>
          <td>
            <button class="btn btn-sm btn-outline btn-toggle-active">${u.active ? 'Khóa' : 'Mở khóa'}</button>
            <button class="btn btn-sm btn-outline btn-reset-password">Đổi mật khẩu</button>
          </td>
        `;
        tr.querySelector('.btn-toggle-active').addEventListener('click', async () => {
          try {
            const res = await fetch(`/api/admin/users/${u.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ active: !u.active })
            });
            if (res.ok) {
              loadUsers();
            } else {
              const data = await res.json();
              alert('Lỗi: ' + (data.detail || 'Không thể cập nhật tài khoản'));
            }
          } catch (err) {
            alert('Lỗi kết nối: ' + err.message);
          }
        });
        tr.querySelector('.btn-reset-password').addEventListener('click', async () => {
          const newPassword = prompt(`Nhập mật khẩu mới cho ${u.full_name}:`);
          if (!newPassword) return;
          try {
            const res = await fetch(`/api/admin/users/${u.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: newPassword })
            });
            if (res.ok) {
              showToast('Đã đổi mật khẩu!');
            } else {
              const data = await res.json();
              alert('Lỗi: ' + (data.detail || 'Không thể cập nhật tài khoản'));
            }
          } catch (err) {
            alert('Lỗi kết nối: ' + err.message);
          }
        });
        tbodyUsers.appendChild(tr);
      });
    } catch (e) {
      tbodyUsers.innerHTML = `<tr><td colspan="5" style="color:red;">Lỗi tải danh sách: ${e.message}</td></tr>`;
    }
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
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }
});
