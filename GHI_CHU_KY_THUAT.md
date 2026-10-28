# Báo Cáo — frontend v0.2

Website tĩnh phục vụ repo `hj1207com-bot/bao-cao-website`, sử dụng schema v1.0 đã tạo ở bước trước. Không phải bản hoàn thiện toàn bộ đặc tả hệ thống.

## Triển khai

Đưa **nội dung** `01-website/` vào root repository, dùng GitHub Pages `main / (root)`. Hash routes hoạt động ở subpath `/bao-cao-website/`; không cần rewrite hay 404 fallback. Font và Supabase SDK được đóng gói cùng website, không gọi CDN lúc mở trang.

`assets/supabase.js` là bản ESM bundle từ `@supabase/supabase-js@2.117.3`, tạo bằng esbuild. `app.js`, `utils.js`, `styles.css`, `config.js` giữ nguyên dạng nguồn để dễ sửa. Font Be Vietnam Pro 400/600/700, OFL; giấy phép thư viện trong `assets/`.

## Kiến trúc hiện tại

- Auth: `signInWithPassword`, `getSession`, `onAuthStateChange`, `signOut({scope:'local'})`. Đăng nhập bằng email. Session storage theo thẻ; không có anonymous login, signup hay email recovery UI.
- Read-only data: profiles, documents, document_sections, document_datasets, access_groups, admin_actions. Mọi truy vấn bảng đi qua Supabase với JWT của người dùng và publishable key.
- Không cấp thêm quyền INSERT/UPDATE/DELETE cho frontend. Thao tác quản trị viết dữ liệu phải được bổ sung bằng trusted server/Edge Functions và kiểm tra lại vai trò ở máy chủ.
- Tự lấy lại hồ sơ và quyền khi chuyển trang, khoảng 30 giây và khi hiện lại tab. Sai quyền/lỗi mạng sẽ xóa report DOM. Sequence token và AbortController ngăn phản hồi cũ dựng lại nội dung sau logout/chuyển tài khoản.
- `auth.getSession` chỉ dùng để khởi tạo client. Nguồn quyền thực sự là RLS và hồ sơ đọc được ở máy chủ; không tin role trong user_metadata.
- Report sections chỉ render text/JSON đã escape, không eval, không render HTML từ CSDL. CSV có chống công thức ở ô bắt đầu bằng dấu đặc biệt. CSP giới hạn nguồn script/font/style và API; không có service worker/offline data cache.
- Watermark là biện pháp nhắc nhở, không ngăn sao chép/chụp màn hình. Không dùng nó làm bằng chứng duy nhất về người phát tán.
- Admin overview chỉ xem dữ liệu hiện có. CSV export chưa ghi một sự kiện xuất ở máy chủ. Bảng access_logs vẫn dành cho luồng ghi đáng tin cậy ở bước sau; không giả lập số lượt xem.
- Giới hạn giao diện: danh mục 1.000 báo cáo, 200 phần/báo cáo, 100 dataset/báo cáo, 60 điểm/biểu đồ, 1.000 dòng/bảng, 500 hồ sơ/nhóm, 100 audit rows. Cần phân trang/thông báo mở rộng nếu vượt quy mô MVP.

## Quy ước section và dataset

`document_datasets.data` là mảng đối tượng. `dataset_key` duy nhất trong một báo cáo.

```json
[{"month":"Tháng 1","revenue":120,"cost":86}]
```

Ví dụ `document_sections.content`:

```json
{"body":"Nội dung văn bản thuần", "source":"Nguồn dữ liệu"}
```

```json
{"type":"bar","dataset_key":"monthly","x_key":"month","y_key":"revenue","unit":"triệu đồng","source":"Nguồn đã xác minh"}
```

```json
{"dataset_key":"monthly","columns":[{"key":"month","label":"Tháng"},{"key":"revenue","label":"Doanh thu","format":"number"}]}
```

```json
{"metrics":[{"label":"Tổng doanh thu","value":1003,"unit":"triệu đồng","detail":"Chú thích"}]}
```

Các loại section được hỗ trợ: heading, text, chart (bar hoặc line), table, note (body hoặc metrics). Nguồn được hiển thị dạng văn bản; không tự biến URL thành HTML. Chỉ báo cáo published mới hiện cho participant có quyền; admin active được đọc draft/archived theo hàm RLS hiện có.

## Kiểm chứng và giới hạn

Migration và seed được kiểm tra bằng PostgreSQL/PGlite cục bộ với mô phỏng Auth roles/uid. Kiểm tra trình duyệt dùng Supabase Auth/REST giả lập để không sử dụng mật khẩu của chủ dự án. Đã kiểm tra riêng kết nối thật: Auth settings trả 200, signup tắt; đọc documents bằng publishable key khi chưa đăng nhập trả permission denied.

Đăng nhập thật bằng tài khoản ADMIN001 và kiểm tra sau khi GitHub Pages triển khai cần chủ tài khoản thực hiện. Chưa có kiểm thử end-to-end trên môi trường Supabase thật với các tài khoản participant, chưa kiểm tra thu hồi Auth refresh token hoặc gửi email.

## Phần cần làm tiếp

1. Edge Functions cho quản trị tài khoản, nhóm, quyền, nhập CSV có kiểm tra và retry theo dòng.
2. Nhật ký đáng tin cậy cho Auth và lần cấp dữ liệu; không coi client telemetry là bằng chứng duy nhất.
3. Storage policy ràng buộc object với document permission và xử lý vòng đời signed URL.
4. Quản lý mật khẩu/email/phiên thực tế, MFA quản trị, sao lưu và nghiệm thu theo ma trận quyền.
