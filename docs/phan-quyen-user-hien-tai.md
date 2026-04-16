# Tài liệu phân tích phần phân quyền user hiện tại của dự án

## 1. Mục tiêu của hệ thống phân quyền

Hệ thống phân quyền hiện tại của dự án `SmartMobileStore` được thiết kế để giải quyết đồng thời 4 lớp kiểm soát:

1. **Xác thực người dùng**: người dùng phải đăng nhập hợp lệ trước khi truy cập các chức năng nội bộ.
2. **Phân quyền theo vai trò và quyền cụ thể**: mỗi user được gán vai trò, sau đó vai trò được ánh xạ sang các permission chi tiết.
3. **Phân quyền theo phạm vi truy cập**: cùng một permission có thể áp dụng ở nhiều phạm vi như `SELF`, `TASK`, `BRANCH`, `GLOBAL`.
4. **Kiểm soát tăng cường cho hành động nhạy cảm**: một số thao tác cần bước xác minh bổ sung `step-up` trước khi thực hiện.

Nói ngắn gọn, hệ thống không chỉ dừng ở mô hình “role-based access control” truyền thống, mà đã tiến gần tới mô hình **RBAC + permission catalog + scope-based authorization + step-up authentication**.

---

## 2. Kiến trúc tổng quan

Luồng phân quyền hiện tại có thể hiểu theo thứ tự sau:

1. User đăng nhập vào hệ thống.
2. Backend xác định thông tin người dùng, vai trò và các gán quyền thực tế.
3. Hệ thống resolve ra **effective access context**: tập quyền hiệu lực cuối cùng của user.
4. Khi user gọi API, middleware / service sẽ so sánh permission cần dùng với permission thực tế.
5. Nếu action nằm trong nhóm nhạy cảm, hệ thống yêu cầu xác minh step-up bằng token riêng.
6. Ở frontend, UI cũng dựa trên snapshot quyền để ẩn/hiện menu, route, nút thao tác và cảnh báo step-up.

Điểm đáng chú ý là dự án đang dùng **kiểm soát ở cả backend lẫn frontend**:

- **Backend** là lớp quyết định cuối cùng về quyền.
- **Frontend** chỉ là lớp hỗ trợ UX, tránh hiển thị các chức năng không phù hợp.

---

## 3. Các khái niệm cốt lõi

### 3.1 Permission

Permission là đơn vị phân quyền nhỏ nhất của hệ thống. Mỗi permission được biểu diễn bằng một chuỗi có cấu trúc dạng:

- `module.action.scope`
- hoặc biến thể gần tương đương theo từng nghiệp vụ

Ví dụ:

- `analytics.read.branch`
- `users.manage.global`
- `pos.order.read.self`
- `warehouse.write`

Các permission này được khai báo tập trung trong backend tại catalog quyền, đồng thời frontend cũng có một số logic đọc snapshot để xử lý giao diện.

### 3.2 Role

Role là nhóm quyền mang tính nghiệp vụ. Dự án đang chia role thành các nhóm chính:

- **System role**: `GLOBAL_ADMIN`
- **Branch role**: `BRANCH_ADMIN`, `SALES_STAFF`, `WAREHOUSE_MANAGER`, `WAREHOUSE_STAFF`, `PRODUCT_MANAGER`, `ORDER_MANAGER`, `POS_STAFF`, `CASHIER`, `ADMIN`
- **Task role**: `SHIPPER`

Ngoài ra còn có mapping từ role cũ sang role nhánh mới, ví dụ `ADMIN` có thể được chuyển sang `BRANCH_ADMIN` trong một số kịch bản migration.

### 3.3 Scope / phạm vi

Scope xác định quyền được dùng ở mức nào. Hệ thống hiện có 4 loại scope:

- **GLOBAL**: áp dụng toàn hệ thống, tất cả chi nhánh.
- **BRANCH**: áp dụng theo chi nhánh đang hoạt động hoặc chi nhánh được gán.
- **SELF**: chỉ áp dụng cho chính user đó.
- **TASK**: áp dụng cho nhiệm vụ/đầu việc được giao.

Đây là điểm quan trọng của hệ thống hiện tại: **một permission không chỉ trả lời “có hay không”, mà còn trả lời “có trong phạm vi nào”**.

### 3.4 Step-up authentication

Một số permission nhạy cảm cần người dùng xác minh lại danh tính thông qua bước step-up. Ví dụ:

