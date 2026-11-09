# PROJECT: BTS POWER MONITOR – ĐỒNG NAI

Bạn là một Senior Full-stack Developer. Hãy xây dựng một website chuyên nghiệp dùng để theo dõi lịch ngừng cung cấp điện tại tỉnh Đồng Nai và tự động đối chiếu với danh sách trạm BTS do tôi cung cấp.

Đây là hệ thống phục vụ nhân viên kỹ thuật viễn thông quản lý nguồn điện các trạm BTS.

## I. MỤC TIÊU CHÍNH

Tôi có một danh sách các trạm BTS đang quản lý tại Đồng Nai.

Tôi muốn website tự động:
1. Thu thập lịch cúp điện mới nhất tại Đồng Nai.
2. Theo dõi lịch cúp điện trong 7 ngày tiếp theo.
3. Đối chiếu lịch cúp điện với danh sách trạm BTS của tôi.
4. Xác định trạm nào nằm trên tuyến đường hoặc khu vực bị cúp điện.
5. Hiển thị ngày, giờ bắt đầu và giờ kết thúc cúp điện.
6. Tự động cập nhật dữ liệu hằng ngày.
7. Thông báo khi có lịch cúp điện mới hoặc lịch bị thay đổi.

## II. NGUỒN DỮ LIỆU

Ưu tiên nguồn chính thức:

- https://cskh.evnspc.vn/TraCuu/LichNgungGiamCungCapDien
- https://pcdongnai.evnspc.vn/

Chỉ sử dụng dữ liệu công khai hoặc API được phép truy cập.

Không được vượt qua CAPTCHA, OTP, đăng nhập hoặc cơ chế bảo vệ của EVNSPC.

Hãy khảo sát khả năng lấy dữ liệu từ nguồn chính thức trước khi triển khai.

Nếu không có API công khai:
- Thiết kế module nhập dữ liệu Excel/CSV.
- Cho phép cập nhật dữ liệu bằng thao tác nhập file.
- Thiết kế sẵn module kết nối API để nâng cấp sau này.
- Không tạo dữ liệu giả rồi hiển thị như dữ liệu thật.

## III. QUẢN LÝ DANH SÁCH TRẠM BTS

Tôi sẽ cung cấp một file Excel chứa danh sách trạm BTS.

Hãy tạo chức năng nhập Excel với các trường:

- Mã trạm BTS.
- Tên trạm BTS.
- Tỉnh/thành phố.
- Phường/xã.
- Tên đường.
- Địa chỉ chi tiết.
- Đơn vị quản lý.
- Ghi chú.

Cho phép thêm, sửa, xóa, tìm kiếm và lọc trạm.

Không yêu cầu tôi nhập lại danh sách trạm mỗi ngày.

## IV. ĐỐI CHIẾU LỊCH CÚP ĐIỆN

Đây là chức năng quan trọng nhất.

Hãy xây dựng thuật toán đối chiếu giữa:
- Địa chỉ trạm BTS.
- Tuyến đường.
- Phường/xã.
- Khu phố, ấp.
- Khu vực được thông báo ngừng cấp điện.

Kết quả phải phân loại:

1. ĐÃ XÁC NHẬN: Có căn cứ xác định trạm bị ảnh hưởng.
2. KHỚP KHU VỰC: Địa chỉ trạm có dấu hiệu nằm trong vùng cúp điện.
3. CẦN KIỂM TRA: Chưa đủ thông tin để xác định.
4. KHÔNG BỊ ẢNH HƯỞNG: Không có căn cứ cho thấy trạm nằm trong khu vực cúp điện.

Không được kết luận một trạm chắc chắn mất điện chỉ vì có cùng tên đường.

Nếu thông báo chỉ ghi một phần tuyến đường thì phải lưu nguyên văn phạm vi ảnh hưởng.

## V. GIAO DIỆN DASHBOARD

Thiết kế giao diện theo phong cách trung tâm điều hành mạng viễn thông NOC.

