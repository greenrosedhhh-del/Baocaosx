/**
 * VICO Production Reporting System - Supabase Adapter
 * Intercepts /api/* requests and serves them directly from Supabase PostgreSQL.
 * Supports both PX NLLT and PX DUC 2 running in parallel on GitHub Pages + Supabase.
 */

(function () {
  const SUPABASE_URL = "https://zhweptxqiiiayibzospw.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_bbgH5Vp3rU23cETYIIMbUQ_pHQNskM-";

  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase JS SDK chưa được tải!");
    return;
  }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.vicoSupabase = sb;

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
    try {
      if (user) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (e) {
      console.warn("Không lưu được session vào localStorage:", e);
    }
  }

  function normalizeUserSession(user) {
    if (!user) return null;
    const role = user.role || "leader";
    return {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: role,
      active: user.active,
      must_change_password: user.must_change_password,
      session_version: user.session_version,
      workshop: user.workshop || (role === "admin" ? "all" : "nllt"),
      signature_data: user.signature_data || null
    };
  }

  function makeRes(data, status = 200, statusText = "OK") {
    return new Response(JSON.stringify(data), {
      status: status,
      statusText: statusText,
      headers: { "Content-Type": "application/json" }
    });
  }

  function dbErrorRes(error, fallbackMsg) {
    const code = error && error.code ? String(error.code) : "";
    const msg = error && error.message ? String(error.message) : "";
    const details = error && error.details ? String(error.details) : "";
    if (
      code === "42P01" ||
      code === "PGRST205" ||
      msg.includes("duc2_") ||
      details.includes("duc2_")
    ) {
      return makeRes({
        detail: "Bảng dữ liệu PX Đúc 2 chưa được khởi tạo trên Supabase. Vui lòng chạy file supabase_duc2_migration.sql trong Supabase SQL Editor."
      }, 500);
    }
    if (code === "42703" || code === "PGRST204") {
      return makeRes({
        detail: "Cơ sở dữ liệu Supabase chưa cập nhật cột mới (workshop / signature_data). Vui lòng chạy file supabase_duc2_migration.sql trong Supabase SQL Editor."
      }, 500);
    }
    return makeRes({
      detail: msg ? `${fallbackMsg}: ${msg}` : fallbackMsg
    }, 500);
  }

  function parseQuery(urlStr) {
    const qIndex = urlStr.indexOf("?");
    if (qIndex === -1) return {};
    const query = {};
    const pairs = urlStr.substring(qIndex + 1).split("&");
    for (const p of pairs) {
      const idx = p.indexOf("=");
      if (idx === -1) {
        if (p) query[decodeURIComponent(p)] = "";
      } else {
        const k = p.slice(0, idx);
        const v = p.slice(idx + 1);
        if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || "");
      }
    }
    return query;
  }

  function parseBody(options) {
    if (!options || !options.body) return {};
    if (typeof options.body === "string") {
      try {
        return JSON.parse(options.body);
      } catch (e) {
        return {};
      }
    }
    return options.body;
  }

  function nowStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function hashPassword(pwd) {
    if (window.dcodeIO && window.dcodeIO.bcrypt) {
      return window.dcodeIO.bcrypt.hashSync(pwd, 10);
    }
    return pwd;
  }

  function verifyPassword(pwd, hash) {
    if (window.dcodeIO && window.dcodeIO.bcrypt) {
      try {
        return window.dcodeIO.bcrypt.compareSync(pwd, hash);
      } catch (e) {
        return pwd === hash;
      }
    }
    return pwd === hash;
  }

  function canEditDuc2Shift(user, shift) {
    if (!user || !shift) return false;
    return (
      user.role === "admin" ||
      user.workshop === "all" ||
      shift.created_by_user_id === user.id ||
      !shift.created_by_user_id
    );
  }

  async function resolveUserSignature(userId) {
    if (!userId) return null;
    try {
      const { data, error } = await sb
        .from("users")
        .select("signature_data")
        .eq("id", userId)
        .maybeSingle();
      if (error || !data) return null;
      return data.signature_data || null;
    } catch (e) {
      return null;
    }
  }

  async function loadFullDuc2Shift(shiftRow) {
    if (!shiftRow) return null;
    const [mldRes, pourRes, meltRes] = await Promise.all([
      sb.from("duc2_molding_items").select("*").eq("shift_id", shiftRow.id).order("sort_order", { ascending: true }).order("id", { ascending: true }),
      sb.from("duc2_pouring_batches").select("*").eq("shift_id", shiftRow.id).order("batch_no", { ascending: true }).order("id", { ascending: true }),
      sb.from("duc2_melting_furnaces").select("*").eq("shift_id", shiftRow.id).order("sort_order", { ascending: true }).order("id", { ascending: true })
    ]);

    let effectiveSig = shiftRow.leader_signature || null;
    if (!effectiveSig && shiftRow.created_by_user_id) {
      effectiveSig = await resolveUserSignature(shiftRow.created_by_user_id);
    }

    return {
      ...shiftRow,
      effective_signature: effectiveSig,
      molding: mldRes.data || [],
      pouring: pourRes.data || [],
      melting: meltRes.data || []
    };
  }

  function toNullableInt(val) {
    if (val === null || val === undefined || val === "") return null;
    const n = parseInt(val, 10);
    return Number.isNaN(n) ? null : n;
  }

  function toIntOr(val, fallback = 0) {
    if (val === null || val === undefined || val === "") return fallback;
    const n = parseInt(val, 10);
    return Number.isNaN(n) ? fallback : n;
  }

  async function handleApiRequest(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const pathOnly = url.split("?")[0].replace(/^https?:\/\/[^\/]+/, "");
    const q = parseQuery(url);

    // ==================== 1. AUTH ====================
    if (pathOnly === "/api/auth/me" && method === "GET") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      try {
        let { data: fresh, error } = await sb
          .from("users")
          .select("id, username, full_name, role, active, must_change_password, session_version, workshop, signature_data")
          .eq("id", u.id)
          .maybeSingle();

        if (error && (error.code === "42703" || error.code === "PGRST204" || (error.message && (error.message.includes("workshop") || error.message.includes("signature_data"))))) {
          const fallbackRes = await sb
            .from("users")
            .select("id, username, full_name, role, active, must_change_password, session_version")
            .eq("id", u.id)
            .maybeSingle();
          fresh = fallbackRes.data;
          error = fallbackRes.error;
        }

        if (!error) {
          if (!fresh || !fresh.active) {
            setCurrentUser(null);
            return makeRes({ detail: "Tài khoản không tồn tại hoặc đã bị khóa" }, 401);
          }
          const synced = normalizeUserSession(fresh);
          setCurrentUser(synced);
          return makeRes(synced, 200);
        }
      } catch (e) {
        // Fallback sang cache cục bộ khi mất mạng tạm thời
      }
      return makeRes(normalizeUserSession(u), 200);
    }

    if (pathOnly === "/api/auth/login" && method === "POST") {
      const body = parseBody(options);
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

      if (!verifyPassword(pwd, user.password_hash)) {
        return makeRes({ detail: "Sai tên đăng nhập hoặc mật khẩu" }, 401);
      }

      const sessionUser = normalizeUserSession(user);
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
      const body = parseBody(options);
      const newPwd = body.new_password || "";
      if (newPwd.length < 6) {
        return makeRes({ detail: "Mật khẩu mới phải có ít nhất 6 ký tự" }, 400);
      }

      if (body.current_password !== undefined) {
        const { data: userRow } = await sb
          .from("users")
          .select("password_hash")
          .eq("id", u.id)
          .maybeSingle();
        if (userRow && !verifyPassword(body.current_password, userRow.password_hash)) {
          return makeRes({ detail: "Mật khẩu hiện tại không đúng" }, 400);
        }
      }

      const newHash = hashPassword(newPwd);
      const { error } = await sb.from("users").update({
        password_hash: newHash,
        must_change_password: 0
      }).eq("id", u.id);

      if (error) return dbErrorRes(error, "Lỗi đổi mật khẩu");

      u.must_change_password = 0;
      setCurrentUser(u);
      return makeRes({ message: "Đổi mật khẩu thành công" }, 200);
    }

    if (pathOnly === "/api/auth/signature" && method === "PATCH") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const body = parseBody(options);
      const sigData = body.signature_data ? String(body.signature_data) : null;
      const { error } = await sb.from("users").update({ signature_data: sigData }).eq("id", u.id);
      if (error) return dbErrorRes(error, "Lỗi cập nhật chữ ký cá nhân");
      u.signature_data = sigData;
      setCurrentUser(u);
      return makeRes({ status: "success", signature_data: sigData });
    }

    // ==================== 2. PRESETS (NLLT) ====================
    if (pathOnly === "/api/presets" && method === "GET") {
      const { data: rows } = await sb
        .from("presets")
        .select("category, name")
        .eq("active", 1)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

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

    // ==================== 3. NLLT SHIFT STATUS CHECK ====================
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

    // ==================== 4. NLLT PREVIOUS TEMPLATE ====================
    if (pathOnly === "/api/shifts/previous-template" && method === "GET") {
      const { data: prevShift } = await sb
        .from("shifts")
        .select("id, report_date, shift_num, shift_leader")
        .order("report_date", { ascending: false })
        .order("shift_num", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!prevShift) {
        return makeRes({ found: false, packaging: [], baskets: [], tumbling: [] });
      }

      const [pkg, bsk, tmb] = await Promise.all([
        sb.from("packaging_items").select("*").eq("shift_id", prevShift.id).order("id"),
        sb.from("basket_items").select("*").eq("shift_id", prevShift.id).order("id"),
        sb.from("tumbling_items").select("*").eq("shift_id", prevShift.id).order("id")
      ]);

      return makeRes({
        found: true,
        from_shift: `Ca ${prevShift.shift_num} ngày ${prevShift.report_date} (${prevShift.shift_leader})`,
        packaging: (pkg.data || []).map(p => ({ ...p, weight_sorted: null, weight_waste: null })),
        baskets: (bsk.data || []).map(b => ({ ...b, basket_count: null, total_weight: null })),
        tumbling: (tmb.data || []).map(t => ({ ...t, m1: null, m2: null, total_weight: null }))
      });
    }

    // ==================== 5. NLLT SHIFTS GET / POST / DELETE ====================
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
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const body = parseBody(options);
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
        if (u.role !== "admin" && existing.created_by_user_id !== u.id) {
          return makeRes({ detail: "Báo cáo ca này do ca trưởng khác nộp, bạn không có quyền sửa." }, 403);
        }

        await sb.from("shifts").update({
          safety_production: body.safety_production ? 1 : 0,
          safety_ppe: body.safety_ppe ? 1 : 0,
          safety_equip: body.safety_equip ? 1 : 0,
          staff_total: body.staff_total || 5,
          staff_present: body.staff_present !== undefined ? body.staff_present : 5,
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
          updated_by_user_id: u.id
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
          shift_leader: u.full_name || "Ca trưởng",
          safety_production: body.safety_production ? 1 : 0,
          safety_ppe: body.safety_ppe ? 1 : 0,
          safety_equip: body.safety_equip ? 1 : 0,
          staff_total: body.staff_total || 5,
          staff_present: body.staff_present !== undefined ? body.staff_present : 5,
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
          created_by_user_id: u.id,
          updated_by_user_id: u.id
        }]).select().single();

        if (insErr) {
          console.error("Insert shift error:", insErr);
          return makeRes({ detail: "Lỗi lưu báo cáo ca: " + insErr.message }, 500);
        }
        shiftId = ins.id;
      }

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
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      if (u.role !== "admin") return makeRes({ detail: "Chỉ quản trị viên mới có quyền xóa báo cáo" }, 403);
      const reportDate = q.date || q.report_date;
      const shiftNum = parseInt(q.shift_num || "1", 10);
      await sb.from("shifts").delete().eq("report_date", reportDate).eq("shift_num", shiftNum);
      return makeRes({ status: "success", message: `Đã xóa báo cáo Ca ${shiftNum} ngày ${reportDate}` });
    }

    // ==================== 6. NLLT DAILY SUMMARY ====================
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

      const normKey = v => String(v || "").trim().toLowerCase();
      const cleanNote = v => {
        const s = String(v || "").trim();
        if (!s || /^(0|ko|không|khong|-|none|null)$/i.test(s)) return "";
        return s;
      };

      const pkgMap = {};
      (pkgRes.data || []).forEach(p => {
        const k = `${normKey(p.product_name)}|${normKey(p.customer)}`;
        if (!pkgMap[k]) {
          pkgMap[k] = {
            ...p,
            product_name: String(p.product_name || "").trim(),
            customer: String(p.customer || "").trim(),
            weight_sorted: 0,
            weight_waste: 0,
            notes: [],
            _count: 0
          };
        }
        pkgMap[k]._count += 1;
        if (pkgMap[k]._count > 1) {
          pkgMap[k].from_val = "";
          pkgMap[k].to_val = "";
        }
        pkgMap[k].weight_sorted += (Number(p.weight_sorted) || 0);
        pkgMap[k].weight_waste += (Number(p.weight_waste) || 0);
        if (p.notes && String(p.notes).trim()) pkgMap[k].notes.push(String(p.notes).trim());
      });
      const packagingList = Object.values(pkgMap)
        .sort((a, b) => (b.weight_sorted || 0) - (a.weight_sorted || 0))
        .map(({ _count, ...p }) => ({ ...p, notes: p.notes.join("; ") }));

      // Gộp giỏ bi ra sau tôi (tôi dầu) theo Sản phẩm + Khách hàng + Mác thép (giống server.py)
      const bskMap = {};
      (bskRes.data || []).forEach(b => {
        const k = `${normKey(b.product_name)}|${normKey(b.customer)}|${normKey(b.steel_grade)}`;
        if (!bskMap[k]) {
          bskMap[k] = {
            ...b,
            product_name: String(b.product_name || "").trim(),
            customer: String(b.customer || "").trim(),
            steel_grade: String(b.steel_grade || "").trim(),
            basket_count: 0,
            total_weight: 0,
            notes: [],
            _count: 0
          };
        }
        bskMap[k]._count += 1;
        if (bskMap[k]._count > 1) {
          bskMap[k].from_val = "";
          bskMap[k].to_val = "";
        }
        const cnt = Number(b.basket_count) || 0;
        const wt = (b.total_weight !== null && b.total_weight !== undefined) ? Number(b.total_weight) : cnt * 350;
        bskMap[k].basket_count += cnt;
        bskMap[k].total_weight += wt;
        if (b.notes && String(b.notes).trim()) bskMap[k].notes.push(String(b.notes).trim());
      });
      const basketsList = Object.values(bskMap)
        .sort((a, b) => (b.basket_count || 0) - (a.basket_count || 0))
        .map(({ _count, ...b }) => ({ ...b, notes: b.notes.join("; ") }));

      const tmbMap = {};
      (tmbRes.data || []).forEach(t => {
        const noteTrim = cleanNote(t.notes);
        const k = `${normKey(t.product_name)}|${normKey(t.customer)}|${normKey(noteTrim)}`;
        if (!tmbMap[k]) {
          tmbMap[k] = {
            ...t,
            product_name: String(t.product_name || "").trim(),
            customer: String(t.customer || "").trim(),
            m1: 0,
            m2: 0,
            total_weight: 0,
            notes: noteTrim
          };
        }
        tmbMap[k].m1 += (Number(t.m1) || 0);
        tmbMap[k].m2 += (Number(t.m2) || 0);
        tmbMap[k].total_weight += (Number(t.total_weight) || 0);
      });
      const tumblingList = Object.values(tmbMap);

      const issuesList = shifts.filter(s => cleanNote(s.issues)).map(s => `Ca ${s.shift_num}: ${cleanNote(s.issues)}`);
      const suggList = shifts.filter(s => cleanNote(s.suggestions)).map(s => `Ca ${s.shift_num}: ${cleanNote(s.suggestions)}`);

      const totalAbsent = Math.max(0, totalStaff - totalPresent);
      let leaveDetail = "";
      if (leaveRotating > 0) {
        leaveDetail = `${leaveRotating} người nghỉ luân phiên`;
      } else if (totalAbsent > 0) {
        leaveDetail = `${totalAbsent} người nghỉ`;
      }

      const packagingNotes = [];
      shifts.forEach(s => {
        const tasks = (s.shift_tasks || "").trim();
        if (tasks && tasks.toUpperCase() !== "KO") {
          tasks.split("\n").forEach(line => {
            const cleaned = line.trim();
            if (cleaned) packagingNotes.push(cleaned);
          });
        }
      });

      const prodFailedShifts = shifts.filter(s => s.safety_production !== null && s.safety_production !== undefined && !s.safety_production).map(s => s.shift_num);
      const ppeFailedShifts = shifts.filter(s => s.safety_ppe !== null && s.safety_ppe !== undefined && !s.safety_ppe).map(s => s.shift_num);
      const equipFailedShifts = shifts.filter(s => s.safety_equip !== null && s.safety_equip !== undefined && !s.safety_equip).map(s => s.shift_num);

      return makeRes({
        report_date: reportDate,
        submitted_shifts: shifts.map(s => s.shift_num),
        shifts: shifts,
        packaging: packagingList,
        packaging_notes: packagingNotes,
        baskets: basketsList,
        basket_notes: "",
        tumbling: tumblingList,
        issues: issuesList,
        suggestions: suggList.length ? suggList.join("; ") : "KO",
        reporter_name: "Ngọc Quang",
        attendance: {
          total_staff: totalStaff,
          present: totalPresent,
          leave_permitted: leavePermitted,
          leave_notes: leaveNotesList.join("; ") || "Ko",
          leave_rotating: leaveRotating,
          rotating_notes: rotNotesList.join("; ") || "Ko",
          leave_detail: leaveDetail,
          leave_unpermitted: leaveUnpermitted,
          unpermitted: unpNotesList.join("; ") || "Ko"
        },
        safety: {
          production: prodFailedShifts.length === 0 ? 1 : 0,
          ppe: ppeFailedShifts.length === 0 ? 1 : 0,
          equip: equipFailedShifts.length === 0 ? 1 : 0,
          production_failed_shifts: prodFailedShifts,
          ppe_failed_shifts: ppeFailedShifts,
          equip_failed_shifts: equipFailedShifts
        },
        excel_row_limits: { packaging: 4, baskets: 4, tumbling: 6 }
      });
    }

    // ==================== 7. NLLT HISTORY ====================
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

    // ==================== 8. NLLT PERIOD SUMMARY & ANALYTICS ====================
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

    // ==================== 9. NLLT EXCEL EXPORT (ExcelJS + Template chuẩn VICO) ====================
    if (pathOnly === "/api/export-excel" && method === "GET") {
      const reportDate = q.date || q.report_date;
      const sumRes = await handleApiRequest(`/api/daily-summary?date=${encodeURIComponent(reportDate)}`);
      const sumData = await sumRes.json();
      const safeDate = String(reportDate || "").replace(/-/g, "") || "report";

      // Ưu tiên xuất theo biểu mẫu chuẩn template_report.xlsx bằng ExcelJS (đủ logo, chữ ký, định dạng A4)
      if (window.VicoNlltExcel && window.ExcelJS) {
        try {
          const xlsxBuf = await window.VicoNlltExcel.exportSummaryToBuffer(sumData);
          return new Response(xlsxBuf, {
            status: 200,
            statusText: "OK",
            headers: {
              "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Disposition": `attachment; filename="BAO_CAO_TONG_HOP_${safeDate}.xlsx"`
            }
          });
        } catch (excelErr) {
          console.error("VicoNlltExcel export failed, falling back to SheetJS:", excelErr);
        }
      }

      if (window.XLSX) {
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
        const xlsxArray = window.XLSX.write(wb, { bookType: "xlsx", type: "array" });
        return new Response(xlsxArray, {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="BAO_CAO_TONG_HOP_${safeDate}.xlsx"`
          }
        });
      }
      return makeRes({ detail: "Thư viện Excel đang tải, vui lòng thử lại sau 2 giây" }, 500);
    }

    // ==================== 10. SYNC MASTER ====================
    if (pathOnly === "/api/sync-to-master" && method === "POST") {
      return makeRes({
        status: "success",
        message: "Dữ liệu ngày đã được lưu trữ vĩnh viễn trên Cloud Supabase. (Tính năng ghép file gốc .xlsx 3MB yêu cầu chạy trên máy tính xưởng)."
      });
    }

    // ==================== 11. ADMIN USERS CRUD ====================
    if (pathOnly === "/api/admin/users" && method === "GET") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      if (u.role !== "admin") return makeRes({ detail: "Chỉ quản trị viên mới có quyền truy cập" }, 403);

      let { data: users, error } = await sb
        .from("users")
        .select("id, username, full_name, role, active, created_at, must_change_password, workshop, signature_data")
        .order("id");

      if (error && (error.code === "42703" || error.code === "PGRST204" || (error.message && (error.message.includes("workshop") || error.message.includes("signature_data"))))) {
        const fb = await sb
          .from("users")
          .select("id, username, full_name, role, active, created_at, must_change_password")
          .order("id");
        users = (fb.data || []).map(row => ({
          ...row,
          workshop: row.role === "admin" ? "all" : "nllt",
          signature_data: null
        }));
        error = fb.error;
      }

      if (error) return dbErrorRes(error, "Lỗi tải danh sách tài khoản");
      return makeRes((users || []).map(row => ({
        ...row,
        workshop: row.workshop || (row.role === "admin" ? "all" : "nllt"),
        signature_data: row.signature_data || null
      })));
    }

    if (pathOnly === "/api/admin/users" && method === "POST") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      if (u.role !== "admin") return makeRes({ detail: "Chỉ quản trị viên mới có quyền tạo tài khoản" }, 403);

      const body = parseBody(options);
      const username = (body.username || "").trim().toLowerCase();
      const fullName = (body.full_name || "").trim();
      const password = body.password || "";
      const role = body.role === "admin" ? "admin" : "leader";
      const workshop = ["nllt", "duc2", "all"].includes(body.workshop)
        ? body.workshop
        : (role === "admin" ? "all" : "nllt");
      const signatureData = body.signature_data ? String(body.signature_data) : null;

      if (!username || !fullName) {
        return makeRes({ detail: "Tên đăng nhập và họ tên không được để trống" }, 400);
      }
      if (password.length < 6) {
        return makeRes({ detail: "Mật khẩu tạm phải có ít nhất 6 ký tự" }, 400);
      }

      const { data: existingUser } = await sb
        .from("users")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      if (existingUser) {
        return makeRes({ detail: `Tên đăng nhập '${username}' đã tồn tại` }, 409);
      }

      const { data: inserted, error } = await sb.from("users").insert([{
        username,
        password_hash: hashPassword(password),
        full_name: fullName,
        role,
        workshop,
        signature_data: signatureData,
        active: 1,
        must_change_password: 1,
        session_version: 0
      }]).select("id, username, full_name, role, active, created_at, must_change_password, workshop, signature_data").single();

      if (error) {
        if (error.code === "23505") {
          return makeRes({ detail: `Tên đăng nhập '${username}' đã tồn tại` }, 409);
        }
        return dbErrorRes(error, "Lỗi tạo tài khoản");
      }

      return makeRes({ status: "success", id: inserted.id, user: inserted }, 201);
    }

    const adminUserMatch = pathOnly.match(/^\/api\/admin\/users\/(\d+)$/);
    if (adminUserMatch && method === "PATCH") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      if (u.role !== "admin") return makeRes({ detail: "Chỉ quản trị viên mới có quyền cập nhật tài khoản" }, 403);

      const targetId = parseInt(adminUserMatch[1], 10);
      const body = parseBody(options);

      if (body.active === false && targetId === u.id) {
        return makeRes({ detail: "Không thể tự khóa tài khoản đang đăng nhập" }, 400);
      }

      const updates = {};
      if (body.full_name !== undefined) {
        const fn = String(body.full_name).trim();
        if (!fn) return makeRes({ detail: "Họ tên không được để trống" }, 400);
        updates.full_name = fn;
      }
      if (body.role !== undefined && ["admin", "leader"].includes(body.role)) {
        updates.role = body.role;
      }
      if (body.workshop !== undefined && ["nllt", "duc2", "all"].includes(body.workshop)) {
        updates.workshop = body.workshop;
      }
      if (body.active !== undefined) {
        updates.active = body.active ? 1 : 0;
      }
      if (body.password !== undefined) {
        if (String(body.password).length < 6) {
          return makeRes({ detail: "Mật khẩu phải có ít nhất 6 ký tự" }, 400);
        }
        updates.password_hash = hashPassword(String(body.password));
        updates.must_change_password = targetId === u.id ? 0 : 1;
      }
      if (Object.prototype.hasOwnProperty.call(body, "signature_data")) {
        updates.signature_data = body.signature_data ? String(body.signature_data) : null;
      }

      if (Object.keys(updates).length === 0) {
        return makeRes({ status: "success" });
      }

      const { data: updated, error } = await sb
        .from("users")
        .update(updates)
        .eq("id", targetId)
        .select("id, username, full_name, role, active, created_at, must_change_password, workshop, signature_data")
        .maybeSingle();

      if (error) return dbErrorRes(error, "Lỗi cập nhật tài khoản");
      if (!updated) return makeRes({ detail: "Không tìm thấy tài khoản" }, 404);

      if (targetId === u.id) {
        setCurrentUser(normalizeUserSession(updated));
      }

      return makeRes({ status: "success", user: updated });
    }

    // ==================== 12. ADMIN PRESETS CRUD ====================
    if (pathOnly === "/api/admin/presets" && method === "GET") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      if (u.role !== "admin") return makeRes({ detail: "Chỉ quản trị viên mới có quyền truy cập" }, 403);

      const { data: presets, error } = await sb
        .from("presets")
        .select("*")
        .order("category")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });
      if (error) return dbErrorRes(error, "Lỗi tải danh mục");
      return makeRes(presets || []);
    }

    if (pathOnly === "/api/admin/presets" && method === "POST") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      if (u.role !== "admin") return makeRes({ detail: "Chỉ quản trị viên mới có quyền thêm danh mục" }, 403);

      const body = parseBody(options);
      const category = (body.category || "").trim();
      const name = (body.name || "").trim();
      const sortOrder = toIntOr(body.sort_order, 0);
      if (!category || !name) {
        return makeRes({ detail: "Loại danh mục và tên hiển thị không được để trống" }, 400);
      }

      const { data: inserted, error } = await sb
        .from("presets")
        .insert([{ category, name, sort_order: sortOrder, active: 1 }])
        .select()
        .single();
      if (error) {
        if (error.code === "23505") {
          return makeRes({ detail: `Mục '${name}' đã có trong danh mục này.` }, 400);
        }
        return dbErrorRes(error, "Lỗi thêm danh mục");
      }
      return makeRes({ status: "success", id: inserted.id, item: inserted }, 201);
    }

    const adminPresetMatch = pathOnly.match(/^\/api\/admin\/presets\/(\d+)$/);
    if (adminPresetMatch && method === "PATCH") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      if (u.role !== "admin") return makeRes({ detail: "Chỉ quản trị viên mới có quyền sửa danh mục" }, 403);

      const presetId = parseInt(adminPresetMatch[1], 10);
      const body = parseBody(options);
      const updates = {};
      if (body.name !== undefined) {
        const n = String(body.name).trim();
        if (!n) return makeRes({ detail: "Tên không được để trống" }, 400);
        updates.name = n;
      }
      if (body.sort_order !== undefined) updates.sort_order = toIntOr(body.sort_order, 0);
      if (body.active !== undefined) updates.active = body.active ? 1 : 0;

      const { error } = await sb.from("presets").update(updates).eq("id", presetId);
      if (error) {
        if (error.code === "23505") {
          return makeRes({ detail: "Tên này đã tồn tại trong danh mục" }, 400);
        }
        return dbErrorRes(error, "Lỗi cập nhật danh mục");
      }
      return makeRes({ status: "success" });
    }

    if (adminPresetMatch && method === "DELETE") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      if (u.role !== "admin") return makeRes({ detail: "Chỉ quản trị viên mới có quyền xóa danh mục" }, 403);

      const presetId = parseInt(adminPresetMatch[1], 10);
      const { error } = await sb.from("presets").delete().eq("id", presetId);
      if (error) return dbErrorRes(error, "Lỗi xóa danh mục");
      return makeRes({ status: "success" });
    }

    // ==================== 13. PX ĐÚC 2 - PRESETS ====================
    if (pathOnly === "/api/duc2/presets" && method === "GET") {
      const { data: rows } = await sb
        .from("presets")
        .select("category, name")
        .eq("active", 1)
        .in("category", ["duc2_product", "duc2_customer", "duc2_steel_grade", "duc2_furnace"])
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      const products = (rows || []).filter(r => r.category === "duc2_product").map(r => r.name);
      const customers = (rows || []).filter(r => r.category === "duc2_customer").map(r => r.name);
      const steel_grades = (rows || []).filter(r => r.category === "duc2_steel_grade").map(r => r.name);
      const furnaces = (rows || []).filter(r => r.category === "duc2_furnace").map(r => r.name);

      return makeRes({
        products: products.length ? products : ["Bi 40", "Bi 60", "Bi 80", "Bi 25"],
        customers: customers.length ? customers : ["Molycop", "VICO", "Nhập TQ"],
        steel_grades: steel_grades.length ? steel_grades : ["Cr18-19.5", "Cr18", "Cr20"],
        furnaces: furnaces.length ? furnaces : ["2.2", "3", "4", "5"],
        shift_hours: {
          1: { start: "6h00'", end: "14h00'" },
          2: { start: "14h00'", end: "22h00'" },
          3: { start: "22h00'", end: "6h00'" }
        }
      });
    }

    // ==================== 14. PX ĐÚC 2 - CURRENT SHIFT & CARRYOVER ====================
    if (pathOnly === "/api/duc2/shifts/current" && method === "GET") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const reportDate = q.date || q.report_date;
      const shiftNum = parseInt(q.shift_num || "1", 10);

      const { data: s, error } = await sb
        .from("duc2_shifts")
        .select("*")
        .eq("report_date", reportDate)
        .eq("shift_num", shiftNum)
        .maybeSingle();

      if (error) return dbErrorRes(error, "Lỗi kiểm tra ca PX Đúc 2");
      if (!s) return makeRes({ exists: false });

      const full = await loadFullDuc2Shift(s);
      return makeRes({
        exists: true,
        can_edit: canEditDuc2Shift(u, s),
        effective_signature: full.effective_signature,
        shift_data: full
      });
    }

    if (pathOnly === "/api/duc2/shifts/carryover" && method === "GET") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const reportDate = q.date || q.report_date || "";
      const shiftNum = parseInt(q.shift_num || "1", 10);

      let prev = null;
      if (reportDate) {
        const { data: prior, error } = await sb
          .from("duc2_shifts")
          .select("*")
          .or(`report_date.lt.${reportDate},and(report_date.eq.${reportDate},shift_num.lt.${shiftNum})`)
          .order("report_date", { ascending: false })
          .order("shift_num", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) return dbErrorRes(error, "Lỗi lấy dữ liệu kế thừa ca trước");
        prev = prior;
      }

      if (!prev) {
        const { data: latest, error } = await sb
          .from("duc2_shifts")
          .select("*")
          .order("report_date", { ascending: false })
          .order("shift_num", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) return dbErrorRes(error, "Lỗi lấy dữ liệu kế thừa ca trước");
        prev = latest;
      }

      if (!prev) {
        return makeRes({
          found: false,
          stopper_remaining: 0,
          nozzle_remaining: 0,
          staff_total: 16,
          default_product: "Bi 40",
          default_customer: "Molycop",
          default_steel_grade: "Cr18-19.5",
          furnace_life_map: {}
        });
      }

      const { data: meltRows } = await sb
        .from("duc2_melting_furnaces")
        .select("furnace_code, lining_life")
        .eq("shift_id", prev.id);

      const furnaceLifeMap = {};
      (meltRows || []).forEach(m => {
        if (m.furnace_code) {
          furnaceLifeMap[m.furnace_code] = Number(m.lining_life) || 0;
        }
      });

      return makeRes({
        found: true,
        from_shift: `Ca ${prev.shift_num} ngày ${prev.report_date}`,
        stopper_remaining: Number(prev.stopper_remaining) || 0,
        nozzle_remaining: Number(prev.nozzle_remaining) || 0,
        staff_total: Number(prev.staff_total) || 16,
        default_product: prev.default_product || "Bi 40",
        default_customer: prev.default_customer || "Molycop",
        default_steel_grade: prev.default_steel_grade || "Cr18-19.5",
        furnace_life_map: furnaceLifeMap
      });
    }

    // ==================== 15. PX ĐÚC 2 - OPEN SHIFT ====================
    if (pathOnly === "/api/duc2/shifts/open" && method === "POST") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const body = parseBody(options);
      const reportDate = body.report_date;
      const shiftNum = parseInt(body.shift_num || "1", 10);

      if (!reportDate || ![1, 2, 3].includes(shiftNum)) {
        return makeRes({ detail: "Ngày báo cáo hoặc ca làm việc không hợp lệ" }, 400);
      }

      const { data: existing, error: existErr } = await sb
        .from("duc2_shifts")
        .select("*")
        .eq("report_date", reportDate)
        .eq("shift_num", shiftNum)
        .maybeSingle();

      if (existErr) return dbErrorRes(existErr, "Lỗi kiểm tra ca PX Đúc 2");
      if (existing) {
        const full = await loadFullDuc2Shift(existing);
        return makeRes({
          status: "existing",
          already_exists: true,
          can_edit: canEditDuc2Shift(u, existing),
          shift_data: full
        });
      }

      const nowIso = isoNow();
      const stopperStart = toIntOr(body.stopper_start, 0);
      const stopperAdded = toIntOr(body.stopper_added, 0);
      const stopperUsed = toIntOr(body.stopper_used, 0);
      const stopperRemaining = body.stopper_remaining !== undefined
        ? toIntOr(body.stopper_remaining, 0)
        : Math.max(0, stopperStart + stopperAdded - stopperUsed);

      const nozzleStart = toIntOr(body.nozzle_start, 0);
      const nozzleAdded = toIntOr(body.nozzle_added, 0);
      const nozzleUsed = toIntOr(body.nozzle_used, 0);
      const nozzleRemaining = body.nozzle_remaining !== undefined
        ? toIntOr(body.nozzle_remaining, 0)
        : Math.max(0, nozzleStart + nozzleAdded - nozzleUsed);

      const staffTotal = toIntOr(body.staff_total, 16);
      const staffPresent = body.staff_present !== undefined ? toIntOr(body.staff_present, staffTotal) : staffTotal;

      const { data: inserted, error: insErr } = await sb.from("duc2_shifts").insert([{
        report_date: reportDate,
        shift_num: shiftNum,
        status: "in_progress",
        doc_code: body.doc_code || "",
        doc_number: body.doc_number || "",
        shift_leader: u.full_name || "Trưởng ca",
        leader_signature: u.signature_data || null,
        safety_production: body.safety_production === false ? 0 : 1,
        safety_ppe: body.safety_ppe === false ? 0 : 1,
        safety_equip: body.safety_equip === false ? 0 : 1,
        staff_total: staffTotal,
        staff_present: staffPresent,
        leave_permitted_names: body.leave_permitted_names || "",
        leave_unpermitted_names: body.leave_unpermitted_names !== undefined ? body.leave_unpermitted_names : "KO",
        stopper_start: stopperStart,
        stopper_added: stopperAdded,
        stopper_used: stopperUsed,
        stopper_remaining: stopperRemaining,
        nozzle_start: nozzleStart,
        nozzle_added: nozzleAdded,
        nozzle_used: nozzleUsed,
        nozzle_remaining: nozzleRemaining,
        default_product: body.default_product || "Bi 40",
        default_customer: body.default_customer || "Molycop",
        default_steel_grade: body.default_steel_grade || "Cr18-19.5",
        issues: body.issues || "",
        suggestions: body.suggestions || "",
        start_time: body.start_time || "",
        end_time: body.end_time || "",
        created_by_user_id: u.id,
        updated_by_user_id: u.id,
        updated_at: nowIso
      }]).select().single();

      if (insErr) return dbErrorRes(insErr, "Lỗi mở ca PX Đúc 2");

      if (Array.isArray(body.molding) && body.molding.length > 0) {
        const mItems = body.molding.map((m, idx) => ({
          shift_id: inserted.id,
          sort_order: idx,
          product_name: m.product_name || "",
          customer: m.customer || "",
          start_time: m.start_time || "",
          end_time: m.end_time || "",
          time_range: m.time_range || "",
          counter_start: toNullableInt(m.counter_start),
          counter_end: toNullableInt(m.counter_end),
          molds_created: toNullableInt(m.molds_created),
          molds_poured: toNullableInt(m.molds_poured),
          notes: m.notes || ""
        }));
        await sb.from("duc2_molding_items").insert(mItems);
      }

      if (Array.isArray(body.melting) && body.melting.length > 0) {
        const fItems = body.melting.map((f, idx) => ({
          shift_id: inserted.id,
          sort_order: idx,
          product_name: f.product_name || "",
          customer: f.customer || "",
          steel_grade: f.steel_grade || "",
          furnace_code: String(f.furnace_code || "").trim(),
          heat_count: toIntOr(f.heat_count, 0),
          prev_lining_life: toIntOr(f.prev_lining_life, 0),
          lining_life: toIntOr(f.lining_life, 0),
          manual_heat_override: f.manual_heat_override ? 1 : 0,
          manual_life_override: f.manual_life_override ? 1 : 0,
          notes: f.notes || ""
        })).filter(f => f.furnace_code);
        if (fItems.length) await sb.from("duc2_melting_furnaces").insert(fItems);
      }

      const full = await loadFullDuc2Shift(inserted);
      return makeRes({
        status: "success",
        can_edit: true,
        shift_data: full
      }, 201);
    }

    // ==================== 16. PX ĐÚC 2 - LIST SHIFTS ====================
    if (pathOnly === "/api/duc2/shifts/list" && method === "GET") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);

      const limit = Math.min(200, Math.max(1, toIntOr(q.limit, 60)));
      let query = sb
        .from("duc2_shifts")
        .select("*")
        .order("report_date", { ascending: false })
        .order("shift_num", { ascending: false })
        .limit(limit);

      if (q.status && ["in_progress", "submitted"].includes(q.status)) {
        query = query.eq("status", q.status);
      }
      if (q.from_date) {
        query = query.gte("report_date", q.from_date);
      }
      if (q.to_date) {
        query = query.lte("report_date", q.to_date);
      }

      const { data: shifts, error } = await query;
      if (error) return dbErrorRes(error, "Lỗi tải danh sách ca PX Đúc 2");
      if (!shifts || shifts.length === 0) return makeRes([]);

      const shiftIds = shifts.map(s => s.id);
      const [mldRes, pourRes, meltRes] = await Promise.all([
        sb.from("duc2_molding_items").select("shift_id, molds_created, molds_poured").in("shift_id", shiftIds),
        sb.from("duc2_pouring_batches").select("shift_id, status").in("shift_id", shiftIds),
        sb.from("duc2_melting_furnaces").select("shift_id, heat_count").in("shift_id", shiftIds)
      ]);

      const stats = {};
      shiftIds.forEach(id => {
        stats[id] = { pouring_count: 0, pouring_active: 0, molds_created_total: 0, molds_poured_total: 0, melting_heats_total: 0 };
      });

      (mldRes.data || []).forEach(m => {
        const st = stats[m.shift_id];
        if (!st) return;
        st.molds_created_total += Number(m.molds_created) || 0;
        st.molds_poured_total += Number(m.molds_poured) || 0;
      });
      (pourRes.data || []).forEach(p => {
        const st = stats[p.shift_id];
        if (!st) return;
        st.pouring_count += 1;
        if (p.status === "pouring") st.pouring_active += 1;
      });
      (meltRes.data || []).forEach(f => {
        const st = stats[f.shift_id];
        if (!st) return;
        st.melting_heats_total += Number(f.heat_count) || 0;
      });

      const result = shifts.map(s => {
        const st = stats[s.id] || {};
        const issueLines = String(s.issues || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        return {
          ...s,
          ...st,
          issues_count: issueLines.length
        };
      });

      return makeRes(result);
    }

    // ==================== 17. PX ĐÚC 2 - SHIFT ITEM ROUTES ====================
    const duc2MoldingMatch = pathOnly.match(/^\/api\/duc2\/shifts\/(\d+)\/molding$/);
    if (duc2MoldingMatch && method === "PUT") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const shiftId = parseInt(duc2MoldingMatch[1], 10);

      const { data: shiftRow, error: sErr } = await sb.from("duc2_shifts").select("*").eq("id", shiftId).maybeSingle();
      if (sErr) return dbErrorRes(sErr, "Lỗi kiểm tra ca");
      if (!shiftRow) return makeRes({ detail: "Không tìm thấy ca làm việc" }, 404);
      if (!canEditDuc2Shift(u, shiftRow)) return makeRes({ detail: "Bạn không có quyền sửa ca này" }, 403);

      const body = parseBody(options);
      const items = Array.isArray(body.items) ? body.items : (Array.isArray(body) ? body : []);

      await sb.from("duc2_molding_items").delete().eq("shift_id", shiftId);

      let inserted = [];
      if (items.length > 0) {
        const rows = items.map((m, idx) => ({
          shift_id: shiftId,
          sort_order: idx,
          product_name: m.product_name || "",
          customer: m.customer || "",
          start_time: m.start_time || "",
          end_time: m.end_time || "",
          time_range: m.time_range || "",
          counter_start: toNullableInt(m.counter_start),
          counter_end: toNullableInt(m.counter_end),
          molds_created: toNullableInt(m.molds_created),
          molds_poured: toNullableInt(m.molds_poured),
          notes: m.notes || ""
        }));
        const { data: ins, error: iErr } = await sb.from("duc2_molding_items").insert(rows).select();
        if (iErr) return dbErrorRes(iErr, "Lỗi lưu khuôn tạo hình");
        inserted = ins || [];
      }

      await sb.from("duc2_shifts").update({ updated_at: isoNow(), updated_by_user_id: u.id }).eq("id", shiftId);
      return makeRes({ status: "success", items: inserted });
    }

    const duc2MeltingMatch = pathOnly.match(/^\/api\/duc2\/shifts\/(\d+)\/melting$/);
    if (duc2MeltingMatch && method === "PUT") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const shiftId = parseInt(duc2MeltingMatch[1], 10);

      const { data: shiftRow, error: sErr } = await sb.from("duc2_shifts").select("*").eq("id", shiftId).maybeSingle();
      if (sErr) return dbErrorRes(sErr, "Lỗi kiểm tra ca");
      if (!shiftRow) return makeRes({ detail: "Không tìm thấy ca làm việc" }, 404);
      if (!canEditDuc2Shift(u, shiftRow)) return makeRes({ detail: "Bạn không có quyền sửa ca này" }, 403);

      const body = parseBody(options);
      const items = Array.isArray(body.items) ? body.items : (Array.isArray(body) ? body : []);

      await sb.from("duc2_melting_furnaces").delete().eq("shift_id", shiftId);

      let inserted = [];
      const rows = items.map((f, idx) => ({
        shift_id: shiftId,
        sort_order: idx,
        product_name: f.product_name || "",
        customer: f.customer || "",
        steel_grade: f.steel_grade || "",
        furnace_code: String(f.furnace_code || "").trim(),
        heat_count: toIntOr(f.heat_count, 0),
        prev_lining_life: toIntOr(f.prev_lining_life, 0),
        lining_life: toIntOr(f.lining_life, 0),
        manual_heat_override: f.manual_heat_override ? 1 : 0,
        manual_life_override: f.manual_life_override ? 1 : 0,
        notes: f.notes || ""
      })).filter(r => r.furnace_code);

      if (rows.length > 0) {
        const { data: ins, error: iErr } = await sb.from("duc2_melting_furnaces").insert(rows).select();
        if (iErr) return dbErrorRes(iErr, "Lỗi lưu lò nấu");
        inserted = ins || [];
      }

      await sb.from("duc2_shifts").update({ updated_at: isoNow(), updated_by_user_id: u.id }).eq("id", shiftId);
      return makeRes({ status: "success", items: inserted });
    }

    const duc2PouringPostMatch = pathOnly.match(/^\/api\/duc2\/shifts\/(\d+)\/pouring$/);
    if (duc2PouringPostMatch && method === "POST") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const shiftId = parseInt(duc2PouringPostMatch[1], 10);

      const { data: shiftRow, error: sErr } = await sb.from("duc2_shifts").select("*").eq("id", shiftId).maybeSingle();
      if (sErr) return dbErrorRes(sErr, "Lỗi kiểm tra ca");
      if (!shiftRow) return makeRes({ detail: "Không tìm thấy ca làm việc" }, 404);
      if (!canEditDuc2Shift(u, shiftRow)) return makeRes({ detail: "Bạn không có quyền sửa ca này" }, 403);

      const body = parseBody(options);
      let batchNo = toNullableInt(body.batch_no);
      if (batchNo === null) {
        const { data: lastBatch } = await sb
          .from("duc2_pouring_batches")
          .select("batch_no")
          .eq("shift_id", shiftId)
          .order("batch_no", { ascending: false })
          .limit(1)
          .maybeSingle();
        batchNo = (lastBatch && lastBatch.batch_no ? lastBatch.batch_no : 0) + 1;
      }

      const { data: inserted, error: iErr } = await sb
        .from("duc2_pouring_batches")
        .insert([{
          shift_id: shiftId,
          batch_no: batchNo,
          product_name: body.product_name || shiftRow.default_product || "",
          customer: body.customer || shiftRow.default_customer || "",
          temp_max: toNullableInt(body.temp_max),
          temp_min: toNullableInt(body.temp_min),
          start_time: body.start_time || "",
          end_time: body.end_time || "",
          furnace_code: body.furnace_code || "",
          heat_no: toNullableInt(body.heat_no),
          furnace_heat_label: body.furnace_heat_label || "",
          status: body.status === "pouring" ? "pouring" : "done",
          notes: body.notes || ""
        }])
        .select()
        .single();

      if (iErr) return dbErrorRes(iErr, "Lỗi thêm lù rót");
      await sb.from("duc2_shifts").update({ updated_at: isoNow(), updated_by_user_id: u.id }).eq("id", shiftId);
      return makeRes({ status: "success", batch: inserted }, 201);
    }

    const duc2PouringItemMatch = pathOnly.match(/^\/api\/duc2\/shifts\/(\d+)\/pouring\/(\d+)$/);
    if (duc2PouringItemMatch && method === "PATCH") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const shiftId = parseInt(duc2PouringItemMatch[1], 10);
      const batchId = parseInt(duc2PouringItemMatch[2], 10);

      const { data: shiftRow, error: sErr } = await sb.from("duc2_shifts").select("*").eq("id", shiftId).maybeSingle();
      if (sErr) return dbErrorRes(sErr, "Lỗi kiểm tra ca");
      if (!shiftRow) return makeRes({ detail: "Không tìm thấy ca làm việc" }, 404);
      if (!canEditDuc2Shift(u, shiftRow)) return makeRes({ detail: "Bạn không có quyền sửa ca này" }, 403);

      const body = parseBody(options);
      const updates = {};
      if (body.batch_no !== undefined) updates.batch_no = toIntOr(body.batch_no, 1);
      if (body.product_name !== undefined) updates.product_name = body.product_name || "";
      if (body.customer !== undefined) updates.customer = body.customer || "";
      if (body.temp_max !== undefined) updates.temp_max = toNullableInt(body.temp_max);
      if (body.temp_min !== undefined) updates.temp_min = toNullableInt(body.temp_min);
      if (body.start_time !== undefined) updates.start_time = body.start_time || "";
      if (body.end_time !== undefined) updates.end_time = body.end_time || "";
      if (body.furnace_code !== undefined) updates.furnace_code = body.furnace_code || "";
      if (body.heat_no !== undefined) updates.heat_no = toNullableInt(body.heat_no);
      if (body.furnace_heat_label !== undefined) updates.furnace_heat_label = body.furnace_heat_label || "";
      if (body.status !== undefined) updates.status = body.status === "pouring" ? "pouring" : "done";
      if (body.notes !== undefined) updates.notes = body.notes || "";

      const { data: updated, error: uErr } = await sb
        .from("duc2_pouring_batches")
        .update(updates)
        .eq("id", batchId)
        .eq("shift_id", shiftId)
        .select()
        .maybeSingle();

      if (uErr) return dbErrorRes(uErr, "Lỗi cập nhật lù rót");
      if (!updated) return makeRes({ detail: "Không tìm thấy lù rót" }, 404);

      await sb.from("duc2_shifts").update({ updated_at: isoNow(), updated_by_user_id: u.id }).eq("id", shiftId);
      return makeRes({ status: "success", batch: updated });
    }

    if (duc2PouringItemMatch && method === "DELETE") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const shiftId = parseInt(duc2PouringItemMatch[1], 10);
      const batchId = parseInt(duc2PouringItemMatch[2], 10);

      const { data: shiftRow, error: sErr } = await sb.from("duc2_shifts").select("*").eq("id", shiftId).maybeSingle();
      if (sErr) return dbErrorRes(sErr, "Lỗi kiểm tra ca");
      if (!shiftRow) return makeRes({ detail: "Không tìm thấy ca làm việc" }, 404);
      if (!canEditDuc2Shift(u, shiftRow)) return makeRes({ detail: "Bạn không có quyền sửa ca này" }, 403);

      const { error: dErr } = await sb
        .from("duc2_pouring_batches")
        .delete()
        .eq("id", batchId)
        .eq("shift_id", shiftId);
      if (dErr) return dbErrorRes(dErr, "Lỗi xóa lù rót");

      const { data: remaining } = await sb
        .from("duc2_pouring_batches")
        .select("*")
        .eq("shift_id", shiftId)
        .order("batch_no", { ascending: true })
        .order("id", { ascending: true });

      const renumbered = [];
      for (let i = 0; i < (remaining || []).length; i++) {
        const row = remaining[i];
        const targetNo = i + 1;
        if (row.batch_no !== targetNo) {
          await sb.from("duc2_pouring_batches").update({ batch_no: targetNo }).eq("id", row.id);
          row.batch_no = targetNo;
        }
        renumbered.push(row);
      }

      await sb.from("duc2_shifts").update({ updated_at: isoNow(), updated_by_user_id: u.id }).eq("id", shiftId);
      return makeRes({ status: "success", batches: renumbered });
    }

    const duc2SubmitMatch = pathOnly.match(/^\/api\/duc2\/shifts\/(\d+)\/submit$/);
    if (duc2SubmitMatch && method === "POST") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const shiftId = parseInt(duc2SubmitMatch[1], 10);

      const { data: shiftRow, error: sErr } = await sb.from("duc2_shifts").select("*").eq("id", shiftId).maybeSingle();
      if (sErr) return dbErrorRes(sErr, "Lỗi kiểm tra ca");
      if (!shiftRow) return makeRes({ detail: "Không tìm thấy ca làm việc" }, 404);
      if (!canEditDuc2Shift(u, shiftRow)) return makeRes({ detail: "Bạn không có quyền chốt ca này" }, 403);

      let sig = shiftRow.leader_signature || null;
      if (!sig && shiftRow.created_by_user_id) {
        sig = await resolveUserSignature(shiftRow.created_by_user_id);
      }
      if (!sig && (!shiftRow.created_by_user_id || shiftRow.created_by_user_id === u.id)) {
        sig = u.signature_data || null;
      }

      const nowIso = isoNow();
      const { data: updated, error: uErr } = await sb
        .from("duc2_shifts")
        .update({
          status: "submitted",
          submitted_at: nowIso,
          updated_at: nowIso,
          updated_by_user_id: u.id,
          leader_signature: sig
        })
        .eq("id", shiftId)
        .select()
        .single();

      if (uErr) return dbErrorRes(uErr, "Lỗi chốt báo cáo ca");
      const full = await loadFullDuc2Shift(updated);
      return makeRes({ status: "success", shift_data: full });
    }

    const duc2ReopenMatch = pathOnly.match(/^\/api\/duc2\/shifts\/(\d+)\/reopen$/);
    if (duc2ReopenMatch && method === "POST") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const shiftId = parseInt(duc2ReopenMatch[1], 10);

      const { data: shiftRow, error: sErr } = await sb.from("duc2_shifts").select("*").eq("id", shiftId).maybeSingle();
      if (sErr) return dbErrorRes(sErr, "Lỗi kiểm tra ca");
      if (!shiftRow) return makeRes({ detail: "Không tìm thấy ca làm việc" }, 404);
      if (!canEditDuc2Shift(u, shiftRow)) return makeRes({ detail: "Bạn không có quyền mở lại ca này" }, 403);

      const { data: updated, error: uErr } = await sb
        .from("duc2_shifts")
        .update({ status: "in_progress", updated_at: isoNow(), updated_by_user_id: u.id })
        .eq("id", shiftId)
        .select()
        .single();
      if (uErr) return dbErrorRes(uErr, "Lỗi mở sửa lại ca");
      const full = await loadFullDuc2Shift(updated);
      return makeRes({ status: "success", shift_data: full });
    }

    const duc2ShiftIdMatch = pathOnly.match(/^\/api\/duc2\/shifts\/(\d+)$/);
    if (duc2ShiftIdMatch && method === "GET") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const shiftId = parseInt(duc2ShiftIdMatch[1], 10);

      const { data: shiftRow, error: sErr } = await sb.from("duc2_shifts").select("*").eq("id", shiftId).maybeSingle();
      if (sErr) return dbErrorRes(sErr, "Lỗi tải báo cáo ca PX Đúc 2");
      if (!shiftRow) return makeRes({ detail: "Không tìm thấy ca làm việc" }, 404);

      const full = await loadFullDuc2Shift(shiftRow);
      return makeRes(full);
    }

    if (duc2ShiftIdMatch && method === "PATCH") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      const shiftId = parseInt(duc2ShiftIdMatch[1], 10);

      const { data: shiftRow, error: sErr } = await sb.from("duc2_shifts").select("*").eq("id", shiftId).maybeSingle();
      if (sErr) return dbErrorRes(sErr, "Lỗi kiểm tra ca");
      if (!shiftRow) return makeRes({ detail: "Không tìm thấy ca làm việc" }, 404);
      if (!canEditDuc2Shift(u, shiftRow)) return makeRes({ detail: "Bạn không có quyền sửa ca này" }, 403);

      const body = parseBody(options);
      const updates = {
        updated_at: isoNow(),
        updated_by_user_id: u.id
      };

      const strFields = [
        "doc_code", "doc_number", "leave_permitted_names", "leave_unpermitted_names",
        "default_product", "default_customer", "default_steel_grade",
        "issues", "suggestions", "start_time", "end_time"
      ];
      strFields.forEach(k => {
        if (body[k] !== undefined) updates[k] = body[k] === null ? "" : String(body[k]);
      });

      const boolIntFields = ["safety_production", "safety_ppe", "safety_equip"];
      boolIntFields.forEach(k => {
        if (body[k] !== undefined) updates[k] = body[k] ? 1 : 0;
      });

      const intFields = [
        "staff_total", "staff_present",
        "stopper_start", "stopper_added", "stopper_used", "stopper_remaining",
        "nozzle_start", "nozzle_added", "nozzle_used", "nozzle_remaining"
      ];
      intFields.forEach(k => {
        if (body[k] !== undefined) updates[k] = toIntOr(body[k], 0);
      });

      const { data: updated, error: uErr } = await sb
        .from("duc2_shifts")
        .update(updates)
        .eq("id", shiftId)
        .select()
        .single();

      if (uErr) return dbErrorRes(uErr, "Lỗi cập nhật thông tin ca PX Đúc 2");
      return makeRes({ status: "success", shift: updated });
    }

    if (duc2ShiftIdMatch && method === "DELETE") {
      const u = getCurrentUser();
      if (!u) return makeRes({ detail: "Chưa đăng nhập" }, 401);
      if (u.role !== "admin") return makeRes({ detail: "Chỉ quản trị viên mới có quyền xóa ca" }, 403);
      const shiftId = parseInt(duc2ShiftIdMatch[1], 10);

      const { error } = await sb.from("duc2_shifts").delete().eq("id", shiftId);
      if (error) return dbErrorRes(error, "Lỗi xóa ca PX Đúc 2");
      return makeRes({ status: "success", message: "Đã xóa ca báo cáo PX Đúc 2" });
    }

    // Fallback 404
    return makeRes({ detail: `Endpoint ${pathOnly} chưa được hỗ trợ trên Supabase Client` }, 404);
  }

  const originalFetch = window.fetch;
  window.fetch = async function (resource, options) {
    const url = typeof resource === "string" ? resource : (resource && resource.url ? resource.url : "");
    if (url.startsWith("/api/") || url.startsWith("api/")) {
      return await handleApiRequest(url, options);
    }
    return originalFetch.apply(this, arguments);
  };

  console.log("✓ VICO Supabase Adapter (PX NLLT + PX ĐÚC 2) đã sẵn sàng!");
})();