- xóa sản phẩm
- quản lý analytics toàn cục
- quản lý user toàn cục
- quản lý promotion
- thao tác kho nhạy cảm
- quản lý trạng thái đơn hàng ở mức quan trọng

Sau khi step-up thành công, hệ thống có cơ chế grace period theo nhóm action để giảm số lần yêu cầu xác minh lặp lại.

---

## 4. Nguồn dữ liệu và mô hình dữ liệu liên quan

### 4.1 Catalog permission

Backend có một danh sách permission chuẩn hóa nằm trong `permissionCatalog.js`. Danh sách này định nghĩa cho từng permission:

- `key`: mã quyền
- `module`: module nghiệp vụ
- `action`: hành động
- `scopeType`: loại scope
- `description`: mô tả
- `isSensitive`: có nhạy cảm hay không

Trong danh mục hiện tại có khá nhiều module nghiệp vụ, bao gồm:

- analytics
- users
- account
- cart
- orders
- order
- inventory
- device
- warranty
- product
- brand
- product_type
- warehouse
- transfer
- store
- content
- monitoring
- promotion
- review
- task
- pos
- context

### 4.2 Seed permission

Hệ thống có hàm seed tự động để đảm bảo các permission trong catalog được đồng bộ vào database. Logic này cho thấy permission không chỉ tồn tại trong code mà còn được lưu và quản trị ở mức dữ liệu.

### 4.3 Role permission map

Tập quyền mặc định cho từng role được định nghĩa tập trung trong `actions.js` qua biến `ROLE_PERMISSIONS`.

Ví dụ:

- `CUSTOMER` có các quyền self-service như cập nhật profile, quản lý địa chỉ, quản lý cart, xem đơn của chính mình, review sản phẩm.
- `SALES_STAFF` có quyền đọc đơn hàng, tạo/cập nhật đơn, xem device/warranty, xem analytics cá nhân, tạo POS order.
- `BRANCH_ADMIN` có tập quyền rộng hơn, bao phủ users, orders, inventory, product, warehouse, promotion, content, POS.
- `WAREHOUSE_MANAGER` và `WAREHOUSE_STAFF` tập trung vào kho, tồn kho, chuyển kho, thiết bị và bảo hành.
- `ORDER_MANAGER` tập trung vào đơn hàng, điều phối, audit và theo dõi workflow.
- `POS_STAFF` tập trung vào thao tác POS.
- `CASHIER` tập trung vào thanh toán, xuất hóa đơn VAT, hủy/chốt đơn POS.
- `SHIPPER` tập trung vào task và đơn được giao.
- `GLOBAL_ADMIN` có quyền `*`.

### 4.4 User permission grant / role assignment

Trong backend còn có các model và service liên quan đến:

- gán role cho user
- gán permission trực tiếp cho user
- resolve quyền hiệu lực
- cache quyền hiệu lực
- audit thay đổi quyền

Điều này cho thấy hệ thống không chỉ dựa vào role tĩnh, mà còn có lớp **override theo user**.

---

## 5. Luồng phân quyền hiện tại ở backend

### 5.1 Resolve quyền hiệu lực

Backend có service để resolve “effective access context” cho user. Context này thường bao gồm:

- `userId`
- `permissions`
- `permissionGrants`
- `roleAssignments`
- `roleKeys`
- `activeBranchId`
- `allowedBranchIds`

Ý nghĩa: từ một user ban đầu, hệ thống tổng hợp mọi nguồn quyền để tạo ra tập quyền cuối cùng dùng khi kiểm tra truy cập.

### 5.2 Kiểm tra quyền khi xử lý request

Khi API được gọi, hệ thống dùng authorization service để đánh giá policy. Logic này nhận:

- `authz` hoặc authorization snapshot
- `permission` cần kiểm tra
- `mode` (ví dụ branch)
- `requireActiveBranch`
- `resource` nếu có

Sau đó policy engine quyết định request có được phép thực hiện hay không.

### 5.3 Quy tắc theo scope

Hệ thống cho phép nhiều kiểu kiểm tra:

- **SELF**: so sánh user hiện tại với đối tượng sở hữu dữ liệu.
- **TASK**: kiểm tra user có được giao task hay không.
- **BRANCH**: kiểm tra quyền có nằm trong chi nhánh hoạt động hay chi nhánh được phép.
- **GLOBAL**: không giới hạn theo branch.

Đây là nền tảng quan trọng để tránh tình trạng user có quyền đúng nhưng vẫn thao tác sai phạm vi.

### 5.4 Kiểm soát chi nhánh đang hoạt động

