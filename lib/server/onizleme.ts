/**
 * lib/server/onizleme.ts
 * Önizleme (Preview) ortamı bayrağı. Yalnızca önizleme Worker'ında HITY7_ONIZLEME=1 tanımlıdır; canlıda tanımlı değildir.
 * Önizlemede gerçek ödeme ve bakiye hareketi yapılamaz (sunucu tarafında da reddedilir).
 */
import { fail } from "./supa";

export const onizlemeMi = () => process.env.HITY7_ONIZLEME === "1";

export const onizlemeKapali = () =>
  fail("Bu bir önizleme ortamı. Ödeme ve bakiye işlemleri burada kapalıdır.", 403, { onizleme: true });
