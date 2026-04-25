"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { confirmPasswordReset } from "@/lib/api";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPw) {
      setError("Passwords do not match.");
      return;
    }

    if (!token) {
      setError("Invalid or missing reset token.");
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset(token, password);
      setSuccess(true);
    } catch (err: any) {
      setError(err?.error?.message || "Failed to reset password. The link may have expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-600 text-white font-bold text-xl mb-4">
            D
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set new password</h1>
        </div>

        <div className="card p-6">
          {success ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-4 text-xl">
                ✓
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Password reset!</h2>
              <p className="text-sm text-gray-500 mb-4">
                Your password has been changed. You can now sign in.
              </p>
              <Link href="/login" className="btn-primary inline-block">
                Sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {!token && (
                <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-700">
                  No reset token found. Please use the link from your email.
                </div>
              )}

              <div>
                <label htmlFor="password" className="label">New password</label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  placeholder="Min 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>

              <div>
                <label htmlFor="confirm" className="label">Confirm password</label>
                <input
                  id="confirm"
                  type="password"
                  className="input"
                  placeholder="Repeat your password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  minLength={8}
                  required
                />
              </div>

              <button type="submit" className="btn-primary w-full" disabled={loading || !token}>
                {loading ? "Resetting..." : "Reset password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
