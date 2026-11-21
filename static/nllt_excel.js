/**
 * VICO Production Report - PX NLLT Client-side ExcelJS Exporter
 * Populates template_report.xlsx directly in the browser with full VICO formatting
 * (Logo VICO, chữ ký GĐ Nhà máy, font đỏ, công thức, gộp ô, in 1 trang A4).
 * Mirrors excel_service.py::generate_excel_report for GitHub Pages + Supabase mode.
 */
(function (global) {
  "use strict";

  const RED_ARGB = "FFFF0000";
  const BLACK_ARGB = "FF000000";
  const NUM_FMT_THOUSANDS = "#,##0";
  const NUM_FMT_PERCENT_2DP = "0.00";
  const ROW_LIMITS = { packaging: 4, baskets: 4, tumbling: 6 };
  const MERGED_ROW_LABEL = "Khác";
  const ILLEGAL_XML_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]/g;

  const _assetCache = {};

  function cleanText(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(ILLEGAL_XML_RE, "");
  }

  function toNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function parseReportDate(dateStr) {
    const s = String(dateStr || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y, m, d] = s.slice(0, 10).split("-").map(Number);
      return { year: y, month: m, day: d };
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
      const [d, m, y] = s.split("/").map(Number);
      return { year: y, month: m, day: d };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatSheetName(dateStr) {
    const dt = parseReportDate(dateStr);
    return `${pad2(dt.day)}.${pad2(dt.month)}.${String(dt.year).slice(2)}`;
  }

  function colToNumber(colStr) {
    let n = 0;
    const upper = colStr.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      n = n * 26 + (upper.charCodeAt(i) - 64);
    }
    return n;
  }

  function parseRange(rangeStr) {
    const [start, end] = String(rangeStr).split(":");
    const m1 = /^([A-Z]+)(\d+)$/i.exec(start);
    const m2 = /^([A-Z]+)(\d+)$/i.exec(end || start);
    if (!m1 || !m2) return null;
    return {
      minCol: colToNumber(m1[1]),
      minRow: parseInt(m1[2], 10),
      maxCol: colToNumber(m2[1]),
      maxRow: parseInt(m2[2], 10)
    };
  }

  function safeMergeRange(ws, rangeStr) {
    const target = parseRange(rangeStr);
    if (!target) return;
    const existingMerges = Array.isArray(ws.model && ws.model.merges) ? [...ws.model.merges] : [];
    for (const rng of existingMerges) {
      const r = parseRange(rng);
      if (!r) continue;
      const overlaps =
        r.minRow <= target.maxRow &&
        r.maxRow >= target.minRow &&
        r.minCol <= target.maxCol &&
        r.maxCol >= target.minCol;
      if (overlaps) {
        try {
          ws.unMergeCells(rng);
        } catch (_) {
          // ignore if already unmerged
        }
      }
    }
    try {
      ws.mergeCells(rangeStr);
    } catch (_) {
      // ignore duplicate merge
    }
  }

  function anchorCell(ws, row, col) {
    const cell = ws.getCell(row, col);
    return cell.isMerged && cell.master ? cell.master : cell;
  }

  function applyRedFont(cell) {
    const base = cell.font ? { ...cell.font } : { name: "Times New Roman", size: 11 };
    base.color = { argb: RED_ARGB };
    cell.font = base;
  }

  function setCell(ws, row, col, val, opts) {
    const options = opts || {};
    const cell = anchorCell(ws, row, col);
    if (options.red) {
      applyRedFont(cell);
    }
    if (typeof val === "string") {
      const text = cleanText(val);
      if (text === "") {
        cell.value = null;
        return cell;
      }
      cell.value = text;
    } else if (val === null || val === undefined) {
      cell.value = null;
    } else {
      cell.value = val;
    }
    if (options.numberFormat) {
      cell.numFmt = options.numberFormat;
    }
    return cell;
  }

  function setFormula(ws, row, col, formulaStr, opts) {
    const options = opts || {};
    const cell = anchorCell(ws, row, col);
    if (options.red) {
      applyRedFont(cell);
    }
    const cleanFormula = String(formulaStr).replace(/^=/, "");
    const payload = { formula: cleanFormula };
    if (options.result !== undefined && Number.isFinite(options.result)) {
      payload.result = options.result;
    }
    cell.value = payload;
    if (options.numberFormat) {
      cell.numFmt = options.numberFormat;
    }
    return cell;
  }

  function checkboxText(label, failedShifts) {
    if (!failedShifts || !failedShifts.length) {
      return `☑ ${label}`;
    }
    const unique = Array.from(new Set(failedShifts.map(String)));
    return `☐ ${label} (Ca ${unique.join(", ")}: không đạt)`;
  }

  function mergedNames(items) {
    const names = items.map(it => `${it.product_name || "?"} ${it.customer || ""}`.trim());
    return "Gộp: " + names.join(", ");
  }

  function fitRows(items, maxRows, mergeFn) {
    const list = Array.isArray(items) ? items : [];
    if (list.length <= maxRows) return list.slice();
    const keep = maxRows - 1;
    return list.slice(0, keep).concat([mergeFn(list.slice(keep))]);
  }

  function mergePackaging(items) {
    return {
      product_name: MERGED_ROW_LABEL,
      customer: "",
      from_val: "",
      to_val: "",
      weight_sorted: items.reduce((s, it) => s + toNum(it.weight_sorted), 0),
      weight_waste: items.reduce((s, it) => s + toNum(it.weight_waste), 0),
      notes: mergedNames(items)
    };
  }

  function mergeBaskets(items) {
    return {
      product_name: MERGED_ROW_LABEL,
      customer: "",
      from_val: "",
      to_val: "",
      steel_grade: "",
      basket_count: items.reduce((s, it) => s + toNum(it.basket_count), 0),
      total_weight: items.reduce((s, it) => {
        const w = it.total_weight !== null && it.total_weight !== undefined
          ? toNum(it.total_weight)
          : toNum(it.basket_count) * 350;
        return s + w;
      }, 0),
      notes: mergedNames(items)
    };
  }

  function mergeTumbling(items) {
    return {
      product_name: MERGED_ROW_LABEL,
      customer: "",
      m1: items.reduce((s, it) => s + toNum(it.m1), 0),
      m2: items.reduce((s, it) => s + toNum(it.m2), 0),
      total_weight: items.reduce((s, it) => s + toNum(it.total_weight), 0),
      notes: mergedNames(items)
    };
  }

  function naturalParts(str) {
    return String(str || "")
      .trim()
      .split(/(\d+)/)
      .filter(Boolean)
      .map(part => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
  }

  function compareNatural(aParts, bParts) {
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
      if (i >= aParts.length) return -1;
      if (i >= bParts.length) return 1;
      const a = aParts[i];
      const b = bParts[i];
      if (a === b) continue;
      if (typeof a === "number" && typeof b === "number") return a - b;
      return String(a).localeCompare(String(b), "vi");
    }
    return 0;
  }

  function sortTumbling(rawItems) {
    return rawItems.slice().sort((a, b) => {
      const prodA = String(a.product_name || "");
      const prodB = String(b.product_name || "");
      const emptyA = !prodA || prodA === MERGED_ROW_LABEL ? 1 : 0;
      const emptyB = !prodB || prodB === MERGED_ROW_LABEL ? 1 : 0;
      if (emptyA !== emptyB) return emptyA - emptyB;

      const nat = compareNatural(naturalParts(prodA), naturalParts(prodB));
      if (nat !== 0) return nat;

      const custCmp = String(a.customer || "").toLowerCase().localeCompare(String(b.customer || "").toLowerCase(), "vi");
      if (custCmp !== 0) return custCmp;

      const hasNoteA = a.notes ? 1 : 0;
      const hasNoteB = b.notes ? 1 : 0;
      if (hasNoteA !== hasNoteB) return hasNoteA - hasNoteB;

      const wDiff = toNum(a.total_weight) - toNum(b.total_weight);
      if (wDiff !== 0) return wDiff;

      return String(a.notes || "").localeCompare(String(b.notes || ""), "vi");
    });
  }

  async function fetchAssetBuffer(relPath) {
    if (_assetCache[relPath]) return _assetCache[relPath];
    const res = await fetch(relPath, { cache: "no-cache" });
    if (!res.ok) {
      throw new Error(`Không tải được tệp mẫu: ${relPath} (HTTP ${res.status})`);
    }
    const buf = await res.arrayBuffer();
    _assetCache[relPath] = buf;
    return buf;
  }

  async function tryFetchImageBuffer(paths) {
    for (const p of paths) {
      try {
        return await fetchAssetBuffer(p);
      } catch (_) {
        // try next fallback path
      }
    }
    return null;
  }

  function makeRichText(segments) {
    return {
      richText: segments.map(seg => ({
        font: {
          name: seg.fontName || "Times New Roman",
          size: seg.size || 11,
          bold: Boolean(seg.bold),
          color: { argb: seg.red ? RED_ARGB : BLACK_ARGB }
        },
        text: cleanText(seg.text)
      }))
    };
  }

  async function exportSummaryToBuffer(summaryData) {
    if (!global.ExcelJS) {
      throw new Error("Thư viện ExcelJS chưa được tải");
    }

    const templateBuf = await fetchAssetBuffer("template_report.xlsx");
    const wb = new global.ExcelJS.Workbook();
    await wb.xlsx.load(templateBuf);
    const ws = wb.worksheets[0];
    if (!ws) {
      throw new Error("File mẫu template_report.xlsx không hợp lệ");
    }

    const dateStr = (summaryData && summaryData.report_date) || new Date().toISOString().slice(0, 10);
    const dt = parseReportDate(dateStr);
    ws.name = formatSheetName(dateStr);

    // 1. Header: Ngày lập (J4), Ca (A6), An toàn (A7, D7, J7)
    const dateDisplay = `${pad2(dt.day)} / ${pad2(dt.month)} / ${dt.year}`;
    const cellJ4 = anchorCell(ws, 4, 10);
    const fontJ4 = (cellJ4.font && cellJ4.font.name) || "Times New Roman";
    const szJ4 = (cellJ4.font && cellJ4.font.size) || 11;
    cellJ4.value = makeRichText([
      { text: " Ngày lập :     ", fontName: fontJ4, size: szJ4 },
      { text: dateDisplay, fontName: fontJ4, size: szJ4, red: true }
    ]);

    const submittedShifts = (summaryData && summaryData.submitted_shifts) || [];
    if (submittedShifts.length) {
      setCell(ws, 6, 1, "Ca: " + submittedShifts.join(", "));
    }

    const safety = (summaryData && summaryData.safety) || {};
    const prodFailed = Array.isArray(safety.production_failed_shifts)
      ? safety.production_failed_shifts
      : (safety.production === 0 ? submittedShifts : []);
    const ppeFailed = Array.isArray(safety.ppe_failed_shifts)
      ? safety.ppe_failed_shifts
      : (safety.ppe === 0 ? submittedShifts : []);
    const equipFailed = Array.isArray(safety.equip_failed_shifts)
      ? safety.equip_failed_shifts
      : (safety.equip === 0 ? submittedShifts : []);

    setCell(ws, 7, 1, checkboxText("Điều kiện sản xuất", prodFailed));
    setCell(ws, 7, 4, checkboxText("Bảo hộ đầy đủ", ppeFailed));
    setCell(ws, 7, 10, checkboxText("Thiết bị an toàn", equipFailed));

    // 2. Chấm công
    const attendance = (summaryData && summaryData.attendance) || {};
    const totalStaff = attendance.total_staff !== undefined ? attendance.total_staff : 5;
    const present = attendance.present !== undefined ? attendance.present : 5;
    const leaveNotes = attendance.leave_notes || "Ko";
    const leaveDetail = attendance.leave_detail || "";
    const unpermitted = attendance.unpermitted || "Ko";

    const cellK10 = anchorCell(ws, 10, 11);
    const fontName = (cellK10.font && cellK10.font.name) || "Times New Roman";
    const sz = (cellK10.font && cellK10.font.size) || 11;
    cellK10.value = makeRichText([
      { text: "Tổng sĩ số: ___", fontName, size: sz },
      { text: String(totalStaff), fontName, size: sz, red: true },
      { text: "___", fontName, size: sz }
    ]);

    const cellK11 = anchorCell(ws, 11, 11);
    cellK11.value = makeRichText([
      { text: "Có mặt: __", fontName, size: sz },
      { text: String(present), fontName, size: sz, red: true },
      { text: "__", fontName, size: sz }
    ]);

    safeMergeRange(ws, "K13:L13");
    const cellK13 = anchorCell(ws, 13, 11);
    const leaveStr = cleanText(String(leaveNotes || "Ko"));
    cellK13.value = makeRichText([
      { text: "1. Nghỉ phép: ", fontName, size: sz },
      { text: leaveStr, fontName, size: 9, red: true }
    ]);
    cellK13.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    if (leaveStr.length > 10) {
      const needH = Math.max(18, 13 * Math.ceil((15 + leaveStr.length) / 24) + 4);
      ws.getRow(13).height = Math.max(ws.getRow(13).height || 18, needH);
    }

    if (leaveDetail) {
      safeMergeRange(ws, "K17:L17");
      const cellK17 = setCell(ws, 17, 11, leaveDetail, { red: true });
      cellK17.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      cellK17.font = { name: fontName, size: 9, color: { argb: RED_ARGB } };
      if (leaveDetail.length > 24) {
        const needH = Math.max(18, 13 * Math.ceil(leaveDetail.length / 24) + 4);
        ws.getRow(17).height = Math.max(ws.getRow(17).height || 18, needH);
      }
    }

    const cellK18 = anchorCell(ws, 18, 11);
    const unpermittedClean = cleanText(String(unpermitted || "Ko")) || "Ko";
    cellK18.value = makeRichText([
      { text: "2. Nghỉ không phép: ", fontName, size: sz },
      { text: unpermittedClean, fontName, size: 9, red: true }
    ]);
    cellK18.alignment = { horizontal: "left", vertical: "middle", wrapText: true };

    // 3. Mục 1: BAO GÓI SẢN PHẨM (Row 11 to 14)
    const packagingItems = fitRows((summaryData && summaryData.packaging) || [], ROW_LIMITS.packaging, mergePackaging);
    packagingItems.forEach((item, idx) => {
      const r = 11 + idx;
      setCell(ws, r, 1, item.product_name || "", { red: true });
      setCell(ws, r, 2, item.customer || "", { red: true });
      setCell(ws, r, 3, item.from_val || "", { red: true });
      setCell(ws, r, 4, item.to_val || "", { red: true });

      const hasSorted = item.weight_sorted !== null && item.weight_sorted !== undefined;
      const hasWaste = item.weight_waste !== null && item.weight_waste !== undefined;
      const weightSorted = hasSorted ? toNum(item.weight_sorted) : null;
      const weightWaste = hasWaste ? toNum(item.weight_waste) : null;

      setCell(ws, r, 5, weightSorted !== null ? weightSorted : "", { red: true, numberFormat: NUM_FMT_THOUSANDS });
      setCell(ws, r, 7, weightWaste !== null ? weightWaste : "", { red: true, numberFormat: NUM_FMT_THOUSANDS });

      if (weightSorted && weightWaste) {
        setFormula(ws, r, 9, `=G${r}/E${r}*100`, {
          red: true,
          result: (weightWaste / weightSorted) * 100,
          numberFormat: NUM_FMT_PERCENT_2DP
        });
      } else if (weightWaste === 0) {
        setCell(ws, r, 9, 0, { red: true, numberFormat: NUM_FMT_PERCENT_2DP });
      }
      setCell(ws, r, 10, item.notes || "", { red: true });
    });

    const extraPackagingNotes = ((summaryData && summaryData.packaging_notes) || []).filter(Boolean);
    if (extraPackagingNotes.length) {
      setCell(ws, 15, 1, extraPackagingNotes[0], { red: true });
      const rest = extraPackagingNotes.slice(1);
      if (rest.length === 1) {
        setCell(ws, 16, 1, rest[0], { red: true });
      } else if (rest.length > 1) {
        setCell(ws, 16, 1, rest.map(n => String(n).trim()).join("; "), { red: true });
      }
    }

    // 4. Mục 2: SỐ LƯỢNG GIỎ BI RA SAU TÔI (Row 21 to 24)
    const basketItems = fitRows((summaryData && summaryData.baskets) || [], ROW_LIMITS.baskets, mergeBaskets);
    basketItems.forEach((item, idx) => {
      const r = 21 + idx;
      setCell(ws, r, 1, item.product_name || "", { red: true });
      setCell(ws, r, 2, item.customer || "", { red: true });
      setCell(ws, r, 3, item.from_val || "", { red: true });
      setCell(ws, r, 4, item.to_val || "", { red: true });
      setCell(ws, r, 5, item.steel_grade || "", { red: true });
      const basketCount = item.basket_count !== null && item.basket_count !== undefined ? toNum(item.basket_count) : null;
      setCell(ws, r, 7, basketCount !== null ? basketCount : "", { red: true });

      const totalWeight = item.total_weight !== null && item.total_weight !== undefined ? toNum(item.total_weight) : null;
      if (totalWeight !== null) {
        setCell(ws, r, 9, totalWeight, { red: true, numberFormat: NUM_FMT_THOUSANDS });
      } else if (basketCount) {
        setFormula(ws, r, 9, `=G${r}*350`, {
          red: true,
          result: basketCount * 350,
          numberFormat: NUM_FMT_THOUSANDS
        });
      }
    });

    const basketNoteParts = [(summaryData && summaryData.basket_notes) || ""];
    basketItems.forEach(item => {
      const notes = String(item.notes || "").trim();
      if (!notes) return;
      if (item.product_name === MERGED_ROW_LABEL) {
        basketNoteParts.push(notes);
      } else {
        const label = `${item.product_name || ""} ${item.customer || ""}`.trim();
        basketNoteParts.push(label ? `${label}: ${notes}` : notes);
      }
    });
    const extraBasketNotes = basketNoteParts.filter(Boolean).join("; ");
    if (extraBasketNotes) {
      setCell(ws, 25, 1, extraBasketNotes, { red: true });
    }

    // 5. Mục 3: SỐ MẺ BI XÓC (Row 30 to 35)
    const rawTumbling = sortTumbling((summaryData && summaryData.tumbling) || []);
    const tumblingItems = fitRows(rawTumbling, ROW_LIMITS.tumbling, mergeTumbling);
    tumblingItems.forEach((item, idx) => {
      const r = 30 + idx;
      setCell(ws, r, 1, item.product_name || "", { red: true });
      setCell(ws, r, 2, item.customer || "", { red: true });
      const m1 = item.m1 !== null && item.m1 !== undefined ? toNum(item.m1) : null;
      const m2 = item.m2 !== null && item.m2 !== undefined ? toNum(item.m2) : null;
      setCell(ws, r, 3, m1 !== null && m1 !== 0 ? m1 : "", { red: true });
      setCell(ws, r, 5, m2 !== null && m2 !== 0 ? m2 : "", { red: true });
      const tw = item.total_weight !== null && item.total_weight !== undefined ? toNum(item.total_weight) : null;
      setCell(ws, r, 7, tw !== null ? tw : "", { red: true, numberFormat: NUM_FMT_THOUSANDS });
      setCell(ws, r, 9, item.notes || "", { red: true });
    });

    // Gộp ô Tên SP (cột A) và Khách hàng (cột B) các dòng liền kề cùng SP & KH
    let i = 0;
    while (i < tumblingItems.length) {
      const prod = tumblingItems[i].product_name || "";
      const cust = tumblingItems[i].customer || "";
      let j = i + 1;
      if (prod && prod !== MERGED_ROW_LABEL) {
        while (
          j < tumblingItems.length &&
          (tumblingItems[j].product_name || "") === prod &&
          (tumblingItems[j].customer || "") === cust
        ) {
          j++;
        }
      }
      const startR = 30 + i;
      const endR = 30 + j - 1;
      if (endR > startR) {
        safeMergeRange(ws, `A${startR}:A${endR}`);
        safeMergeRange(ws, `B${startR}:B${endR}`);
        const cellA = setCell(ws, startR, 1, prod, { red: true });
        const cellB = setCell(ws, startR, 2, cust, { red: true });
        cellA.alignment = { horizontal: "center", vertical: "middle" };
        cellB.alignment = { horizontal: "center", vertical: "middle" };
      }
      i = j;
    }

    // 6. SỰ CỐ TRONG CA (J28:L35)
    const rawIssues = (summaryData && summaryData.issues) || [];
    const flatIssues = [];
    rawIssues.forEach(iss => {
      String(iss || "").split("\n").forEach(line => {
        let lineClean = cleanText(line).trim();
        if (!lineClean) return;
        if (!lineClean.startsWith("-")) {
          lineClean = `- ${lineClean}`;
        } else if (!lineClean.startsWith("- ")) {
          lineClean = `- ${lineClean.replace(/^-+\s*/, "")}`;
        }
        flatIssues.push(lineClean);
      });
    });

    const MAX_ISSUE_ROWS = 8;
    const ISSUE_CHARS_PER_LINE = 42;
    const ISSUE_LINE_HEIGHT = 13;
    const ISSUE_MIN_ROW_HEIGHT = 18;

    for (let offset = 0; offset < MAX_ISSUE_ROWS; offset++) {
      const r = 28 + offset;
      safeMergeRange(ws, `J${r}:L${r}`);
      if (offset < flatIssues.length) {
        const val = (offset === MAX_ISSUE_ROWS - 1 && flatIssues.length > MAX_ISSUE_ROWS)
          ? flatIssues.slice(offset).join("; ")
          : flatIssues[offset];
        setCell(ws, r, 10, val, { red: true });
        const numLines = Math.max(1, Math.ceil(val.length / ISSUE_CHARS_PER_LINE));
        const neededH = Math.max(ISSUE_MIN_ROW_HEIGHT, ISSUE_LINE_HEIGHT * numLines + 4);
        const curH = ws.getRow(r).height || ISSUE_MIN_ROW_HEIGHT;
        ws.getRow(r).height = Math.max(curH, neededH);
      } else {
        setCell(ws, r, 10, null);
      }
      const cellJ = anchorCell(ws, r, 10);
      cellJ.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      cellJ.font = { name: "Times New Roman", size: 9, color: { argb: RED_ARGB } };
    }

    // 7. Yêu cầu - Đề xuất (A37:H37)
    const suggestions = cleanText(String((summaryData && summaryData.suggestions) || "KO")) || "KO";
    safeMergeRange(ws, "A37:H37");
    const cellA37 = setCell(ws, 37, 1, suggestions, { red: true });
    cellA37.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    const suggLines = Math.ceil(suggestions.length / 70) || 1;
    if (suggLines > 1) {
      ws.getRow(37).height = Math.max(ws.getRow(37).height || 15, 15 * suggLines);
    }

    // 8. Thời gian làm việc các ca (I37:L39)
    const SHIFT_TIME_DATA = [
      ["Thời gian làm việc của Ca 1 từ :   ", "6h - 14h "],
      ["Thời gian làm việc của Ca 2 từ :  ", "14h - 22h "],
      ["Thời gian làm việc của Ca 3 từ :  ", "22h - 6h "]
    ];
    safeMergeRange(ws, "I39:L39");
    SHIFT_TIME_DATA.forEach(([label, tVal], offset) => {
      const r = 37 + offset;
      const cCell = anchorCell(ws, r, 9);
      const fn = (cCell.font && cCell.font.name) || "Times New Roman";
      const szTime = (cCell.font && cCell.font.size) || 11;
      cCell.value = makeRichText([
        { text: label, fontName: fn, size: szTime },
        { text: tVal, fontName: fn, size: szTime, red: true }
      ]);
    });
    const alignI38 = anchorCell(ws, 38, 9).alignment;
    if (alignI38) {
      anchorCell(ws, 39, 9).alignment = { ...alignI38 };
    }

    // 9. Người báo cáo
    safeMergeRange(ws, "I44:L44");
    setCell(ws, 44, 9, "Người báo cáo:");
    const reporterName = (summaryData && summaryData.reporter_name) || "Ngọc Quang";
    setCell(ws, 45, 8, `                              ${reporterName}`);

    // 10. Cấu hình in 1 trang A4 dọc
    ws.pageSetup = {
      ...(ws.pageSetup || {}),
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: {
        left: 0.7,
        right: 0.7,
        top: 0.75,
        bottom: 0.75,
        header: 0.3,
        footer: 0.3
      }
    };

    // 11. Chèn logo VICO (A1) & chữ ký GĐ Nhà máy (B44)
    const [logoBuf, sigBuf] = await Promise.all([
      tryFetchImageBuffer(["vico_logo.png", "assets/vico_logo.png"]),
      tryFetchImageBuffer(["signature_gd.png", "assets/signature_gd.png"])
    ]);

    if (logoBuf) {
      const logoId = wb.addImage({ buffer: logoBuf, extension: "png" });
      ws.addImage(logoId, {
        tl: { col: 0, row: 0 },
        ext: { width: 110, height: 70 }
      });
    }
    if (sigBuf) {
      const sigId = wb.addImage({ buffer: sigBuf, extension: "png" });
      ws.addImage(sigId, {
        tl: { col: 1, row: 43 },
        ext: { width: 105, height: 85 }
      });
    }

    return await wb.xlsx.writeBuffer();
  }

  global.VicoNlltExcel = {
    exportSummaryToBuffer,
    formatSheetName
  };
})(window);
