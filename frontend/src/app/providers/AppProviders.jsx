import React, { useEffect } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthFlowProvider } from "@/features/auth/context/AuthFlowContext";

const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

const ProviderContent = ({ children }) => (
  <>
    <ScrollToTop />
    <Toaster position="bottom-right" richColors />
    {children}
  </>
);

const AppProviders = ({ children }) => (
  <BrowserRouter>
    <AuthFlowProvider>
      <ProviderContent>{children}</ProviderContent>
    </AuthFlowProvider>
  </BrowserRouter>
);

export default AppProviders;
