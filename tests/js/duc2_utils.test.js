// Chạy: TZ=Asia/Ho_Chi_Minh node --test tests/js/duc2_utils.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const D2 = require(path.join(__dirname, '..', '..', 'duc2_utils.js'));

function parseRange(rng) {
  const [start, end] = rng.split(':');
  const parseCell = (ref) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { col, row: parseInt(m[2], 10) };
  };
  const a = parseCell(start);
  const b = parseCell(end);
  return { minCol: a.col, minRow: a.row, maxCol: b.col, maxRow: b.row };
}

function assertNoMergeOverlap(merges) {
  const seen = new Map();
  for (const rng of merges) {
    const { minCol, minRow, maxCol, maxRow } = parseRange(rng);
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const key = `${r},${c}`;
        assert.equal(seen.has(key), false, `Merge overlap at row=${r}, col=${c} (${rng} vs ${seen.get(key)})`);
        seen.set(key, rng);
      }
    }
  }
}

test('formatNowVNTime and formatShiftTimeVN match PX DUC 2 sample format', () => {
  assert.equal(D2.formatNowVNTime(new Date(2026, 10, 18, 3, 42)), '3h42');
  assert.equal(D2.formatNowVNTime(new Date(2026, 10, 18, 8, 6)), '8h06');
  assert.equal(D2.formatNowVNTime(new Date(2026, 10, 18, 10, 3)), '10h03');
  assert.equal(D2.formatShiftTimeVN(new Date(2026, 10, 18, 3, 0)), "3h00'");
  assert.equal(D2.formatShiftTimeVN(new Date(2026, 10, 18, 11, 0)), "11h00'");
});

test('parseFurnaceHeatCode splits furnace and heat cleanly', () => {
  assert.deepEqual(D2.parseFurnaceHeatCode('2.2.1'), { furnace: '2.2', heat: 1 });
  assert.deepEqual(D2.parseFurnaceHeatCode('5.1'), { furnace: '5', heat: 1 });
  assert.deepEqual(D2.parseFurnaceHeatCode('3.4'), { furnace: '3', heat: 4 });
  assert.deepEqual(D2.parseFurnaceHeatCode('4'), { furnace: '4', heat: null });
  assert.deepEqual(D2.parseFurnaceHeatCode('2.0'), { furnace: '2.0', heat: null });
  assert.deepEqual(D2.parseFurnaceHeatCode(''), { furnace: '', heat: null });
});

test('suggestNextHeatCode increments per furnace from existing batches', () => {
  const batches = [
    { furnace_code: '5', heat_no: 1, furnace_heat_label: '5.1' },
    { furnace_code: '2.2', heat_no: 1, furnace_heat_label: '2.2.1' },
    { furnace_code: '2.2', heat_no: 2, furnace_heat_label: '2.2.2' },
    { furnace_heat_label: '3.1' }
  ];
  assert.equal(D2.suggestNextHeatCode('2.2', batches), '2.2.3');
  assert.equal(D2.suggestNextHeatCode('5', batches), '5.2');
  assert.equal(D2.suggestNextHeatCode('3', batches), '3.2');
  assert.equal(D2.suggestNextHeatCode('4', batches), '4.1');
});

test('compareFurnaceCodes sorts naturally', () => {
  const list = ['5', '2.2', '10', '3', '4'];
  list.sort(D2.compareFurnaceCodes);
  assert.deepEqual(list, ['2.2', '3', '4', '5', '10']);
});

test('computeMoldsCreated and range formatters match sample image (2320016 - 2319089 = 927)', () => {
  assert.equal(D2.computeMoldsCreated(2319089, 2320016), 927);
  assert.equal(D2.computeMoldsCreated('2319089', '2320016'), 927);
  assert.equal(D2.computeMoldsCreated(100, 90), null);
  assert.equal(D2.computeMoldsCreated('', 100), null);
  assert.equal(D2.formatCounterRange(2319089, 2320016), '2319089–2320016');
  assert.equal(D2.formatTimeRange('3h30', '10h35'), '3h30–10h35');
});

test('computeSupplyRemaining handles additions and usage without going negative', () => {
  assert.equal(D2.computeSupplyRemaining(67, 0, 0), 67);
  assert.equal(D2.computeSupplyRemaining(67, 10, 5), 72);
  assert.equal(D2.computeSupplyRemaining(2, 0, 5), 0);
});

