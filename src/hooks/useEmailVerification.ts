import { useCallback, useEffect, useRef, useState } from "react";
import { confirmEmailVerificationCode, isEmailVerified, sendEmailVerificationCode } from "../services/authService";
import { describeVerificationError } from "../utils/authErrors";

/** Seconds before "Resend" is available again (Cognito also limits sends on its side). */
export const RESEND_COOLDOWN_SECONDS = 60;

export type VerificationStatus = "checking" | "verified" | "unverified" | "error";

/**
 * Email verification of the signed-in account. The first code is sent automatically once; "Resend"
 * is allowed again after a cooldown. Codes are generated, expired (24 h) and made single-use by
 * Cognito; they are typed by the user, never put in a URL.
 */
export function useEmailVerification() {
  const [status, setStatus] = useState<VerificationStatus>("checking");
  const [destination, setDestination] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const autoSent = useRef(false);

  const send = useCallback(async () => {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      setDestination(await sendEmailVerificationCode());
      setNotice("We sent a 6-digit code. It expires in 24 hours.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(describeVerificationError(err));
    } finally {
      setSending(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    isEmailVerified()
      .then((verified) => {
        if (cancelled) return;
        setStatus(verified ? "verified" : "unverified");
        if (!verified && !autoSent.current) {
          autoSent.current = true; // StrictMode runs effects twice: send once
          void send();
        }
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [send]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const confirm = useCallback(async (code: string): Promise<boolean> => {
    setConfirming(true);
    setError(null);
    setNotice(null);
    try {
      await confirmEmailVerificationCode(code);
      setStatus("verified");
      return true;
    } catch (err) {
      setError(describeVerificationError(err));
      return false;
    } finally {
      setConfirming(false);
    }
  }, []);

  return { status, destination, sending, confirming, error, notice, cooldown, send, confirm };
}
