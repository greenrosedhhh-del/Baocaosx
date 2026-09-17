// VICO Production Reporting System - Frontend Logic

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const reportDateInput = document.getElementById('reportDate');
  const shiftNumSelect = document.getElementById('shiftNum');
  const shiftLeaderInput = document.getElementById('shiftLeader');
  const startTimeInput = document.getElementById('startTime');
  const endTimeInput = document.getElementById('endTime');
  const currentDateDisplay = document.getElementById('currentDateDisplay');

  const tbodyPackaging = document.getElementById('tbodyPackaging');
  const tbodyBaskets = document.getElementById('tbodyBaskets');
  const tbodyTumbling = document.getElementById('tbodyTumbling');

  const btnAddPackagingRow = document.getElementById('btnAddPackagingRow');
  const btnAddBasketRow = document.getElementById('btnAddBasketRow');
  const btnAddTumblingRow = document.getElementById('btnAddTumblingRow');
  const shiftReportForm = document.getElementById('shiftReportForm');
  const btnResetForm = document.getElementById('btnResetForm');

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
      }
    });
  });

  shiftNumSelect.addEventListener('change', updateShiftHours);

  function updateShiftHours() {
    const shift = shiftNumSelect.value;
    if (presets.shift_hours && presets.shift_hours[shift]) {
      startTimeInput.value = presets.shift_hours[shift].start;
      endTimeInput.value = presets.shift_hours[shift].end;
    }
  }

  // --- DYNAMIC ROWS MANAGEMENT ---

  // 1. Packaging Rows
  function addPackagingRow(data = {}) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="text" class="pkg-product" value="${data.product_name || 'D25'}" list="prodList" placeholder="Tên SP">
      </td>
      <td>
        <input type="text" class="pkg-customer" value="${data.customer || 'Molycop'}" list="custList" placeholder="Khách hàng">
      </td>
      <td>
        <input type="number" class="pkg-sorted" value="${data.weight_sorted || ''}" placeholder="0" min="0" step="any">
      </td>
      <td>
        <input type="number" class="pkg-waste" value="${data.weight_waste !== undefined ? data.weight_waste : ''}" placeholder="0" min="0" step="any">
      </td>
      <td>
        <span class="rate-badge pkg-rate">-</span>
      </td>
      <td>
        <input type="text" class="pkg-notes" value="${data.notes || ''}" placeholder="Ghi chú">
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn-danger-icon btn-remove-row" title="Xóa dòng">✕</button>
      </td>
    `;

    const sortedInput = tr.querySelector('.pkg-sorted');
    const wasteInput = tr.querySelector('.pkg-waste');
    const rateBadge = tr.querySelector('.pkg-rate');

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

    tr.querySelector('.btn-remove-row').addEventListener('click', () => tr.remove());
    tbodyPackaging.appendChild(tr);
  }

  // 2. Basket Rows (Bi ra sau tôi)
  function addBasketRow(data = {}) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="text" class="bsk-product" value="${data.product_name || 'D25'}" list="prodList" placeholder="Tên SP">
      </td>
      <td>
        <input type="text" class="bsk-customer" value="${data.customer || 'Molycop'}" list="custList" placeholder="Khách hàng">
      </td>
      <td>
        <input type="text" class="bsk-steel" value="${data.steel_grade || 'CR18'}" list="steelList" placeholder="Mác thép">
      </td>
      <td>
        <input type="number" class="bsk-count" value="${data.basket_count || ''}" placeholder="0" min="0" step="any">
      </td>
      <td>
        <input type="number" class="bsk-weight" value="${data.total_weight || ''}" placeholder="Tự động (x 350kg)">
      </td>
      <td>
        <input type="text" class="bsk-notes" value="${data.notes || ''}" placeholder="Ghi chú">
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn-danger-icon btn-remove-row" title="Xóa dòng">✕</button>
      </td>
    `;

    const countInput = tr.querySelector('.bsk-count');
    const weightInput = tr.querySelector('.bsk-weight');

    countInput.addEventListener('input', () => {
      const count = parseFloat(countInput.value) || 0;
      if (count > 0 && !weightInput.dataset.manual) {
        weightInput.value = count * 350;
      }
    });

    weightInput.addEventListener('input', () => {
      weightInput.dataset.manual = "true";
    });

    tr.querySelector('.btn-remove-row').addEventListener('click', () => tr.remove());
    tbodyBaskets.appendChild(tr);
  }

  // 3. Tumbling Rows (Mẻ bi xóc)
  function addTumblingRow(data = {}) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="text" class="tmb-product" value="${data.product_name || 'D25'}" list="prodList" placeholder="Tên SP">
      </td>
      <td>
        <input type="text" class="tmb-customer" value="${data.customer || 'Molycop'}" list="custList" placeholder="Khách hàng">
      </td>
      <td>
        <input type="number" class="tmb-m1" value="${data.m1 !== undefined ? data.m1 : ''}" placeholder="0" min="0" step="any">
      </td>
      <td>
        <input type="number" class="tmb-m2" value="${data.m2 !== undefined ? data.m2 : ''}" placeholder="0" min="0" step="any">
      </td>
      <td>
        <input type="number" class="tmb-weight" value="${data.total_weight || ''}" placeholder="Kg" min="0" step="any">
      </td>
      <td>
        <input type="text" class="tmb-notes" value="${data.notes || ''}" placeholder="Khô dầu...">
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn-danger-icon btn-remove-row" title="Xóa dòng">✕</button>
      </td>
    `;

    tr.querySelector('.btn-remove-row').addEventListener('click', () => tr.remove());
    tbodyTumbling.appendChild(tr);
  }

  // Add initial empty rows
  addPackagingRow();
  addBasketRow();
  addTumblingRow();

  btnAddPackagingRow.addEventListener('click', () => addPackagingRow());
  btnAddBasketRow.addEventListener('click', () => addBasketRow());
  btnAddTumblingRow.addEventListener('click', () => addTumblingRow());

  // --- SUBMIT REPORT FORM ---
  shiftReportForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const reportDate = reportDateInput.value;
    const shiftNum = parseInt(shiftNumSelect.value, 10);
    const shiftLeader = shiftLeaderInput.value.trim();

    if (!reportDate || !shiftLeader) {
      showToast("Vui lòng điền đầy đủ ngày báo cáo và tên trưởng ca!");
      return;
    }

    // Gather packaging items
    const packaging = [];
    tbodyPackaging.querySelectorAll('tr').forEach(tr => {
      const pName = tr.querySelector('.pkg-product').value.trim();
      const cName = tr.querySelector('.pkg-customer').value.trim();
      const sVal = parseFloat(tr.querySelector('.pkg-sorted').value) || 0;
      const wVal = parseFloat(tr.querySelector('.pkg-waste').value) || 0;
      const notes = tr.querySelector('.pkg-notes').value.trim();
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

    // Gather basket items
    const baskets = [];
    tbodyBaskets.querySelectorAll('tr').forEach(tr => {
      const pName = tr.querySelector('.bsk-product').value.trim();
      const cName = tr.querySelector('.bsk-customer').value.trim();
      const steel = tr.querySelector('.bsk-steel').value.trim();
      const count = parseFloat(tr.querySelector('.bsk-count').value) || 0;
      const weight = parseFloat(tr.querySelector('.bsk-weight').value) || (count * 350);
      const notes = tr.querySelector('.bsk-notes').value.trim();
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

    // Gather tumbling items
    const tumbling = [];
    tbodyTumbling.querySelectorAll('tr').forEach(tr => {
      const pName = tr.querySelector('.tmb-product').value.trim();
      const cName = tr.querySelector('.tmb-customer').value.trim();
      const m1 = parseFloat(tr.querySelector('.tmb-m1').value) || 0;
      const m2 = parseFloat(tr.querySelector('.tmb-m2').value) || 0;
      const weight = parseFloat(tr.querySelector('.tmb-weight').value) || 0;
      const notes = tr.querySelector('.tmb-notes').value.trim();
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
      shift_leader: shiftLeader,
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
        // Switch to Summary Tab to see the progress
        setTimeout(() => {
          summaryDateInput.value = reportDate;
          document.getElementById('btnTabSummary').click();
        }, 1200);
      } else {
        alert('Lỗi: ' + (data.detail || 'Không thể lưu báo cáo'));
      }
    } catch (err) {
      alert('Lỗi kết nối máy chủ: ' + err.message);
    } finally {
      const btnSubmit = document.getElementById('btnSubmitReport');
      btnSubmit.disabled = false;
      btnSubmit.querySelector('.btn-text').textContent = 'GỬI BÁO CÁO CA';
    }
  });

  btnResetForm.addEventListener('click', () => {
    if (confirm('Bạn có chắc chắn muốn làm mới toàn bộ form?')) {
      shiftReportForm.reset();
      reportDateInput.value = today;
      updateShiftHours();
      tbodyPackaging.innerHTML = '';
      tbodyBaskets.innerHTML = '';
      tbodyTumbling.innerHTML = '';
      addPackagingRow();
      addBasketRow();
      addTumblingRow();
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
