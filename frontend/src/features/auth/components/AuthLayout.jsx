import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { cn } from "@/shared/lib/utils";

const AuthLayout = ({
  title,
  description,
  children,
  footer,
  className,
}) => (
  <div className="relative min-h-screen overflow-hidden bg-slate-100">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,#f59e0b_0%,transparent_42%),radial-gradient(circle_at_bottom_right,#0f172a_0%,transparent_46%)] opacity-20" />

    <div className="relative mx-auto flex min-h-screen w-full items-center justify-center p-4 sm:p-6 lg:p-8">
      <Card className={cn("mx-auto w-full max-w-md border-0 bg-white/95 shadow-2xl backdrop-blur", className)}>
        <CardHeader className="space-y-3 pb-4">
          <CardTitle className="text-2xl font-semibold text-slate-900">{title}</CardTitle>
          {description ? <CardDescription className="text-sm text-slate-600">{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="space-y-5">
          {children}
          {footer ? <div className="pt-2">{footer}</div> : null}
        </CardContent>
      </Card>
    </div>
  </div>
);

export default AuthLayout;

