// VICO PX ĐÚC 2 - Live Shift Logging & Signature Helper
(function (root) {
  const U = root.VicoUtils;
  const D2 = root.Duc2Utils;
  const ExcelMod = root.Duc2Excel;

  const OFFLINE_QUEUE_KEY = 'vico_duc2_offline_queue';

  // ---------------- TIỆN ÍCH NÉN ẢNH CHỮ KÝ ----------------
  async function compressSignatureFile(file) {
    if (!file) return null;
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error('Vui lòng chọn tệp hình ảnh (PNG, JPG, WebP).');
    }
    const rawDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Không đọc được tệp ảnh.'));
      reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Không nạp được tệp ảnh chữ ký.'));
      image.src = rawDataUrl;
    });

    const maxW = 360;
    const maxH = 160;
    const scale = Math.min(1, maxW / (img.naturalWidth || maxW), maxH / (img.naturalHeight || maxH));
    const targetW = Math.max(1, Math.round((img.naturalWidth || 240) * scale));
    const targetH = Math.max(1, Math.round((img.naturalHeight || 100) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    let out = canvas.toDataURL('image/png');
    if (out.length > 90000) {
      // Ảnh chụp dung lượng lớn -> chuyển JPEG nền trắng để gọn nhẹ trong Supabase
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
      out = canvas.toDataURL('image/jpeg', 0.85);
    }
    return out;
  }

  root.VicoSignatureHelper = {
    compressSignatureFile
  };

  // ---------------- MODULE CHÍNH PX ĐÚC 2 ----------------
  let initialized = false;
  let currentUser = null;
  let helpers = null;

  const state = {
    shift: null,        // null khi chưa mở ca
    canEdit: true,
    presets: {
      products: ['Bi 40', 'Bi 60', 'Bi 80', 'Bi 25'],
      customers: ['Molycop', 'VICO', 'Nhập TQ'],
      steel_grades: ['Cr18-19.5', 'Cr18', 'Cr20'],
      furnaces: ['2.2', '3', '4', '5'],
      shift_hours: {
        1: { start: "19h30'", end: "3h30'" },
        2: { start: "3h00'", end: "11h00'" },
        3: { start: "11h00'", end: "19h30'" }
      }
    },
    carryover: null,
    molding: [],
    pouring: [],
    melting: [],
    headerTimer: null,
    moldingTimer: null,
    meltingTimer: null,
    activeBatchTimer: null,
    issueTimerStart: null,
    issueTimerInterval: null,
    infoCollapsed: false,
    syncStatus: 'idle', // 'idle' | 'saving' | 'saved' | 'offline'
    loadSeq: 0,
    previewShiftData: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function todayStr() {
    return U.toLocalDateStr(new Date());
  }

  function formatDateDisplay(isoDate) {
    return helpers && helpers.formatDateDisplay ? helpers.formatDateDisplay(isoDate) : D2.formatVNDateDisplay(isoDate);
  }

  function showToast(msg) {
    if (helpers && helpers.showToast) helpers.showToast(msg);
  }

  function reportError(err) {
    if (helpers && helpers.reportError) helpers.reportError(err);
    else alert('Lỗi: ' + (err && err.message ? err.message : err));
  }

  function apiFetch(url, options) {
    return helpers.apiFetch(url, options);
  }

  function isNetworkError(err) {
    return !err || err.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  function setSyncBadge(mode, text) {
    state.syncStatus = mode;
    const badge = el('duc2SyncBadge');
    const txt = el('duc2SyncText');
    const retryBtn = el('duc2BtnSyncRetry');
    if (!badge || !txt) return;

    if (mode === 'idle') {
      badge.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'none';
      return;
    }
    badge.style.display = 'inline-flex';
    badge.classList.remove('sync-warn', 'sync-saving');
    if (mode === 'saving') {
      badge.classList.add('sync-saving');
      txt.textContent = text || 'Đang lưu...';
      if (retryBtn) retryBtn.style.display = 'none';
    } else if (mode === 'offline') {
      badge.classList.add('sync-warn');
      txt.textContent = text || 'Ngoại tuyến — Đang giữ tạm';
      if (retryBtn) retryBtn.style.display = 'inline-flex';
    } else {
      txt.textContent = text || `Đã lưu Cloud (${D2.formatNowVNTime(new Date())})`;
      if (retryBtn) retryBtn.style.display = getOfflineQueue().pendingActions.length ? 'inline-flex' : 'none';
    }
  }

  // ---------------- HÀNG ĐỢI OFFLINE ----------------
  function getOfflineQueue() {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (!raw) return { pendingActions: [] };
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.pendingActions) ? parsed : { pendingActions: [] };
    } catch (e) {
      return { pendingActions: [] };
    }
  }

  function saveOfflineQueue(queue) {
    try {
      if (!queue.pendingActions || queue.pendingActions.length === 0) {
        localStorage.removeItem(OFFLINE_QUEUE_KEY);
      } else {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      }
    } catch (e) {
      console.warn('Không lưu được hàng đợi offline PX Đúc 2:', e);
    }
  }

  function enqueueOfflineAction(action) {
    const q = getOfflineQueue();
    if (action.type === 'header' || action.type === 'molding' || action.type === 'melting') {
      q.pendingActions = q.pendingActions.filter(
        a => !(a.shiftId === action.shiftId && a.type === action.type)
      );
    }
    q.pendingActions.push(action);
    saveOfflineQueue(q);
    setSyncBadge('offline', `Chưa đồng bộ (${q.pendingActions.length} thay đổi)`);
  }

  async function flushOfflineQueue() {
    const q = getOfflineQueue();
    if (!q.pendingActions || q.pendingActions.length === 0) return;

    setSyncBadge('saving', 'Đang đồng bộ lại...');
    const remaining = [];
    const tempIdMap = {};

    for (let i = 0; i < q.pendingActions.length; i++) {
      const act = q.pendingActions[i];
      try {
        if (act.type === 'pouring_add') {
          const res = await apiFetch(`/api/duc2/shifts/${act.shiftId}/pouring`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(act.payload)
          });
          const data = await res.json();
          if (data && data.batch) {
            tempIdMap[act.tempId] = data.batch.id;
            const localMatch = state.pouring.find(b => b.id === act.tempId);
            if (localMatch) {
              Object.assign(localMatch, data.batch);
            }
          }
        } else if (act.type === 'pouring_patch') {
          const realBatchId = tempIdMap[act.batchId] || act.batchId;
          if (String(realBatchId).startsWith('tmp_')) {
            remaining.push(act);
            continue;
          }
          await apiFetch(`/api/duc2/shifts/${act.shiftId}/pouring/${realBatchId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(act.payload)
          });
        } else if (act.type === 'header') {
          await apiFetch(`/api/duc2/shifts/${act.shiftId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(act.payload)
          });
        } else if (act.type === 'molding') {
          await apiFetch(`/api/duc2/shifts/${act.shiftId}/molding`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: act.payload })
          });
        } else if (act.type === 'melting') {
          await apiFetch(`/api/duc2/shifts/${act.shiftId}/melting`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: act.payload })
          });
        }
      } catch (err) {
        if (err.status === 401) return;
        remaining.push(act);
      }
    }

    saveOfflineQueue({ pendingActions: remaining });
    if (remaining.length === 0) {
      setSyncBadge('saved', 'Đã đồng bộ toàn bộ lên Cloud');
      showToast('✅ Đã đồng bộ dữ liệu ngoại tuyến lên Cloud!');
      if (state.shift) {
        await loadCurrentShift();
      } else {
        renderPouringSection();
      }
    } else {
      setSyncBadge('offline', `Còn ${remaining.length} thay đổi chưa đồng bộ`);
    }
  }

  // ---------------- NẠP DANH MỤC GỢI Ý ----------------
  async function reloadPresets() {
    try {
      const res = await fetch('/api/duc2/presets');
      if (res.ok) {
        const data = await res.json();
        state.presets = {
          products: data.products || ['Bi 40', 'Bi 60', 'Bi 80', 'Bi 25'],
          customers: data.customers || ['Molycop', 'VICO', 'Nhập TQ'],
          steel_grades: data.steel_grades || ['Cr18-19.5', 'Cr18', 'Cr20'],
          furnaces: data.furnaces || ['2.2', '3', '4', '5'],
          shift_hours: data.shift_hours || state.presets.shift_hours
        };
      }
    } catch (e) {
      console.warn('Không tải được danh mục PX Đúc 2, dùng mặc định:', e);
    }

    const fillList = (id, items) => {
      const dl = el(id);
      if (dl && Array.isArray(items)) {
        dl.innerHTML = items.map(v => `<option value="${U.escapeHtml(v)}">`).join('');
      }
    };
    fillList('duc2PresetProducts', state.presets.products);
    fillList('duc2PresetCustomers', state.presets.customers);
    fillList('duc2PresetSteelGrades', state.presets.steel_grades);
    fillList('duc2PresetFurnaces', state.presets.furnaces);

    if (state.shift) {
      renderQuickPourBar();
    }
  }

  // ---------------- ĐỌC / ĐIỀN FORM HEADER ----------------
  function collectHeaderPayload() {
    const stopperStart = U.parseIntOr(el('duc2StopperStart').value, 0);
    const stopperAdded = U.parseIntOr(el('duc2StopperAdded').value, 0);
    const stopperUsed = U.parseIntOr(el('duc2StopperUsed').value, 0);
    const stopperRem = D2.computeSupplyRemaining(stopperStart, stopperAdded, stopperUsed);

    const nozzleStart = U.parseIntOr(el('duc2NozzleStart').value, 0);
    const nozzleAdded = U.parseIntOr(el('duc2NozzleAdded').value, 0);
    const nozzleUsed = U.parseIntOr(el('duc2NozzleUsed').value, 0);
    const nozzleRem = D2.computeSupplyRemaining(nozzleStart, nozzleAdded, nozzleUsed);

    const staffTotal = Math.max(1, U.parseIntOr(el('duc2StaffTotal').value, 16));
    const staffPresent = Math.min(staffTotal, Math.max(0, U.parseIntOr(el('duc2StaffPresent').value, staffTotal)));

    return {
      start_time: el('duc2StartTime').value.trim(),
      end_time: el('duc2EndTime').value.trim(),
      doc_code: el('duc2DocCode').value.trim(),
      doc_number: el('duc2DocNumber').value.trim(),
      default_product: el('duc2DefaultProduct').value.trim() || state.presets.products[0] || 'Bi 40',
      default_customer: el('duc2DefaultCustomer').value.trim() || state.presets.customers[0] || 'Molycop',
      default_steel_grade: el('duc2DefaultSteelGrade').value.trim() || state.presets.steel_grades[0] || 'Cr18-19.5',
      safety_production: el('duc2SafetyProd').checked ? 1 : 0,
      safety_ppe: el('duc2SafetyPpe').checked ? 1 : 0,
      safety_equip: el('duc2SafetyEquip').checked ? 1 : 0,
      staff_total: staffTotal,
      staff_present: staffPresent,
      leave_permitted_names: el('duc2LeavePermittedNames').value,
      leave_unpermitted_names: el('duc2LeaveUnpermittedNames').value.trim() || 'KO',
      stopper_start: stopperStart,
      stopper_added: stopperAdded,
      stopper_used: stopperUsed,
      stopper_remaining: stopperRem,
      nozzle_start: nozzleStart,
      nozzle_added: nozzleAdded,
      nozzle_used: nozzleUsed,
      nozzle_remaining: nozzleRem,
      issues: el('duc2Issues').value,
      suggestions: el('duc2Suggestions').value
    };
  }

  function applyHeaderToUi(shift) {
    el('duc2ShiftLeader').value = shift.shift_leader || (currentUser ? currentUser.full_name : '');
    el('duc2StartTime').value = shift.start_time || '';
    el('duc2EndTime').value = shift.end_time || '';
    el('duc2DocCode').value = shift.doc_code || '';
    el('duc2DocNumber').value = shift.doc_number || '';
    el('duc2DefaultProduct').value = shift.default_product || state.presets.products[0] || 'Bi 40';
    el('duc2DefaultCustomer').value = shift.default_customer || state.presets.customers[0] || 'Molycop';
    el('duc2DefaultSteelGrade').value = shift.default_steel_grade || state.presets.steel_grades[0] || 'Cr18-19.5';

    el('duc2SafetyProd').checked = shift.safety_production !== 0;
    el('duc2SafetyPpe').checked = shift.safety_ppe !== 0;
    el('duc2SafetyEquip').checked = shift.safety_equip !== 0;

    el('duc2StaffTotal').value = shift.staff_total ?? 16;
    el('duc2StaffPresent').value = shift.staff_present ?? 16;
    el('duc2LeavePermittedNames').value = shift.leave_permitted_names || '';
    el('duc2LeaveUnpermittedNames').value = shift.leave_unpermitted_names || 'KO';

    el('duc2StopperStart').value = shift.stopper_start ?? 0;
    el('duc2StopperAdded').value = shift.stopper_added ?? 0;
    el('duc2StopperUsed').value = shift.stopper_used ?? 0;

    el('duc2NozzleStart').value = shift.nozzle_start ?? 0;
    el('duc2NozzleAdded').value = shift.nozzle_added ?? 0;
    el('duc2NozzleUsed').value = shift.nozzle_used ?? 0;

    el('duc2Issues').value = shift.issues || '';
    el('duc2Suggestions').value = shift.suggestions || '';

    updateSupplyDisplays();
    refreshSignaturePreview();
  }

  function updateSupplyDisplays() {
    const stopperRem = D2.computeSupplyRemaining(
      el('duc2StopperStart').value,
      el('duc2StopperAdded').value,
      el('duc2StopperUsed').value
    );
    const nozzleRem = D2.computeSupplyRemaining(
      el('duc2NozzleStart').value,
      el('duc2NozzleAdded').value,
      el('duc2NozzleUsed').value
    );
    el('duc2StopperRemainingText').textContent = stopperRem;
    el('duc2NozzleRemainingText').textContent = nozzleRem;
    updateLiveKpiStrip();
  }

  function updateLiveKpiStrip() {
    if (!state.shift) return;
    const pouredCount = state.pouring.length;
    const activeCount = state.pouring.filter(b => b.status === 'pouring').length;
    el('duc2KpiPouring').textContent = activeCount > 0
      ? `${pouredCount} / 18 (${activeCount} đang rót)`
      : `${pouredCount} / 18`;

    const moldsTotal = state.molding.reduce((sum, m) => sum + (Number(m.molds_created) || 0), 0);
    el('duc2KpiMoldsCreated').textContent = moldsTotal.toLocaleString('vi-VN');
    el('duc2KpiStopper').textContent = `${el('duc2StopperRemainingText').textContent} cái`;
    el('duc2KpiNozzle').textContent = `${el('duc2NozzleRemainingText').textContent} cái`;
  }

  function refreshSignaturePreview() {
    const box = el('duc2LeaderSigPreview');
    if (!box) return;
    let sig = null;
    if (state.shift) {
      sig = state.shift.leader_signature || state.shift.effective_signature || null;
      if (!sig && currentUser && (!state.shift.created_by_user_id || state.shift.created_by_user_id === currentUser.id)) {
        sig = currentUser.signature_data || null;
      }
    } else if (currentUser) {
      sig = currentUser.signature_data || null;
    }

    if (sig) {
      box.innerHTML = `<img src="${U.escapeHtml(sig)}" alt="Chữ ký Trưởng ca" class="duc2-sig-img">`;
    } else {
      box.innerHTML = '<span class="duc2-sig-empty">⚠️ Tài khoản chưa gắn ảnh chữ ký (Admin gắn ở tab Quản Lý Tài Khoản; khi xuất Excel sẽ hiển thị tên Trưởng ca).</span>';
    }
  }

  function buildFullShiftSnapshot() {
    if (!state.shift) return null;
    const header = collectHeaderPayload();
    const sig = state.shift.leader_signature || state.shift.effective_signature ||
      (currentUser && (!state.shift.created_by_user_id || state.shift.created_by_user_id === currentUser.id) ? currentUser.signature_data : null);
    return {
      ...state.shift,
      ...header,
      leader_signature: sig || null,
      effective_signature: sig || null,
      molding: state.molding.map(m => ({ ...m })),
      pouring: state.pouring.map(b => ({ ...b })),
      melting: state.melting.map(f => ({ ...f }))
    };
  }

  // ---------------- KIỂM TRA & TẢI CA HIỆN TẠI ----------------
  function updateQuickDateChips() {
    const curVal = el('duc2ReportDate').value;
    el('duc2BtnDateToday').classList.toggle('active', curVal === todayStr());
    el('duc2BtnDateYesterday').classList.toggle('active', curVal === U.yesterdayStr(new Date()));
  }

  async function loadCurrentShift() {
    const reportDate = el('duc2ReportDate').value;
    const shiftNum = el('duc2ShiftNum').value;
    updateQuickDateChips();
    if (!reportDate || !shiftNum) return;

    const seq = ++state.loadSeq;
    el('duc2StatusBadge').textContent = 'Đang kiểm tra...';
    el('duc2StatusBadge').className = 'duc2-state-pill state-new';

    try {
      const res = await apiFetch(`/api/duc2/shifts/current?date=${encodeURIComponent(reportDate)}&shift_num=${encodeURIComponent(shiftNum)}`);
      const data = await res.json();
      if (seq !== state.loadSeq) return;

      if (!data.exists) {
        state.shift = null;
        state.molding = [];
        state.pouring = [];
        state.melting = [];
        state.canEdit = true;
        await loadCarryover(reportDate, shiftNum, seq);
        renderShiftWorkspaceState();
      } else {
        state.shift = data.shift_data;
        state.canEdit = !!data.can_edit;
        state.molding = (data.shift_data.molding || []).map(m => ({ ...m }));
        state.pouring = (data.shift_data.pouring || []).map(b => ({ ...b }));
        state.melting = (data.shift_data.melting || []).map(f => ({ ...f }));
        state.carryover = null;
        // Cũng nạp carryover furnace map để phục vụ tự động cộng tuổi thọ nếu có lò mới xuất hiện
        loadCarryoverMapQuiet(reportDate, shiftNum);
        applyHeaderToUi(state.shift);
        renderAllSections();
        renderShiftWorkspaceState();
        setSyncBadge('idle');
      }
    } catch (err) {
      if (seq !== state.loadSeq || err.status === 401) return;
      reportError(err);
      el('duc2StatusBadge').textContent = 'Lỗi tải dữ liệu';
      el('duc2StatusBadge').className = 'duc2-state-pill state-locked';
    }
  }

  async function loadCarryover(reportDate, shiftNum, seq) {
    el('duc2CarryoverHint').textContent = 'Đang kiểm tra tồn vật tư & tuổi thọ lò từ ca trước...';
    try {
      const res = await apiFetch(`/api/duc2/shifts/carryover?date=${encodeURIComponent(reportDate)}&shift_num=${encodeURIComponent(shiftNum)}`);
      const co = await res.json();
      if (seq !== state.loadSeq) return;
      state.carryover = co;
      if (co.found) {
        const lifeEntries = Object.entries(co.furnace_life_map || {});
        const lifeText = lifeEntries.length
          ? lifeEntries.map(([k, v]) => `Lò ${k}: ${v}`).join(', ')
          : 'chưa có lò';
        el('duc2CarryoverHint').textContent =
          `Kế thừa từ ${co.from_shift}: Thanh chặn còn ${co.stopper_remaining} cái, Cốc rót còn ${co.nozzle_remaining} cái (${lifeText}).`;
      } else {
        el('duc2CarryoverHint').textContent = 'Chưa có dữ liệu ca trước. Bấm để khởi tạo ca làm việc mới ngay.';
      }
    } catch (e) {
      if (seq !== state.loadSeq) return;
      state.carryover = {
        found: false, stopper_remaining: 0, nozzle_remaining: 0,
        staff_total: 16, default_product: 'Bi 40', default_customer: 'Molycop',
        default_steel_grade: 'Cr18-19.5', furnace_life_map: {}
      };
      el('duc2CarryoverHint').textContent = 'Bấm nút bên cạnh để bắt đầu ghi nhận trực tiếp trong ca.';
    }
  }

  async function loadCarryoverMapQuiet(reportDate, shiftNum) {
    try {
      const res = await apiFetch(`/api/duc2/shifts/carryover?date=${encodeURIComponent(reportDate)}&shift_num=${encodeURIComponent(shiftNum)}`);
      const co = await res.json();
      if (state.shift && String(state.shift.report_date) === String(reportDate) && String(state.shift.shift_num) === String(shiftNum)) {
        state.carryover = co;
      }
    } catch (e) {
      // ignore background fetch error
    }
  }

  function renderShiftWorkspaceState() {
    const preOpen = el('duc2PreOpenBanner');
    const workspace = el('duc2Workspace');
    const kpiStrip = el('duc2LiveKpiStrip');
    const lockBanner = el('duc2ShiftLockBanner');
    const badge = el('duc2StatusBadge');

    if (!state.shift) {
      preOpen.style.display = 'flex';
      workspace.style.display = 'none';
      kpiStrip.style.display = 'none';
      lockBanner.style.display = 'none';
      badge.textContent = 'Chưa mở ca';
      badge.className = 'duc2-state-pill state-new';
      el('duc2ShiftLeader').value = currentUser ? currentUser.full_name : '';
      return;
    }

    preOpen.style.display = 'none';
    workspace.style.display = 'block';
    kpiStrip.style.display = 'grid';

    const isSubmitted = state.shift.status === 'submitted';
    const editable = state.canEdit && !isSubmitted;

    if (isSubmitted) {
      badge.textContent = '✓ Đã chốt ca';
      badge.className = 'duc2-state-pill state-submitted';
    } else {
      badge.textContent = '● Đang làm việc';
      badge.className = 'duc2-state-pill state-live';
    }

    if (!state.canEdit) {
      lockBanner.style.display = 'flex';
      lockBanner.className = 'shift-status-banner warning mt-2';
      lockBanner.innerHTML = `
        <div class="banner-icon">🔒</div>
        <div class="banner-content">
          <div class="banner-title">Ca này do Trưởng ca ${U.escapeHtml(state.shift.shift_leader)} phụ trách</div>
          <div class="banner-desc">Bạn đang ở chế độ chỉ xem &amp; xuất Excel.</div>
        </div>
      `;
    } else if (isSubmitted) {
      lockBanner.style.display = 'flex';
      lockBanner.className = 'shift-status-banner success mt-2';
      lockBanner.innerHTML = `
        <div class="banner-icon">✅</div>
        <div class="banner-content">
          <div class="banner-title">Báo cáo Ca ${U.escapeHtml(state.shift.shift_num)} ngày ${U.escapeHtml(formatDateDisplay(state.shift.report_date))} đã được chốt</div>
          <div class="banner-desc">Có thể xem trước A4, xuất Excel ngay hoặc bấm <strong>Mở sửa lại</strong> ở cuối trang nếu cần bổ sung số liệu.</div>
        </div>
      `;
    } else {
      lockBanner.style.display = 'none';
    }

    // Bật/tắt các ô nhập liệu trong workspace
    const controls = workspace.querySelectorAll('input, select, textarea, button');
    const alwaysEnabledIds = new Set([
      'duc2BtnToggleInfo', 'duc2BtnPreviewA4', 'duc2BtnExportExcel',
      'duc2BtnReopenShift', 'duc2BtnDeleteShift'
    ]);
    controls.forEach(ctrl => {
      if (alwaysEnabledIds.has(ctrl.id)) {
        ctrl.disabled = false;
      } else {
        ctrl.disabled = !editable;
      }
    });

    el('duc2BtnSubmitShift').style.display = (state.canEdit && !isSubmitted) ? '' : 'none';
    el('duc2BtnReopenShift').style.display = (state.canEdit && isSubmitted) ? '' : 'none';
    el('duc2BtnDeleteShift').style.display = (currentUser && currentUser.role === 'admin') ? '' : 'none';
    updateLiveKpiStrip();
  }

  // ---------------- MỞ CA MỚI ----------------
  async function handleOpenShift() {
    const reportDate = el('duc2ReportDate').value;
    const shiftNum = parseInt(el('duc2ShiftNum').value, 10);
    if (!reportDate || !shiftNum) return;

    const btn = el('duc2BtnOpenShift');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Đang mở ca...';
    try {
      const co = state.carryover || {};
      const hours = (state.presets.shift_hours && state.presets.shift_hours[shiftNum]) || { start: '', end: '' };
      const defProduct = co.default_product || state.presets.products[0] || 'Bi 40';
      const defCustomer = co.default_customer || state.presets.customers[0] || 'Molycop';
      const defSteel = co.default_steel_grade || state.presets.steel_grades[0] || 'Cr18-19.5';

      const initialMolding = [{
        product_name: defProduct,
        customer: defCustomer,
        start_time: D2.formatNowVNTime(new Date()),
        end_time: '',
        time_range: '',
        counter_start: null,
        counter_end: null,
        molds_created: null,
        molds_poured: null,
        notes: ''
      }];

      const res = await apiFetch('/api/duc2/shifts/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_date: reportDate,
          shift_num: shiftNum,
          start_time: hours.start,
          end_time: hours.end,
          staff_total: co.staff_total || 16,
          staff_present: co.staff_total || 16,
          stopper_start: co.stopper_remaining || 0,
          stopper_added: 0,
          stopper_used: 0,
          stopper_remaining: co.stopper_remaining || 0,
          nozzle_start: co.nozzle_remaining || 0,
          nozzle_added: 0,
          nozzle_used: 0,
          nozzle_remaining: co.nozzle_remaining || 0,
          default_product: defProduct,
          default_customer: defCustomer,
          default_steel_grade: defSteel,
          leave_unpermitted_names: 'KO',
          molding: initialMolding
        })
      });
      const data = await res.json();
      state.shift = data.shift_data;
      state.canEdit = data.can_edit !== undefined ? !!data.can_edit : true;
      state.molding = (state.shift.molding || []).map(m => ({ ...m }));
      state.pouring = (state.shift.pouring || []).map(b => ({ ...b }));
      state.melting = (state.shift.melting || []).map(f => ({ ...f }));

      applyHeaderToUi(state.shift);
      renderAllSections();
      renderShiftWorkspaceState();
      setSyncBadge('saved', 'Đã mở ca trực tiếp');
      showToast(data.already_exists ? 'Ca này đã được mở trước đó, đã nạp dữ liệu!' : `Đã bắt đầu Ca ${shiftNum}!`);
    } catch (err) {
      reportError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  // ---------------- AUTO-SAVE HEADER ----------------
  function scheduleHeaderSave() {
    if (!state.shift || !state.canEdit || state.shift.status === 'submitted') return;
    updateSupplyDisplays();
    clearTimeout(state.headerTimer);
    state.headerTimer = setTimeout(() => {
      state.headerTimer = null;
      saveHeaderNow();
    }, 550);
  }

  async function saveHeaderNow() {
    if (!state.shift || !state.canEdit) return;
    const payload = collectHeaderPayload();
    Object.assign(state.shift, payload);
    setSyncBadge('saving');
    try {
      await apiFetch(`/api/duc2/shifts/${state.shift.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setSyncBadge('saved');
    } catch (err) {
      if (err.status === 401) return;
      if (isNetworkError(err)) {
        enqueueOfflineAction({ type: 'header', shiftId: state.shift.id, payload });
      } else {
        reportError(err);
      }
    }
  }

  // ---------------- MỤC 2: LÒ RÓT ĐÁY (LIVE 1 CHẠM) ----------------
  function renderQuickPourBar() {
    const bar = el('duc2QuickPourBar');
    if (!bar) return;
    const nextNo = state.pouring.length + 1;
    const furnaces = state.presets.furnaces || ['2.2', '3', '4', '5'];
    const editable = state.shift && state.canEdit && state.shift.status !== 'submitted';

    bar.innerHTML = furnaces.map(code => {
      const nextCode = D2.suggestNextHeatCode(code, state.pouring);
      return `
        <button type="button" class="btn-quick-pour" data-furnace="${U.escapeHtml(code)}" ${editable ? '' : 'disabled'}>
          <span class="qp-top">🔥 Rót Lù #${nextNo}</span>
          <span class="qp-sub">Lò ${U.escapeHtml(code)} → <strong>${U.escapeHtml(nextCode)}</strong></span>
        </button>
      `;
    }).join('');

    bar.querySelectorAll('.btn-quick-pour').forEach(btn => {
      btn.addEventListener('click', () => startQuickPour(btn.dataset.furnace));
    });
  }

  async function startQuickPour(furnaceCode) {
    if (!state.shift || !state.canEdit || state.shift.status === 'submitted') return;

    const active = state.pouring.find(b => b.status === 'pouring');
    if (active) {
      const ok = confirm(`Lù #${active.batch_no} (lò ${active.furnace_heat_label || active.furnace_code || '?'}) chưa bấm kết thúc.\nBạn muốn tự chốt giờ kết thúc cho lù #${active.batch_no} và mở lù mới ngay không?`);
      if (!ok) return;
      await finishPourBatch(active.id);
    }

    const nextNo = state.pouring.length + 1;
    const nextLabel = D2.suggestNextHeatCode(furnaceCode, state.pouring);
    const parsed = D2.parseFurnaceHeatCode(nextLabel);
    const defProd = el('duc2DefaultProduct').value.trim() || state.presets.products[0] || 'Bi 40';
    const defCust = el('duc2DefaultCustomer').value.trim() || state.presets.customers[0] || 'Molycop';

    const payload = {
      batch_no: nextNo,
      product_name: defProd,
      customer: defCust,
      temp_max: null,
      temp_min: null,
      start_time: D2.formatNowVNTime(new Date()),
      end_time: '',
      furnace_code: parsed.furnace || furnaceCode,
      heat_no: parsed.heat,
      furnace_heat_label: nextLabel,
      status: 'pouring',
      notes: ''
    };

    await createPourBatch(payload, true);
  }

  async function addManualPourBatch() {
    if (!state.shift || !state.canEdit || state.shift.status === 'submitted') return;
    const nextNo = state.pouring.length + 1;
    const defProd = el('duc2DefaultProduct').value.trim() || state.presets.products[0] || 'Bi 40';
    const defCust = el('duc2DefaultCustomer').value.trim() || state.presets.customers[0] || 'Molycop';
    await createPourBatch({
      batch_no: nextNo,
      product_name: defProd,
      customer: defCust,
      temp_max: null,
      temp_min: null,
      start_time: D2.formatNowVNTime(new Date()),
      end_time: '',
      furnace_code: '',
      heat_no: null,
      furnace_heat_label: '',
      status: 'done',
      notes: ''
    }, false);
  }

  async function createPourBatch(payload, focusActive) {
    setSyncBadge('saving');
    try {
      const res = await apiFetch(`/api/duc2/shifts/${state.shift.id}/pouring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      state.pouring.push(data.batch);
      setSyncBadge('saved');
    } catch (err) {
      if (err.status === 401) return;
      if (isNetworkError(err)) {
        const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        state.pouring.push({ ...payload, id: tempId });
        enqueueOfflineAction({ type: 'pouring_add', shiftId: state.shift.id, tempId, payload });
      } else {
        reportError(err);
        return;
      }
    }

    await syncMeltingFromPouring();
    renderPouringSection();
    updateLiveKpiStrip();
    if (focusActive) {
      const inp = el('duc2ActiveTempMax');
      if (inp) {
        inp.focus();
        inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  async function patchPourBatch(batchId, patchObj) {
    const batch = state.pouring.find(b => String(b.id) === String(batchId));
    if (!batch || !state.shift || !state.canEdit) return;
    Object.assign(batch, patchObj);
    setSyncBadge('saving');

    if (String(batchId).startsWith('tmp_')) {
      enqueueOfflineAction({ type: 'pouring_patch', shiftId: state.shift.id, batchId, payload: patchObj });
      return;
    }

    try {
      await apiFetch(`/api/duc2/shifts/${state.shift.id}/pouring/${batchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchObj)
      });
      setSyncBadge('saved');
    } catch (err) {
      if (err.status === 401) return;
      if (isNetworkError(err)) {
        enqueueOfflineAction({ type: 'pouring_patch', shiftId: state.shift.id, batchId, payload: patchObj });
      } else {
        reportError(err);
      }
    }
  }

  async function finishPourBatch(batchId) {
    const batch = state.pouring.find(b => String(b.id) === String(batchId));
    if (!batch) return;
    const endTime = batch.end_time && batch.end_time.trim()
      ? batch.end_time.trim()
      : D2.formatNowVNTime(new Date());
    await patchPourBatch(batchId, { end_time: endTime, status: 'done' });
    renderPouringSection();
    updateLiveKpiStrip();
    showToast(`✓ Đã chốt Lù #${batch.batch_no} lúc ${endTime}`);
  }

  async function deletePourBatch(batchId) {
    const batch = state.pouring.find(b => String(b.id) === String(batchId));
    if (!batch || !state.shift || !state.canEdit || state.shift.status === 'submitted') return;
    if (!confirm(`Xóa Lù #${batch.batch_no}? Các lù sau sẽ được đánh số lại tự động.`)) return;

    if (String(batchId).startsWith('tmp_')) {
      state.pouring = state.pouring.filter(b => String(b.id) !== String(batchId));
      state.pouring.forEach((b, idx) => { b.batch_no = idx + 1; });
      await syncMeltingFromPouring();
      renderPouringSection();
      updateLiveKpiStrip();
      return;
    }

    setSyncBadge('saving');
    try {
      const res = await apiFetch(`/api/duc2/shifts/${state.shift.id}/pouring/${batchId}`, { method: 'DELETE' });
      const data = await res.json();
      state.pouring = data.batches || [];
      setSyncBadge('saved');
      await syncMeltingFromPouring();
      renderPouringSection();
      updateLiveKpiStrip();
    } catch (err) {
      reportError(err);
    }
  }

  function renderActivePourCard() {
    const card = el('duc2ActivePourCard');
    if (!card) return;
    const active = state.pouring.find(b => b.status === 'pouring');
    if (!active || !state.canEdit || (state.shift && state.shift.status === 'submitted')) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    card.dataset.batchId = String(active.id);
    el('duc2ActivePourTitle').textContent = `Lù #${active.batch_no} (${active.product_name || ''} — ${active.customer || ''})`;
    el('duc2ActivePourMeta').textContent = `Bắt đầu lúc ${active.start_time || '...'}`;
    el('duc2ActiveTempMax').value = active.temp_max ?? '';
    el('duc2ActiveTempMin').value = active.temp_min ?? '';
    el('duc2ActiveFurnaceLabel').value = active.furnace_heat_label || '';
    el('duc2ActiveBatchNotes').value = active.notes || '';
  }

  function renderPouringSection() {
    renderQuickPourBar();
    renderActivePourCard();

    const tbody = el('duc2PouringTbody');
    if (!tbody) return;
    if (state.pouring.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--slate-600); padding:1.25rem;">Chưa có lù rót nào trong ca. Bấm nút lò ở trên khi bắt đầu rót.</td></tr>';
      return;
    }

    const editable = state.shift && state.canEdit && state.shift.status !== 'submitted';
    tbody.innerHTML = state.pouring.map(b => {
      const isPouring = b.status === 'pouring';
      return `
        <tr class="${isPouring ? 'duc2-row-pouring' : ''}" data-batch-id="${U.escapeHtml(b.id)}">
          <td><strong>${U.escapeHtml(b.batch_no)}</strong>${isPouring ? '<div class="duc2-mini-live">Rót</div>' : ''}</td>
          <td><input type="text" class="pour-field" data-field="product_name" list="duc2PresetProducts" value="${U.escapeHtml(b.product_name || '')}" ${editable ? '' : 'disabled'}></td>
          <td><input type="text" class="pour-field" data-field="customer" list="duc2PresetCustomers" value="${U.escapeHtml(b.customer || '')}" ${editable ? '' : 'disabled'}></td>
          <td><input type="number" class="pour-field" data-field="temp_max" value="${b.temp_max ?? ''}" min="0" max="3000" inputmode="numeric" ${editable ? '' : 'disabled'}></td>
          <td><input type="number" class="pour-field" data-field="temp_min" value="${b.temp_min ?? ''}" min="0" max="3000" inputmode="numeric" ${editable ? '' : 'disabled'}></td>
          <td><input type="text" class="pour-field" data-field="start_time" value="${U.escapeHtml(b.start_time || '')}" ${editable ? '' : 'disabled'}></td>
          <td><input type="text" class="pour-field" data-field="end_time" value="${U.escapeHtml(b.end_time || '')}" ${editable ? '' : 'disabled'}></td>
          <td><input type="text" class="pour-field" data-field="furnace_heat_label" value="${U.escapeHtml(b.furnace_heat_label || '')}" ${editable ? '' : 'disabled'}></td>
          <td><input type="text" class="pour-field" data-field="notes" value="${U.escapeHtml(b.notes || '')}" ${editable ? '' : 'disabled'}></td>
          <td>
            <div style="display:flex; gap:0.25rem; justify-content:center;">
              ${isPouring && editable ? `<button type="button" class="btn btn-sm btn-success btn-finish-row" title="Kết thúc rót">⏹</button>` : ''}
              ${editable ? `<button type="button" class="btn-danger-icon btn-del-row" title="Xóa lù">✕</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('tr[data-batch-id]').forEach(tr => {
      const batchId = tr.dataset.batchId;
      let rowTimer = null;

      tr.querySelectorAll('.pour-field').forEach(inp => {
        inp.addEventListener('input', () => {
          const field = inp.dataset.field;
          const batch = state.pouring.find(x => String(x.id) === String(batchId));
          if (!batch) return;

          let patch = {};
          if (field === 'temp_max' || field === 'temp_min') {
            patch[field] = inp.value === '' ? null : U.parseIntOr(inp.value, null);
          } else if (field === 'furnace_heat_label') {
            const parsed = D2.parseFurnaceHeatCode(inp.value);
            patch = {
              furnace_heat_label: inp.value.trim(),
              furnace_code: parsed.furnace,
              heat_no: parsed.heat
            };
          } else {
            patch[field] = inp.value;
          }
          Object.assign(batch, patch);

          if (field === 'furnace_heat_label') {
            renderQuickPourBar();
            syncMeltingFromPouring(false, false);
          }
          if (String(batch.id) === String((el('duc2ActivePourCard').dataset || {}).batchId)) {
            if (field === 'temp_max') el('duc2ActiveTempMax').value = inp.value;
            if (field === 'temp_min') el('duc2ActiveTempMin').value = inp.value;
            if (field === 'furnace_heat_label') el('duc2ActiveFurnaceLabel').value = inp.value;
            if (field === 'notes') el('duc2ActiveBatchNotes').value = inp.value;
          }

          clearTimeout(rowTimer);
          rowTimer = setTimeout(() => {
            patchPourBatch(batchId, patch);
          }, 500);
        });
      });

      const btnFin = tr.querySelector('.btn-finish-row');
      if (btnFin) btnFin.addEventListener('click', () => finishPourBatch(batchId));
      const btnDel = tr.querySelector('.btn-del-row');
      if (btnDel) btnDel.addEventListener('click', () => deletePourBatch(batchId));
    });
  }

  // ---------------- MỤC 3: KHUÔN TẠO HÌNH ----------------
  function renderMoldingSection() {
    const container = el('duc2MoldingContainer');
    if (!container) return;
    const editable = state.shift && state.canEdit && state.shift.status !== 'submitted';

    if (state.molding.length === 0) {
      container.innerHTML = '<div style="text-align:center; color:var(--slate-600); padding:1rem;">Chưa có dòng Khuôn tạo hình. Bấm "+ Thêm dòng SP Khuôn".</div>';
      return;
    }

    container.innerHTML = state.molding.map((m, idx) => {
      const timeRange = m.time_range || D2.formatTimeRange(m.start_time, m.end_time);
      return `
        <div class="entry-card" data-mld-idx="${idx}">
          <div class="entry-card-header">
            <div class="entry-card-title">
              <span class="card-icon">🧱</span>
              <span>Khuôn tạo hình #${idx + 1}</span>
            </div>
            ${editable ? `<button type="button" class="btn-remove-card btn-remove-molding"><span>Xóa</span> ✕</button>` : ''}
          </div>
          <div class="entry-card-body">
            <div class="grid grid-3">
              <div class="form-group">
                <label>Tên SP</label>
                <input type="text" class="mld-field" data-field="product_name" list="duc2PresetProducts" value="${U.escapeHtml(m.product_name || '')}" ${editable ? '' : 'disabled'}>
              </div>
              <div class="form-group">
                <label>Khách hàng</label>
                <input type="text" class="mld-field" data-field="customer" list="duc2PresetCustomers" value="${U.escapeHtml(m.customer || '')}" ${editable ? '' : 'disabled'}>
              </div>
              <div class="form-group">
                <label>Thời gian tạo hình (hiện trên phiếu)</label>
                <input type="text" class="mld-field mld-time-range" data-field="time_range" value="${U.escapeHtml(timeRange)}" placeholder="VD: 3h30–10h35" ${editable ? '' : 'disabled'}>
              </div>
            </div>
            <div class="grid grid-4 mt-2">
              <div class="form-group">
                <label>Giờ bắt đầu</label>
                <div class="duc2-input-with-btn">
                  <input type="text" class="mld-field mld-start-time" data-field="start_time" value="${U.escapeHtml(m.start_time || '')}" placeholder="VD: 3h30" ${editable ? '' : 'disabled'}>
                  <button type="button" class="btn btn-sm btn-outline btn-now-mld" data-target="start_time" title="Lấy giờ hiện tại" ${editable ? '' : 'disabled'}>⏱</button>
                </div>
              </div>
              <div class="form-group">
                <label>Giờ kết thúc</label>
                <div class="duc2-input-with-btn">
                  <input type="text" class="mld-field mld-end-time" data-field="end_time" value="${U.escapeHtml(m.end_time || '')}" placeholder="VD: 10h35" ${editable ? '' : 'disabled'}>
                  <button type="button" class="btn btn-sm btn-outline btn-now-mld" data-target="end_time" title="Lấy giờ hiện tại" ${editable ? '' : 'disabled'}>⏱</button>
                </div>
              </div>
              <div class="form-group">
                <label>Chỉ số đầu ca</label>
                <input type="number" class="mld-field mld-cstart" data-field="counter_start" value="${m.counter_start ?? ''}" placeholder="VD: 2319089" inputmode="numeric" ${editable ? '' : 'disabled'}>
              </div>
              <div class="form-group">
                <label>Chỉ số cuối ca</label>
                <input type="number" class="mld-field mld-cend" data-field="counter_end" value="${m.counter_end ?? ''}" placeholder="VD: 2320016" inputmode="numeric" ${editable ? '' : 'disabled'}>
              </div>
            </div>
            <div class="grid grid-3 mt-2">
              <div class="form-group">
                <label>Khuôn tạo hình (tự tính)</label>
                <input type="number" class="mld-field mld-created input-highlight" data-field="molds_created" value="${m.molds_created ?? ''}" placeholder="Tự tính" inputmode="numeric" ${editable ? '' : 'disabled'}>
              </div>
              <div class="form-group">
                <label>Khuôn rót</label>
                <input type="number" class="mld-field input-highlight" data-field="molds_poured" value="${m.molds_poured ?? ''}" placeholder="VD: 819" inputmode="numeric" ${editable ? '' : 'disabled'}>
              </div>
              <div class="form-group">
                <label>Ghi chú</label>
                <input type="text" class="mld-field" data-field="notes" value="${U.escapeHtml(m.notes || '')}" placeholder="Ghi chú (nếu có)" ${editable ? '' : 'disabled'}>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.entry-card[data-mld-idx]').forEach(card => {
      const idx = parseInt(card.dataset.mldIdx, 10);
      const item = state.molding[idx];
      if (!item) return;

      card.querySelectorAll('.mld-field').forEach(inp => {
        inp.addEventListener('input', () => {
          const field = inp.dataset.field;
          if (['counter_start', 'counter_end', 'molds_created', 'molds_poured'].includes(field)) {
            item[field] = inp.value === '' ? null : U.parseIntOr(inp.value, null);
          } else {
            item[field] = inp.value;
          }

          if (field === 'start_time' || field === 'end_time') {
            item.time_range = D2.formatTimeRange(item.start_time, item.end_time);
            card.querySelector('.mld-time-range').value = item.time_range;
          }
          if (field === 'counter_start' || field === 'counter_end') {
            const diff = D2.computeMoldsCreated(item.counter_start, item.counter_end);
            if (diff !== null) {
              item.molds_created = diff;
              card.querySelector('.mld-created').value = diff;
            }
          }
          updateLiveKpiStrip();
          scheduleMoldingSave();
        });
      });

      card.querySelectorAll('.btn-now-mld').forEach(btn => {
        btn.addEventListener('click', () => {
          const t = D2.formatNowVNTime(new Date());
          const target = btn.dataset.target;
          item[target] = t;
          item.time_range = D2.formatTimeRange(item.start_time, item.end_time);
          card.querySelector(target === 'start_time' ? '.mld-start-time' : '.mld-end-time').value = t;
          card.querySelector('.mld-time-range').value = item.time_range;
          scheduleMoldingSave();
        });
      });

      const btnRem = card.querySelector('.btn-remove-molding');
      if (btnRem) {
        btnRem.addEventListener('click', () => {
          if (state.molding.length <= 1 && !confirm('Xóa dòng khuôn cuối cùng?')) return;
          state.molding.splice(idx, 1);
          renderMoldingSection();
          updateLiveKpiStrip();
          scheduleMoldingSave();
        });
      }
    });
  }

  function scheduleMoldingSave() {
    if (!state.shift || !state.canEdit || state.shift.status === 'submitted') return;
    clearTimeout(state.moldingTimer);
    state.moldingTimer = setTimeout(() => {
      state.moldingTimer = null;
      saveMoldingNow();
    }, 550);
  }

  async function saveMoldingNow() {
    if (!state.shift || !state.canEdit) return;
    setSyncBadge('saving');
    try {
      await apiFetch(`/api/duc2/shifts/${state.shift.id}/molding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: state.molding })
      });
      setSyncBadge('saved');
    } catch (err) {
      if (err.status === 401) return;
      if (isNetworkError(err)) {
        enqueueOfflineAction({ type: 'molding', shiftId: state.shift.id, payload: state.molding });
      } else {
        reportError(err);
      }
    }
  }

  // ---------------- MỤC 4: LÒ NẤU (TỰ ĐỘNG + TÙY CHỈNH) ----------------
  function getDefaultProductGroup() {
    return {
      product_name: (el('duc2DefaultProduct') && el('duc2DefaultProduct').value.trim()) || state.presets.products[0] || 'Bi 40',
      customer: (el('duc2DefaultCustomer') && el('duc2DefaultCustomer').value.trim()) || state.presets.customers[0] || 'Molycop',
      steel_grade: (el('duc2DefaultSteelGrade') && el('duc2DefaultSteelGrade').value.trim()) || state.presets.steel_grades[0] || 'Cr18-19.5'
    };
  }

  async function syncMeltingFromPouring(resetOverrides = false, immediate = true) {
    if (!state.shift) return;
    const prevMap = (state.carryover && state.carryover.furnace_life_map) || {};
    const baseList = resetOverrides
      ? state.melting.map(f => ({ ...f, manual_heat_override: 0, manual_life_override: 0 }))
      : state.melting;

    state.melting = D2.recalculateFurnacesFromBatches(
      state.pouring,
      baseList,
      prevMap,
      getDefaultProductGroup()
    );
    renderMeltingSection();
    if (immediate) {
      await saveMeltingNow();
    } else {
      scheduleMeltingSave();
    }
  }

  function renderMeltingSection() {
    const container = el('duc2MeltingContainer');
    if (!container) return;
    const editable = state.shift && state.canEdit && state.shift.status !== 'submitted';

    if (state.melting.length === 0) {
      container.innerHTML = '<div style="text-align:center; color:var(--slate-600); padding:1rem;">Bảng Lò nấu sẽ tự động điền khi bạn bắt đầu rót lù từ lò (hoặc bấm "+ Thêm lò nấu").</div>';
      return;
    }

    container.innerHTML = state.melting.map((f, idx) => `
      <div class="entry-card" data-melt-idx="${idx}">
        <div class="entry-card-header">
          <div class="entry-card-title">
            <span class="card-icon">🌋</span>
            <span>Lò nấu ${U.escapeHtml(f.furnace_code || `#${idx + 1}`)}</span>
          </div>
          <div style="display:flex; gap:0.4rem; align-items:center;">
            ${editable ? `<button type="button" class="btn btn-sm btn-outline btn-reline-furnace" title="Thay tường lò mới (reset tuổi thọ đầu ca về 0)">↻ Thay tường lò</button>` : ''}
            ${editable ? `<button type="button" class="btn-remove-card btn-remove-melting"><span>Xóa</span> ✕</button>` : ''}
          </div>
        </div>
        <div class="entry-card-body">
          <div class="grid grid-4">
            <div class="form-group">
              <label>Tên SP</label>
              <input type="text" class="melt-field" data-field="product_name" list="duc2PresetProducts" value="${U.escapeHtml(f.product_name || '')}" ${editable ? '' : 'disabled'}>
            </div>
            <div class="form-group">
              <label>Khách hàng</label>
              <input type="text" class="melt-field" data-field="customer" list="duc2PresetCustomers" value="${U.escapeHtml(f.customer || '')}" ${editable ? '' : 'disabled'}>
            </div>
            <div class="form-group">
              <label>Mác thép</label>
              <input type="text" class="melt-field" data-field="steel_grade" list="duc2PresetSteelGrades" value="${U.escapeHtml(f.steel_grade || '')}" ${editable ? '' : 'disabled'}>
            </div>
            <div class="form-group">
              <label>Lò nấu</label>
              <input type="text" class="melt-field" data-field="furnace_code" list="duc2PresetFurnaces" value="${U.escapeHtml(f.furnace_code || '')}" ${editable ? '' : 'disabled'}>
            </div>
          </div>
          <div class="grid grid-4 mt-2">
            <div class="form-group">
              <label>Số mẻ nấu</label>
              <input type="number" class="melt-field melt-heats input-highlight" data-field="heat_count" value="${f.heat_count ?? 0}" min="0" inputmode="numeric" ${editable ? '' : 'disabled'}>
            </div>
            <div class="form-group">
              <label>Tuổi thọ đầu ca</label>
              <input type="number" class="melt-field melt-prev-life" data-field="prev_lining_life" value="${f.prev_lining_life ?? 0}" min="0" inputmode="numeric" ${editable ? '' : 'disabled'}>
            </div>
            <div class="form-group">
              <label>Tuổi thọ cuối ca</label>
              <input type="number" class="melt-field melt-life input-highlight" data-field="lining_life" value="${f.lining_life ?? 0}" min="0" inputmode="numeric" ${editable ? '' : 'disabled'}>
            </div>
            <div class="form-group">
              <label>Ghi chú</label>
              <input type="text" class="melt-field" data-field="notes" value="${U.escapeHtml(f.notes || '')}" placeholder="Ghi chú lò..." ${editable ? '' : 'disabled'}>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.entry-card[data-melt-idx]').forEach(card => {
      const idx = parseInt(card.dataset.meltIdx, 10);
      const item = state.melting[idx];
      if (!item) return;

      card.querySelectorAll('.melt-field').forEach(inp => {
        inp.addEventListener('input', () => {
          const field = inp.dataset.field;
          if (field === 'heat_count') {
            item.heat_count = U.parseIntOr(inp.value, 0);
            item.manual_heat_override = 1;
            if (!item.manual_life_override) {
              item.lining_life = (Number(item.prev_lining_life) || 0) + item.heat_count;
              card.querySelector('.melt-life').value = item.lining_life;
            }
          } else if (field === 'prev_lining_life') {
            item.prev_lining_life = U.parseIntOr(inp.value, 0);
            if (!item.manual_life_override) {
              item.lining_life = item.prev_lining_life + (Number(item.heat_count) || 0);
              card.querySelector('.melt-life').value = item.lining_life;
            }
          } else if (field === 'lining_life') {
            item.lining_life = U.parseIntOr(inp.value, 0);
            item.manual_life_override = 1;
          } else {
            item[field] = inp.value;
          }
          scheduleMeltingSave();
        });
      });

      const btnReline = card.querySelector('.btn-reline-furnace');
      if (btnReline) {
        btnReline.addEventListener('click', () => {
          if (!confirm(`Xác nhận đã thay tường mới cho Lò ${item.furnace_code}? Tuổi thọ đầu ca sẽ đặt về 0.`)) return;
          item.prev_lining_life = 0;
          item.manual_life_override = 0;
          item.lining_life = Number(item.heat_count) || 0;
          renderMeltingSection();
          scheduleMeltingSave();
        });
      }

      const btnDel = card.querySelector('.btn-remove-melting');
      if (btnDel) {
        btnDel.addEventListener('click', () => {
          state.melting.splice(idx, 1);
          renderMeltingSection();
          scheduleMeltingSave();
        });
      }
    });
  }

  function scheduleMeltingSave() {
    if (!state.shift || !state.canEdit || state.shift.status === 'submitted') return;
    clearTimeout(state.meltingTimer);
    state.meltingTimer = setTimeout(() => {
      state.meltingTimer = null;
      saveMeltingNow();
    }, 550);
  }

  async function saveMeltingNow() {
    if (!state.shift || !state.canEdit) return;
    setSyncBadge('saving');
    try {
      await apiFetch(`/api/duc2/shifts/${state.shift.id}/melting`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: state.melting })
      });
      setSyncBadge('saved');
    } catch (err) {
      if (err.status === 401) return;
      if (isNetworkError(err)) {
        enqueueOfflineAction({ type: 'melting', shiftId: state.shift.id, payload: state.melting });
      } else {
        reportError(err);
      }
    }
  }

  function renderAllSections() {
    renderPouringSection();
    renderMoldingSection();
    renderMeltingSection();
  }

  // ---------------- BẤM GIỜ SỰ CỐ ----------------
  function toggleIssueTimer() {
    const btn = el('duc2BtnIssueTimer');
    const lbl = el('duc2IssueTimerLabel');
    if (!state.issueTimerStart) {
      state.issueTimerStart = new Date();
      btn.textContent = '⏹ Dừng & chèn sự cố';
      btn.classList.remove('btn-outline');
      btn.classList.add('btn-danger-outline');
      lbl.style.display = 'inline-block';
      lbl.textContent = '00:00';
      state.issueTimerInterval = setInterval(() => {
        const sec = Math.max(0, Math.floor((Date.now() - state.issueTimerStart.getTime()) / 1000));
        const mm = String(Math.floor(sec / 60)).padStart(2, '0');
        const ss = String(sec % 60).padStart(2, '0');
        lbl.textContent = `${mm}:${ss}`;
      }, 1000);
    } else {
      const end = new Date();
      const mins = D2.formatMinutesElapsed(state.issueTimerStart, end);
      clearInterval(state.issueTimerInterval);
      state.issueTimerInterval = null;
      state.issueTimerStart = null;
      btn.textContent = '⏱ Bắt đầu sự cố';
      btn.classList.remove('btn-danger-outline');
      btn.classList.add('btn-outline');
      lbl.style.display = 'none';

      const nameInput = el('duc2IssueQuickName');
      const desc = (nameInput.value || '').trim() || 'Sự cố dừng máy';
      const line = `- ${desc}: ${mins}'`;
      const area = el('duc2Issues');
      area.value = area.value.trim() ? `${area.value.trim()}\n${line}` : line;
      nameInput.value = '';
      scheduleHeaderSave();
      showToast(`Đã chèn sự cố "${line}"`);
    }
  }

  // ---------------- CHỐT CA / MỞ LẠI / XÓA / XUẤT EXCEL ----------------
  async function flushAllPendingEdits() {
    if (state.headerTimer) {
      clearTimeout(state.headerTimer);
      state.headerTimer = null;
      await saveHeaderNow();
    }
    if (state.moldingTimer) {
      clearTimeout(state.moldingTimer);
      state.moldingTimer = null;
      await saveMoldingNow();
    }
    if (state.meltingTimer) {
      clearTimeout(state.meltingTimer);
      state.meltingTimer = null;
      await saveMeltingNow();
    }
  }

  async function submitShift() {
    if (!state.shift || !state.canEdit) return;
    const activePour = state.pouring.filter(b => b.status === 'pouring');
    if (activePour.length > 0) {
      const ok = confirm(`Vẫn còn ${activePour.length} lù chưa bấm kết thúc rót. Tự động chốt giờ kết thúc ngay bây giờ để hoàn tất ca?`);
      if (!ok) return;
      for (const b of activePour) {
        await finishPourBatch(b.id);
      }
    }

    await flushAllPendingEdits();
    const btn = el('duc2BtnSubmitShift');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Đang chốt báo cáo ca...';
    try {
      const res = await apiFetch(`/api/duc2/shifts/${state.shift.id}/submit`, { method: 'POST' });
      const data = await res.json();
      state.shift = data.shift_data;
      state.molding = (state.shift.molding || []).map(m => ({ ...m }));
      state.pouring = (state.shift.pouring || []).map(b => ({ ...b }));
      state.melting = (state.shift.melting || []).map(f => ({ ...f }));
      applyHeaderToUi(state.shift);
      renderAllSections();
      renderShiftWorkspaceState();
      setSyncBadge('saved', 'Đã chốt báo cáo ca');
      showToast('✅ Đã chốt báo cáo ca PX ĐÚC 2!');
    } catch (err) {
      reportError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  async function reopenShift() {
    if (!state.shift || !state.canEdit) return;
    if (!confirm('Mở khóa báo cáo ca này để chỉnh sửa lại?')) return;
    try {
      const res = await apiFetch(`/api/duc2/shifts/${state.shift.id}/reopen`, { method: 'POST' });
      const data = await res.json();
      state.shift = data.shift_data;
      renderShiftWorkspaceState();
      showToast('🔓 Đã mở lại ca để chỉnh sửa.');
    } catch (err) {
      reportError(err);
    }
  }

  async function deleteCurrentShift() {
    if (!state.shift || !currentUser || currentUser.role !== 'admin') return;
    if (!confirm(`Xóa vĩnh viễn báo cáo PX ĐÚC 2 Ca ${state.shift.shift_num} ngày ${formatDateDisplay(state.shift.report_date)}?`)) return;
    try {
      await apiFetch(`/api/duc2/shifts/${state.shift.id}`, { method: 'DELETE' });
      showToast('Đã xóa ca báo cáo.');
      await loadCurrentShift();
    } catch (err) {
      reportError(err);
    }
  }

  async function exportShiftToExcel(shiftObj) {
    const snapshot = shiftObj || buildFullShiftSnapshot();
    if (!snapshot) {
      showToast('Chưa có dữ liệu ca để xuất Excel.');
      return;
    }
    try {
      if (!shiftObj) await flushAllPendingEdits();
      const filename = await ExcelMod.exportDuc2Excel(snapshot);
      showToast(`📥 Đã tải ${filename}`);
    } catch (err) {
      reportError(err);
    }
  }

  function openPreviewModal(shiftObj) {
    const snapshot = shiftObj || buildFullShiftSnapshot();
    if (!snapshot) {
      showToast('Chưa có dữ liệu ca để xem trước.');
      return;
    }
    state.previewShiftData = snapshot;
    el('duc2PreviewContent').innerHTML = ExcelMod.buildPrintPreviewHtml(snapshot);
    el('duc2PreviewModal').style.display = 'flex';
  }

  function closePreviewModal() {
    el('duc2PreviewModal').style.display = 'none';
  }

  // ---------------- DANH SÁCH CA & XUẤT EXCEL (TAB LỊCH SỬ) ----------------
  async function loadHistoryList() {
    const tbody = el('tbodyDuc2History');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:1.5rem;">Đang tải danh sách ca...</td></tr>';

    const params = new URLSearchParams();
    params.set('limit', '80');
    const fromD = el('duc2HistFromDate').value;
    const toD = el('duc2HistToDate').value;
    const st = el('duc2HistStatus').value;
    if (fromD) params.set('from_date', fromD);
    if (toD) params.set('to_date', toD);
    if (st) params.set('status', st);

    try {
      const res = await apiFetch(`/api/duc2/shifts/list?${params.toString()}`);
      const rows = await res.json();
      if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:var(--slate-600);">Chưa có báo cáo ca nào cho PX ĐÚC 2.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.map(r => {
        const isDone = r.status === 'submitted';
        const statusHtml = isDone
          ? '<span class="rate-badge good">Đã chốt ca</span>'
          : '<span class="rate-badge warn">Đang làm việc</span>';
        return `
          <tr data-shift-id="${r.id}" data-date="${U.escapeHtml(r.report_date)}" data-shift-num="${r.shift_num}">
            <td><strong>${U.escapeHtml(formatDateDisplay(r.report_date))}</strong></td>
            <td>Ca ${U.escapeHtml(r.shift_num)}</td>
            <td>${U.escapeHtml(r.shift_leader)}</td>
            <td>${statusHtml}</td>
            <td><strong>${U.escapeHtml(r.pouring_count || 0)}</strong> lù</td>
            <td>${U.escapeHtml(r.molds_created_total || 0)} / ${U.escapeHtml(r.molds_poured_total || 0)}</td>
            <td>${U.escapeHtml(r.melting_heats_total || 0)} mẻ</td>
            <td>
              <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                <button type="button" class="btn btn-sm btn-outline btn-hist-open">Mở ca</button>
                <button type="button" class="btn btn-sm btn-outline btn-hist-preview">👁 A4</button>
                <button type="button" class="btn btn-sm btn-success btn-hist-excel">📥 Excel</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('tr[data-shift-id]').forEach(tr => {
        const shiftId = tr.dataset.shiftId;
        tr.querySelector('.btn-hist-open').addEventListener('click', () => {
          el('duc2ReportDate').value = tr.dataset.date;
          el('duc2ShiftNum').value = tr.dataset.shiftNum;
          el('btnTabDuc2Live').click();
          loadCurrentShift();
        });
        tr.querySelector('.btn-hist-preview').addEventListener('click', async () => {
          try {
            const res = await apiFetch(`/api/duc2/shifts/${shiftId}`);
            const full = await res.json();
            openPreviewModal(full);
          } catch (err) {
            reportError(err);
          }
        });
        tr.querySelector('.btn-hist-excel').addEventListener('click', async () => {
          try {
            const res = await apiFetch(`/api/duc2/shifts/${shiftId}`);
            const full = await res.json();
            await exportShiftToExcel(full);
          } catch (err) {
            reportError(err);
          }
        });
      });
    } catch (err) {
      if (err.status === 401) return;
      tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger); padding:1rem;">${U.escapeHtml(err.message)}</td></tr>`;
    }
  }

  // ---------------- KHỞI TẠO & GẮN SỰ KIỆN ----------------
  function bindEventsOnce() {
    if (initialized) return;
    initialized = true;

    el('duc2ReportDate').value = todayStr();
    el('duc2ReportDate').addEventListener('change', loadCurrentShift);
    el('duc2ShiftNum').addEventListener('change', loadCurrentShift);
    el('duc2BtnDateToday').addEventListener('click', () => {
      el('duc2ReportDate').value = todayStr();
      loadCurrentShift();
    });
    el('duc2BtnDateYesterday').addEventListener('click', () => {
      el('duc2ReportDate').value = U.yesterdayStr(new Date());
      loadCurrentShift();
    });

    el('duc2BtnOpenShift').addEventListener('click', handleOpenShift);
    el('duc2BtnSyncRetry').addEventListener('click', flushOfflineQueue);

    el('duc2BtnToggleInfo').addEventListener('click', () => {
      state.infoCollapsed = !state.infoCollapsed;
      el('duc2InfoBody').style.display = state.infoCollapsed ? 'none' : 'block';
      el('duc2BtnToggleInfo').textContent = state.infoCollapsed ? 'Mở rộng ▼' : 'Thu gọn ▲';
    });

    // Header auto-save bindings
    [
      'duc2StartTime', 'duc2EndTime', 'duc2DocCode', 'duc2DocNumber',
      'duc2DefaultProduct', 'duc2DefaultCustomer', 'duc2DefaultSteelGrade',
      'duc2StaffTotal', 'duc2StaffPresent', 'duc2LeavePermittedNames', 'duc2LeaveUnpermittedNames',
      'duc2StopperStart', 'duc2StopperAdded', 'duc2StopperUsed',
      'duc2NozzleStart', 'duc2NozzleAdded', 'duc2NozzleUsed',
      'duc2Issues', 'duc2Suggestions'
    ].forEach(id => {
      const node = el(id);
      if (node) node.addEventListener('input', scheduleHeaderSave);
    });

    ['duc2SafetyProd', 'duc2SafetyPpe', 'duc2SafetyEquip'].forEach(id => {
      const node = el(id);
      if (node) node.addEventListener('change', scheduleHeaderSave);
    });

    // Stepper -1 / +1 cho vật tư
    document.querySelectorAll('.btn-step[data-supply]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!state.shift || !state.canEdit || state.shift.status === 'submitted') return;
        const targetId = btn.dataset.supply === 'stopper' ? 'duc2StopperUsed' : 'duc2NozzleUsed';
        const delta = parseInt(btn.dataset.delta, 10) || 0;
        const inp = el(targetId);
        const cur = U.parseIntOr(inp.value, 0);
        inp.value = Math.max(0, cur + delta);
        scheduleHeaderSave();
      });
    });

    // Thẻ lù đang rót bindings
    const syncActiveField = (inputId, field) => {
      const node = el(inputId);
      if (!node) return;
      node.addEventListener('input', () => {
        const activeId = (el('duc2ActivePourCard').dataset || {}).batchId;
        const batch = state.pouring.find(b => String(b.id) === String(activeId));
        if (!batch) return;
        let patch = {};
        if (field === 'temp_max' || field === 'temp_min') {
          patch[field] = node.value === '' ? null : U.parseIntOr(node.value, null);
        } else if (field === 'furnace_heat_label') {
          const parsed = D2.parseFurnaceHeatCode(node.value);
          patch = { furnace_heat_label: node.value.trim(), furnace_code: parsed.furnace, heat_no: parsed.heat };
        } else {
          patch[field] = node.value;
        }
        Object.assign(batch, patch);
        // Đồng bộ ô tương ứng trong bảng
        const rowInp = document.querySelector(`#duc2PouringTbody tr[data-batch-id="${activeId}"] .pour-field[data-field="${field}"]`);
        if (rowInp) rowInp.value = node.value;
        if (field === 'furnace_heat_label') {
          renderQuickPourBar();
          syncMeltingFromPouring(false, false);
        }
        clearTimeout(state.activeBatchTimer);
        state.activeBatchTimer = setTimeout(() => patchPourBatch(activeId, patch), 450);
      });
    };
    syncActiveField('duc2ActiveTempMax', 'temp_max');
    syncActiveField('duc2ActiveTempMin', 'temp_min');
    syncActiveField('duc2ActiveFurnaceLabel', 'furnace_heat_label');
    syncActiveField('duc2ActiveBatchNotes', 'notes');

    el('duc2BtnFinishActivePour').addEventListener('click', () => {
      const activeId = (el('duc2ActivePourCard').dataset || {}).batchId;
      if (activeId) finishPourBatch(activeId);
    });
    el('duc2BtnAddManualPour').addEventListener('click', addManualPourBatch);

    // Khuôn tạo hình
    el('duc2BtnAddMolding').addEventListener('click', () => {
      if (!state.shift || !state.canEdit || state.shift.status === 'submitted') return;
      const defs = getDefaultProductGroup();
      state.molding.push({
        product_name: defs.product_name,
        customer: defs.customer,
        start_time: D2.formatNowVNTime(new Date()),
        end_time: '',
        time_range: '',
        counter_start: null,
        counter_end: null,
        molds_created: null,
        molds_poured: null,
        notes: ''
      });
      renderMoldingSection();
      scheduleMoldingSave();
    });

    // Lò nấu
    el('duc2BtnAddMelting').addEventListener('click', () => {
      if (!state.shift || !state.canEdit || state.shift.status === 'submitted') return;
      const defs = getDefaultProductGroup();
      const usedCodes = new Set(state.melting.map(f => f.furnace_code));
      const nextCode = (state.presets.furnaces || []).find(c => !usedCodes.has(c)) || '';
      const prevLife = ((state.carryover && state.carryover.furnace_life_map) || {})[nextCode] || 0;
      state.melting.push({
        product_name: defs.product_name,
        customer: defs.customer,
        steel_grade: defs.steel_grade,
        furnace_code: nextCode,
        heat_count: 0,
        prev_lining_life: prevLife,
        lining_life: prevLife,
        manual_heat_override: 0,
        manual_life_override: 0,
        notes: ''
      });
      renderMeltingSection();
      scheduleMeltingSave();
    });

    el('duc2BtnResyncMelting').addEventListener('click', () => {
      if (!state.shift || !state.canEdit || state.shift.status === 'submitted') return;
      syncMeltingFromPouring(true);
      showToast('Đã đồng bộ lại số mẻ nấu từ bảng Lò rót đáy.');
    });

    // Bấm giờ sự cố
    el('duc2BtnIssueTimer').addEventListener('click', toggleIssueTimer);

    // Chốt ca / Xem trước / Xuất Excel
    el('duc2BtnSubmitShift').addEventListener('click', submitShift);
    el('duc2BtnReopenShift').addEventListener('click', reopenShift);
    el('duc2BtnDeleteShift').addEventListener('click', deleteCurrentShift);
    el('duc2BtnPreviewA4').addEventListener('click', () => openPreviewModal());
    el('duc2BtnTopPreview').addEventListener('click', () => openPreviewModal());
    el('duc2BtnExportExcel').addEventListener('click', () => exportShiftToExcel());
    el('duc2BtnTopExport').addEventListener('click', () => exportShiftToExcel());

    // Modal A4
    el('duc2PreviewClose').addEventListener('click', closePreviewModal);
    el('duc2PreviewExportBtn').addEventListener('click', () => exportShiftToExcel(state.previewShiftData));
    el('duc2PreviewPrintBtn').addEventListener('click', () => window.print());
    el('duc2PreviewModal').addEventListener('click', (e) => {
      if (e.target === el('duc2PreviewModal')) closePreviewModal();
    });

    // Lịch sử
    el('duc2BtnFilterHistory').addEventListener('click', loadHistoryList);
    el('duc2BtnRefreshHistory').addEventListener('click', loadHistoryList);

    // Tự đồng bộ khi có mạng lại
    root.addEventListener('online', () => {
      flushOfflineQueue();
    });
  }

  async function activate(user, sharedHelpers) {
    currentUser = user;
    helpers = sharedHelpers;
    bindEventsOnce();
    await reloadPresets();
    await loadCurrentShift();
    flushOfflineQueue();
  }

  function onTabShow(tabName) {
    if (!initialized) return;
    if (tabName === 'live') {
      refreshSignaturePreview();
    } else if (tabName === 'history') {
      loadHistoryList();
    }
  }

  function updateCurrentUser(user) {
    currentUser = user;
    refreshSignaturePreview();
  }

  root.Duc2App = {
    activate,
    onTabShow,
    reloadPresets,
    refreshSignaturePreview,
    updateCurrentUser
  };
})(window);
