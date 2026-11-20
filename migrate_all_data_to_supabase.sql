-- ====================================================================
-- DONG BO TOAN BO DU LIEU CU TU MAY TINH LEN SUPABASE
-- ====================================================================

-- 0. Dam bao cac cot can thiet ton tai
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS updated_by_user_id BIGINT;

-- Du lieu bang users (5 dong)
INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, must_change_password, session_version) VALUES
(1, 'trong', '$2b$12$vNaPctYjonqV6nV5XWW4n.BKlM6x1S4QVUQ0MOJFg3aBhCVunorgi', 'Trọng', 'leader', 1, '2026-09-17 10:22:52', 0, 9),
(2, 'hai', '$2b$12$XovnY/XleiKWkdUJGAqbY.rt5GCAW0.NEpKnd0RblZRvLrcxRRIzW', 'Hải', 'leader', 1, '2026-09-17 10:22:53', 0, 14),
(3, 'tan', '$2b$12$a/oPLmEpKsIjp/cGOWWY8uTjFgmIMywEDQra9HoQ3TdQTJOG9vGrK', 'Tân', 'leader', 0, '2026-09-17 10:22:53', 0, 7),
(4, 'admin', '$2b$12$0/0FvltGq.hlwljMYe4e8.Yw8fKQXv16PfaGI3zdbPiFm4l5EmVWa', 'Quản trị viên', 'admin', 1, '2026-09-17 10:00:00', 0, 3),
(5, 'canh', '$2b$12$9ZvFifmYylPMTiGmFflSr.NBi54wYH2ZbB1UvJOL5rxfpoiVWI.OG', 'Cảnh', 'leader', 1, '2026-10-14 09:32:12', 0, 4)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1));

-- Du lieu bang presets (12 dong)
INSERT INTO presets (id, category, name, sort_order, active, created_at) VALUES
(1, 'product', 'D25', 1, 1, '2026-09-21 15:09:45'),
(2, 'product', 'D40', 2, 1, '2026-09-21 15:09:45'),
(3, 'product', 'D60', 3, 1, '2026-09-21 15:09:45'),
(4, 'product', 'D80', 4, 1, '2026-09-21 15:09:45'),
(5, 'customer', 'Molycop', 1, 1, '2026-09-21 15:09:45'),
(6, 'customer', 'Nhập TQ', 2, 1, '2026-09-21 15:09:45'),
(7, 'customer', 'Khô dầu', 3, 1, '2026-09-21 15:09:45'),
(8, 'customer', 'VICO', 4, 1, '2026-09-21 15:09:45'),
(9, 'steel_grade', 'CR18', 1, 1, '2026-09-21 15:09:45'),
(10, 'steel_grade', '18', 2, 1, '2026-09-21 15:09:45'),
(11, 'steel_grade', 'CR20', 3, 1, '2026-09-21 15:09:45'),
(12, 'steel_grade', 'B2', 4, 1, '2026-09-21 15:09:45')
ON CONFLICT (category, name) DO NOTHING;
SELECT setval(pg_get_serial_sequence('presets', 'id'), COALESCE((SELECT MAX(id) FROM presets), 1));

