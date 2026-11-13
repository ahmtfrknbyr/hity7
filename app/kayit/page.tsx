"use client";

import { useEffect } from "react";

export default function KayitPage() {
  useEffect(() => {
    window.location.replace("/giris?tab=kayit");
  }, []);
  return null;
}
