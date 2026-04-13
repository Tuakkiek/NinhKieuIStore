# Fix IPv6 ENETUNREACH Error on Render Forgot-Password API Call

## Status: ✅ Plan Approved, Implementation Started

## Steps:

1. ✅ **Create TODO.md** - Done
2. ✅ **Update `src/shared/lib/http/httpClient.js`**: Added smart BASE_URL prod fallback (`window.location.origin/api`), network retry interceptor (3x exponential backoff for ENETUNREACH/ERR_NETWORK), enhanced logging + prod warning
3. [ ] **Local test**: `cd SmartMobileStore/frontend && npm run dev`, test forgot-password flow
4. [ ] **Build test**: `npm run build`, check console logs
5. [ ] **Deploy to Render**: Push changes, redeploy service
6. [ ] **Set Render Env Var**: Dashboard → Environment → Add `VITE_API_URL=https://ninhkieu-istore-ct.onrender.com/api` (recommended for optimal perf)
7. [ ] **Prod test**: Visit https://ninhkieu-istore-ct.onrender.com/forgot-password, submit email `tuankiet12032005@gmail.com`, verify success/no ENETUNREACH (retries shown if fails)
8. [ ] **Monitor**: Check browser console for retry logs/warnings
9. ✅ **Complete task**

## Backend Optional:

- Update `backend/src/server.js`: `app.listen(PORT, '::')` for IPv6 dual-stack support

_Created by BLACKBOXAI_