-- Du lieu bang shifts (37 dong)
INSERT INTO shifts (id, report_date, shift_num, shift_leader, safety_ppe, safety_equip, staff_total, staff_present, leave_permitted, leave_permitted_names, leave_unpermitted, leave_unpermitted_names, issues, suggestions, start_time, end_time, created_at, created_by_user_id, updated_by_user_id, updated_at, safety_production, leave_rotating, leave_rotating_names, shift_tasks) VALUES
(1, '2026-09-14', 1, 'Trọng', 1, 1, 5, 5, 0, '', 0, '', 'Đứt dây maiso vùng 7 (8h - 14h)', 'KO', '6h', '14h', '2026-09-17 08:24:50', 1, 1, NULL, 1, 0, NULL, NULL),
(2, '2026-09-14', 2, 'Hải', 1, 1, 5, 3, 2, 'Hợi, Đồng (nghỉ phép)', 0, '', 'Cầu 2 tây kêu to (15h50 - 19h)
Máy xóc 1 bay tấm lót (16h20 - hết ca)', 'KO', '14h', '22h', '2026-09-17 08:24:59', 2, 2, NULL, 1, 0, NULL, NULL),
(3, '2026-09-13', 2, 'Hải', 1, 1, 5, 5, 0, '', 0, '', 'Lỗi cảm biến sàng tôi (19h10 - 21h15'')', 'KO', '14h', '22h', '2026-09-17 08:27:58', 2, 2, NULL, 1, 0, NULL, NULL),
(4, '2026-09-13', 3, 'Tân', 1, 1, 5, 5, 0, '', 0, '', 'KO', 'KO', '22h', '6h', '2026-09-17 08:27:59', 3, 3, NULL, 1, 0, NULL, NULL),
(5, '2026-09-15', 3, 'Tân', 1, 1, 5, 3, 2, 'Chung, Tuyên (nghỉ luân phiên)', 0, '', 'Máy xóc 2 làm việc lúc 22h30''', 'KO', '22h', '6h', '2026-09-17 08:27:59', 3, 3, NULL, 1, 0, NULL, NULL),
(6, '2026-09-28', 2, 'Hải', 1, 0, 5, 3, 2, 'Hợi, Đồng (nghỉ phép)', 0, '', 'Cầu 2 tây kêu to (15h50 - 19h)
Máy xóc 1 bay tấm lót (16h20 - hết ca)', 'KO', '14h', '22h', '2026-09-17 13:35:33', 2, 2, NULL, 1, 0, NULL, NULL),
(7, '2026-09-17', 1, 'Quản trị viên', 1, 1, 5, 5, 0, '', 0, '', 'fasdfs', 'avsdv', '6h', '14h', '2026-09-17 14:54:42', 4, 4, NULL, 1, 0, NULL, NULL),
(8, '2026-09-12', 2, 'Hải', 1, 1, 5, 3, 2, 'Hợi, Đông', 0, '', '- Cẩu 2 tây kêu to (15h50-19h)
- Máy xóc 1 bung tấm lót (16h20-hết ca)', '', '14h', '22h', '2026-09-18 08:07:00', 2, 2, NULL, 1, 0, NULL, NULL),
(9, '2026-09-12', 3, 'Tân', 1, 1, 5, 5, 0, '', 0, '', '', '', '22h', '6h', '2026-09-18 08:22:25', 3, 3, '2026-09-18 09:21:09', 1, 0, NULL, NULL),
(10, '2026-09-18', 1, 'Hải', 1, 1, 5, 5, 0, '', 0, '', 'dùng lò từ 10h15-11h30', '', '6h', '14h', '2026-09-18 09:14:46', 2, 2, '2026-09-18 09:16:33', 1, 0, NULL, NULL),
(11, '2026-09-12', 1, 'Hải', 1, 1, 5, 5, 0, '', 0, '', '', '', '6h', '14h', '2026-09-18 09:16:57', 2, 2, NULL, 1, 0, NULL, NULL),
(12, '2026-09-01', 1, 'Trọng', 1, 1, 5, 5, 0, '', 0, '', 'dừng lò 10h15-11h30', '', '6h', '14h', '2026-09-18 09:26:31', 1, 1, '2026-09-18 09:27:03', 1, 0, NULL, NULL),
(13, '2026-09-01', 2, 'Hải', 1, 1, 5, 5, 0, '', 0, '', 'lỗi cảm biến sàng tôi dầu 19h10-21h15', '', '14h', '22h', '2026-09-18 09:47:40', 2, 2, NULL, 1, 0, NULL, NULL),
(14, '2026-09-01', 3, 'Tân', 1, 1, 5, 5, 0, '', 0, '', '', '', '22h', '6h', '2026-09-18 09:50:00', 3, 3, NULL, 1, 0, NULL, NULL),
(15, '2026-09-23', 3, 'Trọng', 1, 1, 5, 5, 0, '', 0, '', 'Máy xóc 1 bung tấm lót từ 22h30'' - 4h', 'Ko', '22h', '6h', '2026-09-24 09:22:01', 1, 1, NULL, 1, 0, '', NULL),
(16, '2026-09-23', 1, 'Hải', 1, 1, 5, 5, 0, '', 0, '', '- Sửa cửa sàng tôi dầu từ 6h15'' - 7h30''
- Cẩu hồi sọt không lên xuống được từ 13h15'' - 13h40''', 'KO', '6h', '14h', '2026-09-24 09:26:34', 2, 2, NULL, 1, 0, '', NULL),
(17, '2026-09-23', 2, 'Tân', 1, 1, 5, 5, 0, '', 0, '', '- Kênh sọt từ 18h - 19h30''', 'Ko', '14h', '22h', '2026-09-24 09:32:42', 3, 3, NULL, 1, 0, '', NULL),
(18, '2026-09-24', 3, 'Trọng', 1, 1, 5, 5, 0, '', 0, '', 'Đứt dây điện trở vùng 8 từ 5h45'' - dừng lò', 'Ko', '22h', '6h', '2026-09-25 06:39:42', 1, 1, NULL, 1, 0, '', NULL),
(19, '2026-09-24', 2, 'Tân', 1, 1, 5, 5, 0, '', 0, '', 'Hàn miệng sàng tôi dầu từ 14h - 15h30''
Máy xóc 1 bị vỡ gối bi dừng từ 17h30'' - 22h', 'Ko', '14h', '22h', '2026-09-25 06:42:53', 3, 3, NULL, 1, 0, '', NULL),
(20, '2026-09-24', 1, 'Hải', 1, 1, 5, 5, 0, '', 0, '', 'Kẹt cửa ra lò Nl từ 6h - 6h20''
Kênh sọt thứ 22
Gẫy hãm cửa sàng tôi dầu từ 13h35'' - 14h', '', '6h', '14h', '2026-09-25 06:46:44', 2, 2, NULL, 1, 0, '', NULL),
(21, '2026-09-25', 1, 'Hải', 1, 1, 5, 3, 0, '', 0, '', 'Thiết bị sử dụng cẩu sửa máy xóc 1 nên không chạy được máy xóc 2', 'Ko', '6h', '14h', '2026-09-26 06:33:44', 2, 2, NULL, 1, 2, 'Hợi, Bắc', NULL),
(22, '2026-09-25', 2, 'Tân', 1, 1, 5, 5, 0, '', 0, '', 'Máy xóc 2 kẹt cửa vào miệng đổ bị từ 14h- 22h', '', '14h', '22h', '2026-09-26 06:36:15', 3, 3, NULL, 1, 0, '', NULL),
(23, '2026-09-25', 3, 'Trọng', 1, 1, 5, 5, 0, '', 0, '', 'Lỗi hồi sọt từ 0h - 1h15''', 'Ko', '22h', '6h', '2026-09-26 06:40:01', 1, 1, NULL, 1, 0, '', NULL),
(24, '2026-09-28', 1, 'Tân', 1, 1, 5, 5, 0, '', 0, '', 'KO', 'KO', '6h', '14h', '2026-09-29 06:40:17', 3, 3, NULL, 1, 0, '', 'Sắp xếp kho bi D90'),
(25, '2026-09-29', 2, 'Trọng', 1, 1, 5, 5, 0, '', 0, '', 'KO', 'KO', '14h', '22h', '2026-09-29 06:42:35', 1, 1, NULL, 1, 0, '', ''),
(26, '2026-09-29', 3, 'Hải', 1, 1, 5, 5, 0, '', 0, '', 'Dàn làm mát dầu nhảy rơ le từ 4h35'' - 5h20''
Vùng 8 đứt 3 dây', 'KO', '22h', '6h', '2026-09-29 06:45:29', 2, 2, NULL, 1, 0, '', 'Sắp xếp kho bi D40'),
(27, '2026-09-29', 1, 'Tân', 1, 1, 5, 5, 0, '', 0, '', 'KO', 'KO', '6h', '14h', '2026-09-29 06:47:18', 3, 3, '2026-09-29 09:16:14', 1, 0, '', 'Sắp xếp kho bi nghiệm thu D90'),
(28, '2026-10-13', 2, 'Cảnh', 1, 1, 5, 3, 0, '', 0, '', 'Ko', 'Ko', '14h', '22h', '2026-10-14 09:38:11', 5, 5, NULL, 1, 2, 'Tân , Chung', ''),
(29, '2026-10-13', 3, 'Trọng', 1, 1, 5, 3, 0, '', 0, '', 'Vùng 2 đứt 1 dây', 'Ko', '22h', '6h', '2026-10-14 09:41:17', 1, 1, NULL, 1, 2, 'Trọng, Tuyến', ''),
(30, '2026-10-13', 1, 'Hải', 1, 1, 5, 3, 0, '', 0, '', 'Ko', 'Ko', '6h', '14h', '2026-10-14 09:42:51', 2, 2, NULL, 1, 2, 'Hải , Tâm', ''),
(31, '2026-10-12', 2, 'Cảnh', 1, 1, 5, 3, 0, '', 0, '', '', '', '14h', '22h', '2026-10-14 09:50:00', 5, 5, NULL, 1, 2, 'Tân , Chung', '- Bật lò + đẩy bi vào lò'),
(32, '2026-10-12', 1, 'Hải', 1, 1, 5, 3, 0, '', 0, '', 'Ko', 'Ko', '6h', '14h', '2026-10-14 09:51:23', 2, 2, NULL, 1, 2, 'Hải , Tâm', ''),
(33, '2026-10-12', 3, 'Trọng', 1, 1, 5, 3, 0, '', 0, '', 'Vùng 2 đứt 1 dây', 'Ko', '22h', '6h', '2026-10-14 09:53:42', 1, 1, NULL, 1, 2, 'Trọng, Tuyến', ''),
(34, '2026-11-09', 2, 'Trọng', 1, 1, 5, 5, 0, '', 0, '', 'KO', 'KO', '14h', '22h', '2026-11-10 06:48:11', 1, 1, NULL, 1, 0, '', '- Xuất bi Hoàng Thạch
 - Mài bi đậu dài + kéo sọt'),
(35, '2026-11-09', 3, 'Hải', 1, 1, 5, 3, 0, '', 0, '', 'KO', 'KO', '22h', '6h', '2026-11-10 06:50:00', 2, 2, NULL, 1, 2, 'Hợi , Đông', '- Mài bi D40 đậu dài'),
(36, '2026-11-10', 1, 'Cảnh', 1, 1, 5, 5, 0, '', 0, '', 'KO', 'KO', '6h', '14h', '2026-11-10 06:53:01', 5, 5, NULL, 1, 0, '', '- Mài bi đậu dài 
 - Ra lò bông 2.2
 - Ra lò Ram giếng 1'),
(37, '2026-11-09', 1, 'Cảnh', 1, 1, 5, 5, 0, '', 0, '', 'KO', 'KO', '6h', '14h', '2026-11-10 06:54:45', 5, 5, NULL, 1, 0, '', '- Mài bi đậu dài
 - Ra lò bông 2.2 
 - Ra lò RAM giếng 1')
ON CONFLICT (report_date, shift_num) DO NOTHING;
SELECT setval(pg_get_serial_sequence('shifts', 'id'), COALESCE((SELECT MAX(id) FROM shifts), 1));

-- Du lieu bang packaging_items (41 dong)
INSERT INTO packaging_items (id, shift_id, product_name, customer, from_val, to_val, weight_sorted, weight_waste, notes) VALUES
(1, 1, 'D25', 'Molycop', '', '', 10000.0, 100.0, ''),
(2, 2, 'D25', 'Molycop', '', '', 4000.0, 37.0, 'Xếp kho bi chờ nghiệm thu'),
(3, 3, 'D25', 'Nhập TQ', '', '', 4000.0, 267.0, 'bi nhập'),
(4, 4, 'D25', 'Molycop', '', '', 10000.0, 110.0, ''),
(5, 5, 'D25', 'Nhập TQ', '', '', 930.0, 80.0, 'Kéo sọt bi trong lò NLLT'),
(6, 6, 'D25', 'Molycop', '', '', 4000.0, 37.0, 'Xếp kho bi chờ nghiệm thu'),
(8, 7, 'D25', 'Molycop', '', '', 123.0, 23.0, 'thích thì hủy'),
(9, 8, 'D25', 'Molycop', '', '', 4000.0, 37.0, 'Xếp kho bi chờ nghiệm'),
(14, 10, 'D40', 'Molycop', '', '', 6000.0, 60.0, ''),
(15, 10, 'D25', 'nhập về', '', '', 5000.0, 190.0, ''),
(16, 9, 'D25', 'Molycop', '', '', 10000.0, 110.0, ''),
(19, 12, 'D25', 'Molycop', '', '', 5000.0, 190.0, ''),
(20, 12, 'D40', 'khô dầu', '', '', 6000.0, 60.0, ''),
(21, 13, 'D25', 'bi nhập', '', '', 4000.0, 267.0, ''),
(22, 14, 'D25', 'Molycop', '', '', 10000.0, 110.0, ''),
(23, 15, 'D40', 'Molycop', '', '', 12000.0, 120.0, ''),
(24, 16, 'D25', 'Nhập TQ', '', '', 1800.0, 105.0, ''),
(25, 16, 'D90', 'Lương Ý Yên', '', '', 460.0, 0.0, ''),
(26, 17, 'D25', 'Nhập TQ', '', '', 945.0, 55.0, ''),
(27, 17, 'D40', 'Molycop', '', '', 4000.0, 45.0, ''),
(28, 17, 'D90', 'Lương Ý Yên', '', '', 599.0, 0.0, ''),
(29, 18, 'D40', 'Molycop', '', '', 14000.0, 150.0, ''),
(30, 19, 'D40', 'Molycop', '', '', 12000.0, 130.0, ''),
(31, 20, 'D40', 'Molycop', '', '', 10000.0, 180.0, ''),
(32, 21, 'D25', 'Nhập TQ', '', '', 1950.0, 220.0, ''),
(33, 22, 'D25', 'Nhập TQ', '', '', 1800.0, 200.0, ''),
(34, 23, 'D25', 'Molycop', '', '', 6000.0, 70.0, ''),
(35, 23, 'D40', 'Molycop', '', '', 4000.0, 50.0, ''),
(36, 23, 'D25', 'Nhập TQ', '', '', 900.0, 100.0, ''),
(37, 24, 'D25', 'Molycop', '', '', 10000.0, 75.0, ''),
(38, 25, 'D25', 'Molycop', '', '', 10000.0, 60.0, ''),
(39, 26, 'D25', 'Molycop', '', '', 10000.0, 70.0, ''),
(42, 27, 'D25', 'Molycop', '', '', 10000.0, 75.0, ''),
(43, 28, 'D25', 'Nhập Trung Quốc', '', '', 7100.0, 700.0, 'Nhặt bi lỗi'),
(44, 29, 'D25', 'Nhập Trung Quốc', '', '', 6000.0, 250.0, 'Bao gói bi nhập'),
(45, 30, 'D25', 'Nhập Trung Quốc', '', '', 3700.0, 360.0, 'Nhặt bi lỗi'),
(46, 31, 'D25', 'Nhập Trung Quốc', '', '', 7100.0, 700.0, 'Nhặt bi lỗi'),
(47, 32, 'D25', 'Nhập Trung Quốc', '', '', 3700.0, 359.0, 'Nhặt bi lỗi'),
(48, 33, 'D25', 'Molycop', '', '', 6000.0, 250.0, 'Bao gói bi nhập'),
(49, 36, 'D80', 'Hoàng Thạch', '', '', 12700.0, 500.0, ''),
(50, 37, 'D80', 'Hoàng Thạch', '', '', 12700.0, 500.0, '')
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('packaging_items', 'id'), COALESCE((SELECT MAX(id) FROM packaging_items), 1));

-- Du lieu bang basket_items (27 dong)
INSERT INTO basket_items (id, shift_id, product_name, customer, from_val, to_val, steel_grade, basket_count, total_weight, notes) VALUES
(1, 1, 'D25', 'Molycop', '1', '12', 'CR-18', 12.0, 4200.0, ''),
(2, 3, 'D25', 'Molycop', '1', '26', 'CR18', 26.0, 9100.0, ''),
(3, 4, 'D25', 'Molycop', '1', '36', '18', 36.0, 12600.0, ''),
(4, 6, 'D25', 'Molycop', '', '', 'CR18', 0.0, 0.0, ''),
(6, 7, 'D25', 'Molycop', '', '', 'CR18', 12.0, 4200.0, '142rws'),
(11, 10, 'D40', 'Molycop', '', '', 'CR18', 25.0, 8750.0, ''),
(12, 10, 'D25', 'Molycop', '', '', 'CR18', 3.0, 1050.0, ''),
(13, 9, 'D25', 'Molycop', '', '', '18', 36.0, 12600.0, ''),
(16, 12, 'D25', 'Molycop', '', '', 'CR18', 25.0, 8750.0, ''),
(17, 12, 'D40', 'Molycop', '', '', 'CR18', 3.0, 1050.0, ''),
(18, 13, 'D25', 'Molycop', '', '', 'CR18', 26.0, 9100.0, ''),
(19, 14, 'D25', 'Molycop', '', '', 'CR18', 36.0, 12600.0, ''),
(20, 15, 'D40', 'Molycop', '', '', 'CR18', 36.0, 12600.0, ''),
(21, 16, 'D40', 'Molycop', '', '', 'CR18', 31.0, 10850.0, ''),
(22, 17, 'D40', 'Molycop', '', '', 'CR18', 32.0, 11200.0, ''),
(23, 18, 'D25', 'Molycop', '', '', 'CR18', 32.0, 11200.0, ''),
(24, 18, 'D40', 'Molycop', '', '', 'CR18', 3.0, 1050.0, ''),
(25, 19, 'D40', 'Molycop', '', '', 'CR18', 28.0, 9800.0, ''),
(26, 20, 'D25', 'Molycop', '', '', 'CR18', 12.0, 4200.0, ''),
(27, 20, 'D40', 'Molycop', '', '', 'CR18', 23.0, 8050.0, ''),
(28, 23, 'D25', 'Molycop', '', '', 'CR18', 25.0, 8750.0, ''),
(29, 24, 'D25', 'Molycop', '', '', 'CR18', 36.0, 12600.0, ''),
(30, 25, 'D25', 'Molycop', '', '', 'CR18', 36.0, 12600.0, ''),
(31, 26, 'D25', 'Molycop', '', '', 'CR18', 32.0, 11200.0, ''),
(34, 27, 'D25', 'Molycop', '', '', 'CR18', 33.0, 11550.0, ''),
(35, 29, 'D25', 'Nhập Trung Quốc', '', '', 'CR18', 10.0, 3500.0, ''),
(36, 33, 'D25', 'Molycop', '', '', 'CR18', 10.0, 3500.0, 'Bi nhập TQ')
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('basket_items', 'id'), COALESCE((SELECT MAX(id) FROM basket_items), 1));

-- Du lieu bang tumbling_items (55 dong)
INSERT INTO tumbling_items (id, shift_id, product_name, customer, m1, m2, total_weight, notes) VALUES
(1, 1, 'D25', 'Molycop', 2.0, 3.0, 6500.0, ''),
(2, 1, '', '', 3.0, 0.0, 10000.0, 'Khô dầu'),
(3, 2, 'D25', 'Molycop', 1.0, 3.0, 7000.0, ''),
(4, 2, '', '', 1.0, 0.0, 4000.0, 'Khô dầu'),
(5, 3, 'D25', 'Molycop', 3.0, 3.0, 9500.0, ''),
(6, 4, 'D40', 'Khô dầu', 3.0, 1.0, 12000.0, 'Khô dầu'),
(7, 4, 'D25', 'Molycop', 2.0, 3.0, 6500.0, ''),
(8, 5, 'D25', 'Molycop', 2.0, 2.0, 5200.0, ''),
(9, 6, 'D25', 'Molycop', 1.0, 3.0, 7000.0, ''),
(10, 6, 'D25', 'Molycop', 1.0, 0.0, 4000.0, 'Khô dầu'),
(12, 7, 'D25', 'Molycop', 123.0, 120.0, 12312.0, ''),
(13, 8, 'D25', 'Molycop', 1.0, 3.0, 7000.0, ''),
(14, 8, 'D25', 'Khô dầu', 1.0, 0.0, 4000.0, ''),
(21, 10, 'D25', 'Molycop', 3.0, 3.0, 8000.0, ''),
(22, 10, 'D40', 'Molycop', 1.0, 0.0, 4000.0, 'khô dầu'),
(23, 9, 'D25', 'khô dầu', 3.0, 1.0, 0.0, ''),
(24, 9, 'D25', 'Molycop', 2.0, 3.0, 6500.0, ''),
(27, 12, 'D25', 'Molycop', 3.0, 3.0, 8000.0, ''),
(28, 12, 'D40', 'Molycop', 1.0, 0.0, 4000.0, 'khô dầu'),
(29, 13, 'D25', 'Molycop', 3.0, 3.0, 9500.0, ''),
(30, 14, 'D40', 'Molycop', 3.0, 1.0, 12000.0, ''),
(31, 14, 'D25', 'Molycop', 2.0, 3.0, 6500.0, ''),
(32, 15, 'D25', 'Molycop', 1.0, 1.0, 2600.0, ''),
(33, 15, 'D40', 'Molycop', 0.0, 1.0, 2997.0, ''),
(34, 15, 'D40', 'Molycop', 4.0, 0.0, 12000.0, 'Khô dầu'),
(35, 15, 'D40', 'Molycop', 0.0, 1.0, 3000.0, 'Sạch cát'),
(36, 16, 'D25', 'Molycop', 0.0, 3.0, 4500.0, ''),
(37, 16, 'D90', 'Molycop', 3.0, 0.0, 9000.0, 'Sạch cát'),
(38, 17, 'D25', 'Molycop', 1.0, 2.0, 5600.0, ''),
(39, 17, 'D40', 'Molycop', 1.0, 0.0, 3500.0, 'Khô dầu'),
(40, 17, 'D90', 'Molycop', 2.0, 0.0, 5499.0, 'Sạch cát'),
(41, 18, 'D25', 'Molycop', 0.0, 1.0, 1300.0, ''),
(42, 18, 'D40', 'Molycop', 0.0, 5.0, 15000.0, 'Khô dầu'),
(43, 19, 'D25', 'Molycop', 1.0, 3.0, 5600.0, ''),
(44, 19, 'D40', 'Molycop', 3.0, 1.0, 13000.0, 'Khô dầu'),
(45, 20, 'D40', 'Molycop', 1.0, 3.0, 6000.0, ''),
(46, 20, 'D40', 'Molycop', 2.0, 0.0, 6000.0, 'Sạch cát'),
(47, 20, 'D40', 'Molycop', 4.0, 0.0, 11500.0, 'Khô dầu'),
(48, 21, 'D25', 'Molycop', 1.0, 0.0, 1500.0, ''),
(49, 23, 'D25', 'Molycop', 2.0, 3.0, 6500.0, ''),
(50, 23, 'D25', 'Molycop', 2.0, 0.0, 6000.0, 'Khô dầu'),
(51, 23, 'D40', 'Molycop', 0.0, 1.0, 3000.0, ''),
(52, 24, 'D25', 'Molycop', 2.0, 3.0, 6500.0, ''),
(53, 24, 'D25', 'Molycop', 3.0, 0.0, 9998.0, 'Khô dầu'),
(54, 25, 'D25', 'Molycop', 2.0, 3.0, 6500.0, ''),
(55, 26, 'D25', 'Molycop', 2.0, 3.0, 6994.0, ''),
(56, 26, 'D25', 'Molycop', 3.0, 0.0, 10000.0, 'Khô dầu'),
(61, 27, 'D25', 'Molycop', 2.0, 3.0, 6500.0, ''),
(62, 27, 'D25', 'Molycop', 3.0, 0.0, 10000.0, 'Khô dầu'),
(63, 29, 'D25', 'Nhập Trung Quốc', 2.0, 0.0, 6000.0, 'Khô dầu')
ON CONFLICT (id) DO NOTHING;
INSERT INTO tumbling_items (id, shift_id, product_name, customer, m1, m2, total_weight, notes) VALUES
(64, 33, 'D25', 'Molycop', 2.0, 0.0, 6000.0, 'Bi nhập'),
(65, 34, 'D40', 'Molycop', 3.0, 3.0, 8995.0, ''),
(66, 35, 'D40', 'Molycop', 3.0, 3.0, 8195.0, ''),
(67, 36, 'D40', 'Molycop', 0.0, 3.0, 8000.0, ''),
(68, 37, 'D40', 'Molycop', 3.0, 3.0, 8000.0, '')
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('tumbling_items', 'id'), COALESCE((SELECT MAX(id) FROM tumbling_items), 1));

-- 7. CAP QUYEN CHO ANON VA AUTHENTICATED
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;