Hệ thống có khái niệm `activeBranchId` và danh sách `allowedBranchIds`. Điều này đặc biệt quan trọng với các role có thể làm việc ở nhiều chi nhánh.

Một số quyền còn yêu cầu đang ở đúng branch context thì mới thực thi được.

### 5.5 Chống leo thang quyền

Các test trong backend cho thấy hệ thống đã có nhiều cơ chế chống bypass hoặc privilege escalation, ví dụ:

- kiểm tra biên giới authorization
- kiểm tra branch isolation
- kiểm tra scope của permission
- kiểm tra normalize permission self
- kiểm tra anti-escalation

Điều đó phản ánh rằng phân quyền hiện tại không chỉ là “set quyền rồi dùng”, mà đã có tư duy bảo vệ biên giới quyền khá rõ.

---

## 6. Các nhóm permission chính trong hệ thống

### 6.1 Nhóm analytics

Bao gồm:

- đọc analytics theo branch
- đọc analytics theo assigned branches
- đọc analytics global
- đọc analytics cá nhân
- quản lý analytics global

Đây là nhóm có phân tầng rõ nhất giữa dữ liệu cá nhân, dữ liệu chi nhánh và dữ liệu toàn hệ thống.

### 6.2 Nhóm users

Bao gồm:

- đọc users trong branch
- quản lý users trong branch
- quản lý users toàn cục

Nhóm này là một trong những nhóm nhạy cảm nhất, đặc biệt là quyền global.

### 6.3 Nhóm account/self-service

Bao gồm:

- cập nhật profile của chính mình
- quản lý địa chỉ của chính mình
- quản lý cart của chính mình

Nhóm này phục vụ người dùng cuối, thiên về self-service.

### 6.4 Nhóm orders và order workflow

Bao gồm quyền đọc/ghi đơn, audit đơn, phân công đơn, quản lý trạng thái đơn hàng, picker cho đơn trong store, task shipper, và các flow POS.

Đây là nhóm phức tạp nhất vì liên quan nhiều vai trò:

- nhân viên bán hàng
- quản lý đơn
- kho
- shipper
- cashier
- branch admin

### 6.5 Nhóm inventory / warehouse / transfer

Bao gồm:

- đọc và ghi inventory
- đọc và ghi warehouse
- tạo/duyệt/ship/receive transfer
- thao tác pick hàng

Nhóm này có độ nhạy cao vì ảnh hưởng trực tiếp tới tồn kho và vận hành thực tế.

### 6.6 Nhóm product / brand / product type

Bao gồm:

- đọc sản phẩm
- tạo/cập nhật/xóa sản phẩm
- quản lý brand
- quản lý product type

Quyền xóa sản phẩm và các quyền tạo/cập nhật thường được đánh dấu nhạy cảm.

### 6.7 Nhóm content / monitoring / promotion

Bao gồm:

- quản lý nội dung homepage, short video
- đọc monitoring telemetry
- quản lý promotion

Các quyền này thường gắn với role quản trị hoặc quản trị chi nhánh.

### 6.8 Nhóm review

Bao gồm:

- tạo/sửa/xóa review của chính mình
- like review của chính mình
- upload media review
- reply review với staff
- moderate review

Nhóm này thể hiện sự tách biệt giữa quyền người dùng cuối và quyền staff quản trị nội dung phản hồi.

### 6.9 Nhóm POS

Bao gồm:

- tạo đơn POS
- đọc đơn POS của chính mình
- đọc đơn POS theo branch
- xử lý thanh toán
- hủy đơn
- finalize đơn
- xuất VAT invoice

Đây là khu vực có nhiều thao tác nhạy cảm nên thường đi kèm step-up hoặc kiểm soát branch.

### 6.10 Nhóm context

Bao gồm:

- switch branch
- simulate branch

Nhóm này rất quan trọng vì nó ảnh hưởng tới toàn bộ access context hiện tại của user.

---

## 7. Cách frontend đang dùng phân quyền

Frontend có một lớp authorization helper để đọc snapshot quyền từ backend và phục vụ UI.

### 7.1 Authorization snapshot

Frontend hỗ trợ lấy snapshot từ các biến như:

- `authz`
- `authorization`

Từ snapshot này, frontend lấy ra:

- danh sách permissions
- danh sách role keys
- role chính
- trạng thái global admin

### 7.2 Tính route khởi đầu

Frontend có hàm resolve home route dựa trên quyền hiện có. Nghĩa là sau khi đăng nhập, hệ thống sẽ đưa user tới khu vực phù hợp với role/permission.

