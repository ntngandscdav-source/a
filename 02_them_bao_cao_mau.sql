-- BAO CAO MINH HOA - Du lieu gia lap, khong dung cho phan tich thuc te.
-- Chay SAU tep 01_khoi_tao_bao_cao.sql, trong SQL Editor (role postgres).
-- Khong sua cau truc bang, khong cap them quyen, khong ghi de noi dung cu.
-- Tao 1 bao cao BAN NHAP: chi admin hoat dong nhin thay.
-- Co the chay lai: cac dong da ton tai theo ID se duoc giu nguyen.
begin;

do $$
begin
  if not exists (select 1 from public.profiles where participant_code='ADMIN001' and role='admin' and status='active') then
    raise exception 'Can tao tai khoan ADMIN001, role admin, status active truoc.';
  end if;
end;
$$;

insert into public.documents(id,slug,title,description,status,version,created_by)
values (
  'c0a00000-0000-4000-8000-000000000001',
  'bao-cao-minh-hoa-v1',
  'Báo cáo minh họa — Hiệu quả hoạt động',
  'Bản mẫu sáu tháng với biểu đồ, bảng dữ liệu và các chỉ số tổng hợp. Toàn bộ số liệu là giả lập để kiểm tra giao diện.',
  'draft',1,
  (select id from public.profiles where participant_code='ADMIN001')
) on conflict (id) do nothing;

insert into public.document_datasets(id,document_id,dataset_key,data)
values (
  'c0c00000-0000-4000-8000-000000000001',
  'c0a00000-0000-4000-8000-000000000001',
  'monthly',
  '[{"month":"Tháng 1","revenue":120,"cost":86,"difference":34},
    {"month":"Tháng 2","revenue":148,"cost":96,"difference":52},
    {"month":"Tháng 3","revenue":142,"cost":105,"difference":37},
    {"month":"Tháng 4","revenue":176,"cost":117,"difference":59},
    {"month":"Tháng 5","revenue":193,"cost":130,"difference":63},
    {"month":"Tháng 6","revenue":224,"cost":143,"difference":81}]'::jsonb
) on conflict (id) do nothing;

insert into public.document_sections(id,document_id,title,section_type,content,sort_order)
values
('c0b00000-0000-4000-8000-000000000001','c0a00000-0000-4000-8000-000000000001',
 'Dữ liệu giả lập','note',
 '{"body":"Đây là báo cáo minh họa phục vụ kiểm tra website. Các con số không phản ánh một doanh nghiệp hoặc nghiên cứu thực tế. Báo cáo đang ở trạng thái bản nháp và chỉ dành cho quản trị viên."}',10),
('c0b00000-0000-4000-8000-000000000002','c0a00000-0000-4000-8000-000000000001',
 'Các chỉ số chính','note',
 '{"metrics":[{"label":"Tổng doanh thu","value":1003,"unit":"triệu đồng","detail":"Cộng dồn 6 tháng giả lập"},{"label":"Tổng chi phí","value":677,"unit":"triệu đồng","detail":"Cộng dồn 6 tháng giả lập"},{"label":"Chênh lệch thu – chi","value":326,"unit":"triệu đồng","detail":"Chưa có ý nghĩa lợi nhuận kế toán"}]}',20),
('c0b00000-0000-4000-8000-000000000003','c0a00000-0000-4000-8000-000000000001',
 'Doanh thu theo tháng','chart',
 '{"type":"bar","dataset_key":"monthly","x_key":"month","y_key":"revenue","unit":"triệu đồng","source":"Dữ liệu giả lập để kiểm tra giao diện."}',30),
('c0b00000-0000-4000-8000-000000000004','c0a00000-0000-4000-8000-000000000001',
 'Diễn biến hoạt động','text',
 '{"body":"Trong bộ số liệu minh họa, doanh thu tăng từ 120 triệu đồng ở tháng 1 lên 224 triệu đồng ở tháng 6. Tháng 3 có mức doanh thu thấp hơn tháng 2, sau đó tăng trong các tháng còn lại.\n\nĐoạn diễn giải này dùng để kiểm tra cách website trình bày nội dung văn bản bên cạnh biểu đồ và bảng số liệu. Khi bổ sung báo cáo thật, phần nhận định phải được viết dựa trên dữ liệu và nguồn đã xác minh."}',40),
('c0b00000-0000-4000-8000-000000000005','c0a00000-0000-4000-8000-000000000001',
 'Bảng dữ liệu chi tiết','table',
 '{"dataset_key":"monthly","columns":[{"key":"month","label":"Tháng"},{"key":"revenue","label":"Doanh thu","format":"number"},{"key":"cost","label":"Chi phí","format":"number"},{"key":"difference","label":"Chênh lệch","format":"number"}],"source":"Dữ liệu giả lập; đơn vị: triệu đồng."}',50),
('c0b00000-0000-4000-8000-000000000006','c0a00000-0000-4000-8000-000000000001',
 'Cách sử dụng báo cáo','text',
 '{"body":"Bạn có thể dùng mục lục để chuyển đến từng phần, xem số liệu trong biểu đồ và cuộn ngang bảng khi dùng điện thoại. Mã người xem được hiển thị trên nội dung dưới dạng watermark.\n\nWatermark hỗ trợ nhắc nhở phạm vi sử dụng; không thể ngăn tuyệt đối việc chụp màn hình hoặc sao chép nội dung đã được phép xem."}',60)
on conflict (id) do nothing;

commit;
select title,status,
 (select count(*) from public.document_sections where document_id=d.id) as so_phan,
 (select count(*) from public.document_datasets where document_id=d.id) as so_bo_du_lieu
from public.documents d where id='c0a00000-0000-4000-8000-000000000001';
