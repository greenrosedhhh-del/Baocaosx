// VICO PX ĐÚC 2 - Bộ xuất Excel chuẩn mẫu (ExcelJS) & Xem trước / In PDF A4
(function (root) {
  const D2 = root.Duc2Utils;
  const U = root.VicoUtils;

  const FONT_FAMILY = 'Times New Roman';
  const RED_ARGB = 'FFFF0000';
  const BLACK_ARGB = 'FF000000';
  const BORDER_THIN = { style: 'thin', color: { argb: BLACK_ARGB } };
  const BORDER_MED = { style: 'medium', color: { argb: BLACK_ARGB } };
  const BORDER_DOTTED = { style: 'dotted', color: { argb: BLACK_ARGB } };

  let cachedLogo = null;

  function escapeHtml(val) {
    if (U && typeof U.escapeHtml === 'function') return U.escapeHtml(val);
    return String(val === null || val === undefined ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function dataUrlToBase64Info(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(dataUrl.trim());
    if (!match) return null;
    let ext = match[1].toLowerCase();
    if (ext === 'jpg') ext = 'jpeg';
    return { ext, base64: match[2] };
  }

  function measureImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 200, height: img.naturalHeight || 100 });
      img.onerror = () => resolve({ width: 200, height: 100 });
      img.src = src;
    });
  }

  async function loadLogoBase64() {
    if (cachedLogo) return cachedLogo;
    try {
      const res = await fetch('vico_logo.png');
      if (!res.ok) return null;
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const dims = await measureImage(dataUrl);
      const info = dataUrlToBase64Info(dataUrl);
      if (!info) return null;
      cachedLogo = { ...info, ...dims, dataUrl };
      return cachedLogo;
    } catch (e) {
      return null;
    }
  }

  function setCellBorder(ws, row, col, edges) {
    const cell = ws.getCell(row, col);
    cell.border = { ...(cell.border || {}), ...edges };
  }

  function applyBoxBorders(ws, r1, c1, r2, c2, {
    outerTop = BORDER_THIN,
    outerBottom = BORDER_THIN,
    outerLeft = BORDER_THIN,
    outerRight = BORDER_THIN,
    innerH = BORDER_DOTTED,
    innerV = BORDER_DOTTED
  } = {}) {
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        setCellBorder(ws, r, c, {
          top: r === r1 ? outerTop : innerH,
          bottom: r === r2 ? outerBottom : innerH,
          left: c === c1 ? outerLeft : innerV,
          right: c === c2 ? outerRight : innerV
        });
      }
    }
  }

  function styleCell(ws, row, col, {
    value,
    bold = false,
    size = 10,
    color = BLACK_ARGB,
    align = 'center',
    vertical = 'middle',
    wrapText = true
  } = {}) {
    const cell = ws.getCell(row, col);
    if (value !== undefined) cell.value = value;
    cell.font = { name: FONT_FAMILY, size, bold, color: { argb: color } };
    cell.alignment = { horizontal: align, vertical, wrapText };
    return cell;
  }

  function calcFitDimensions(srcWidth, srcHeight, maxWidth, maxHeight) {
    const w = srcWidth || maxWidth;
    const h = srcHeight || maxHeight;
    const ratio = Math.min(maxWidth / w, maxHeight / h);
    return {
      width: Math.max(20, Math.round(w * ratio)),
      height: Math.max(14, Math.round(h * ratio))
    };
  }

  function groupDisplayKey(item, fields) {
    return fields.map(f => String((item && item[f]) || '').trim().toLowerCase()).join('|');
  }

  async function exportDuc2Excel(shiftData) {
    if (!root.ExcelJS) {
      throw new Error('Thư viện ExcelJS đang tải hoặc chưa sẵn sàng, vui lòng thử lại sau vài giây.');
    }
    if (!D2) {
      throw new Error('Thiếu module Duc2Utils.');
    }

    const data = shiftData || {};
    const layout = D2.computeDuc2SheetLayout(data);
    const wb = new root.ExcelJS.Workbook();
    wb.creator = 'VICO PX ĐÚC 2';
    wb.created = new Date();

    const dateFormatted = D2.formatVNDateDisplay(data.report_date || '');
    const sheetTitle = `Ca ${data.shift_num || 1}`.slice(0, 31);
    const ws = wb.addWorksheet(sheetTitle, {
      views: [{ showGridLines: true }],
      pageSetup: {
        paperSize: 9,
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        horizontalCentered: true,
        margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0.15, footer: 0.15 }
      }
    });

    // 12 cột chuẩn (A..I trái = 9 cột, J..L phải = 3 cột)
    const colWidths = [10.5, 11.5, 7.2, 10.2, 10.2, 10.2, 10.2, 9.5, 11.5, 15.8, 7.2, 6.5];
    ws.columns = colWidths.map(width => ({ width }));

    // Merge tất cả vùng ô theo layout đã kiểm chứng không overlap
    layout.merges.forEach(rng => ws.mergeCells(rng));

    // Đặt font mặc định cho toàn bộ lưới để không sót ô trống
    for (let r = 1; r <= layout.totalRows; r++) {
      for (let c = 1; c <= 12; c++) {
        const cell = ws.getCell(r, c);
        cell.font = { name: FONT_FAMILY, size: 10, color: { argb: BLACK_ARGB } };
      }
    }

    // ---------- 1. HEADER (Hàng 1 - 4) ----------
    ws.getRow(1).height = 19;
    ws.getRow(2).height = 19;
    ws.getRow(3).height = 19;
    ws.getRow(4).height = 20;

    styleCell(ws, 1, 3, { value: 'CÔNG TY TNHH THẮNG LỢI', bold: true, size: 14 });
    styleCell(ws, 3, 3, { value: 'BÁO CÁO TỔNG HỢP SẢN XUẤT', bold: true, size: 14 });

    const docCode = String(data.doc_code || '').trim();
    if (docCode) {
      styleCell(ws, 1, 9, {
        align: 'left',
        size: 10,
        value: {
          richText: [
            { text: 'Mã hiệu : ', font: { name: FONT_FAMILY, size: 10, color: { argb: BLACK_ARGB } } },
            { text: docCode, font: { name: FONT_FAMILY, size: 10, bold: true, color: { argb: RED_ARGB } } }
          ]
        }
      });
    } else {
      styleCell(ws, 1, 9, { value: 'Mã hiệu :', align: 'left', size: 10 });
    }

    styleCell(ws, 2, 9, { value: 'Đơn vị thực hiện : PX ĐÚC 2', align: 'left', size: 10 });

    const docNum = String(data.doc_number || '').trim();
    if (docNum) {
      styleCell(ws, 3, 9, {
        align: 'left',
        size: 10,
        value: {
          richText: [
            { text: 'Số : ', font: { name: FONT_FAMILY, size: 10, color: { argb: BLACK_ARGB } } },
            { text: docNum, font: { name: FONT_FAMILY, size: 10, bold: true, color: { argb: RED_ARGB } } }
          ]
        }
      });
    } else {
      styleCell(ws, 3, 9, { value: 'Số : ...................... / Năm 20...........', align: 'left', size: 10 });
    }

    styleCell(ws, 4, 9, {
      align: 'left',
      size: 10,
      value: {
        richText: [
          { text: 'Ngày lập :   ', font: { name: FONT_FAMILY, size: 10, color: { argb: BLACK_ARGB } } },
          { text: dateFormatted, font: { name: FONT_FAMILY, size: 10, bold: true, color: { argb: RED_ARGB } } }
        ]
      }
    });

    applyBoxBorders(ws, 1, 1, 4, 2, { outerTop: BORDER_MED, outerLeft: BORDER_MED, outerBottom: BORDER_THIN, outerRight: BORDER_THIN, innerH: null, innerV: null });
    applyBoxBorders(ws, 1, 3, 2, 8, { outerTop: BORDER_MED, outerBottom: BORDER_THIN, outerLeft: BORDER_THIN, outerRight: BORDER_THIN, innerH: null, innerV: null });
    applyBoxBorders(ws, 3, 3, 4, 8, { outerTop: BORDER_THIN, outerBottom: BORDER_THIN, outerLeft: BORDER_THIN, outerRight: BORDER_THIN, innerH: null, innerV: null });
    applyBoxBorders(ws, 1, 9, 4, 12, { outerTop: BORDER_MED, outerRight: BORDER_MED, outerBottom: BORDER_THIN, outerLeft: BORDER_THIN, innerH: BORDER_DOTTED, innerV: null });

    // ---------- 2. CA & AN TOÀN (Hàng 5 - 6) ----------
    ws.getRow(5).height = 20;
    ws.getRow(6).height = 22;

    styleCell(ws, 5, 1, { value: 'Ca:', bold: true, size: 10, align: 'center' });
    styleCell(ws, 5, 2, { value: Number(data.shift_num) || 1, bold: true, size: 11, color: RED_ARGB, align: 'center' });
    styleCell(ws, 5, 4, { value: 'Viết tắt: BT=Bình thường ; KO=Không', size: 10, align: 'center' });
    applyBoxBorders(ws, 5, 1, 5, 12, { outerLeft: BORDER_MED, outerRight: BORDER_MED, outerTop: BORDER_THIN, outerBottom: BORDER_THIN, innerV: null });

    const prodText = data.safety_production ? 'Điều kiện sản xuất' : '☐ Điều kiện sản xuất (KĐ)';
    const ppeText = data.safety_ppe ? '☑ Bảo hộ đầy đủ' : '☐ Bảo hộ đầy đủ (KĐ)';
    const equipText = data.safety_equip ? '☑ Thiết bị an toàn' : '☐ Thiết bị an toàn (KĐ)';
    styleCell(ws, 6, 1, { value: prodText, size: 10, align: 'center' });
    styleCell(ws, 6, 4, { value: ppeText, size: 10, align: 'center' });
    styleCell(ws, 6, 9, { value: equipText, size: 10, align: 'center' });
    applyBoxBorders(ws, 6, 1, 6, 3, { outerLeft: BORDER_MED, outerRight: BORDER_THIN, outerTop: BORDER_THIN, outerBottom: BORDER_MED, innerV: null });
    applyBoxBorders(ws, 6, 4, 6, 8, { outerLeft: BORDER_THIN, outerRight: BORDER_THIN, outerTop: BORDER_THIN, outerBottom: BORDER_MED, innerV: null });
    applyBoxBorders(ws, 6, 9, 6, 12, { outerLeft: BORDER_THIN, outerRight: BORDER_MED, outerTop: BORDER_THIN, outerBottom: BORDER_MED, innerV: null });

    // ---------- 3. KHUÔN TẠO HÌNH (Trái) & CHẤM CÔNG (Phải) ----------
    ws.getRow(layout.moldingTitleRow).height = 20;
    ws.getRow(layout.moldingHeaderRow).height = 30;
    styleCell(ws, layout.moldingTitleRow, 1, { value: 'KHUÔN TẠO HÌNH', bold: true, size: 10 });
    styleCell(ws, layout.moldingTitleRow, 10, { value: 'Chấm công', bold: true, size: 10 });

    styleCell(ws, layout.moldingHeaderRow, 1, { value: 'Tên SP', bold: true, size: 9.5 });
    styleCell(ws, layout.moldingHeaderRow, 2, { value: 'Khách hàng', bold: true, size: 9.5 });
    styleCell(ws, layout.moldingHeaderRow, 3, { value: 'Thời gian\ntạo hình', bold: true, size: 9.5 });
    styleCell(ws, layout.moldingHeaderRow, 5, { value: 'Tính toán tạo hình', bold: true, size: 9.5 });
    styleCell(ws, layout.moldingHeaderRow, 7, { value: 'Khuôn tạo hình', bold: true, size: 9.5 });
    styleCell(ws, layout.moldingHeaderRow, 8, { value: 'Khuôn rót', bold: true, size: 9.5 });
    styleCell(ws, layout.moldingHeaderRow, 9, { value: 'Ghi chú', bold: true, size: 9.5 });

    styleCell(ws, layout.moldingHeaderRow, 10, { value: 'Tổng sĩ số:', size: 10, align: 'left' });
    styleCell(ws, layout.moldingHeaderRow, 12, { value: Number(data.staff_total ?? 16), bold: true, size: 11, color: RED_ARGB });

    const moldingList = Array.isArray(data.molding) ? data.molding : [];
    for (let i = 0; i < layout.moldingRowsCount; i++) {
      const r = layout.moldingDataStart + i;
      ws.getRow(r).height = 19;
      const item = moldingList[i];
      if (item) {
        const timeStr = item.time_range || D2.formatTimeRange(item.start_time, item.end_time);
        const counterStr = D2.formatCounterRange(item.counter_start, item.counter_end);
        styleCell(ws, r, 1, { value: item.product_name || '', color: RED_ARGB, size: 10 });
        styleCell(ws, r, 2, { value: item.customer || '', color: RED_ARGB, size: 10 });
        styleCell(ws, r, 3, { value: timeStr, color: RED_ARGB, size: 10 });
        styleCell(ws, r, 5, { value: counterStr, color: RED_ARGB, size: 10 });
        styleCell(ws, r, 7, {
          value: item.molds_created !== null && item.molds_created !== undefined && item.molds_created !== '' ? Number(item.molds_created) : '',
          color: RED_ARGB, size: 10
        });
        styleCell(ws, r, 8, {
          value: item.molds_poured !== null && item.molds_poured !== undefined && item.molds_poured !== '' ? Number(item.molds_poured) : '',
          color: RED_ARGB, size: 10
        });
        styleCell(ws, r, 9, { value: item.notes || '', color: RED_ARGB, size: 9.5 });
      }

      if (i === 0) {
        styleCell(ws, r, 10, { value: 'Có mặt:', size: 10, align: 'left' });
        styleCell(ws, r, 12, { value: Number(data.staff_present ?? 16), bold: true, size: 11, color: RED_ARGB });
      } else if (i === 1) {
        styleCell(ws, r, 10, { value: '1. Nghỉ phép:', size: 10, align: 'left' });
      } else {
        const nameLine = layout.permittedLines[i - 2] || '';
        styleCell(ws, r, 10, { value: nameLine, color: RED_ARGB, size: 10, align: 'center' });
      }
    }

    applyBoxBorders(ws, layout.moldingTitleRow, 1, layout.moldingTitleRow, 9, {
      outerTop: BORDER_MED, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED
    });
    applyBoxBorders(ws, layout.moldingHeaderRow, 1, layout.moldingHeaderRow, 9, {
      outerTop: BORDER_THIN, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerV: BORDER_DOTTED
    });
    applyBoxBorders(ws, layout.moldingDataStart, 1, layout.moldingDataEnd, 9, {
      outerTop: BORDER_THIN, outerBottom: BORDER_MED, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerH: BORDER_DOTTED, innerV: BORDER_DOTTED
    });

    applyBoxBorders(ws, layout.moldingTitleRow, 10, layout.moldingTitleRow, 12, {
      outerTop: BORDER_MED, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED
    });
    applyBoxBorders(ws, layout.moldingHeaderRow, 10, layout.moldingDataStart, 12, {
      outerTop: BORDER_THIN, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerH: BORDER_DOTTED, innerV: BORDER_THIN
    });
    applyBoxBorders(ws, layout.moldingDataStart + 1, 10, layout.moldingDataEnd, 12, {
      outerTop: BORDER_THIN, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerH: BORDER_DOTTED, innerV: null
    });

    // ---------- 4. LÒ RÓT ĐÁY (Trái) & NGHỈ KHÔNG PHÉP + TIÊU HAO VẬT TƯ (Phải) ----------
    ws.getRow(layout.pouringTitleRow).height = 20;
    ws.getRow(layout.pouringHeaderRow).height = 30;
    styleCell(ws, layout.pouringTitleRow, 1, { value: 'LÒ RÓT ĐÁY', bold: true, size: 10 });
    styleCell(ws, layout.pouringTitleRow, 10, { value: '2. Nghỉ không phép:', size: 10, align: 'left' });

    const pouringHeaders = ['Tên SP', 'Khách hàng', 'Lù rót', 'Nhiệt độ\nMax', 'Nhiệt độ\nMin', 'Thời gian\nbắt đầu', 'Thời gian\nkết thúc', 'Lò nấu\nsố', 'Ghi chú'];
    pouringHeaders.forEach((lbl, idx) => {
      styleCell(ws, layout.pouringHeaderRow, idx + 1, { value: lbl, bold: true, size: 9.5 });
    });

    const unpermittedFirst = layout.unpermittedLines.length > 0 ? layout.unpermittedLines[0] : 'KO';
    styleCell(ws, layout.pouringHeaderRow, 10, { value: unpermittedFirst, color: RED_ARGB, size: 10, align: 'center' });

    const pouringList = Array.isArray(data.pouring) ? data.pouring : [];
    let prevPourKey = '';
    for (let i = 0; i < layout.pouringRowsCount; i++) {
      const r = layout.pouringDataStart + i;
      ws.getRow(r).height = 17;
      const b = pouringList[i];
      styleCell(ws, r, 3, { value: i + 1, size: 9.5, color: BLACK_ARGB });
      if (b) {
        const gKey = groupDisplayKey(b, ['product_name', 'customer']);
        const showGroup = i === 0 || gKey !== prevPourKey;
        prevPourKey = gKey;
        styleCell(ws, r, 1, { value: showGroup ? (b.product_name || '') : '', color: RED_ARGB, size: 9.5 });
        styleCell(ws, r, 2, { value: showGroup ? (b.customer || '') : '', color: RED_ARGB, size: 9.5 });
        styleCell(ws, r, 4, { value: b.temp_max !== null && b.temp_max !== undefined && b.temp_max !== '' ? Number(b.temp_max) : '', color: RED_ARGB, size: 9.5 });
        styleCell(ws, r, 5, { value: b.temp_min !== null && b.temp_min !== undefined && b.temp_min !== '' ? Number(b.temp_min) : '', color: RED_ARGB, size: 9.5 });
        styleCell(ws, r, 6, { value: b.start_time || '', color: RED_ARGB, size: 9.5 });
        styleCell(ws, r, 7, { value: b.end_time || '', color: RED_ARGB, size: 9.5 });
        const heatLabel = b.furnace_heat_label || (b.furnace_code && b.heat_no ? `${b.furnace_code}.${b.heat_no}` : (b.furnace_code || ''));
        styleCell(ws, r, 8, { value: heatLabel, color: RED_ARGB, size: 9.5 });
        styleCell(ws, r, 9, { value: b.notes || '', color: RED_ARGB, size: 9 });
      }
    }

    // Bên phải phần Lò rót đáy: tên nghỉ K.phép dư + Tiêu hao vật tư
    const extraStartRow = layout.pouringDataStart;
    const unpermittedExtraCount = Math.max(1, layout.unpermittedLines.length - 1);
    for (let i = 0; i < unpermittedExtraCount; i++) {
      const r = extraStartRow + i;
      const line = layout.unpermittedLines[i + 1] || '';
      if (line) {
        styleCell(ws, r, 10, { value: line, color: RED_ARGB, size: 10, align: 'center' });
      }
    }

    if (layout.supplyTitleRow) {
      styleCell(ws, layout.supplyTitleRow, 10, { value: 'Tiêu hao vật tư :', bold: true, size: 10, align: 'left' });
    }
    const supplyRows = layout.supplyRows || [];
    if (supplyRows.length === 4) {
      const [sr0, sr1, sr2, sr3] = supplyRows;
      styleCell(ws, sr0, 10, { value: '1. Thanh chặn :', bold: true, size: 10, align: 'left' });
      styleCell(ws, sr0, 11, { value: Number(data.stopper_used ?? 0), bold: true, size: 10.5, color: RED_ARGB });
      styleCell(ws, sr0, 12, { value: 'Cái', bold: true, size: 10 });

      styleCell(ws, sr1, 10, { value: '    Còn lại :', size: 10, align: 'left' });
      styleCell(ws, sr1, 11, { value: Number(data.stopper_remaining ?? 0), bold: true, size: 10.5, color: RED_ARGB });
      styleCell(ws, sr1, 12, { value: 'Cái', size: 10 });

      styleCell(ws, sr2, 10, { value: '2. Cốc rót :', bold: true, size: 10, align: 'left' });
      styleCell(ws, sr2, 11, { value: Number(data.nozzle_used ?? 0), bold: true, size: 10.5, color: RED_ARGB });
      styleCell(ws, sr2, 12, { value: 'Cái', bold: true, size: 10 });

      styleCell(ws, sr3, 10, { value: '    Còn lại :', size: 10, align: 'left' });
      styleCell(ws, sr3, 11, { value: Number(data.nozzle_remaining ?? 0), bold: true, size: 10.5, color: RED_ARGB });
      styleCell(ws, sr3, 12, { value: 'Cái', size: 10 });
    }

    applyBoxBorders(ws, layout.pouringTitleRow, 1, layout.pouringTitleRow, 9, {
      outerTop: BORDER_MED, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED
    });
    applyBoxBorders(ws, layout.pouringHeaderRow, 1, layout.pouringHeaderRow, 9, {
      outerTop: BORDER_THIN, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerV: BORDER_DOTTED
    });
    applyBoxBorders(ws, layout.pouringDataStart, 1, layout.pouringDataEnd, 9, {
      outerTop: BORDER_THIN, outerBottom: BORDER_MED, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerH: BORDER_DOTTED, innerV: BORDER_DOTTED
    });

    // Viền phải khu vực Nghỉ K.phép + Tiêu hao vật tư
    const unpermittedBoxEndRow = layout.supplyTitleRow
      ? layout.supplyTitleRow - 1
      : (layout.pouringDataStart + unpermittedExtraCount - 1);
    applyBoxBorders(ws, layout.pouringTitleRow, 10, unpermittedBoxEndRow, 12, {
      outerTop: BORDER_THIN, outerBottom: BORDER_MED, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerH: BORDER_DOTTED, innerV: null
    });
    if (layout.supplyTitleRow) {
      applyBoxBorders(ws, layout.supplyTitleRow, 10, layout.pouringDataEnd, 12, {
        outerTop: BORDER_MED, outerBottom: BORDER_MED, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerH: BORDER_DOTTED, innerV: null
      });
      if (supplyRows.length === 4) {
        for (let c = 10; c <= 12; c++) {
          setCellBorder(ws, layout.supplyTitleRow, c, { top: BORDER_MED, bottom: BORDER_THIN });
          setCellBorder(ws, supplyRows[0], c, { top: BORDER_THIN });
          setCellBorder(ws, supplyRows[1], c, { bottom: BORDER_DOTTED });
          setCellBorder(ws, supplyRows[2], c, { top: BORDER_DOTTED });
          setCellBorder(ws, supplyRows[3], c, { bottom: BORDER_THIN });
          if (supplyRows[3] < layout.pouringDataEnd) {
            setCellBorder(ws, supplyRows[3] + 1, c, { top: BORDER_THIN });
          }
        }
      }
    }

    // ---------- 5. LÒ NẤU (Trái) & SỰ CỐ TRONG CA (Phải) ----------
    ws.getRow(layout.meltingTitleRow).height = 20;
    ws.getRow(layout.meltingHeaderRow).height = 26;
    styleCell(ws, layout.meltingTitleRow, 1, { value: 'LÒ NẤU', bold: true, size: 10 });
    styleCell(ws, layout.meltingTitleRow, 10, { value: 'SỰ CỐ TRONG CA', bold: true, size: 10 });

    styleCell(ws, layout.meltingHeaderRow, 1, { value: 'Tên SP', bold: true, size: 9.5 });
    styleCell(ws, layout.meltingHeaderRow, 2, { value: 'Khách hàng', bold: true, size: 9.5 });
    styleCell(ws, layout.meltingHeaderRow, 3, { value: 'Mác thép', bold: true, size: 9.5 });
    styleCell(ws, layout.meltingHeaderRow, 5, { value: 'Lò nấu', bold: true, size: 9.5 });
    styleCell(ws, layout.meltingHeaderRow, 6, { value: 'Số mẻ nấu', bold: true, size: 9.5 });
    styleCell(ws, layout.meltingHeaderRow, 7, { value: 'Tuổi thọ', bold: true, size: 9.5 });
    styleCell(ws, layout.meltingHeaderRow, 8, { value: 'Ghi chú', bold: true, size: 9.5 });

    const meltingList = Array.isArray(data.melting) ? data.melting : [];
    let prevMeltKey = '';
    for (let i = 0; i < layout.meltingRowsCount; i++) {
      const r = layout.meltingDataStart + i;
      ws.getRow(r).height = 19;
      const m = meltingList[i];
      if (m) {
        const mKey = groupDisplayKey(m, ['product_name', 'customer', 'steel_grade']);
        const showGroup = i === 0 || mKey !== prevMeltKey;
        prevMeltKey = mKey;
        styleCell(ws, r, 1, { value: showGroup ? (m.product_name || '') : '', color: RED_ARGB, size: 10 });
        styleCell(ws, r, 2, { value: showGroup ? (m.customer || '') : '', color: RED_ARGB, size: 10 });
        styleCell(ws, r, 3, { value: showGroup ? (m.steel_grade || '') : '', color: RED_ARGB, size: 10 });
        styleCell(ws, r, 5, { value: m.furnace_code || '', color: RED_ARGB, size: 10 });
        styleCell(ws, r, 6, { value: Number(m.heat_count ?? 0), color: RED_ARGB, size: 10 });
        styleCell(ws, r, 7, { value: Number(m.lining_life ?? 0), color: RED_ARGB, size: 10 });
        styleCell(ws, r, 8, { value: m.notes || '', color: RED_ARGB, size: 9.5 });
      }
    }

    // Sự cố trong ca bắt đầu từ meltingHeaderRow (cột J:L) trở xuống
    const issueRowsAll = [layout.meltingHeaderRow];
    for (let i = 0; i < layout.meltingRowsCount; i++) {
      issueRowsAll.push(layout.meltingDataStart + i);
    }
    const issueDisplayLines = layout.issueLines.length > 0 ? layout.issueLines : [];
    issueRowsAll.forEach((r, idx) => {
      const txt = issueDisplayLines[idx] || '';
      if (txt) {
        styleCell(ws, r, 10, { value: txt, color: RED_ARGB, size: 9.5, align: 'left' });
        const wrappedLines = Math.max(1, Math.ceil(txt.length / 28));
        if (wrappedLines > 1) {
          ws.getRow(r).height = Math.max(ws.getRow(r).height || 19, wrappedLines * 14 + 4);
        }
      }
    });

    applyBoxBorders(ws, layout.meltingTitleRow, 1, layout.meltingTitleRow, 9, {
      outerTop: BORDER_MED, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED
    });
    applyBoxBorders(ws, layout.meltingHeaderRow, 1, layout.meltingHeaderRow, 9, {
      outerTop: BORDER_THIN, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerV: BORDER_DOTTED
    });
    applyBoxBorders(ws, layout.meltingDataStart, 1, layout.meltingDataEnd, 9, {
      outerTop: BORDER_THIN, outerBottom: BORDER_MED, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerH: BORDER_DOTTED, innerV: BORDER_DOTTED
    });

    applyBoxBorders(ws, layout.meltingTitleRow, 10, layout.meltingTitleRow, 12, {
      outerTop: BORDER_MED, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED
    });
    applyBoxBorders(ws, layout.meltingHeaderRow, 10, layout.meltingDataEnd, 12, {
      outerTop: BORDER_THIN, outerBottom: BORDER_MED, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerH: BORDER_DOTTED, innerV: null
    });

    // ---------- 6. YÊU CẦU - ĐỀ XUẤT (Trái) & KHÁC (Phải) ----------
    ws.getRow(layout.footerTitleRow).height = 20;
    styleCell(ws, layout.footerTitleRow, 1, { value: 'Yêu cầu - Đề xuất', bold: true, size: 10 });
    styleCell(ws, layout.footerTitleRow, 10, { value: 'Khác', bold: true, size: 10 });

    for (let i = 0; i < layout.suggestionRowsCount; i++) {
      const r = layout.footerDataStart + i;
      ws.getRow(r).height = 19;
      const sugLine = layout.suggestionLines[i] || '';
      if (sugLine) {
        styleCell(ws, r, 1, { value: sugLine, color: RED_ARGB, size: 10, align: 'left' });
        const wrappedLines = Math.max(1, Math.ceil(sugLine.length / 75));
        if (wrappedLines > 1) {
          ws.getRow(r).height = Math.max(ws.getRow(r).height || 19, wrappedLines * 14 + 4);
        }
      }
      if (i === 0) {
        styleCell(ws, r, 10, { value: 'Thời gian bắt đầu ca làm việc :', size: 9.5, align: 'left' });
        styleCell(ws, r, 12, { value: data.start_time || '', color: RED_ARGB, size: 10, align: 'center' });
      } else if (i === 1) {
        styleCell(ws, r, 10, { value: 'Thời gian kết thúc ca làm việc :', size: 9.5, align: 'left' });
        styleCell(ws, r, 12, { value: data.end_time || '', color: RED_ARGB, size: 10, align: 'center' });
      }
    }

    applyBoxBorders(ws, layout.footerTitleRow, 1, layout.footerTitleRow, 9, {
      outerTop: BORDER_MED, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED
    });
    applyBoxBorders(ws, layout.footerDataStart, 1, layout.footerDataEnd, 9, {
      outerTop: BORDER_THIN, outerBottom: BORDER_MED, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerH: BORDER_DOTTED, innerV: null
    });
    applyBoxBorders(ws, layout.footerTitleRow, 10, layout.footerTitleRow, 12, {
      outerTop: BORDER_MED, outerBottom: BORDER_THIN, outerLeft: BORDER_MED, outerRight: BORDER_MED
    });
    applyBoxBorders(ws, layout.footerDataStart, 10, layout.footerDataEnd, 12, {
      outerTop: BORDER_THIN, outerBottom: BORDER_MED, outerLeft: BORDER_MED, outerRight: BORDER_MED, innerH: BORDER_DOTTED, innerV: BORDER_DOTTED
    });

    // ---------- 7. CHÂN TRANG CHỮ KÝ ----------
    ws.getRow(layout.sigTitleRow).height = 20;
    ws.getRow(layout.sigSpaceStart).height = 22;
    ws.getRow(layout.sigSpaceStart + 1).height = 22;
    ws.getRow(layout.sigSpaceEnd).height = 22;

    styleCell(ws, layout.sigTitleRow, 1, { value: 'GĐ Nhà Máy:', bold: true, size: 10 });
    styleCell(ws, layout.sigTitleRow, 7, { value: 'Trưởng ca:', bold: true, size: 10 });

    // Nhúng Logo VICO ở A1:B4
    const logoInfo = await loadLogoBase64();
    if (logoInfo) {
      try {
        const logoId = wb.addImage({ base64: logoInfo.base64, extension: logoInfo.ext });
        const dims = calcFitDimensions(logoInfo.width, logoInfo.height, 118, 62);
        ws.addImage(logoId, {
          tl: { col: 0.2, row: 0.2 },
          ext: dims,
          editAs: 'oneCell'
        });
      } catch (e) {
        console.warn('Không thể nhúng logo vào Excel:', e);
      }
    }

    // Nhúng chữ ký Trưởng ca cố định theo tài khoản
    const sigDataUrl = data.leader_signature || data.effective_signature || '';
    const sigInfo = dataUrlToBase64Info(sigDataUrl);
    if (sigInfo) {
      try {
        const sigDimsNatural = await measureImage(sigDataUrl);
        const sigDims = calcFitDimensions(sigDimsNatural.width, sigDimsNatural.height, 130, 60);
        const sigId = wb.addImage({ base64: sigInfo.base64, extension: sigInfo.ext });
        ws.addImage(sigId, {
          tl: { col: 8.4, row: layout.sigSpaceStart - 1 + 0.1 },
          ext: sigDims,
          editAs: 'oneCell'
        });
      } catch (e) {
        console.warn('Không thể nhúng ảnh chữ ký Trưởng ca:', e);
        if (data.shift_leader) {
          styleCell(ws, layout.sigSpaceEnd, 7, { value: data.shift_leader, bold: true, size: 10 });
        }
      }
    } else if (data.shift_leader) {
      styleCell(ws, layout.sigSpaceEnd, 7, { value: data.shift_leader, bold: true, size: 10 });
    }

    // Xuất file tải về trình duyệt (đảm bảo không vướng outlineProperties của ExcelJS 4.4.0)
    if (ws.properties && ws.properties.outlineProperties) {
      delete ws.properties.outlineProperties;
    }
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const dateParts = String(data.report_date || '').split('-');
    const dateFileStr = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : 'report';
    const filename = `Bao_Cao_PX_DUC2_Ca${data.shift_num || 1}_${dateFileStr}.xlsx`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return filename;
  }

  function buildPrintPreviewHtml(shiftData) {
    const data = shiftData || {};
    const layout = D2.computeDuc2SheetLayout(data);
    const molding = Array.isArray(data.molding) ? data.molding : [];
    const pouring = Array.isArray(data.pouring) ? data.pouring : [];
    const melting = Array.isArray(data.melting) ? data.melting : [];

    const docCode = String(data.doc_code || '').trim();
    const docNum = String(data.doc_number || '').trim();
    const dateFormatted = D2.formatVNDateDisplay(data.report_date || '');

    const prodCheck = data.safety_production ? 'Điều kiện sản xuất' : '☐ Điều kiện sản xuất (KĐ)';
    const ppeCheck = data.safety_ppe ? '☑ Bảo hộ đầy đủ' : '☐ Bảo hộ đầy đủ (KĐ)';
    const equipCheck = data.safety_equip ? '☑ Thiết bị an toàn' : '☐ Thiết bị an toàn (KĐ)';

    // Khối Khuôn tạo hình + Chấm công
    const moldingRowsHtml = [];
    for (let i = 0; i < layout.moldingRowsCount; i++) {
      const m = molding[i];
      const timeStr = m ? (m.time_range || D2.formatTimeRange(m.start_time, m.end_time)) : '';
      const counterStr = m ? D2.formatCounterRange(m.counter_start, m.counter_end) : '';
      const createdVal = m && m.molds_created !== null && m.molds_created !== undefined ? m.molds_created : '';
      const pouredVal = m && m.molds_poured !== null && m.molds_poured !== undefined ? m.molds_poured : '';

      let rightCellHtml = '';
      if (i === 0) {
        rightCellHtml = `<td colspan="2" class="text-left">Có mặt:</td><td class="red-val bold">${escapeHtml(data.staff_present ?? 16)}</td>`;
      } else if (i === 1) {
        rightCellHtml = `<td colspan="3" class="text-left">1. Nghỉ phép:</td>`;
      } else {
        const permName = layout.permittedLines[i - 2] || '';
        rightCellHtml = `<td colspan="3" class="red-val">${escapeHtml(permName)}</td>`;
      }

      moldingRowsHtml.push(`
        <tr class="dotted-row">
          <td class="red-val">${escapeHtml(m ? m.product_name : '')}</td>
          <td class="red-val">${escapeHtml(m ? m.customer : '')}</td>
          <td colspan="2" class="red-val">${escapeHtml(timeStr)}</td>
          <td colspan="2" class="red-val">${escapeHtml(counterStr)}</td>
          <td class="red-val">${escapeHtml(createdVal)}</td>
          <td class="red-val">${escapeHtml(pouredVal)}</td>
          <td class="red-val">${escapeHtml(m ? m.notes : '')}</td>
          ${rightCellHtml}
        </tr>
      `);
    }

    // Khối Lò rót đáy + Nghỉ K.phép + Tiêu hao vật tư
    const unpermittedFirst = layout.unpermittedLines.length > 0 ? layout.unpermittedLines[0] : 'KO';
    const unpermittedExtraCount = Math.max(1, layout.unpermittedLines.length - 1);
    const pouringRowsHtml = [];
    let prevPourKey = '';

    for (let i = 0; i < layout.pouringRowsCount; i++) {
      const r = layout.pouringDataStart + i;
      const b = pouring[i];
      let spCell = '';
      let custCell = '';
      if (b) {
        const gKey = groupDisplayKey(b, ['product_name', 'customer']);
        if (i === 0 || gKey !== prevPourKey) {
          spCell = b.product_name || '';
          custCell = b.customer || '';
        }
        prevPourKey = gKey;
      }
      const heatLabel = b
        ? (b.furnace_heat_label || (b.furnace_code && b.heat_no ? `${b.furnace_code}.${b.heat_no}` : (b.furnace_code || '')))
        : '';

      let rightCells = '<td colspan="3">&nbsp;</td>';
      const extraIdx = i;
      if (extraIdx < unpermittedExtraCount) {
        const extraLine = layout.unpermittedLines[extraIdx + 1] || '';
        rightCells = `<td colspan="3" class="red-val">${escapeHtml(extraLine)}</td>`;
      } else if (layout.supplyTitleRow && r === layout.supplyTitleRow - 1) {
        rightCells = `<td colspan="3" class="solid-bottom">&nbsp;</td>`;
      } else if (r === layout.supplyTitleRow) {
        rightCells = `<td colspan="3" class="text-left bold">Tiêu hao vật tư :</td>`;
      } else if (layout.supplyRows && layout.supplyRows.length === 4 && r >= layout.supplyRows[0] && r <= layout.supplyRows[3]) {
        const sIdx = r - layout.supplyRows[0];
        if (sIdx === 0) {
          rightCells = `<td class="text-left bold">1. Thanh chặn :</td><td class="red-val bold">${escapeHtml(data.stopper_used ?? 0)}</td><td class="bold">Cái</td>`;
        } else if (sIdx === 1) {
          rightCells = `<td class="text-left">&nbsp;&nbsp;&nbsp;&nbsp;Còn lại :</td><td class="red-val bold">${escapeHtml(data.stopper_remaining ?? 0)}</td><td>Cái</td>`;
        } else if (sIdx === 2) {
          rightCells = `<td class="text-left bold">2. Cốc rót :</td><td class="red-val bold">${escapeHtml(data.nozzle_used ?? 0)}</td><td class="bold">Cái</td>`;
        } else {
          rightCells = `<td class="text-left">&nbsp;&nbsp;&nbsp;&nbsp;Còn lại :</td><td class="red-val bold">${escapeHtml(data.nozzle_remaining ?? 0)}</td><td>Cái</td>`;
        }
      }

      pouringRowsHtml.push(`
        <tr class="dotted-row">
          <td class="red-val">${escapeHtml(spCell)}</td>
          <td class="red-val">${escapeHtml(custCell)}</td>
          <td>${i + 1}</td>
          <td class="red-val">${escapeHtml(b && b.temp_max !== null && b.temp_max !== undefined ? b.temp_max : '')}</td>
          <td class="red-val">${escapeHtml(b && b.temp_min !== null && b.temp_min !== undefined ? b.temp_min : '')}</td>
          <td class="red-val">${escapeHtml(b ? b.start_time : '')}</td>
          <td class="red-val">${escapeHtml(b ? b.end_time : '')}</td>
          <td class="red-val">${escapeHtml(heatLabel)}</td>
          <td class="red-val">${escapeHtml(b ? b.notes : '')}</td>
          ${rightCells}
        </tr>
      `);
    }

    // Khối Lò nấu + Sự cố trong ca
    const meltingRowsHtml = [];
    let prevMeltKey = '';
    for (let i = 0; i < layout.meltingRowsCount; i++) {
      const m = melting[i];
      let sp = '';
      let cust = '';
      let grade = '';
      if (m) {
        const mKey = groupDisplayKey(m, ['product_name', 'customer', 'steel_grade']);
        if (i === 0 || mKey !== prevMeltKey) {
          sp = m.product_name || '';
          cust = m.customer || '';
          grade = m.steel_grade || '';
        }
        prevMeltKey = mKey;
      }
      const issueText = layout.issueLines[i + 1] || '';
      meltingRowsHtml.push(`
        <tr class="dotted-row">
          <td class="red-val">${escapeHtml(sp)}</td>
          <td class="red-val">${escapeHtml(cust)}</td>
          <td colspan="2" class="red-val">${escapeHtml(grade)}</td>
          <td class="red-val">${escapeHtml(m ? m.furnace_code : '')}</td>
          <td class="red-val">${escapeHtml(m ? m.heat_count : '')}</td>
          <td class="red-val">${escapeHtml(m ? m.lining_life : '')}</td>
          <td colspan="2" class="red-val">${escapeHtml(m ? m.notes : '')}</td>
          <td colspan="3" class="red-val text-left">${escapeHtml(issueText)}</td>
        </tr>
      `);
    }

    // Khối Yêu cầu - Đề xuất + Khác
    const suggestionRowsHtml = [];
    for (let i = 0; i < layout.suggestionRowsCount; i++) {
      const sug = layout.suggestionLines[i] || '';
      let rightCells = '<td colspan="3">&nbsp;</td>';
      if (i === 0) {
        rightCells = `<td colspan="2" class="text-left">Thời gian bắt đầu ca làm việc :</td><td class="red-val">${escapeHtml(data.start_time || '')}</td>`;
      } else if (i === 1) {
        rightCells = `<td colspan="2" class="text-left">Thời gian kết thúc ca làm việc :</td><td class="red-val">${escapeHtml(data.end_time || '')}</td>`;
      }
      suggestionRowsHtml.push(`
        <tr class="dotted-row">
          <td colspan="9" class="red-val text-left">${escapeHtml(sug)}</td>
          ${rightCells}
        </tr>
      `);
    }

    const sigUrl = data.leader_signature || data.effective_signature || '';
    const sigHtml = sigUrl
      ? `<img src="${escapeHtml(sigUrl)}" alt="Chữ ký Trưởng ca" class="a4-sig-img">`
      : `<div class="a4-sig-name">${escapeHtml(data.shift_leader || '')}</div>`;

    return `
      <div class="a4-sheet">
        <table class="a4-table">
          <colgroup>
            <col style="width: 8.5%;">
            <col style="width: 9.5%;">
            <col style="width: 5.5%;">
            <col style="width: 8%;">
            <col style="width: 8%;">
            <col style="width: 8%;">
            <col style="width: 8%;">
            <col style="width: 7.5%;">
            <col style="width: 9.5%;">
            <col style="width: 14.5%;">
            <col style="width: 6.5%;">
            <col style="width: 6.5%;">
          </colgroup>
          <tbody>
            <!-- Header -->
            <tr>
              <td colspan="2" rowspan="4" class="a4-logo-cell solid-box"><img src="vico_logo.png" alt="VICO" class="a4-logo-img"></td>
              <td colspan="6" rowspan="2" class="a4-title-top solid-box">CÔNG TY TNHH THẮNG LỢI</td>
              <td colspan="4" class="text-left solid-top solid-right dotted-bottom">Mã hiệu : ${docCode ? `<span class="red-val bold">${escapeHtml(docCode)}</span>` : ''}</td>
            </tr>
            <tr>
              <td colspan="4" class="text-left solid-right dotted-bottom">Đơn vị thực hiện : PX ĐÚC 2</td>
            </tr>
            <tr>
              <td colspan="6" rowspan="2" class="a4-title-sub solid-box">BÁO CÁO TỔNG HỢP SẢN XUẤT</td>
              <td colspan="4" class="text-left solid-right dotted-bottom">Số : ${docNum ? `<span class="red-val bold">${escapeHtml(docNum)}</span>` : '................. / Năm 20........'}</td>
            </tr>
            <tr>
              <td colspan="4" class="text-left solid-right solid-bottom">Ngày lập : <span class="red-val bold">${escapeHtml(dateFormatted)}</span></td>
            </tr>

            <!-- Ca & An toàn -->
            <tr>
              <td class="bold solid-left solid-bottom">Ca:</td>
              <td colspan="2" class="red-val bold solid-bottom">${escapeHtml(data.shift_num || 1)}</td>
              <td colspan="9" class="solid-right solid-bottom">Viết tắt: BT=Bình thường ; KO=Không</td>
            </tr>
            <tr>
              <td colspan="3" class="solid-box">${escapeHtml(prodCheck)}</td>
              <td colspan="5" class="solid-box">${escapeHtml(ppeCheck)}</td>
              <td colspan="4" class="solid-box">${escapeHtml(equipCheck)}</td>
            </tr>

            <!-- Khuôn tạo hình + Chấm công -->
            <tr>
              <td colspan="9" class="bold solid-box">KHUÔN TẠO HÌNH</td>
              <td colspan="3" class="bold solid-box">Chấm công</td>
            </tr>
            <tr class="a4-subhead">
              <td>Tên SP</td>
              <td>Khách hàng</td>
              <td colspan="2">Thời gian<br>tạo hình</td>
              <td colspan="2">Tính toán tạo hình</td>
              <td>Khuôn tạo hình</td>
              <td>Khuôn rót</td>
              <td>Ghi chú</td>
              <td colspan="2" class="text-left">Tổng sĩ số:</td>
              <td class="red-val bold">${escapeHtml(data.staff_total ?? 16)}</td>
            </tr>
            ${moldingRowsHtml.join('')}

            <!-- Lò rót đáy + Nghỉ K.phép + Tiêu hao vật tư -->
            <tr>
              <td colspan="9" class="bold solid-box">LÒ RÓT ĐÁY</td>
              <td colspan="3" class="text-left solid-box">2. Nghỉ không phép:</td>
            </tr>
            <tr class="a4-subhead">
              <td>Tên SP</td>
              <td>Khách hàng</td>
              <td>Lù rót</td>
              <td>Nhiệt độ<br>Max</td>
              <td>Nhiệt độ<br>Min</td>
              <td>Thời gian<br>bắt đầu</td>
              <td>Thời gian<br>kết thúc</td>
              <td>Lò nấu<br>số</td>
              <td>Ghi chú</td>
              <td colspan="3" class="red-val">${escapeHtml(unpermittedFirst)}</td>
            </tr>
            ${pouringRowsHtml.join('')}

            <!-- Lò nấu + Sự cố trong ca -->
            <tr>
              <td colspan="9" class="bold solid-box">LÒ NẤU</td>
              <td colspan="3" class="bold solid-box">SỰ CỐ TRONG CA</td>
            </tr>
            <tr class="a4-subhead">
              <td>Tên SP</td>
              <td>Khách hàng</td>
              <td colspan="2">Mác thép</td>
              <td>Lò nấu</td>
              <td>Số mẻ nấu</td>
              <td>Tuổi thọ</td>
              <td colspan="2">Ghi chú</td>
              <td colspan="3" class="red-val text-left">${escapeHtml(layout.issueLines[0] || '')}</td>
            </tr>
            ${meltingRowsHtml.join('')}

            <!-- Yêu cầu - Đề xuất + Khác -->
            <tr>
              <td colspan="9" class="bold solid-box">Yêu cầu - Đề xuất</td>
              <td colspan="3" class="bold solid-box">Khác</td>
            </tr>
            ${suggestionRowsHtml.join('')}
          </tbody>
        </table>

        <!-- Chữ ký -->
        <div class="a4-sign-row">
          <div class="a4-sign-col">
            <div class="bold">GĐ Nhà Máy:</div>
          </div>
          <div class="a4-sign-col">
            <div class="bold">Trưởng ca:</div>
            <div class="a4-sig-box">${sigHtml}</div>
          </div>
        </div>
      </div>
    `;
  }

  root.Duc2Excel = {
    exportDuc2Excel,
    buildPrintPreviewHtml
  };
})(window);
