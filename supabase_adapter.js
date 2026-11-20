/**
 * VICO Production Reporting System - Supabase Adapter
 * Intercepts /api/* requests and serves them directly from Supabase PostgreSQL.
 * Enables 100% serverless hosting on GitHub Pages with 0 monthly cost.
 */

(function () {
  const SUPABASE_URL = "https://zhweptxqiiiayibzospw.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_bbgH5Vp3rU23cETYIIMbUQ_pHQNskM-";

  // Khởi tạo Supabase client
  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase JS SDK chưa được tải!");
    return;
  }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.vicoSupabase = sb;

  // Session storage key
  const SESSION_KEY = "vico_user_session";

  function getCurrentUser() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setCurrentUser(user) {
    if (user) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  function makeRes(data, status = 200, statusText = "OK") {
    return new Response(JSON.stringify(data), {
      status: status,
      statusText: statusText,
      headers: { "Content-Type": "application/json" }
    });
  }

  function parseQuery(urlStr) {
    const qIndex = urlStr.indexOf("?");
    if (qIndex === -1) return {};
    const query = {};
    const pairs = urlStr.substring(qIndex + 1).split("&");
    for (const p of pairs) {
      const [k, v] = p.split("=");
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || "");
    }
    return query;
  }

  function nowStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  async function handleApiRequest(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const pathOnly = url.split("?")[0].replace(/^https?:\/\/[^\/]+/, "");
    const q = parseQuery(url);

    // 1. AUTH
    if (pathOnly === "/api/auth/me" && method === "GET") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      return makeRes(u, 200);
    }

    if (pathOnly === "/api/auth/login" && method === "POST") {
      const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
      const uname = (body.username || "").trim().toLowerCase();
      const pwd = body.password || "";

      const { data: user, error } = await sb
        .from("users")
        .select("*")
        .eq("username", uname)
        .maybeSingle();

      if (error || !user || !user.active) {
        return makeRes({ detail: "Sai tên đăng nhập hoặc tài khoản đã bị khóa" }, 401);
      }

      let passwordOk = false;
      if (window.dcodeIO && window.dcodeIO.bcrypt) {
        try {
          passwordOk = window.dcodeIO.bcrypt.compareSync(pwd, user.password_hash);
        } catch (e) {
          passwordOk = (pwd === user.password_hash);
        }
      } else {
        // Fallback plain
        passwordOk = (pwd === user.password_hash);
      }

      if (!passwordOk) {
        return makeRes({ detail: "Sai tên đăng nhập hoặc mật khẩu" }, 401);
      }

      const sessionUser = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        active: user.active,
        must_change_password: user.must_change_password,
        session_version: user.session_version
      };
      setCurrentUser(sessionUser);
      return makeRes({ message: "Đăng nhập thành công", user: sessionUser }, 200);
    }

    if (pathOnly === "/api/auth/logout" && method === "POST") {
      setCurrentUser(null);
      return makeRes({ message: "Đã đăng xuất" }, 200);
    }

    if (pathOnly === "/api/auth/change-password" && method === "POST") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;

      let newHash = body.new_password;
      if (window.dcodeIO && window.dcodeIO.bcrypt) {
        newHash = window.dcodeIO.bcrypt.hashSync(body.new_password, 12);
      }

      await sb.from("users").update({
        password_hash: newHash,
        must_change_password: 0
      }).eq("id", u.id);

      u.must_change_password = 0;
      setCurrentUser(u);
      return makeRes({ message: "Đổi mật khẩu thành công" }, 200);
    }

    // 2. PRESETS
    if (pathOnly === "/api/presets" && method === "GET") {
      const { data: rows } = await sb
        .from("presets")
        .select("category, name")
        .eq("active", 1)
        .order("sort_order", { ascending: true });

      const products = (rows || []).filter(r => r.category === "product").map(r => r.name);
      const customers = (rows || []).filter(r => r.category === "customer").map(r => r.name);
      const steel_grades = (rows || []).filter(r => r.category === "steel_grade").map(r => r.name);

      return makeRes({
        products: products.length ? products : ["D25", "D40", "D60", "D80"],
        customers: customers.length ? customers : ["Molycop", "Nhập TQ", "Khô dầu", "VICO"],
        steel_grades: steel_grades.length ? steel_grades : ["CR18", "18", "CR20", "B2"],
        shift_hours: {
          1: { start: "6h", end: "14h" },
          2: { start: "14h", end: "22h" },
          3: { start: "22h", end: "6h" }
        }
      });
    }

    // 3. SHIFT STATUS CHECK
    if (pathOnly === "/api/shifts/check-status" && method === "GET") {
      const reportDate = q.date || q.report_date;
      const shiftNum = parseInt(q.shift_num || "1", 10);
      const u = getCurrentUser();

      const { data: s } = await sb
        .from("shifts")
        .select("*")
        .eq("report_date", reportDate)
        .eq("shift_num", shiftNum)
        .maybeSingle();

      if (!s) {
        return makeRes({ exists: false });
      }

      const canEdit = u && (u.role === "admin" || s.created_by_user_id === u.id);
      let shiftData = null;

      if (canEdit) {
        const [pkg, bsk, tmb] = await Promise.all([
          sb.from("packaging_items").select("*").eq("shift_id", s.id).order("id"),
          sb.from("basket_items").select("*").eq("shift_id", s.id).order("id"),
          sb.from("tumbling_items").select("*").eq("shift_id", s.id).order("id")
        ]);
        s.packaging = pkg.data || [];
        s.baskets = bsk.data || [];
        s.tumbling = tmb.data || [];
        shiftData = s;
      }

      return makeRes({
        exists: true,
        shift_leader: s.shift_leader,
        can_edit: canEdit,
        created_at: s.created_at,
        updated_at: s.updated_at,
        shift_data: shiftData
      });
    }

    // 4. SHIFTS GET / PREVIOUS TEMPLATE
    if (pathOnly === "/api/shifts/previous-template" && method === "GET") {
      const { data: prevShift } = await sb
        .from("shifts")
        .select("id")
        .order("report_date", { ascending: false })
        .order("shift_num", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!prevShift) {
        return makeRes({ packaging: [], baskets: [], tumbling: [] });
      }

      const [pkg, bsk, tmb] = await Promise.all([
        sb.from("packaging_items").select("*").eq("shift_id", prevShift.id).order("id"),
        sb.from("basket_items").select("*").eq("shift_id", prevShift.id).order("id"),
        sb.from("tumbling_items").select("*").eq("shift_id", prevShift.id).order("id")
      ]);

      return makeRes({
        packaging: (pkg.data || []).map(p => ({ ...p, weight_sorted: null, weight_waste: null })),
        baskets: (bsk.data || []).map(b => ({ ...b, basket_count: null, total_weight: null })),
        tumbling: (tmb.data || []).map(t => ({ ...t, m1: null, m2: null, total_weight: null }))
      });
    }

    // 5. SHIFTS GET / POST / DELETE
    if (pathOnly === "/api/shifts" && method === "GET") {
      const reportDate = q.date || q.report_date;
      const { data: shifts } = await sb
        .from("shifts")
        .select("*")
        .eq("report_date", reportDate)
        .order("shift_num");

      for (const s of (shifts || [])) {
        const [pkg, bsk, tmb] = await Promise.all([
          sb.from("packaging_items").select("*").eq("shift_id", s.id).order("id"),
          sb.from("basket_items").select("*").eq("shift_id", s.id).order("id"),
          sb.from("tumbling_items").select("*").eq("shift_id", s.id).order("id")
        ]);
        s.packaging = pkg.data || [];
        s.baskets = bsk.data || [];
        s.tumbling = tmb.data || [];
      }
      return makeRes(shifts || []);
    }

    if (pathOnly === "/api/shifts" && method === "POST") {
      const u = getCurrentUser();
      const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
      const ts = nowStr();

      const { data: existing } = await sb
        .from("shifts")
        .select("id, created_by_user_id")
        .eq("report_date", body.report_date)
        .eq("shift_num", body.shift_num)
        .maybeSingle();

      let shiftId;
      if (existing) {
        shiftId = existing.id;
        if (u && u.role !== "admin" && existing.created_by_user_id !== u.id) {
          return makeRes({ detail: "Báo cáo ca này do ca trưởng khác nộp, bạn không có quyền sửa." }, 403);
        }

        await sb.from("shifts").update({
          safety_production: body.safety_production ? 1 : 0,
          safety_ppe: body.safety_ppe ? 1 : 0,
          safety_equip: body.safety_equip ? 1 : 0,
          staff_total: body.staff_total || 5,
          staff_present: body.staff_present || 5,
          leave_permitted: body.leave_permitted || 0,
          leave_permitted_names: body.leave_permitted_names || "",
          leave_rotating: body.leave_rotating || 0,
          leave_rotating_names: body.leave_rotating_names || "",
          leave_unpermitted: body.leave_unpermitted || 0,
          leave_unpermitted_names: body.leave_unpermitted_names || "",
          issues: body.issues || "",
          suggestions: body.suggestions || "",
          shift_tasks: body.shift_tasks || "",
          start_time: body.start_time || "",
          end_time: body.end_time || "",
          updated_at: ts,
          updated_by_user_id: u ? u.id : null
        }).eq("id", shiftId);

        await Promise.all([
          sb.from("packaging_items").delete().eq("shift_id", shiftId),
          sb.from("basket_items").delete().eq("shift_id", shiftId),
          sb.from("tumbling_items").delete().eq("shift_id", shiftId)
        ]);
      } else {
        const { data: ins, error: insErr } = await sb.from("shifts").insert([{
          report_date: body.report_date,
          shift_num: body.shift_num,
          shift_leader: (u && u.full_name) ? u.full_name : "Ca trưởng",
          safety_production: body.safety_production ? 1 : 0,
          safety_ppe: body.safety_ppe ? 1 : 0,
          safety_equip: body.safety_equip ? 1 : 0,
          staff_total: body.staff_total || 5,
          staff_present: body.staff_present || 5,
          leave_permitted: body.leave_permitted || 0,
          leave_permitted_names: body.leave_permitted_names || "",
          leave_rotating: body.leave_rotating || 0,
          leave_rotating_names: body.leave_rotating_names || "",
          leave_unpermitted: body.leave_unpermitted || 0,
          leave_unpermitted_names: body.leave_unpermitted_names || "",
          issues: body.issues || "",
          suggestions: body.suggestions || "",
          shift_tasks: body.shift_tasks || "",
          start_time: body.start_time || "",
          end_time: body.end_time || "",
          created_at: ts,
          created_by_user_id: u ? u.id : null,
          updated_by_user_id: u ? u.id : null
        }]).select().single();

        if (insErr) {
          console.error("Insert shift error:", insErr);
          return makeRes({ detail: "Lỗi lưu báo cáo ca: " + insErr.message }, 500);
        }
        shiftId = ins.id;
      }

      // Lưu bảng con
      if (body.packaging && body.packaging.length) {
        const items = body.packaging.map(p => ({
          shift_id: shiftId,
          product_name: p.product_name,
          customer: p.customer,
          from_val: p.from_val,
          to_val: p.to_val,
          weight_sorted: p.weight_sorted || 0,
          weight_waste: p.weight_waste || 0,
          notes: p.notes || ""
        }));
        await sb.from("packaging_items").insert(items);
      }

      if (body.baskets && body.baskets.length) {
        const items = body.baskets.map(b => ({
          shift_id: shiftId,
          product_name: b.product_name,
          customer: b.customer,
          from_val: b.from_val,
          to_val: b.to_val,
          steel_grade: b.steel_grade,
          basket_count: b.basket_count || 0,
          total_weight: b.total_weight || 0,
          notes: b.notes || ""
        }));
        await sb.from("basket_items").insert(items);
      }

      if (body.tumbling && body.tumbling.length) {
        const items = body.tumbling.map(t => ({
          shift_id: shiftId,
          product_name: t.product_name,
          customer: t.customer,
          m1: t.m1 || 0,
          m2: t.m2 || 0,
          total_weight: t.total_weight || 0,
          notes: t.notes || ""
        }));
        await sb.from("tumbling_items").insert(items);
      }

      return makeRes({
        status: "success",
        message: `Đã lưu báo cáo Ca ${body.shift_num} ngày ${body.report_date} thành công!`
      });
    }

    if (pathOnly === "/api/shifts" && method === "DELETE") {
      const reportDate = q.date || q.report_date;
      const shiftNum = parseInt(q.shift_num || "1", 10);
      await sb.from("shifts").delete().eq("report_date", reportDate).eq("shift_num", shiftNum);
      return makeRes({ status: "success", message: `Đã xóa báo cáo Ca ${shiftNum} ngày ${reportDate}` });
    }

    // 6. DAILY SUMMARY
    if (pathOnly === "/api/daily-summary" && method === "GET") {
      const reportDate = q.date || q.report_date;
      const { data: shifts } = await sb
        .from("shifts")
        .select("*")
        .eq("report_date", reportDate)
        .order("shift_num");

      if (!shifts || !shifts.length) {
        return makeRes({
          report_date: reportDate,
          submitted_shifts: [],
          packaging: [],
          baskets: [],
          tumbling: [],
          issues: [],
          suggestions: "KO",
          attendance: {
            total_staff: 15, present: 0, leave_permitted: 0, leave_notes: "Ko",
            leave_rotating: 0, rotating_notes: "Ko", leave_unpermitted: 0, unpermitted: "Ko"
          },
          safety: { production: 1, ppe: 1, equip: 1 },
          excel_row_limits: { packaging: 4, baskets: 4, tumbling: 6 }
        });
      }

      const shiftIds = shifts.map(s => s.id);
      const [pkgRes, bskRes, tmbRes] = await Promise.all([
        sb.from("packaging_items").select("*").in("shift_id", shiftIds),
        sb.from("basket_items").select("*").in("shift_id", shiftIds),
        sb.from("tumbling_items").select("*").in("shift_id", shiftIds)
      ]);

      const totalStaff = shifts.reduce((sum, s) => sum + (s.staff_total || 0), 0) || 15;
      const totalPresent = shifts.reduce((sum, s) => sum + (s.staff_present || 0), 0);
      const leavePermitted = shifts.reduce((sum, s) => sum + (s.leave_permitted || 0), 0);
      const leaveRotating = shifts.reduce((sum, s) => sum + (s.leave_rotating || 0), 0);
      const leaveUnpermitted = shifts.reduce((sum, s) => sum + (s.leave_unpermitted || 0), 0);

      const leaveNotesList = shifts.filter(s => s.leave_permitted_names).map(s => `Ca ${s.shift_num}: ${s.leave_permitted_names}`);
      const rotNotesList = shifts.filter(s => s.leave_rotating_names).map(s => `Ca ${s.shift_num}: ${s.leave_rotating_names}`);
      const unpNotesList = shifts.filter(s => s.leave_unpermitted_names).map(s => `Ca ${s.shift_num}: ${s.leave_unpermitted_names}`);

      // Gộp dòng packaging
      const pkgMap = {};
      (pkgRes.data || []).forEach(p => {
        const k = `${p.product_name || ""}|${p.customer || ""}|${p.from_val || ""}|${p.to_val || ""}`;
        if (!pkgMap[k]) {
          pkgMap[k] = { ...p, weight_sorted: 0, weight_waste: 0, notes: [] };
        }
        pkgMap[k].weight_sorted += (p.weight_sorted || 0);
        pkgMap[k].weight_waste += (p.weight_waste || 0);
        if (p.notes) pkgMap[k].notes.push(p.notes);
      });
      const packagingList = Object.values(pkgMap).map(p => ({
        ...p,
        notes: p.notes.join("; ")
      }));

      // Gộp dòng baskets
      const bskMap = {};
      (bskRes.data || []).forEach(b => {
        const k = `${b.product_name || ""}|${b.customer || ""}|${b.from_val || ""}|${b.to_val || ""}|${b.steel_grade || ""}`;
        if (!bskMap[k]) {
          bskMap[k] = { ...b, basket_count: 0, total_weight: 0, notes: [] };
        }
        bskMap[k].basket_count += (b.basket_count || 0);
        bskMap[k].total_weight += (b.total_weight || 0);
        if (b.notes) bskMap[k].notes.push(b.notes);
      });
      const basketsList = Object.values(bskMap).map(b => ({
        ...b,
        notes: b.notes.join("; ")
      }));

      // Gộp dòng tumbling
      const tmbMap = {};
      (tmbRes.data || []).forEach(t => {
        const k = `${t.product_name || ""}|${t.customer || ""}`;
        if (!tmbMap[k]) {
          tmbMap[k] = { ...t, m1: 0, m2: 0, total_weight: 0, notes: [] };
        }
        tmbMap[k].m1 += (t.m1 || 0);
        tmbMap[k].m2 += (t.m2 || 0);
        tmbMap[k].total_weight += (t.total_weight || 0);
        if (t.notes) tmbMap[k].notes.push(t.notes);
      });
      const tumblingList = Object.values(tmbMap).map(t => ({
        ...t,
        notes: t.notes.join("; ")
      }));

      const issuesList = shifts.filter(s => s.issues && s.issues !== "KO" && s.issues !== "Ko").map(s => `Ca ${s.shift_num}: ${s.issues}`);
      const suggList = shifts.filter(s => s.suggestions && s.suggestions !== "KO" && s.suggestions !== "Ko").map(s => `Ca ${s.shift_num}: ${s.suggestions}`);

      return makeRes({
        report_date: reportDate,
        submitted_shifts: shifts.map(s => s.shift_num),
        shifts: shifts,
        packaging: packagingList,
        baskets: basketsList,
        tumbling: tumblingList,
        issues: issuesList,
        suggestions: suggList.length ? suggList.join("; ") : "KO",
        attendance: {
          total_staff: totalStaff,
          present: totalPresent,
          leave_permitted: leavePermitted,
          leave_notes: leaveNotesList.join("; ") || "Ko",
          leave_rotating: leaveRotating,
          rotating_notes: rotNotesList.join("; ") || "Ko",
          leave_unpermitted: leaveUnpermitted,
          unpermitted: unpNotesList.join("; ") || "Ko"
        },
        safety: {
          production: shifts.every(s => s.safety_production === 1) ? 1 : 0,
          ppe: shifts.every(s => s.safety_ppe === 1) ? 1 : 0,
          equip: shifts.every(s => s.safety_equip === 1) ? 1 : 0
        },
        excel_row_limits: { packaging: 4, baskets: 4, tumbling: 6 }
      });
    }

    // 7. HISTORY
    if (pathOnly === "/api/history" && method === "GET") {
      const { data: rows } = await sb
        .from("shifts")
        .select("report_date, shift_num, shift_leader")
        .order("report_date", { ascending: false })
        .order("shift_num", { ascending: true })
        .limit(100);

      const grouped = {};
      (rows || []).forEach(r => {
        if (!grouped[r.report_date]) grouped[r.report_date] = [];
        grouped[r.report_date].push(r);
      });

      const history = Object.keys(grouped).map(d => {
        const items = grouped[d];
        return {
          report_date: d,
          shift_count: items.length,
          shifts: items.map(x => x.shift_num).join(","),
          leaders: items.map(x => x.shift_leader || "").join(", ")
        };
      });

      return makeRes(history);
    }

    // 8. PERIOD SUMMARY & ANALYTICS
    if (pathOnly === "/api/period-summary" && method === "GET") {
      const startDate = q.start_date;
      const endDate = q.end_date;

      const { data: shifts } = await sb
        .from("shifts")
        .select("*")
        .gte("report_date", startDate)
        .lte("report_date", endDate)
        .order("report_date", { ascending: true })
        .order("shift_num", { ascending: true });

      const totalShifts = (shifts || []).length;
      const uniqueDates = Array.from(new Set((shifts || []).map(s => s.report_date)));
      const totalStaffSum = (shifts || []).reduce((sum, s) => sum + (s.staff_total || 0), 0);
      const totalPresentSum = (shifts || []).reduce((sum, s) => sum + (s.staff_present || 0), 0);

      const attendance = {
        total_shifts: totalShifts,
        total_days: uniqueDates.length,
        total_staff_man_shifts: totalStaffSum,
        total_present_man_shifts: totalPresentSum,
        attendance_rate: totalStaffSum > 0 ? Math.round((totalPresentSum / totalStaffSum * 100) * 10) / 10 : 0,
        total_leave_permitted: (shifts || []).reduce((sum, s) => sum + (s.leave_permitted || 0), 0),
        total_leave_rotating: (shifts || []).reduce((sum, s) => sum + (s.leave_rotating || 0), 0),
        total_leave_unpermitted: (shifts || []).reduce((sum, s) => sum + (s.leave_unpermitted || 0), 0)
      };

      if (!totalShifts) {
        return makeRes({
          start_date: startDate,
          end_date: endDate,
          attendance: attendance,
          packaging: { total_sorted: 0, total_waste: 0, waste_rate: 0, by_product: [], by_customer: [] },
          baskets: { total_baskets: 0, total_weight: 0, by_product: [], by_steel: [] },
          tumbling: { total_m1: 0, total_m2: 0, total_batches: 0, total_weight: 0, by_product: [] },
          by_shift: { shift_1: 0, shift_2: 0, shift_3: 0 },
          daily_series: []
        });
      }

      const shiftIds = shifts.map(s => s.id);
      const [pkgRes, bskRes, tmbRes] = await Promise.all([
        sb.from("packaging_items").select("*").in("shift_id", shiftIds),
        sb.from("basket_items").select("*").in("shift_id", shiftIds),
        sb.from("tumbling_items").select("*").in("shift_id", shiftIds)
      ]);

      const totalSorted = (pkgRes.data || []).reduce((s, p) => s + (p.weight_sorted || 0), 0);
      const totalWaste = (pkgRes.data || []).reduce((s, p) => s + (p.weight_waste || 0), 0);
      const wasteRate = totalSorted > 0 ? Math.round((totalWaste / totalSorted * 100) * 100) / 100 : 0;

      const totalBaskets = (bskRes.data || []).reduce((s, b) => s + (b.basket_count || 0), 0);
      const totalBskWeight = (bskRes.data || []).reduce((s, b) => s + (b.total_weight || 0), 0);

      const totalTmbWeight = (tmbRes.data || []).reduce((s, t) => s + (t.total_weight || 0), 0);

      // Thống kê theo ca
      const byShift = { shift_1: 0, shift_2: 0, shift_3: 0 };
      shifts.forEach(s => {
        if (s.shift_num === 1) byShift.shift_1++;
        if (s.shift_num === 2) byShift.shift_2++;
        if (s.shift_num === 3) byShift.shift_3++;
      });

      return makeRes({
        start_date: startDate,
        end_date: endDate,
        attendance: attendance,
        packaging: { total_sorted: totalSorted, total_waste: totalWaste, waste_rate: wasteRate, by_product: [], by_customer: [] },
        baskets: { total_baskets: totalBaskets, total_weight: totalBskWeight, by_product: [], by_steel: [] },
        tumbling: { total_m1: 0, total_m2: 0, total_batches: (tmbRes.data || []).length, total_weight: totalTmbWeight, by_product: [] },
        by_shift: byShift,
        daily_series: []
      });
    }

    // 9. EXCEL EXPORT (Client-side via SheetJS)
    if (pathOnly === "/api/export-excel" && method === "GET") {
      const reportDate = q.date || q.report_date;
      if (window.XLSX) {
        // Tải dữ liệu tổng hợp
        const sumRes = await handleApiRequest(`/api/daily-summary?date=${encodeURIComponent(reportDate)}`);
        const sumData = await sumRes.json();

        const wb = window.XLSX.utils.book_new();
        const wsData = [
          ["BÁO CÁO SẢN XUẤT NGÀY", reportDate],
          [],
          ["1. ĐÓNG GÓI"],
          ["Sản phẩm", "Khách hàng", "Từ", "Đến", "SL Đạt (kg)", "Phế phẩm (kg)", "Ghi chú"]
        ];
        (sumData.packaging || []).forEach(p => {
          wsData.push([p.product_name, p.customer, p.from_val, p.to_val, p.weight_sorted, p.weight_waste, p.notes]);
        });

        wsData.push([]);
        wsData.push(["2. GIỎ BI"]);
        wsData.push(["Sản phẩm", "Khách hàng", "Từ", "Đến", "Mác thép", "Số giỏ", "Tổng KL (kg)", "Ghi chú"]);
        (sumData.baskets || []).forEach(b => {
          wsData.push([b.product_name, b.customer, b.from_val, b.to_val, b.steel_grade, b.basket_count, b.total_weight, b.notes]);
        });

        wsData.push([]);
        wsData.push(["3. BI XÓC"]);
        wsData.push(["Sản phẩm", "Khách hàng", "M1", "M2", "Tổng KL (kg)", "Ghi chú"]);
        (sumData.tumbling || []).forEach(t => {
          wsData.push([t.product_name, t.customer, t.m1, t.m2, t.total_weight, t.notes]);
        });

        const ws = window.XLSX.utils.aoa_to_sheet(wsData);
        window.XLSX.utils.book_append_sheet(wb, ws, "BaoCaoNgay");
        window.XLSX.writeFile(wb, `Bao_Cao_${reportDate}.xlsx`);
        return makeRes({ status: "success", message: "Đã xuất Excel thành công!" });
      }
      return makeRes({ detail: "Thư viện Excel đang tải, vui lòng thử lại sau 2 giây" }, 500);
    }

    // 10. SYNC MASTER (Thông báo trên cloud)
    if (pathOnly === "/api/sync-to-master" && method === "POST") {
      return makeRes({
        status: "success",
        message: "Dữ liệu ngày đã được lưu trữ vĩnh viễn trên Cloud Supabase. (Tính năng ghép file gốc .xlsx 3MB yêu cầu chạy trên máy tính xưởng)."
      });
    }

    // 11. ADMIN USERS
    if (pathOnly === "/api/admin/users" && method === "GET") {
      const { data: users } = await sb.from("users").select("id, username, full_name, role, active, created_at, must_change_password").order("id");
      return makeRes(users || []);
    }

    if (pathOnly === "/api/admin/presets" && method === "GET") {
      const { data: presets } = await sb.from("presets").select("*").order("sort_order");
      return makeRes(presets || []);
    }

    // Fallback 404
    return makeRes({ detail: `Endpoint ${pathOnly} chưa được hỗ trợ trên Supabase Client` }, 404);
  }

  // Intercept window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (resource, options) {
    const url = typeof resource === "string" ? resource : (resource && resource.url ? resource.url : "");
    if (url.startsWith("/api/") || url.startsWith("api/")) {
      return await handleApiRequest(url, options);
    }
    return originalFetch.apply(this, arguments);
  };

  console.log("✓ VICO Supabase Adapter đã sẵn sàng kết nối Cloud!");
})();
