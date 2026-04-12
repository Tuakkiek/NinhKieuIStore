const fs = require('fs');

const file = 'c:/Project_1/v-24/SmartMobileStore/frontend/src/features/account/pages/ProfilePage.jsx';
let content = fs.readFileSync(file, 'utf8');

// Replace import
content = content.replace('import { useAuthStore } from "@/features/auth";', 'import { useAuthStore, authAPI } from "@/features/auth";');

// Replace states
const statesRegex = /const \[success, setSuccess\] = useState\(""\);/g;
const statesReplace = `const [success, setSuccess] = useState("");

  const [showVerifyDialog, setShowVerifyDialog] = useState(false);
  const [verifyStep, setVerifyStep] = useState(1);
  const [otpCode, setOtpCode] = useState("");
  const [verifySession, setVerifySession] = useState(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");`;
content = content.replace(statesRegex, statesReplace);

// Replace Form inputs / labels
const emailFieldRegex = /<div className="space-y-2">\s*<Label htmlFor="email">Email<\/Label>\s*<Input\s*id="email"\s*name="email"\s*type="email"\s*value={formData\.email}\s*onChange={handleChange}\s*\/>\s*<\/div>/g;
const emailFieldReplace = `<div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="email">Email</Label>
              {user?.email && user?.email === formData.email && (
                <Badge variant={user?.emailVerified ? "default" : "destructive"} className={user?.emailVerified ? "bg-green-500" : ""}>
                  {user?.emailVerified ? "Đã xác thực" : "Chưa xác thực"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                className="flex-1"
              />
              {!user?.emailVerified && formData.email && formData.email === user?.email && (
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setVerifyStep(1);
                    setOtpCode("");
                    setVerifyError("");
                    setShowVerifyDialog(true);
                  }}
                >
                  Xác thực
                </Button>
              )}
            </div>
          </div>`;
content = content.replace(emailFieldRegex, emailFieldReplace);

// Replace button + add dialog
const submitButtonRegex = /<Button type="submit" disabled={isLoading} className="w-full">\s*{isLoading \? "Đang cập nhật\.\.\." : "Cập nhật thông tin"}\s*<\/Button>\s*<\/form>\s*<\/CardContent>\s*<\/Card>\s*\);\s*};/g;
const submitButtonReplace = `<Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? "Đang cập nhật..." : "Cập nhật thông tin"}
          </Button>
        </form>

        <Dialog open={showVerifyDialog} onOpenChange={setShowVerifyDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Xác thực Email</DialogTitle>
              <DialogDescription>
                Hệ thống sẽ gửi một mã OTP gồm 6 chữ số đến <strong>{formData.email}</strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4">
              {verifyError && <ErrorMessage message={verifyError} />}
              
              {verifyStep === 1 ? (
                <div className="flex justify-center">
                  <Button 
                    type="button"
                    onClick={async () => {
                      setVerifyLoading(true);
                      setVerifyError("");
                      try {
                        const res = await authAPI.sendEmailOTP({ email: formData.email });
                        if (res.data?.success) {
                          setVerifySession(res.data.data.sessionId);
                          setVerifyStep(2);
                        }
                      } catch (err) {
                        setVerifyError(err.response?.data?.message || "Lỗi gửi OTP");
                      } finally {
                        setVerifyLoading(false);
                      }
                    }} 
                    disabled={verifyLoading} className="w-full"
                  >
                    {verifyLoading ? "Đang gửi..." : "Gửi mã OTP"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nhập mã OTP</Label>
                    <Input
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="• • • • • •"
                      className="text-center text-lg tracking-widest"
                      maxLength={6}
                    />
                  </div>
                  <Button 
                    type="button"
                    onClick={async () => {
                      setVerifyLoading(true);
                      setVerifyError("");
                      try {
                        const res = await authAPI.verifyEmailOTP({
                          sessionId: verifySession,
                          otp: otpCode,
                        });
                        if (res.data?.success) {
                          setShowVerifyDialog(false);
                          toast.success("Xác thực email thành công! 🎉");
                          onUpdate();
                        }
                      } catch (err) {
                        setVerifyError(err.response?.data?.message || "Mã không hợp lệ");
                      } finally {
                        setVerifyLoading(false);
                      }
                    }} 
                    disabled={verifyLoading || otpCode.length !== 6} 
                    className="w-full"
                  >
                    {verifyLoading ? "Đang xử lý..." : "Xác nhận"}
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};`;
content = content.replace(submitButtonRegex, submitButtonReplace);

fs.writeFileSync(file, content);
console.log("Updated UI script ran successfully");