Menu bên trái:

- Tổng quan.
- Danh sách BTS.
- Lịch cúp điện 7 ngày.
- Trạm BTS bị ảnh hưởng.
- Bản đồ trạm BTS.
- Lịch sử cập nhật.
- Quản lý dữ liệu.

Dashboard hiển thị:

- Tổng số trạm BTS.
- Số trạm có lịch cúp điện trong 7 ngày.
- Số trạm cúp điện hôm nay.
- Số trạm đang mất điện.
- Số trạm cần xác minh.

## VI. BẢNG THEO DÕI 7 NGÀY

Tạo bảng có các cột:

- Mã BTS.
- Tên trạm.
- Khu vực.
- Đường bị ảnh hưởng.
- Ngày cúp điện.
- Giờ bắt đầu.
- Giờ kết thúc dự kiến.
- Lý do cúp điện.
- Mức độ xác nhận.
- Nguồn dữ liệu.

Cho phép lọc theo ngày, phường/xã và mã BTS.

## VII. TỰ ĐỘNG CẬP NHẬT

Thiết kế hệ thống Backend có lịch chạy tự động.

Yêu cầu:
- Mỗi ngày tự động kiểm tra lịch cúp điện.
- Lấy dữ liệu 7 ngày tiếp theo.
- So sánh với dữ liệu lần cập nhật trước.
- Phát hiện lịch mới.
- Phát hiện thay đổi giờ cúp điện.
- Phát hiện lịch bị hủy.
- Ghi lại lịch sử cập nhật.
- Hiển thị thời điểm cập nhật gần nhất.
- Có nút cập nhật thủ công.

Nếu nguồn dữ liệu không truy cập được, phải thông báo lỗi và giữ dữ liệu cũ kèm thời điểm cập nhật. Không được coi dữ liệu cũ là dữ liệu mới.

## VIII. HỆ THỐNG CẢNH BÁO

- Đỏ: Đã xác nhận đang mất điện.
- Cam: Có lịch cúp điện sắp tới.
- Vàng: Cần xác minh khu vực.
- Xanh: Không có lịch ảnh hưởng được ghi nhận.
- Xám: Chưa có dữ liệu.

Tạo cảnh báo khi:
- Có trạm BTS mới nằm trong lịch cúp điện.
- Lịch cúp điện thay đổi.
- Lịch cúp điện bị hủy.
- Trạm sắp đến thời gian mất điện.

## IX. CÔNG NGHỆ

Đề xuất kiến trúc:
- Frontend: HTML, CSS, JavaScript.
- Backend: Node.js và Express.
- Database: SQLite ở phiên bản đầu.
- Excel: ExcelJS.
- Lập lịch tự động: node-cron.
- Biểu đồ: Chart.js.
- Bản đồ: Leaflet và OpenStreetMap.

## X. YÊU CẦU HOÀN THIỆN

Tạo đầy đủ cấu trúc dự án:

- frontend/
- backend/
- database/
- uploads/
- services/
- README.md

Không viết tất cả code vào một file.

Hãy chia thành từng module dễ bảo trì.

Thực hiện theo các giai đoạn:

Giai đoạn 1: Tạo giao diện website.

Giai đoạn 2: Xây dựng chức năng nhập và quản lý danh sách BTS.

Giai đoạn 3: Xây dựng chức năng lấy dữ liệu lịch cúp điện từ nguồn hợp lệ.

Giai đoạn 4: Xây dựng thuật toán đối chiếu địa chỉ BTS với lịch cúp điện.

Giai đoạn 5: Xây dựng cập nhật tự động hằng ngày.

Giai đoạn 6: Kiểm tra toàn bộ chức năng và sửa lỗi.

Trước khi lập trình, hãy kiểm tra cấu trúc thư mục hiện tại và lập kế hoạch triển khai. Không tự ý xóa các file có sẵn.

Quan trọng: Tôi muốn một hệ thống hoạt động thực tế, không phải một giao diện demo chỉ có dữ liệu giả.

