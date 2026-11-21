// VICO PX ĐÚC 2 - Pure Helpers (dùng chung cho trình duyệt và Node test)
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Duc2Utils = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * Định dạng giờ kiểu "3h42", "8h06", "10h03" theo giờ địa phương.
   */
  function formatNowVNTime(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    return `${d.getHours()}h${pad2(d.getMinutes())}`;
  }

  /**
   * Định dạng giờ đầu/cuối ca kiểu "3h00'", "11h00'".
   */
  function formatShiftTimeVN(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    return `${d.getHours()}h${pad2(d.getMinutes())}'`;
  }

  /**
   * Tách mã "Lò nấu số" kiểu "2.2.1" -> { furnace: '2.2', heat: 1 }
   * hoặc "5.1" -> { furnace: '5', heat: 1 }.
   */
  function parseFurnaceHeatCode(label) {
    const raw = String(label === null || label === undefined ? '' : label).trim();
    if (!raw) return { furnace: '', heat: null };
    const lastDot = raw.lastIndexOf('.');
    if (lastDot > 0 && lastDot < raw.length - 1) {
      const furnacePart = raw.slice(0, lastDot).trim();
      const heatPart = raw.slice(lastDot + 1).trim();
      if (/^[1-9]\d*$/.test(heatPart) && furnacePart) {
        return { furnace: furnacePart, heat: parseInt(heatPart, 10) };
      }
    }
    return { furnace: raw, heat: null };
  }

  /**
   * Gợi ý mã mẻ tiếp theo cho một lò nấu dựa trên danh sách các lù đã có.
   */
  function suggestNextHeatCode(furnaceCode, batches) {
    const code = String(furnaceCode === null || furnaceCode === undefined ? '' : furnaceCode).trim();
    if (!code) return '';
    let maxHeat = 0;
    (batches || []).forEach(b => {
      if (!b) return;
      const parsed = parseFurnaceHeatCode(b.furnace_heat_label);
      const bFurnace = String(b.furnace_code || parsed.furnace || '').trim();
      if (bFurnace !== code) return;
      let h = Number(b.heat_no);
      if (!Number.isInteger(h) || h <= 0) {
        h = parsed.heat || 0;
      }
      if (h > maxHeat) maxHeat = h;
    });
    return `${code}.${maxHeat + 1}`;
  }

  /**
   * So sánh tự nhiên mã lò (2.2 < 3 < 4 < 5 < 10).
   */
  function compareFurnaceCodes(a, b) {
    const partsA = String(a === null || a === undefined ? '' : a).trim().split('.');
    const partsB = String(b === null || b === undefined ? '' : b).trim().split('.');
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
      if (i >= partsA.length) return -1;
      if (i >= partsB.length) return 1;
      const sa = partsA[i];
      const sb = partsB[i];
      const na = /^\d+$/.test(sa) ? parseInt(sa, 10) : null;
      const nb = /^\d+$/.test(sb) ? parseInt(sb, 10) : null;
      if (na !== null && nb !== null) {
        if (na !== nb) return na - nb;
      } else {
        const cmp = sa.localeCompare(sb, 'vi', { numeric: true });
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  }

  function parseNonNegInt(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
      return Number.isInteger(value) && value >= 0 ? value : null;
    }
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) return null;
    const n = parseInt(text, 10);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }

  /**
   * Tính số khuôn tạo hình = Chỉ số cuối - Chỉ số đầu.
   */
  function computeMoldsCreated(counterStart, counterEnd) {
    const start = parseNonNegInt(counterStart);
    const end = parseNonNegInt(counterEnd);
    if (start === null || end === null || end < start) return null;
    return end - start;
  }

  function formatCounterRange(counterStart, counterEnd) {
    const s = counterStart === null || counterStart === undefined ? '' : String(counterStart).trim();
    const e = counterEnd === null || counterEnd === undefined ? '' : String(counterEnd).trim();
    if (s && e) return `${s}–${e}`;
    return s || e || '';
  }

  function formatTimeRange(startTime, endTime) {
    const s = startTime === null || startTime === undefined ? '' : String(startTime).trim();
    const e = endTime === null || endTime === undefined ? '' : String(endTime).trim();
    if (s && e) return `${s}–${e}`;
    return s || e || '';
  }

  function computeSupplyRemaining(startVal, addedVal, usedVal) {
    const start = Number(startVal) || 0;
    const added = Number(addedVal) || 0;
    const used = Number(usedVal) || 0;
    return Math.max(0, start + added - used);
  }

  /**
   * Tự động tổng hợp số mẻ nấu & tuổi thọ từng lò từ danh sách lù rót đáy.
   */
  function recalculateFurnacesFromBatches(batches, existingFurnaces, prevLifeMap, defaults) {
    const counts = {};
    (batches || []).forEach(b => {
      if (!b) return;
      const parsed = parseFurnaceHeatCode(b.furnace_heat_label);
      const code = String(b.furnace_code || parsed.furnace || '').trim();
      if (!code) return;
      counts[code] = (counts[code] || 0) + 1;
    });

    const furnaceMap = {};
    (existingFurnaces || []).forEach(f => {
      if (!f) return;
      const code = String(f.furnace_code || '').trim();
      if (!code) return;
      furnaceMap[code] = { ...f, furnace_code: code };
    });

    Object.keys(counts).forEach(code => {
      if (!furnaceMap[code]) {
        furnaceMap[code] = {
          furnace_code: code,
          product_name: (defaults && defaults.product_name) || '',
          customer: (defaults && defaults.customer) || '',
          steel_grade: (defaults && defaults.steel_grade) || '',
          heat_count: counts[code],
          prev_lining_life: Number((prevLifeMap && prevLifeMap[code]) || 0),
          lining_life: 0,
          manual_heat_override: 0,
          manual_life_override: 0,
          notes: ''
        };
      }
    });

    return Object.values(furnaceMap)
      .map(f => {
        const code = f.furnace_code;
        const hasPrev = f.prev_lining_life !== null && f.prev_lining_life !== undefined && f.prev_lining_life !== '';
        const prevLife = hasPrev ? (Number(f.prev_lining_life) || 0) : (Number((prevLifeMap && prevLifeMap[code]) || 0));
        const manualHeat = Boolean(f.manual_heat_override);
        const manualLife = Boolean(f.manual_life_override);
        const heatCount = manualHeat ? (Number(f.heat_count) || 0) : (counts[code] || 0);
        const liningLife = manualLife ? (Number(f.lining_life) || 0) : (prevLife + heatCount);
        return {
          ...f,
          product_name: f.product_name || (defaults && defaults.product_name) || '',
          customer: f.customer || (defaults && defaults.customer) || '',
          steel_grade: f.steel_grade || (defaults && defaults.steel_grade) || '',
          furnace_code: code,
          heat_count: heatCount,
          prev_lining_life: prevLife,
          lining_life: liningLife,
          manual_heat_override: manualHeat ? 1 : 0,
          manual_life_override: manualLife ? 1 : 0,
          notes: f.notes || ''
        };
      })
      .sort((a, b) => compareFurnaceCodes(a.furnace_code, b.furnace_code));
  }

  function splitCleanLines(text) {
    return String(text === null || text === undefined ? '' : text)
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function normalizeBulletLines(text) {
    return splitCleanLines(text).map(line => `- ${line.replace(/^-+\s*/, '')}`);
  }

  function formatMinutesElapsed(startDate, endDate) {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 1;
    return Math.max(1, Math.round((endMs - startMs) / 60000));
  }

  function formatVNDateDisplay(isoDate) {
    const text = String(isoDate === null || isoDate === undefined ? '' : isoDate).trim();
    if (!text) return '';
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (m) {
      return `${pad2(m[3])} / ${pad2(m[2])} / ${m[1]}`;
    }
    return text;
  }

  function canAccessWorkshop(user, workshop) {
    if (!user) return false;
    if (user.role === 'admin' || user.workshop === 'all') return true;
    return (user.workshop || 'nllt') === workshop;
  }

  function defaultWorkshopForUser(user, savedWorkshop) {
    if (!user) return 'nllt';
    if (user.role !== 'admin' && user.workshop && user.workshop !== 'all') {
      return user.workshop === 'duc2' ? 'duc2' : 'nllt';
    }
    let candidate = savedWorkshop;
    if (!candidate && typeof localStorage !== 'undefined') {
      try {
        candidate = localStorage.getItem('vico_active_workshop');
      } catch (e) {
        candidate = null;
      }
    }
    return candidate === 'duc2' ? 'duc2' : 'nllt';
  }

  /**
   * Tính toán bố cục hàng & vùng merge chuẩn 12 cột (A..L) cho mẫu PX ĐÚC 2.
   * Dùng chung cho ExcelJS và test tự động kiểm tra không chồng lấn vùng merge.
   */
  function computeDuc2SheetLayout(shiftData) {
    const data = shiftData || {};
    const moldingRaw = Array.isArray(data.molding) ? data.molding : [];
    const pouringRaw = Array.isArray(data.pouring) ? data.pouring : [];
    const meltingRaw = Array.isArray(data.melting) ? data.melting : [];

    const permittedLines = splitCleanLines(data.leave_permitted_names);
    const unpermittedLines = splitCleanLines(data.leave_unpermitted_names);
    const issueLines = normalizeBulletLines(data.issues);
    const suggestionLines = normalizeBulletLines(data.suggestions);

    // 1. Khối Khuôn tạo hình (trái) song song Chấm công phần Nghỉ phép (phải)
    // Phải có 2 dòng nhãn (Có mặt:, 1. Nghỉ phép:) + các dòng tên người nghỉ phép
    const moldingRowsCount = Math.max(4, moldingRaw.length, 2 + permittedLines.length);
    const moldingTitleRow = 7;
    const moldingHeaderRow = 8;
    const moldingDataStart = 9;
    const moldingDataEnd = moldingDataStart + moldingRowsCount - 1;

    // 2. Khối Lò rót đáy (trái) song song Nghỉ không phép + Tiêu hao vật tư (phải)
    const unpermittedExtraCount = Math.max(1, unpermittedLines.length - 1);
    const pouringRowsCount = Math.max(18, pouringRaw.length, unpermittedExtraCount + 6);
    const pouringTitleRow = moldingDataEnd + 1;
    const pouringHeaderRow = pouringTitleRow + 1;
    const pouringDataStart = pouringHeaderRow + 1;
    const pouringDataEnd = pouringDataStart + pouringRowsCount - 1;

    // 3. Khối Lò nấu (trái) song song Sự cố trong ca (phải)
    const meltingRowsCount = Math.max(6, meltingRaw.length, issueLines.length + 1);
    const meltingTitleRow = pouringDataEnd + 1;
    const meltingHeaderRow = meltingTitleRow + 1;
    const meltingDataStart = meltingHeaderRow + 1;
    const meltingDataEnd = meltingDataStart + meltingRowsCount - 1;

    // 4. Khối Yêu cầu - Đề xuất (trái) song song Khác (phải)
    const suggestionRowsCount = Math.max(5, suggestionLines.length);
    const footerTitleRow = meltingDataEnd + 1;
    const footerDataStart = footerTitleRow + 1;
    const footerDataEnd = footerDataStart + suggestionRowsCount - 1;

    // 5. Chân trang chữ ký
    const sigTitleRow = footerDataEnd + 1;
    const sigSpaceStart = sigTitleRow + 1;
    const sigSpaceEnd = sigSpaceStart + 2;

    const merges = [
      // Header
      'A1:B4', 'C1:H2', 'C3:H4',
      'I1:L1', 'I2:L2', 'I3:L3', 'I4:L4',
      // Ca + Chú thích viết tắt + An toàn
      'B5:C5', 'D5:L5',
      'A6:C6', 'D6:H6', 'I6:L6',
      // Tiêu đề Khuôn tạo hình & Chấm công
      `A${moldingTitleRow}:I${moldingTitleRow}`,
      `J${moldingTitleRow}:L${moldingTitleRow}`,
      `C${moldingHeaderRow}:D${moldingHeaderRow}`,
      `E${moldingHeaderRow}:F${moldingHeaderRow}`,
      `J${moldingHeaderRow}:K${moldingHeaderRow}`
    ];

    // Dòng dữ liệu Khuôn tạo hình (trái) + Có mặt / Nghỉ phép (phải)
    for (let i = 0; i < moldingRowsCount; i++) {
      const r = moldingDataStart + i;
      merges.push(`C${r}:D${r}`, `E${r}:F${r}`);
      if (i === 0) {
        merges.push(`J${r}:K${r}`); // Có mặt:
      } else {
        merges.push(`J${r}:L${r}`); // 1. Nghỉ phép: & tên người nghỉ
      }
    }

    // Tiêu đề Lò rót đáy & Nghỉ không phép (trái)
    merges.push(
      `A${pouringTitleRow}:I${pouringTitleRow}`,
      `J${pouringTitleRow}:L${pouringTitleRow}`
    );

    // Hàng pouringHeaderRow bên phải là giá trị Nghỉ không phép
    merges.push(`J${pouringHeaderRow}:L${pouringHeaderRow}`);

    // Phải vùng Lò rót đáy: dòng thêm của nghỉ K.phép -> dòng trống -> Tiêu hao vật tư -> Thanh chặn / Cốc rót
    let rightCursor = pouringDataStart;
    for (let i = 0; i < unpermittedExtraCount && rightCursor <= pouringDataEnd; i++) {
      merges.push(`J${rightCursor}:L${rightCursor}`);
      rightCursor++;
    }
    const supplyBlankTop = rightCursor <= pouringDataEnd ? rightCursor++ : null;
    if (supplyBlankTop) merges.push(`J${supplyBlankTop}:L${supplyBlankTop}`);

    const supplyTitleRow = rightCursor <= pouringDataEnd ? rightCursor++ : null;
    if (supplyTitleRow) merges.push(`J${supplyTitleRow}:L${supplyTitleRow}`);

    const supplyRows = [];
    for (let k = 0; k < 4 && rightCursor <= pouringDataEnd; k++) {
      supplyRows.push(rightCursor++);
    }
    const rightRemainRows = [];
    while (rightCursor <= pouringDataEnd) {
      merges.push(`J${rightCursor}:L${rightCursor}`);
      rightRemainRows.push(rightCursor++);
    }

    // Tiêu đề Lò nấu & Sự cố trong ca
    merges.push(
      `A${meltingTitleRow}:I${meltingTitleRow}`,
      `J${meltingTitleRow}:L${meltingTitleRow}`,
      `C${meltingHeaderRow}:D${meltingHeaderRow}`,
      `H${meltingHeaderRow}:I${meltingHeaderRow}`,
      `J${meltingHeaderRow}:L${meltingHeaderRow}`
    );
    for (let i = 0; i < meltingRowsCount; i++) {
      const r = meltingDataStart + i;
      merges.push(`C${r}:D${r}`, `H${r}:I${r}`, `J${r}:L${r}`);
    }

    // Tiêu đề Yêu cầu - Đề xuất & Khác
    merges.push(
      `A${footerTitleRow}:I${footerTitleRow}`,
      `J${footerTitleRow}:L${footerTitleRow}`
    );
    for (let i = 0; i < suggestionRowsCount; i++) {
      const r = footerDataStart + i;
      merges.push(`A${r}:I${r}`);
      if (i === 0 || i === 1) {
        merges.push(`J${r}:K${r}`);
      } else {
        merges.push(`J${r}:L${r}`);
      }
    }

    // Chữ ký
    merges.push(
      `A${sigTitleRow}:F${sigTitleRow}`,
      `G${sigTitleRow}:L${sigTitleRow}`,
      `A${sigSpaceStart}:F${sigSpaceEnd}`,
      `G${sigSpaceStart}:L${sigSpaceEnd}`
    );

    return {
      moldingRowsCount,
      pouringRowsCount,
      meltingRowsCount,
      suggestionRowsCount,
      permittedLines,
      unpermittedLines,
      issueLines,
      suggestionLines,
      moldingTitleRow,
      moldingHeaderRow,
      moldingDataStart,
      moldingDataEnd,
      pouringTitleRow,
      pouringHeaderRow,
      pouringDataStart,
      pouringDataEnd,
      supplyTitleRow,
      supplyRows,
      rightRemainRows,
      meltingTitleRow,
      meltingHeaderRow,
      meltingDataStart,
      meltingDataEnd,
      footerTitleRow,
      footerDataStart,
      footerDataEnd,
      sigTitleRow,
      sigSpaceStart,
      sigSpaceEnd,
      totalRows: sigSpaceEnd,
      merges
    };
  }

  return {
    formatNowVNTime,
    formatShiftTimeVN,
    parseFurnaceHeatCode,
    suggestNextHeatCode,
    compareFurnaceCodes,
    computeMoldsCreated,
    formatCounterRange,
    formatTimeRange,
    computeSupplyRemaining,
    recalculateFurnacesFromBatches,
    splitCleanLines,
    normalizeBulletLines,
    formatMinutesElapsed,
    formatVNDateDisplay,
    canAccessWorkshop,
    defaultWorkshopForUser,
    computeDuc2SheetLayout
  };
});
