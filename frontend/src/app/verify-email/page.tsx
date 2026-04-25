"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { verifyEmail } from "@/lib/api";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("No verification token found.");
      return;
    }

    verifyEmail(token)
      .then(() => {
        setStatus("success");
        setMessage("Your email has been verified!");
      })
      .catch((err: any) => {
        setStatus("error");
        setMessage(err?.error?.message || "Verification failed. The link may have expired.");
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-600 text-white font-bold text-xl mb-4">
            D
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Email Verification</h1>
        </div>

        <div className="card p-6 text-center">
          {status === "loading" && (
            <>
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600 mx-auto mb-4" />
              <p className="text-sm text-gray-500">Verifying your email...</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-4 text-xl">
                ✓
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">{message}</h2>
              <p className="text-sm text-gray-500 mb-4">You can now use all features.</p>
              <Link href="/dashboard" className="btn-primary inline-block">
                Go to Dashboard
              </Link>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4 text-xl">
                !
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Verification Failed</h2>
              <p className="text-sm text-gray-500 mb-4">{message}</p>
              <Link href="/login" className="btn-primary inline-block">
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
