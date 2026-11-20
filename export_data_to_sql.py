import sqlite3

def sql_escape(val):
    if val is None:
        return 'NULL'
    if isinstance(val, (int, float)):
        return str(val)
    val_str = str(val).replace("'", "''")
    return f"'{val_str}'"

conn = sqlite3.connect('vico_production.db')
conn.row_factory = sqlite3.Row
c = conn.cursor()

out_lines = []
out_lines.append('-- ====================================================================')
out_lines.append('-- DONG BO TOAN BO DU LIEU CU TU MAY TINH LEN SUPABASE')
out_lines.append('-- ====================================================================')
out_lines.append('')
out_lines.append('-- 0. Dam bao cac cot can thiet ton tai')
out_lines.append('ALTER TABLE shifts ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT;')
out_lines.append('ALTER TABLE shifts ADD COLUMN IF NOT EXISTS updated_by_user_id BIGINT;')
out_lines.append('')

tables = ['users', 'presets', 'shifts', 'packaging_items', 'basket_items', 'tumbling_items']

for table in tables:
    c.execute(f'PRAGMA table_info({table})')
    columns = [col[1] for col in c.fetchall()]
    cols_str = ', '.join(columns)
    
    c.execute(f'SELECT * FROM {table}')
    rows = c.fetchall()
    
    out_lines.append(f'-- Du lieu bang {table} ({len(rows)} dong)')
    if rows:
        val_rows = []
        for r in rows:
            row_vals = [sql_escape(r[col]) for col in columns]
            val_rows.append(f"({', '.join(row_vals)})")
        
        batch_size = 50
        for i in range(0, len(val_rows), batch_size):
            batch = val_rows[i:i+batch_size]
            if table == 'users':
                conflict_clause = 'ON CONFLICT (id) DO NOTHING'
            elif table == 'presets':
                conflict_clause = 'ON CONFLICT (category, name) DO NOTHING'
            elif table == 'shifts':
                conflict_clause = 'ON CONFLICT (report_date, shift_num) DO NOTHING'
            else:
                conflict_clause = 'ON CONFLICT (id) DO NOTHING'
            out_lines.append(f'INSERT INTO {table} ({cols_str}) VALUES\n' + ',\n'.join(batch) + f'\n{conflict_clause};')
        
        out_lines.append(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE((SELECT MAX(id) FROM {table}), 1));")
    out_lines.append('')

out_lines.append('-- 7. CAP QUYEN CHO ANON VA AUTHENTICATED')
out_lines.append('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;')
out_lines.append('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;')
out_lines.append('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;')
out_lines.append('GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;')
out_lines.append('')
out_lines.append('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;')
out_lines.append('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;')
out_lines.append('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;')

with open('migrate_all_data_to_supabase.sql', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out_lines))

print('Da tao thanh cong migrate_all_data_to_supabase.sql!')