Hãy giải thích cách cài đặt, chạy Backend, Frontend và cách đưa website lên môi trường hoạt động liên tục 24/7.

## Triển khai và chạy ứng dụng

### Khảo sát nguồn dữ liệu chính thức

Đã kiểm tra [trang tra cứu EVNSPC](https://cskh.evnspc.vn/TraCuu/LichNgungGiamCungCapDien) và [Công ty Điện lực Đồng Nai](https://pcdongnai.evnspc.vn/). Trang Đồng Nai dẫn người dùng sang trang tra cứu EVNSPC; nội dung công khai đọc được trong quá trình khảo sát không cung cấp lịch dạng JSON/API công khai có thể xác minh. Vì vậy, phiên bản này không tự cào nội dung được bảo vệ, không gọi API ẩn, không xử lý CAPTCHA và không hiển thị lịch mẫu như lịch thật. Nhập lịch được hỗ trợ qua Excel/CSV.

Adapter tự động chỉ nhận endpoint HTTPS JSON công khai, được đơn vị cung cấp cho phép, theo cấu trúc:

```json
{
  "complete": true,
  "outages": [
    {
      "id": "ma-lich-nguon",
      "date": "2026-12-01",
      "startAt": "2026-12-01T08:00",
      "endAt": "2026-12-01T16:00",
      "affectedScope": "Phạm vi nguyên văn trong thông báo",
      "province": "Đồng Nai",
      "ward": "Phường ...",
      "street": "Đường ...",
      "cause": "Bảo trì",
      "sourceUrl": "https://..."
    }
  ]
}
```

Chỉ cấu hình endpoint khi nhà cung cấp xác nhận đây là API công khai được phép sử dụng. `complete: true` bắt buộc để hệ thống có thể phân biệt lịch bị hủy với dữ liệu thiếu. Khi endpoint lỗi hoặc cấu hình trống, lịch đang lưu không bị xóa và thời điểm đồng bộ thành công cũ được giữ nguyên.

### Cài đặt

- Cài Node.js 22.5 trở lên.
- Mở PowerShell tại thư mục dự án:

```powershell
npm install
npm test
npm run import:stations -- "C:\Users\Admin\Downloads\BTS_BH.xlsx"
npm start
```

- Mở `http://127.0.0.1:3000`.
- Backend phục vụ luôn frontend; không cần chạy một web server frontend khác.
- Trong VS Code, chọn cấu hình **Run BTS Power Monitor** rồi nhấn F5 để khởi động backend và tự mở Chrome sau khi server sẵn sàng. Không mở riêng cổng `5000`.
- SQLite được lưu tại `database/bts.sqlite` và bị loại khỏi Git. Dữ liệu không được nhúng vào mã nguồn hoặc tự tải lên dịch vụ bên ngoài.
- Cơ sở dữ liệu dùng `node:sqlite` có sẵn trong Node.js 22. Node có thể in cảnh báo rằng API SQLite còn experimental.

Workbook `BTS_BH.xlsx` đã được kiểm tra: sheet đầu có 194 dòng dữ liệu, 194 mã trạm duy nhất. Cột `ten_csht` được dùng làm mã BTS; `Ten gợi nhớ` làm tên hiển thị; `tramvt` được giữ làm đơn vị quản lý; `latitude`/`longitude` làm tọa độ. Workbook không có đủ phường/xã và tên đường, do đó các trường này để trống cho tới khi được bổ sung. Dữ liệu gốc của từng dòng được giữ lại trong bản ghi để tiện tra cứu.

Cột `ma_dienke` trong workbook được lưu và hiển thị riêng dưới dạng Mã khách hàng/mã công tơ. Mục Danh sách BTS có nút sao chép mã hợp lệ và mở trang tra cứu EVNSPC; giá trị có dấu cách hoặc sai định dạng vẫn được giữ lại nhưng không có nút tra cứu cho tới khi được xác minh. Trang công khai được thử bằng giao diện bình thường và trả lịch trong một cửa sổ ngày giới hạn; tra cứu từng mã vẫn do nhân viên thực hiện. Chưa xác minh được API/ủy quyền để gửi tự động các mã khách hàng hằng ngày.

`npm run import:stations` hỗ trợ nhập workbook lại; nhập lần nữa sẽ cập nhật theo mã trạm, không xóa các trạm khác không có trong tệp. Có thể nhập danh sách trạm và lịch từ giao diện. Lịch `.xlsx`/CSV cần tiêu đề ngày, giờ bắt đầu, giờ kết thúc và phạm vi ảnh hưởng; mẫu CSV có thể tải trong mục Quản lý dữ liệu. Lịch nhập thủ công chỉ thêm/cập nhật các dòng trong file, không tự hủy những lịch không có trong file.

### Cập nhật và đối chiếu

- Có thể cập nhật lịch thủ công trong Dashboard hoặc nhập file lịch tải từ nguồn EVNSPC.
- Nếu cấu hình `EVNSPC_PUBLIC_API_URL`, backend kiểm tra mỗi ngày lúc 06:00 giờ Việt Nam và có nút cập nhật ngay. Lỗi kết nối/định dạng được ghi trong Lịch sử cập nhật; dữ liệu cũ được giữ nguyên.
- Trong mục Lịch cúp điện và Trạm BTS bị ảnh hưởng, nút **Cập nhật hôm nay**/**Cập nhật tuần này** sẽ thử đồng bộ nguồn API được cấu hình rồi lọc kết quả tương ứng. Nếu chưa cấu hình API, thao tác báo lỗi nguồn và chỉ có thể xem lịch đã nhập/lưu; không tự tạo lịch mới.
- Có thể tìm trạm bằng mã BTS hoặc mã khách hàng ở các bảng lịch/ảnh hưởng. Mã khách hàng chỉ dùng để tìm trong danh sách trạm và đối chiếu với lịch nguồn; hệ thống chưa tự gửi/truy vấn từng mã trên EVNSPC vì chưa xác minh được API công khai được phép hỗ trợ cách tra cứu đó. Khi có API được EVNSPC cho phép, cần cấu hình adapter tương ứng mới có thể tự động tra từng mã.
- Hệ thống phát hiện lịch mới, thay đổi (khi nguồn giữ nguyên ID), lịch API bị hủy (chỉ với snapshot đầy đủ `complete: true`) và lịch sắp bắt đầu.
- Đối chiếu “Đã xác nhận” chỉ khi phạm vi ghi rõ mã BTS; khớp phường/xã và đường chỉ là “Khớp khu vực”, không khẳng định trạm chắc chắn mất điện. Workbook ban đầu thiếu địa chỉ hành chính nên cần bổ sung địa chỉ để tăng độ hữu ích.
- Bản đồ dùng tọa độ workbook và tile OpenStreetMap; cần kết nối Internet để tải thư viện/lớp bản đồ. Trạm không có tọa độ không xuất hiện trên bản đồ.
- Giao diện cảnh báo là cảnh báo nội bộ trên website, không gửi SMS/email/push.

### Chạy liên tục 24/7

Đặt ứng dụng trên máy chủ luôn bật, sao lưu định kỳ `database/bts.sqlite`, giữ Node.js tiến trình chạy nền bằng Windows Task Scheduler/Windows Service hoặc `systemd`/PM2 trên Linux. Cấu hình khởi động lại khi lỗi và giám sát dung lượng đĩa/database. Nếu cho phép truy cập mạng nội bộ, đặt sau reverse proxy có HTTPS và xác thực; không mở trực tiếp cổng ứng dụng ra Internet vì phiên bản này chưa có đăng nhập/phân quyền. Đặt `HOST=127.0.0.1` khi chỉ dùng cùng máy; chỉ dùng `HOST=0.0.0.0` sau khi đã cấu hình firewall và proxy phù hợp.