"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Header auth button: "เข้าสู่ระบบ" (→ /center/login) when logged out,
 * "บัญชีของฉัน" (→ /account) when a session exists. SSR renders the
 * logged-out state; the client swaps after hydration.
 */
export default function AccountNavButton() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    let mounted = true;
    sb.auth.getSession().then(({ data }) => {
      if (mounted) setLoggedIn(!!data.session);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (mounted) setLoggedIn(!!session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const cls =
    "inline-flex items-center gap-1.5 rounded-lg border border-white/30 px-3 py-1.5 text-white/90 hover:bg-white/10 transition whitespace-nowrap";

  return loggedIn ? (
    <Link href="/account" className={cls}>
      บัญชีของฉัน
    </Link>
  ) : (
    <a href="/center/login" className={cls}>
      เข้าสู่ระบบ
    </a>
  );
}
