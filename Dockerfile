FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PORT=8088 \
    TZ=Asia/Ho_Chi_Minh \
    VICO_DB_PATH=/data/vico_production.db \
    VICO_MASTER_PATH=/data/bao_cao_tong_hop.xlsx

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . .

# Database, khóa bí mật, file Excel gốc và bản sao lưu nằm trong /data.
# Gắn volume vào /data để không mất dữ liệu khi tạo lại container.
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8088

# Chạy trực tiếp uvicorn (không bật chế độ tự nạp lại code)
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
