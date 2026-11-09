Hãy tiếp tục phát triển chức năng LỊCH CÚP ĐIỆN BTS hiện tại.

Hiện tại website báo lỗi:
"EVNSPC từ chối yêu cầu tra cứu tự động từ backend".

Tôi muốn bạn xử lý lại chức năng lấy dữ liệu theo hướng thực tế, không giả lập dữ liệu và không vượt cơ chế bảo vệ của EVNSPC.

YÊU CẦU:

1. Giữ nguyên giao diện Lịch cúp điện BTS hiện tại.

2. Xây dựng chức năng IMPORT LỊCH CÚP ĐIỆN:
- Cho phép tải lên file Excel (.xlsx) và CSV.
- Đọc dữ liệu lịch cúp điện từ file.
- Tự động nhận diện các cột: địa điểm, đường, phường/xã, ngày cúp điện, giờ bắt đầu, giờ kết thúc, đơn vị điện lực và lý do.
- Cho phép xem trước dữ liệu trước khi nhập.
- Cho phép xác nhận nhập dữ liệu vào database.
- Không tạo dữ liệu giả.

3. Xây dựng chức năng đối chiếu:
- So sánh địa chỉ lịch cúp điện với danh sách trạm BTS.
- Tìm các trạm có khả năng bị ảnh hưởng.
- Hiển thị tên trạm, tuyến đường, ngày và giờ mất điện.
- Cho phép nhân viên xác nhận kết quả đối chiếu.

4. Chức năng cập nhật:
- Nếu có API EVNSPC được cấp phép thì sử dụng API đó.
- Nếu chưa có API, hiển thị trạng thái "Chưa kết nối nguồn dữ liệu tự động".
- Không báo cập nhật thành công khi chưa lấy được dữ liệu.
- Không xóa dữ liệu cũ khi đồng bộ thất bại.
- Phân biệt dữ liệu mới, dữ liệu cũ và dữ liệu đã xác minh.

5. Tạo thêm nút:
- Nhập lịch Excel/CSV.
- Tải file mẫu Excel.
- Xem lịch sử cập nhật.
- Đồng bộ dữ liệu.
- Mở trang tra cứu EVNSPC.

6. Kiểm tra toàn bộ code backend, frontend và database để đảm bảo các chức năng hoạt động thực tế.

Hãy thực hiện trực tiếp trên source code hiện tại, không tạo một website mới.

## Cách sử dụng

- Trong **Lịch cúp điện BTS**, chọn **Nhập lịch Excel/CSV** để xem trước các dòng hợp lệ và lỗi. Chỉ các dòng hợp lệ được chọn nhập khi bấm **Xác nhận nhập**; đóng cửa sổ preview sẽ không ghi dữ liệu.
- Dùng **Tải mẫu Excel** để lấy hàng tiêu đề. Có thể dùng các cột địa điểm/phạm vi, ngày cúp điện, giờ bắt đầu, giờ kết thúc, đường, phường/xã, đơn vị điện lực và lý do. Hỗ trợ `.xlsx` và `.csv`.
- Lịch đã nhập được đối chiếu với địa chỉ BTS. Nhân viên chọn **Xác nhận có ảnh hưởng** hoặc **Xác nhận không ảnh hưởng** để lưu kết quả và thời điểm xác minh.
- Mục **Lịch sử cập nhật** ghi nhận lần nhập, xác minh và đồng bộ thành công/lỗi.

## Nguồn dữ liệu tự động

Chỉ cấu hình `EVNSPC_PUBLIC_API_URL` khi được cấp quyền dùng API JSON EVNSPC. Endpoint phải là HTTPS và trả về đối tượng có `complete: true` cùng mảng `outages` đầy đủ cho cửa sổ lịch đồng bộ. Mỗi mục cần có `id`, `startAt`, `endAt`, `affectedScope`; có thể có `date`, `province`, `ward`, `street`, `utilityUnit`, `cause`, `sourceUrl`. Không cấu hình URL trang tra cứu HTML thay cho API.

Khi chưa cấu hình API, ứng dụng hiển thị **Chưa kết nối nguồn dữ liệu tự động**; không chạy lịch đồng bộ nền và nút đồng bộ báo lỗi rõ ràng. Lỗi API không xóa lịch đã lưu. Có thể nhập lịch từ thông báo chính thức qua Excel/CSV trong thời gian chưa có API.