test('recalculateFurnacesFromBatches matches 16-batch sample image totals and lining life', () => {
  const labels = [
    '5.1', '4.1', '2.2.1', '3.1',
    '4.2', '5.2', '3.2', '2.2.2',
    '4.3', '5.3', '3.3', '2.2.3',
    '5.4', '3.4', '2.2.4', '4.4'
  ];
  const batches = labels.map((lbl, idx) => {
    const parsed = D2.parseFurnaceHeatCode(lbl);
    return {
      batch_no: idx + 1,
      furnace_code: parsed.furnace,
      heat_no: parsed.heat,
      furnace_heat_label: lbl
    };
  });
  const prevLifeMap = { '2.2': 32, '3': 4, '4': 3, '5': 3 };
  const defaults = { product_name: 'Bi 40', customer: 'Molycop', steel_grade: 'Cr18-19.5' };
  const furnaces = D2.recalculateFurnacesFromBatches(batches, [], prevLifeMap, defaults);

  assert.equal(furnaces.length, 4);
  assert.deepEqual(
    furnaces.map(f => ({ code: f.furnace_code, heats: f.heat_count, life: f.lining_life })),
    [
      { code: '2.2', heats: 4, life: 36 },
      { code: '3', heats: 4, life: 8 },
      { code: '4', heats: 4, life: 7 },
      { code: '5', heats: 4, life: 7 }
    ]
  );

  // Manual override preserves user override
  const overridden = D2.recalculateFurnacesFromBatches(
    batches,
    [{ furnace_code: '3', prev_lining_life: 4, heat_count: 4, lining_life: 1, manual_life_override: 1 }],
    prevLifeMap,
    defaults
  );
  assert.equal(overridden.find(f => f.furnace_code === '3').lining_life, 1);
});

test('line normalizers, date display, minutes elapsed, and workshop permissions', () => {
  assert.deepEqual(
    D2.normalizeBulletLines("Chờ nước thép: 30'\n- Sự cố khác\n\n"),
    ["- Chờ nước thép: 30'", '- Sự cố khác']
  );
  assert.equal(D2.formatVNDateDisplay('2026-11-18'), '18 / 11 / 2026');
  assert.equal(
    D2.formatMinutesElapsed(new Date(2026, 10, 18, 4, 0), new Date(2026, 10, 18, 4, 30)),
    30
  );
  assert.equal(D2.canAccessWorkshop({ role: 'leader', workshop: 'duc2' }, 'duc2'), true);
  assert.equal(D2.canAccessWorkshop({ role: 'leader', workshop: 'duc2' }, 'nllt'), false);
  assert.equal(D2.canAccessWorkshop({ role: 'leader', workshop: 'all' }, 'nllt'), true);
  assert.equal(D2.canAccessWorkshop({ role: 'admin', workshop: 'nllt' }, 'duc2'), true);
  assert.equal(D2.defaultWorkshopForUser({ role: 'leader', workshop: 'duc2' }, 'nllt'), 'duc2');
  assert.equal(D2.defaultWorkshopForUser({ role: 'admin', workshop: 'all' }, 'duc2'), 'duc2');
});

test('computeDuc2SheetLayout produces zero overlapping merges across standard and overflow shifts', () => {
  const standardLayout = D2.computeDuc2SheetLayout({
    leave_permitted_names: 'Phạm Văn Hải\nNguyễn Văn Bình',
    leave_unpermitted_names: 'KO',
    molding: [{ product_name: 'Bi 40' }],
    pouring: Array.from({ length: 16 }, (_, i) => ({ batch_no: i + 1 })),
    melting: [{ furnace_code: '2.2' }, { furnace_code: '3' }, { furnace_code: '4' }, { furnace_code: '5' }],
    issues: "Chờ nước thép: 30'",
    suggestions: "Thay ống khí đóng mở thanh chặn\nHàn gia cố khung bệ"
  });
  assert.equal(standardLayout.moldingRowsCount, 4);
  assert.equal(standardLayout.pouringRowsCount, 18);
  assert.equal(standardLayout.meltingRowsCount, 6);
  assert.equal(standardLayout.suggestionRowsCount, 5);
  assertNoMergeOverlap(standardLayout.merges);

  const overflowLayout = D2.computeDuc2SheetLayout({
    leave_permitted_names: 'A\nB\nC\nD\nE\nF',
    leave_unpermitted_names: 'X\nY\nZ',
    molding: Array.from({ length: 7 }, (_, i) => ({ product_name: `Bi ${i}` })),
    pouring: Array.from({ length: 24 }, (_, i) => ({ batch_no: i + 1 })),
    melting: Array.from({ length: 8 }, (_, i) => ({ furnace_code: String(i + 1) })),
    issues: Array.from({ length: 9 }, (_, i) => `Sự cố ${i + 1}`).join('\n'),
    suggestions: Array.from({ length: 7 }, (_, i) => `Đề xuất ${i + 1}`).join('\n')
  });
  assert.equal(overflowLayout.moldingRowsCount, 8);
  assert.equal(overflowLayout.pouringRowsCount, 24);
  assert.equal(overflowLayout.meltingRowsCount, 10);
  assert.equal(overflowLayout.suggestionRowsCount, 7);
  assertNoMergeOverlap(overflowLayout.merges);

  const manyLeaveLayout = D2.computeDuc2SheetLayout({
    leave_permitted_names: '1\n2\n3\n4\n5',
    leave_unpermitted_names: Array.from({ length: 16 }, (_, i) => `KP ${i + 1}`).join('\n'),
    molding: [{ product_name: 'Bi 40' }],
    pouring: [],
    melting: [],
    issues: '',
    suggestions: ''
  });
  assert.equal(manyLeaveLayout.moldingRowsCount, 7);
  assert.equal(manyLeaveLayout.pouringRowsCount, 21);
  assert.equal(manyLeaveLayout.supplyRows.length, 4);
  assertNoMergeOverlap(manyLeaveLayout.merges);
});
