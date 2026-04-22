# 🚀 E-commerce High-Performance - System Architecture & Roadmap

Dự án này được thiết kế để giải quyết các bài toán thực tế trong hệ thống thương mại điện tử quy mô lớn, tập trung vào hiệu năng cao, tính nhất quán dữ liệu và khả năng mở rộng.

---

## 🛡️ 1. Infrastructure & Security (Hạ tầng & Bảo mật)

### **Rate Limiting (Chặn Spam & Bot)**
* **Vấn đề:** Bot tấn công Brute-force hoặc người dùng cố tình spam request làm nghẽn hệ thống.
* **Giải pháp:** Sử dụng `ThrottlerModule` kết hợp với **Redis Storage**.
* **Cơ chế (Multi-tier throttling):**
    * **Short (1s):** Chặn bot gửi request liên tục trong mili giây.
    * **Medium (10s):** Chặn người dùng spam click thủ công.
    * **Long (1m):** Giới hạn tổng tài nguyên trên mỗi IP để tránh khai thác quá mức.
* **Ưu điểm:** Bộ đếm được lưu tại Redis, không bị reset khi server khởi động lại.

---

## ⚡ 2. Performance Optimization (Tối ưu hiệu năng)

### **Giải quyết bài toán N+1 Query**
* **Vấn đề:** Truy vấn danh sách (ví dụ: Orders) kèm theo các quan hệ (User, Products) tạo ra hàng trăm query nhỏ làm chậm database.
* **Giải pháp:** * Sử dụng **Dataloader** để gom nhóm (Batching) các request nhỏ thành một query duy nhất.
    * Tối ưu hóa việc sử dụng `include` và `select` trong Prisma để tránh lấy dư thừa dữ liệu.

### **Caching Strategy**
* **Giải pháp:** Sử dụng **Redis** làm lớp đệm dữ liệu.
* **Cơ chế:** Áp dụng **Cache-aside Pattern** cho các dữ liệu ít thay đổi như Danh mục (Categories) và Cấu hình hệ thống (Settings).

---

## 💰 3. Transaction & Consistency (Giao dịch & Nhất quán)

### **Idempotency (Chống thanh toán/nhấn nút 2 lần)**
* **Vấn đề:** User nhấn nút thanh toán 2 lần do mạng lag hoặc cố tình, dẫn đến trừ tiền 2 lần.
* **Giải pháp:** * **Idempotency Key:** Mỗi request từ client gửi kèm một mã định danh duy nhất. 
    * Backend kiểm tra mã này trong Redis; nếu đã tồn tại và đang xử lý, sẽ từ chối request thứ hai hoặc trả về kết quả cũ.

### **Inventory Race Condition (Tranh chấp tồn kho)**
* **Vấn đề:** 2 người cùng mua 1 sản phẩm cuối cùng tại cùng một thời điểm.
* **Giải pháp:** * **Database Transaction:** Sử dụng `Prisma.$transaction` để đảm bảo tính nguyên tử (Atomicity).
    * **Atomic Updates:** Sử dụng câu lệnh UPDATE trực tiếp: `SET stock = stock - 1 WHERE id = ? AND stock > 0`. Nếu hàng trong kho bằng 0, câu lệnh sẽ không thực hiện được và trả về lỗi ngay lập tức.

### **Xử lý sự cố khi đang thanh toán**
* **Vấn đề:** Đang thanh toán thì mất mạng hoặc ứng dụng crash.
* **Giải pháp:** * Sử dụng **Webhooks** từ phía Payment Gateway để cập nhật trạng thái đơn hàng (Asynchronous).
    * Kết hợp với **Background Jobs (RabbitMQ)** để retry việc cập nhật trạng thái nếu hệ thống gặp sự cố tạm thời.

---

## 📡 4. Communication & Scalability (Giao tiếp & Mở rộng)

### **Message Queue (RabbitMQ)**
* **Mục đích:** Tách rời (Decoupling) các tác vụ không cần phản hồi ngay lập tức như: Gửi email xác nhận, Thông báo cho Admin, Xử lý ảnh sản phẩm.
* **Lợi ích:** Giảm thời gian phản hồi (Latency) cho người dùng cuối.

---

## 🛠️ Tech Stack Overview
- **Backend:** NestJS, Prisma, PostgreSQL.
- **Frontend:** Next.js (App Router), Tailwind CSS.
- **Infrastructure:** Redis (Caching & Rate Limit), RabbitMQ (Job Queue), Docker & Docker Compose.
- **Monitoring:** Winston Logger & Correlation ID.

---
*Tài liệu này phục vụ cho việc định hướng phát triển và tài liệu hóa các tính năng kỹ thuật cốt lõi của dự án.*