Ví dụ:

- product permissions → trang warehouse products
- warehouse/inventory permissions → warehouse staff dashboard
- orders permissions → order manager
- POS permissions → cashier hoặc POS dashboard
- task permissions → shipper dashboard
- admin permissions → admin dashboard
- self-service permissions → profile

Điều này giúp trải nghiệm điều hướng gắn trực tiếp với quyền.

### 7.3 Ẩn/hiện UI theo quyền

Frontend có các component như:

- `PermissionGate`
- `ProtectedRoute`
- `SensitiveAction`
- hook kiểm tra permission

Ý nghĩa là UI chỉ hiển thị thành phần nếu user có quyền tương ứng.

### 7.4 Step-up ở frontend

Frontend cũng có helper để nhận diện action nhạy cảm, nhằm hiển thị cảnh báo hoặc badge bảo mật, đồng thời phối hợp với step-up modal / interceptor khi backend yêu cầu xác minh lại.

---

## 8. Cơ chế step-up authentication chi tiết

### 8.1 Action nhạy cảm

Backend khai báo một số action cần step-up, ví dụ:

- `product.delete`
- `analytics.read.global`
- `analytics.manage.global`
- `users.manage.global`
- `promotion.manage`
- `warehouse.write`
- `order.status.manage`

### 8.2 Nhóm action dùng chung grace period

Các action nhạy cảm được gom thành nhóm:

- `PRODUCT_BULK_SENSITIVE`
- `FINANCIAL_EXPORT`
- `USER_ADMIN`
- `INVENTORY_ADJUST`
- `ORDER_BULK_SENSITIVE`
- `PROMOTION_ADMIN`

Sau khi user step-up thành công cho một action trong nhóm, các action cùng nhóm có thể được mở trong khoảng grace period nhất định.

### 8.3 Ý nghĩa nghiệp vụ

Cơ chế này giúp cân bằng giữa:

- **an toàn**: không cho phép thao tác nhạy cảm một cách vô ý
- **trải nghiệm**: không ép người dùng xác minh lại quá thường xuyên

---

## 9. Nhận xét về mức độ trưởng thành của hệ thống phân quyền hiện tại

### 9.1 Điểm mạnh

1. **Có catalog quyền rõ ràng**: quyền được định danh tập trung, tránh rải rác hard-code.
2. **Có scope rõ ràng**: phân biệt self, task, branch, global.
3. **Có role mapping rõ ràng**: dễ hiểu theo nghiệp vụ.
4. **Có user override / permission grant**: linh hoạt hơn RBAC thuần túy.
5. **Có step-up cho hành động nhạy cảm**: tăng bảo mật đáng kể.
6. **Có kiểm soát frontend và backend**: UX tốt hơn và an toàn hơn.
7. **Có nhiều test bảo vệ biên giới quyền**: cho thấy hệ thống đã được harden tương đối kỹ.

### 9.2 Điểm cần lưu ý

1. **Số lượng permission khá lớn**: việc quản trị cần có tài liệu và quy ước tốt.
2. **Tên quyền đang mang nhiều logic nghiệp vụ**: dễ đọc nhưng cần chuẩn hóa để tránh lệch giữa frontend và backend.
3. **Một số route / dashboard phụ thuộc mạnh vào permission snapshot**: nếu snapshot sai sẽ ảnh hưởng trực tiếp đến điều hướng UI.
4. **Step-up cần đồng bộ backend - frontend**: nếu một bên thay đổi mà bên kia không cập nhật sẽ gây lỗi trải nghiệm.
5. **Branch context là rủi ro lớn nhất**: nếu resolve sai `activeBranchId`, user có thể bị chặn nhầm hoặc thấy dữ liệu sai phạm vi.

---

## 10. Cách hệ thống xử lý người dùng theo từng nhóm

### 10.1 Người dùng thường / customer

User loại này chủ yếu dùng các quyền self-service:

- cập nhật profile
- quản lý địa chỉ
- quản lý cart
- áp dụng promotion cho đơn của mình
- tạo/sửa/xóa review của mình
- xem đơn của mình

### 10.2 Nhân viên bán hàng / sales staff

Nhóm này có thể:

- xem và xử lý đơn
- tạo đơn POS
- xem device, warranty
- xem analytics cá nhân
- chuyển chi nhánh context

### 10.3 Quản lý chi nhánh / branch admin

Đây là nhóm quyền rộng, có thể:

- quản lý users trong branch
- thao tác đơn hàng
- quản lý kho, sản phẩm, warehouse
- quản lý nội dung, promotion, monitoring
- xử lý review reply/moderation
- thao tác POS branch-level

### 10.4 Quản lý kho / warehouse manager, warehouse staff

Các quyền tập trung vào:

- inventory
- warehouse
- transfer
- device
- warranty
- workflow xử lý đơn liên quan kho

### 10.5 Quản lý đơn hàng / order manager

Tập trung vào:

- theo dõi, sửa, phân công đơn
- audit đơn
- phối hợp carrier/store
- xử lý trạng thái đơn

### 10.6 Cashier / POS staff

Tập trung vào:

- tạo đơn POS
- xử lý thanh toán
- xuất VAT
- finalize / cancel đơn
- thao tác theo chi nhánh

### 10.7 Shipper

Chỉ tập trung vào:

- task được giao
- cập nhật trạng thái task
- xem đơn được assign

### 10.8 Global admin

Là nhóm có quyền cao nhất, thường có toàn quyền truy cập và quản trị hệ thống.

---

## 11. Luồng triển khai phân quyền khi một request đi vào hệ thống

Một request thường đi qua chuỗi kiểm tra như sau:

1. Người dùng đã đăng nhập hay chưa.
2. Có token hợp lệ hay không.
3. User có role / permission cần thiết không.
4. Permission có đúng scope không.
5. Có đang ở đúng branch context không.
6. Nếu là action nhạy cảm, có step-up token hợp lệ không.
7. Nếu là thao tác trên resource cụ thể, resource đó có thuộc phạm vi user không.
8. Nếu tất cả hợp lệ thì request mới được xử lý.

Cách tiếp cận này giúp hệ thống tránh lỗi kiểu “có quyền chung nhưng thao tác sai tài nguyên”.

---

## 12. Các file / module quan trọng liên quan đến phân quyền hiện tại

### Backend

- `backend/src/authz/actions.js`
- `backend/src/authz/permissionCatalog.js`
- `backend/src/authz/authorizationService.js`
- `backend/src/authz/policyEngine.js`
- `backend/src/authz/permissionResolver.js`
- `backend/src/authz/userPermissionService.js`
- `backend/src/authz/roleAssignmentService.js`
- `backend/src/middleware/authz/checkPermission.js`
- `backend/src/middleware/authz/requireStepUp.js`
- `backend/src/middleware/authz/resolveAccessContext.js`
- các model: `Permission`, `Role`, `UserPermissionGrant`, `UserRoleAssignment`, `PermissionGroup`, `StepUpToken`, `StepUpGracePeriod`, `AuthzAuditLog`

### Frontend

- `frontend/src/features/auth/lib/authorization.js`
- `frontend/src/features/auth/components/PermissionGate.jsx`
- `frontend/src/features/auth/components/SensitiveAction.jsx`
- `frontend/src/app/router/guards/ProtectedRoute.jsx`
- `frontend/src/shared/lib/http/stepUpInterceptor.js`
- `frontend/src/features/auth/hooks/usePermission.js`
- `frontend/src/features/auth/hooks/useStepUp.js`

---

## 13. Kết luận

Phần phân quyền user hiện tại của dự án là một hệ thống tương đối đầy đủ và đã đi xa hơn RBAC cơ bản. Hệ thống hiện tại có các đặc điểm nổi bật:

- quản lý quyền theo catalog tập trung
- có role và permission song song
- hỗ trợ nhiều scope truy cập
- có context theo chi nhánh và nhiệm vụ
- có step-up cho hành động nhạy cảm
- có cơ chế chống vượt quyền tương đối tốt
- có frontend hỗ trợ ẩn/hiện UI theo quyền

Nếu mô tả ngắn gọn nhất, có thể xem đây là một hệ thống:

**RBAC mở rộng + permission-based authorization + scope-based access control + step-up authentication + branch context isolation**.

---

## 14. Gợi ý nếu muốn hoàn thiện thêm tài liệu này

Nếu cần, có thể bổ sung tiếp các phần sau để tài liệu “đủ dùng cho bàn giao”:

1. **Bảng mapping chi tiết role → permission**
2. **Sơ đồ luồng login → resolve quyền → kiểm tra API**
3. **Danh sách API theo từng permission**
4. **Ma trận quyền theo module**
5. **Danh sách trường hợp step-up và thời gian grace period**
6. **Ví dụ thực tế cho từng role**
7. **Quy ước đặt tên permission/role chuẩn hóa cho tương lai**

