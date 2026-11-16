"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { uploadOrderFiles, type UploadedFile } from "../../lib/siparis";
import { useSiteContent } from "../../lib/use-site-content";
import { getSupabase } from "../../lib/supabase";
import EkHizmetKarti from "../../components/EkHizmetKarti";
import { istekKimligi, sendOrder } from "../../lib/siparis";
import SozlesmeOnay from "../../components/SozlesmeOnay";
import SiparisOnizleme from "../../components/SiparisOnizleme";
import { addonFor } from "../../lib/sepet-hesap";

type Service = "mix" | "stems";

type Producer = {
  id: string;
  name: string;
  role: string;
  description: string;
  hity7: boolean;
  mixPrice: number;
  stemsPrice: number;
  initials: string;
};

/**
 * ÖRNEK ÇALIŞMALAR ("Farkı kendin duy")
 * Yönetim paneli → Prodüktörler → "Mix & Mastering sayfası · örnek çalışmalar" bölümünden yüklenir
 * (samples tablosu, page = 'mix'). Önce ve sonra dosyası olan her örnek burada bir oynatıcı olarak görünür.
 * Hiç örnek yoksa bölüm gösterilmez (bozuk oynatıcı görünmez).
 */
type MixSample = { id: string; title: string | null; a_url: string | null; b_url: string | null };

/** Yönetim panelinden prodüktör listesi gelmezse kullanılan varsayılanlar (fiyatlar sunucuda yeniden hesaplanır). */
const FALLBACK_PRODUCERS: Producer[] = [
  {
    id: "hity7",
    name: "HITY7 Prodüktörleri",
    role: "HITY7 Official Team",
    description:
      "HITY7 bünyesindeki profesyonel mix ve mastering ekibi.",
    hity7: true,
    mixPrice: 3000,
    stemsPrice: 10000,
    initials: "H7",
  },
  {
    id: "producer1",
    name: "Prodüktör 01",
    role: "Rap / Trap / Drill",
    description: "Rap, trap ve drill müzik üzerine uzmanlaşmış bağımsız prodüktör.",
    hity7: false,
    mixPrice: 4500,
    stemsPrice: 12000,
    initials: "P1",
  },
  {
    id: "producer2",
    name: "Prodüktör 02",
    role: "Melodik Rap / R&B / Pop",
    description: "Melodik vokal ve modern müzik prodüksiyonu.",
    hity7: false,
    mixPrice: 5000,
    stemsPrice: 15000,
    initials: "P2",
  },
  {
    id: "producer3",
    name: "Prodüktör 03",
    role: "Hip-Hop / Boom Bap",
    description: "Old school ve modern hip-hop mix çalışmaları.",
    hity7: false,
    mixPrice: 4000,
    stemsPrice: 11000,
    initials: "P3",
  },
];

const money = (amount: number) =>
  new Intl.NumberFormat("tr-TR").format(amount) + " TL";

/* ------------------------------------------------------------------ */
/*  AI MIX: tarayıcıda çalışan, ses analizine göre ayarlanan mix zinciri */
/* ------------------------------------------------------------------ */

const STYLE_PRESETS: Record<
  string,
  { low: number; mud: number; pres: number; air: number; ratio: number }
> = {
  "Modern / Parlak": { low: 2, mud: -2.5, pres: 2.5, air: 3, ratio: 3 },
  "Karanlık / Sert": { low: 3, mud: -1.5, pres: 1.5, air: -1, ratio: 4 },
  "Doğal / Temiz": { low: 0.5, mud: -1.5, pres: 1, air: 1.5, ratio: 2 },
  "Trap / Agresif": { low: 4, mud: -3, pres: 3, air: 2, ratio: 4 },
  "Melodik / Atmosferik": { low: 1.5, mud: -2, pres: 1.5, air: 3.5, ratio: 2.5 },
  "Old School": { low: 2, mud: -1, pres: 0.5, air: -2, ratio: 3 },
};

const VOCAL_PRESENCE: Record<string, number> = {
  "Beat'in önünde ve net": 1,
  "Beat ile dengeli": 0,
  "Beat'in içinde ve atmosferik": -1,
  "Güçlü ve yüksek": 1.5,
  "Daha doğal ve yumuşak": -0.5,
};

const REVERB_LEVEL: Record<string, number> = { Yok: 0, Az: 0.12, Orta: 0.22, Yoğun: 0.38 };
const DELAY_LEVEL: Record<string, number> = { Yok: 0, Az: 0.08, Orta: 0.16, Yoğun: 0.28 };

const clampNum = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function encodeWav(channels: Float32Array[], sampleRate: number) {
  const frames = channels[0].length;
  const nc = channels.length;
  const buffer = new ArrayBuffer(44 + frames * nc * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + frames * nc * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, nc, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * nc * 2, true);
  view.setUint16(32, nc * 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, frames * nc * 2, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nc; c++) {
      const s = clampNum(channels[c][i], -1, 1);
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 40));

async function runAiMix(
  file: File,
  opts: { style: string; vocal: string; reverb: string; delay: string },
  onStage: (text: string) => void
): Promise<Blob> {
  onStage("Dosya okunuyor…");
  await tick();
  const Ctx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    ctx.close();
  }
  if (decoded.duration > 480) {
    throw new Error("Şarkı 8 dakikadan uzun olamaz.");
  }

  onStage("Ses analiz ediliyor…");
  await tick();
  const sr = decoded.sampleRate;
  const src0 = decoded.getChannelData(0);
  let sum = 0;
  let peak = 0;
  let crossings = 0;
  let prev = 0;
  for (let i = 0; i < src0.length; i++) {
    const x = src0[i];
    sum += x * x;
    const ax = Math.abs(x);
    if (ax > peak) peak = ax;
    if (x >= 0 !== prev >= 0) crossings++;
    prev = x;
  }
  const rms = Math.sqrt(sum / src0.length) || 1e-6;
  const rmsDb = 20 * Math.log10(rms);
  const dominant = ((crossings / src0.length) * sr) / 2;
  // Parlaklık analizi: karanlık kayıtlara biraz parlaklık, aşırı parlaklara yumuşaklık
  const brightAdj = clampNum((2200 - dominant) / 700, -2, 2);

  const preset = STYLE_PRESETS[opts.style] || STYLE_PRESETS["Modern / Parlak"];
  const vocalAdj = VOCAL_PRESENCE[opts.vocal] ?? 0;
  const reverbWet = (REVERB_LEVEL[opts.reverb] ?? 0.2) * (opts.vocal.includes("atmosferik") ? 1.3 : 1);
  const delayWet = DELAY_LEVEL[opts.delay] ?? 0.1;

  onStage("Mix zinciri uygulanıyor…");
  await tick();
  const tail = reverbWet > 0 || delayWet > 0 ? 2.6 : 0.2;
  const off = new OfflineAudioContext(
    2,
    Math.ceil((decoded.duration + tail) * sr),
    sr
  );
  const source = off.createBufferSource();
  source.buffer = decoded;

  const hp = off.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 35;

  const low = off.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 110;
  low.gain.value = preset.low;

  const mud = off.createBiquadFilter();
  mud.type = "peaking";
  mud.frequency.value = 320;
  mud.Q.value = 1;
  mud.gain.value = preset.mud;

  const pres = off.createBiquadFilter();
  pres.type = "peaking";
  pres.frequency.value = 3200;
  pres.Q.value = 0.9;
  pres.gain.value = preset.pres + vocalAdj + brightAdj * 0.6;

  const air = off.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = 9000;
  air.gain.value = preset.air + brightAdj * 0.8;

  const comp = off.createDynamicsCompressor();
  comp.threshold.value = clampNum(rmsDb + 3, -36, -10);
  comp.ratio.value = preset.ratio;
  comp.knee.value = 12;
  comp.attack.value = 0.012;
  comp.release.value = 0.2;

  const master = off.createGain();
  master.gain.value = 1;

  source.connect(hp);
  hp.connect(low);
  low.connect(mud);
  mud.connect(pres);
  pres.connect(air);
  air.connect(comp);
  comp.connect(master);

  if (reverbWet > 0) {
    const conv = off.createConvolver();
    conv.buffer = makeImpulse(off, 1.9, 3.2);
    const rLow = off.createBiquadFilter();
    rLow.type = "lowpass";
    rLow.frequency.value = 7000;
    const rGain = off.createGain();
    rGain.gain.value = reverbWet;
    comp.connect(conv);
    conv.connect(rLow);
    rLow.connect(rGain);
    rGain.connect(master);
  }

  if (delayWet > 0) {
    const delay = off.createDelay(1);
    delay.delayTime.value = 0.3;
    const fb = off.createGain();
    fb.gain.value = 0.32;
    const dLow = off.createBiquadFilter();
    dLow.type = "lowpass";
    dLow.frequency.value = 4200;
    const dGain = off.createGain();
    dGain.gain.value = delayWet;
    comp.connect(delay);
    delay.connect(dLow);
    dLow.connect(fb);
    fb.connect(delay);
    dLow.connect(dGain);
    dGain.connect(master);
  }

  master.connect(off.destination);
  source.start();
  const rendered = await off.startRendering();

  onStage("Mastering uygulanıyor…");
  await tick();
  const left = new Float32Array(rendered.getChannelData(0));
  const right = new Float32Array(
    rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0)
  );
  let rs = 0;
  for (let i = 0; i < left.length; i++) rs += left[i] * left[i] + right[i] * right[i];
  const outRms = Math.sqrt(rs / (left.length * 2)) || 1e-6;
  const gainDb = clampNum(-13 - 20 * Math.log10(outRms), -6, 12);
  const g = Math.pow(10, gainDb / 20);
  let outPeak = 0;
  for (let i = 0; i < left.length; i++) {
    left[i] = Math.tanh(left[i] * g * 0.9);
    right[i] = Math.tanh(right[i] * g * 0.9);
    const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (a > outPeak) outPeak = a;
  }
  const norm = outPeak > 0 ? 0.944 / outPeak : 1;
  for (let i = 0; i < left.length; i++) {
    left[i] *= norm;
    right[i] *= norm;
  }

  onStage("Dosya hazırlanıyor…");
  await tick();
  return encodeWav([left, right], sr);
}

/**
 * HITY7 çocuğu: Pixar tarzı mascot.
 * - Gözleri fareyi takip eder, göz kırpar, el sallar.
 * - Şifre alanına odaklanınca gözlerini kapatır (şifre gösteriliyorsa kapatmaz).
 * - Tıklayınca zıplayıp takla atar.
 * Form mantığına dokunmaz; sadece sayfadaki input odak olaylarını dinler.
 */
function KidMascot() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const q = (id: string) => svg.querySelector<SVGGElement>("#" + id)!;
    const rootEl = q("k-root"), bodyEl = q("k-body");
    const legL = q("k-legL"), legR = q("k-legR"), armL = q("k-armL"), armR = q("k-armR"), headEl = q("k-head");
    const eyeL = q("k-eyeL"), eyeR = q("k-eyeR"), irisL = q("k-irisL"), irisR = q("k-irisR");
    const browL = q("k-browL"), browR = q("k-browR");
    const mSmile = q("m-smile"), mGrin = q("m-grin"), mO = q("m-o");

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const easeIO = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

    const P = { aL: 8, aR: 8, head: 0, brow: 0 };
    let cover = false;
    let mx: number | null = null, my = 0;
    let time = 0, blinkT = 2.2, blinkU = 0, hop = 0, hopDir = 1;
    let mouth = "";
    let raf = 0, last = performance.now();

    const setMouth = (k: string) => {
      if (k === mouth) return;
      mouth = k;
      mSmile.style.display = k === "smile" ? "" : "none";
      mGrin.style.display = k === "grin" ? "" : "none";
      mO.style.display = k === "o" ? "" : "none";
    };

    const isPw = (t: EventTarget | null) =>
      t instanceof HTMLInputElement && t.type === "password";
    const onFocusIn = (e: FocusEvent) => { cover = isPw(e.target); };
    const onFocusOut = () => { cover = false; };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") { mx = null; return; }
      mx = e.clientX; my = e.clientY;
    };
    const onClick = () => { if (hop <= 0) { hop = 0.6; hopDir = Math.random() < 0.5 ? 1 : -1; } };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("pointermove", onMove, { passive: true });
    svg.addEventListener("click", onClick);
    cover = isPw(document.activeElement);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      if (document.hidden || dt <= 0) return;
      time += dt;

      let aL = 8, aR = 8, head = 0, brow = 0, m = "smile", arc = 0, rot = 0;
      if (hop > 0) {
        hop -= dt;
        const u = 1 - Math.max(hop, 0) / 0.6;
        arc = 70 * 4 * u * (1 - u);
        rot = reduced ? 0 : hopDir * 360 * easeIO(u);
        aL = 140; aR = 140; m = "o"; brow = -3;
      } else if (cover) {
        aL = -164; aR = -164; head = 3; m = "smile"; brow = 1;
      } else {
        aR = reduced ? 125 : 125 + 24 * Math.sin(time * 8);
        head = 4; m = "grin";
      }
      const k = reduced ? 1 : 1 - Math.exp(-dt * 12);
      P.aL += (aL - P.aL) * k; P.aR += (aR - P.aR) * k;
      P.head += (head - P.head) * k; P.brow += (brow - P.brow) * k;
      armL.setAttribute("transform", "rotate(" + P.aL.toFixed(1) + ")");
      armR.setAttribute("transform", "rotate(" + (-P.aR).toFixed(1) + ")");
      legL.setAttribute("transform", "rotate(2)");
      legR.setAttribute("transform", "rotate(-2)");
      headEl.setAttribute("transform", "rotate(" + P.head.toFixed(1) + " 0 32)");
      browL.setAttribute("transform", "translate(0 " + (-P.brow * 1.6).toFixed(2) + ")");
      browR.setAttribute("transform", "translate(0 " + (-P.brow * 1.6).toFixed(2) + ")");
      setMouth(m);

      let lx = 0.6, ly = 0.6;
      if (cover) { lx = 0; ly = 1.2; }
      else if (mx !== null) {
        const r = svg.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height * 0.35;
        lx = clamp((mx - cx) / 260, -1, 1) * 2.6;
        ly = clamp((my - cy) / 260, -1, 1) * 2;
      }
      const pt = "translate(" + lx.toFixed(2) + " " + ly.toFixed(2) + ")";
      irisL.setAttribute("transform", pt); irisR.setAttribute("transform", pt);

      blinkT -= dt;
      if (blinkT < 0) { blinkU = 0.13; blinkT = 2.6 + Math.random() * 2.8; }
      let bl = 1;
      if (blinkU > 0) { blinkU -= dt; bl = 0.1; }
      eyeL.setAttribute("transform", "translate(-12.5 3) scale(1 " + bl + ")");
      eyeR.setAttribute("transform", "translate(12.5 3) scale(1 " + bl + ")");

      const bob = reduced ? 0 : Math.sin(time * 2.4) * 1.6;
      bodyEl.setAttribute("transform", "translate(0 " + (bob - arc).toFixed(2) + ")");
      rootEl.setAttribute("transform", "translate(0 -90) rotate(" + rot.toFixed(1) + ") translate(0 90)");
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("pointermove", onMove);
      svg.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <>
      <svg ref={ref} className="kid-svg" viewBox="-90 -215 180 245" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="g-skin" cx="0.38" cy="0.3" r="0.8"><stop offset="0" stopColor="#f7d2af"/><stop offset="0.55" stopColor="#e9af86"/><stop offset="1" stopColor="#c98760"/></radialGradient>
        <linearGradient id="g-hood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe269"/><stop offset="0.5" stopColor="#f5c518"/><stop offset="1" stopColor="#dda500"/></linearGradient>
        <linearGradient id="g-pants" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3d3d3d"/><stop offset="1" stopColor="#111"/></linearGradient>
        <radialGradient id="g-shoe" cx="0.4" cy="0.3" r="0.9"><stop offset="0" stopColor="#fff"/><stop offset="1" stopColor="#d6d6d6"/></radialGradient>
        <linearGradient id="g-hair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#34302e"/><stop offset="1" stopColor="#0c0b0b"/></linearGradient>
        <radialGradient id="g-iris" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stopColor="#8a5a35"/><stop offset="1" stopColor="#2b1708"/></radialGradient>
        <linearGradient id="g-cup" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe269"/><stop offset="1" stopColor="#e5b600"/></linearGradient>
      </defs>
      <ellipse cx="0" cy="9" rx="72" ry="20" fill="#000" opacity="0.22"/>
      <ellipse cx="0" cy="4" rx="70" ry="19" fill="#111"/>
      <ellipse cx="0" cy="4" rx="58" ry="15" fill="none" stroke="#2c2c2c" strokeWidth="1.5"/>
      <ellipse cx="0" cy="4" rx="46" ry="12" fill="none" stroke="#2c2c2c" strokeWidth="1.5"/>
      <ellipse cx="0" cy="4" rx="22" ry="6" fill="#f5c518"/>
      <ellipse cx="0" cy="4" rx="3" ry="1" fill="#111"/>
      <g id="k-root">
        <g id="k-body">
          
          <g transform="translate(-9 -62)"><g id="k-legL">
            <rect x="-8" y="-6" width="16" height="56" rx="8" fill="url(#g-pants)"/>
            <rect x="-8" y="-6" width="5" height="56" rx="2.5" fill="#fff" opacity="0.08"/>
            <ellipse cx="-1" cy="53" rx="13.5" ry="7.5" fill="url(#g-shoe)"/>
            <path d="M -14 55.5 Q -1 63 15 55.5 Q 14 62 -1 62 Q -13 62 -14 55.5 Z" fill="#f5c518"/>
          </g></g>
          <g transform="translate(9 -62)"><g id="k-legR">
            <rect x="-8" y="-6" width="16" height="56" rx="8" fill="url(#g-pants)"/>
            <rect x="-8" y="-6" width="5" height="56" rx="2.5" fill="#fff" opacity="0.08"/>
            <ellipse cx="1" cy="53" rx="13.5" ry="7.5" fill="url(#g-shoe)"/>
            <path d="M -15 55.5 Q 1 63 14 55.5 Q 13 62 1 62 Q -14 62 -15 55.5 Z" fill="#f5c518"/>
          </g></g>
          
          <path d="M -23 -112 Q -28 -88 -24 -58 Q 0 -50 24 -58 Q 28 -88 23 -112 Q 0 -122 -23 -112 Z" fill="url(#g-hood)"/>
          <path d="M -13 -76 Q 0 -70 13 -76 L 15 -62 Q 0 -57 -15 -62 Z" fill="#a06e00" opacity="0.22"/>
          <ellipse cx="0" cy="-114" rx="12" ry="5.5" fill="#d79f00"/>
          <path d="M -5 -112 L -6 -92 M 5 -112 L 6 -92" stroke="#111" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
          <circle cx="-6" cy="-91" r="1.9" fill="#111"/><circle cx="6" cy="-91" r="1.9" fill="#111"/>
          <text x="0" y="-80" textAnchor="middle" fontFamily="Bricolage Grotesque, Arial, sans-serif" fontWeight="800" fontSize="11" fill="#111">H7</text>
          <ellipse cx="-13" cy="-96" rx="4" ry="14" fill="#fff" opacity="0.28" transform="rotate(8 -13 -96)"/>
          
          <g transform="translate(-23 -108)"><g id="k-armL">
            <rect x="-7.5" y="-6" width="15" height="38" rx="7.5" fill="url(#g-hood)"/>
            <rect x="-8" y="26" width="16" height="7" rx="3.5" fill="#d79f00"/>
            <circle cx="0" cy="38" r="8.6" fill="url(#g-skin)"/>
            <rect x="-5" y="-4" width="3.6" height="26" rx="1.8" fill="#fff" opacity="0.25"/>
          </g></g>
          <g transform="translate(23 -108)"><g id="k-armR">
            <rect x="-7.5" y="-6" width="15" height="38" rx="7.5" fill="url(#g-hood)"/>
            <rect x="-8" y="26" width="16" height="7" rx="3.5" fill="#d79f00"/>
            <circle cx="0" cy="38" r="8.6" fill="url(#g-skin)"/>
            <rect x="-5" y="-4" width="3.6" height="26" rx="1.8" fill="#fff" opacity="0.25"/>
          </g></g>
          
          <g transform="translate(0 -148)"><g id="k-head">
            <path d="M -35 -4 Q -42 -40 -8 -44 Q 8 -52 26 -40 Q 42 -28 35 -2 Q 24 -26 0 -24 Q -22 -22 -35 -4 Z" fill="url(#g-hair)"/>
            <circle cx="-33" cy="5" r="7" fill="#d99a72"/><circle cx="33" cy="5" r="7" fill="#d99a72"/>
            <ellipse cx="0" cy="1" rx="34" ry="32" fill="url(#g-skin)"/>
            <ellipse cx="-12" cy="-14" rx="11" ry="6" fill="#fff" opacity="0.22" transform="rotate(-20 -12 -14)"/>
            <path d="M -34 -4 Q -32 -34 -4 -37 Q 22 -39 34 -6 Q 24 -22 6 -20 Q -14 -18 -22 -13 Q -28 -11 -34 -4 Z" fill="url(#g-hair)"/>
            <path d="M -3 -37 Q -1 -53 14 -49 Q 5 -47 7 -37 Z" fill="url(#g-hair)"/>
            <path d="M -14 -30 Q -4 -35 6 -31" stroke="#fff" strokeOpacity="0.3" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
            <path d="M -37 4 Q -39 -48 0 -47 Q 39 -48 37 4" fill="none" stroke="#242424" strokeWidth="5" strokeLinecap="round"/>
            <ellipse cx="-37" cy="5" rx="8.5" ry="12.5" fill="url(#g-cup)" stroke="#111" strokeWidth="2.4"/>
            <ellipse cx="37" cy="5" rx="8.5" ry="12.5" fill="url(#g-cup)" stroke="#111" strokeWidth="2.4"/>
            <ellipse cx="-39" cy="2" rx="2.4" ry="4.6" fill="#fff" opacity="0.5"/><ellipse cx="35" cy="2" rx="2.4" ry="4.6" fill="#fff" opacity="0.5"/>
            <ellipse cx="-21" cy="15" rx="6.4" ry="4" fill="#e0715c" opacity="0.32"/><ellipse cx="21" cy="15" rx="6.4" ry="4" fill="#e0715c" opacity="0.32"/>
            
            <g id="k-eyeL" transform="translate(-12.5 3)">
              <ellipse rx="8.4" ry="10" fill="#fff"/>
              <g id="k-irisL"><circle r="6.4" fill="url(#g-iris)"/><circle r="3.2" fill="#0d0603"/><circle cx="-2.2" cy="-3" r="2.2" fill="#fff"/><circle cx="2.6" cy="2.6" r="1" fill="#fff" opacity="0.9"/></g>
              <path d="M -8.6 -4 Q 0 -13 8.6 -4" stroke="#111" strokeWidth="2.4" fill="none" strokeLinecap="round"/>
            </g>
            <g id="k-eyeR" transform="translate(12.5 3)">
              <ellipse rx="8.4" ry="10" fill="#fff"/>
              <g id="k-irisR"><circle r="6.4" fill="url(#g-iris)"/><circle r="3.2" fill="#0d0603"/><circle cx="-2.2" cy="-3" r="2.2" fill="#fff"/><circle cx="2.6" cy="2.6" r="1" fill="#fff" opacity="0.9"/></g>
              <path d="M -8.6 -4 Q 0 -13 8.6 -4" stroke="#111" strokeWidth="2.4" fill="none" strokeLinecap="round"/>
            </g>
            <g id="k-browL"><path d="M -20 -11 Q -12 -17 -5 -12" stroke="#111" strokeWidth="3" fill="none" strokeLinecap="round"/></g>
            <g id="k-browR"><path d="M 5 -12 Q 12 -17 20 -11" stroke="#111" strokeWidth="3" fill="none" strokeLinecap="round"/></g>
            <path d="M -3 14 Q 0 18 3 14" stroke="#b8704c" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
            <ellipse cx="-1" cy="12" rx="2.2" ry="1.4" fill="#fff" opacity="0.45"/>
            
            <path id="m-smile" d="M -9 21 Q 0 29 9 21" stroke="#2a0f0f" strokeWidth="2.7" fill="none" strokeLinecap="round"/>
            <g id="m-grin" style={{ display: "none" }}>
              <path d="M -11 19 Q 0 39 11 19 Z" fill="#2a0f0f"/>
              <path d="M -9.6 19.8 Q 0 24.6 9.6 19.8 Q 0 21.6 -9.6 19.8 Z" fill="#fff"/>
              <ellipse cx="0" cy="30" rx="5.2" ry="3" fill="#f08a7c"/>
            </g>
            <ellipse id="m-o" cx="0" cy="25" rx="4.4" ry="5.6" fill="#2a0f0f" style={{ display: "none" }}/>
          </g></g>
        </g>
      </g>
    </svg>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  ÖNCE / SONRA oynatıcı                                              */
/* ------------------------------------------------------------------ */

function BeforeAfter({
  beforeSrc,
  afterSrc,
  beforeLabel = "ÖNCE",
  afterLabel = "SONRA",
}: {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const aRef = useRef<HTMLAudioElement>(null);
  const bRef = useRef<HTMLAudioElement>(null);
  const [side, setSide] = useState<"before" | "after">("after");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    aRef.current?.pause();
    bRef.current?.pause();
  }, [beforeSrc, afterSrc]);

  useEffect(() => {
    if (aRef.current) aRef.current.muted = side !== "before";
    if (bRef.current) bRef.current.muted = side !== "after";
  }, [side, beforeSrc, afterSrc]);

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    return () => {
      a?.pause();
      b?.pause();
    };
  }, []);

  const active = () => (side === "before" ? aRef.current : bRef.current);
  const other = () => (side === "before" ? bRef.current : aRef.current);

  const toggle = async () => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;
    if (playing) {
      a.pause();
      b.pause();
      setPlaying(false);
    } else {
      try {
        b.currentTime = a.currentTime = active()!.currentTime;
        await Promise.all([a.play(), b.play()]);
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    }
  };

  const seek = (value: number) => {
    const a = aRef.current;
    const b = bRef.current;
    if (a) a.currentTime = Math.min(value, a.duration || value);
    if (b) b.currentTime = Math.min(value, b.duration || value);
    setTime(value);
  };

  const fmt = (n: number) =>
    `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

  return (
    <div className="rounded-3xl border-[2.5px] border-[#111] bg-white p-5 shadow-[0_6px_0_#111] sm:p-6">
      <audio
        ref={aRef}
        src={beforeSrc}
        preload="metadata"
        onEnded={() => setPlaying(false)}
      />
      <audio
        ref={bRef}
        src={afterSrc}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          const cur = side === "after" ? e.currentTarget : aRef.current;
          if (cur) setTime(cur.currentTime);
          const o = other();
          const act = active();
          if (o && act && Math.abs(o.currentTime - act.currentTime) > 0.2) {
            o.currentTime = act.currentTime;
          }
        }}
        onEnded={() => setPlaying(false)}
      />

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Duraklat" : "Oynat"}
          className="grid h-14 w-14 flex-none place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-xl shadow-[0_4px_0_#111] transition hover:-translate-y-0.5 hover:bg-[#e5b600] active:translate-y-[2px] active:shadow-[0_1px_0_#111]"
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <div className="inline-flex rounded-full border-[2.5px] border-[#111] bg-white p-1" role="group" aria-label="Dinleme seçimi">
          {(
            [
              ["before", beforeLabel],
              ["after", afterLabel],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={side === key}
              onClick={() => setSide(key)}
              className={`rounded-full px-4 py-2 text-xs font-bold tracking-[0.1em] transition ${
                side === key ? "bg-[#111] text-[#f5c518]" : "text-[#242424] hover:bg-[#f5f5f5]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="eq ml-auto hidden items-end gap-[3px] sm:flex" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <span
              key={i}
              className={`eq-bar ${playing ? "on" : ""}`}
              style={{ animationDelay: `${(i * 0.11) % 0.9}s` }}
            />
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3 text-xs font-semibold text-[#686868]">
        <span className="w-9 tabular-nums">{fmt(time)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Şarkıda ilerle"
          className="seek h-2 w-full"
        />
        <span className="w-9 text-right tabular-nums">{fmt(duration)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function MixMasteringPage() {
  const [service, setService] = useState<Service>("mix");
  const [producerId, setProducerId] = useState("hity7");
  const [files, setFiles] = useState<File[]>([]);
  const [reference, setReference] = useState<File | null>(null);
  const [mixStyle, setMixStyle] = useState("Modern / Parlak");
  const [vocalPosition, setVocalPosition] = useState(
    "Beat'in önünde ve net"
  );
  const [autotune, setAutotune] = useState("Hafif");
  const [reverb, setReverb] = useState("Orta");
  const [delay, setDelay] = useState("Orta");
  const [notes, setNotes] = useState("");
  const [doneCode, setDoneCode] = useState("");
  const [addonId, setAddonId] = useState("");
  const [onay, setOnay] = useState(false);
  const [onizleme, setOnizleme] = useState(false);
  const [onizHata, setOnizHata] = useState("");
  const [eksik, setEksik] = useState<number | null>(null);
  // Tekrar koruması ve aynı denemede dosyaların ikinci kez yüklenmemesi
  const istekRef = useRef<{ key: string; sig: string } | null>(null);
  const yuklenen = useRef<{ imza: string; out: UploadedFile[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [needLogin, setNeedLogin] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);

  // Prodüktörler ve fiyatları yönetim panelinden (Prodüktörler bölümü) gelir
  const content = useSiteContent();
  const producers: Producer[] = useMemo(() => {
    const list = content.producers
      .filter((p) => p.active !== false)
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        description: p.desc,
        hity7: p.hity7,
        mixPrice: Number(p.mixPrice) || 0,
        stemsPrice: Number(p.stemsPrice) || 0,
        initials: p.hity7
          ? "H7"
          : p.name
              .split(/\s+/)
              .map((w) => w[0] || "")
              .join("")
              .slice(0, 2)
              .toUpperCase() || "P",
      }));
    return list.length ? list : FALLBACK_PRODUCERS;
  }, [content.producers]);
  const sampleProducers = producers.some((p) => /^Prodüktör 0\d$/.test(p.name));

  // Örnek çalışmalar (önce / sonra): yönetim panelinden yüklenenler
  const [samples, setSamples] = useState<MixSample[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await getSupabase()
          .from("samples")
          .select("id,title,a_url,b_url")
          .eq("page", "mix")
          .order("sort", { ascending: true });
        const rows = ((data as MixSample[]) || []).filter((s) => s.a_url && s.b_url);
        if (alive) setSamples(rows);
      } catch {
        /* örnekler okunamazsa bölüm gösterilmez */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [aiStatus, setAiStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [aiStage, setAiStage] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiOriginalUrl, setAiOriginalUrl] = useState<string | null>(null);
  const [aiMixedUrl, setAiMixedUrl] = useState<string | null>(null);
  const [aiFileName, setAiFileName] = useState("");

  const selectedProducer =
    producers.find((producer) => producer.id === producerId) || producers[0];

  const price = useMemo(
    () =>
      service === "mix"
        ? selectedProducer.mixPrice
        : selectedProducer.stemsPrice,
    [service, selectedProducer]
  );

  // Ek hizmet (sepetsiz: aynı siparişe eklenir; fiyat sunucuda yeniden hesaplanır)
  const addonItem = addonId ? addonFor(content, "mix", addonId) : null;
  const addonTotal = addonItem ? addonItem.price : 0;
  const orderTotal = Math.round((price + addonTotal) * 100) / 100;

  const aiCandidate = files.find((file) => !file.name.toLowerCase().endsWith(".zip"));

  useEffect(() => {
    return () => {
      if (aiOriginalUrl) URL.revokeObjectURL(aiOriginalUrl);
      if (aiMixedUrl) URL.revokeObjectURL(aiMixedUrl);
    };
  }, [aiOriginalUrl, aiMixedUrl]);

  async function startAiMix() {
    if (!aiCandidate) return;
    if (aiCandidate.size > 80 * 1024 * 1024) {
      setAiStatus("error");
      setAiError("AI Mix için dosya 80 MB'tan küçük olmalı.");
      return;
    }
    setAiStatus("working");
    setAiError("");
    setAiMixedUrl(null);
    setAiOriginalUrl(null);
    try {
      const blob = await runAiMix(
        aiCandidate,
        { style: mixStyle, vocal: vocalPosition, reverb, delay },
        setAiStage
      );
      setAiFileName(aiCandidate.name.replace(/\.[^.]+$/, ""));
      setAiOriginalUrl(URL.createObjectURL(aiCandidate));
      setAiMixedUrl(URL.createObjectURL(blob));
      setAiStatus("done");
    } catch (error) {
      setAiStatus("error");
      setAiError(
        error instanceof Error && error.message
          ? error.message
          : "Bu dosya okunamadı. WAV veya MP3 ile tekrar dene."
      );
    }
  }

  function addFiles(selected: FileList | null) {
    if (!selected) return;

    // Mix & Mastering: MP3, WAV, ZIP (aynı kural sunucuda da denetlenir)
    const allowed = [".zip", ".wav", ".mp3"];
    const incoming = Array.from(selected);

    const invalid = incoming.filter(
      (file) =>
        !allowed.some((extension) =>
          file.name.toLowerCase().endsWith(extension)
        )
    );

    if (invalid.length > 0) {
      setNotice("Yalnızca MP3, WAV ve ZIP dosyaları yükleyebilirsin.");
      return;
    }

    setFiles((previous) => {
      const combined = [...previous, ...incoming];
      return combined.filter(
        (file, index, array) =>
          array.findIndex(
            (item) =>
              item.name === file.name && item.size === file.size
          ) === index
      );
    });
  }

  /** Sipariş önizlemesini açar (sepet yok: doğrudan sipariş + cüzdandan ödeme). */
  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setNeedLogin(false);
    setDoneCode("");

    if (files.length === 0) {
      setNotice("Lütfen vokal ve beat dosyalarını yükle.");
      return;
    }
    const tooBig = [...files, ...(reference ? [reference] : [])].find((f) => f.size > 50 * 1024 * 1024);
    if (tooBig) {
      setNotice(`“${tooBig.name}” 50 MB'tan büyük. Dosyaları ZIP olarak bölüp tekrar dene.`);
      return;
    }
    if (!onay) {
      setNotice("Siparişi oluşturmak için sözleşme onay kutusunu işaretle.");
      return;
    }
    const { data } = await getSupabase().auth.getSession().catch(() => ({ data: { session: null } }));
    if (!data.session) {
      setNeedLogin(true);
      setNotice("Dosyalarını yükleyip sipariş vermek için giriş yapmalısın.");
      return;
    }
    setOnizHata("");
    setEksik(null);
    setOnizleme(true);
  }

  /** Onay ekranında "Onayla": dosyaları özel depoya yükler, siparişi oluşturur ve tutarı bakiyeden düşer (tek işlem). */
  async function confirmOrder() {
    setSending(true);
    setOnizHata("");
    try {
      const imza = JSON.stringify([...files.map((f) => [f.name, f.size]), reference ? [reference.name, reference.size] : null]);
      let uploaded: UploadedFile[];
      if (yuklenen.current?.imza === imza) uploaded = yuklenen.current.out;
      else {
        const work = await uploadOrderFiles(files, {
          kind: "work",
          hizmet: "mix",
          onBytes: (l, t) => setProgress(`Dosyalar yükleniyor… %${Math.floor((l / Math.max(t, 1)) * 100)}`),
        });
        const ref: UploadedFile[] = reference ? await uploadOrderFiles([reference], { kind: "reference", hizmet: "mix" }) : [];
        uploaded = [...work, ...ref];
        yuklenen.current = { imza, out: uploaded };
      }
      setProgress("");
      const refName = reference?.name || "";
      const r = await sendOrder({
        type: "mix",
        accept: onay,
        istekId: istekKimligi(istekRef, JSON.stringify([service, selectedProducer.id, addonId, imza, orderTotal])),
        service,
        producerId: selectedProducer.id,
        details: [
          ["Mix karakteri", mixStyle],
          ["Vokal / beat dengesi", vocalPosition],
          ["Auto-Tune", autotune],
          ["Reverb", reverb],
          ["Delay", delay],
          ...(refName ? ([["Referans şarkı", refName]] as [string, string][]) : []),
          ...(notes.trim() ? ([["Prodüktöre not", notes.trim()]] as [string, string][]) : []),
        ],
        files: uploaded,
        addonId: addonId || undefined,
        beklenenTutar: orderTotal,
        yonlendir: false,
      });
      if (r.ok) {
        istekRef.current = null;
        yuklenen.current = null;
        setOnizleme(false);
        setDoneCode(r.code || "");
        setFiles([]);
        setReference(null);
        setOnay(false);
      } else if (r.needTopup) {
        setEksik(r.missing || null);
        setOnizHata(r.error || "Yetersiz bakiye.");
      } else if (r.fiyatDegisti) {
        setOnizleme(false);
        setNotice((r.error || "Fiyat değişti.") + (r.guncel?.toplam !== undefined ? ` Güncel tutar: ${money(Number(r.guncel.toplam))}.` : ""));
      } else {
        setOnizHata(r.error || "Sipariş gönderilemedi. Lütfen tekrar dene.");
      }
    } catch (e) {
      setProgress("");
      setOnizHata(e instanceof Error ? e.message : "Dosyalar yüklenemedi. Lütfen tekrar dene.");
    }
    setSending(false);
  }

  function removeFile(index: number) {
    setFiles((previous) => previous.filter((_, i) => i !== index));
  }

  return (
    <main className="dots editorial min-h-screen text-[#111]">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        button, input, select, textarea { font: inherit; }
        .editorial { font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
        .hd { font-family: "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif; }
        .dots { background-color: #ffffff; background-image: radial-gradient(#d9d9d9 1.4px, transparent 1.5px); background-size: 28px 28px; }
        .field:focus { background: #fffdf2; box-shadow: 0 0 0 4px #f5c518; }
        .editorial :focus-visible { outline: 3px solid #111; outline-offset: 3px; }
        .kid-wrap { position: relative; }
        .kid-svg { display: block; width: 100%; height: 100%; overflow: visible; cursor: pointer; }
        .seek { accent-color: #111; cursor: pointer; }
        .eq-bar { display: block; width: 5px; height: 8px; border-radius: 3px; background: #111; transform-origin: bottom; }
        .eq-bar.on { background: #f5c518; box-shadow: 0 0 0 1.5px #111; animation: eqjump 0.8s ease-in-out infinite alternate; }
        @keyframes eqjump { from { height: 6px; } to { height: 30px; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.9s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .eq-bar.on, .spin { animation: none; } }
      `}</style>

      <div className="mx-auto max-w-7xl px-5 py-10 md:px-8 md:py-16">
        <div className="mb-10 grid gap-8 border-b-[3px] border-[#111] pb-10 lg:grid-cols-[1fr_350px] lg:items-start">
          <div>
            <div className="mb-5 inline-flex items-center gap-2.5 rounded-full border-[2.5px] border-[#111] bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.14em]">
              <span className="h-[9px] w-[9px] rounded-full border-2 border-[#111] bg-[#f5c518]" />
              HITY7 STUDIO SERVICES
            </div>
            <h1 className="hd text-[44px] font-extrabold leading-[0.95] tracking-[-0.045em] md:text-7xl">
              MIX &{" "}
              <span className="rounded-2xl bg-[#f5c518] px-3">MASTERING.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#686868]">
              Dosyalarını yükle, prodüktörünü seç ve hayalindeki ses
              karakterini tarif et. Profesyonel sesini HITY7 ile oluştur.
            </p>
            <div className="mt-6 text-sm font-bold tracking-[0.1em] text-[#686868]">
              HITY7 / AUDIO SERVICES
            </div>
          </div>
          <EkHizmetKarti service="mix" value={addonId} onChange={setAddonId} />
        </div>

        {samples.length > 0 && (
          <section className="mb-12">
            <Step number="♪" title="Farkı kendin duy" />
            <p className="mt-2 text-base text-[#686868]">
              Aynı şarkının ham demosu ve HITY7 mix &amp; mastering sonrası hali.
              Oynat, ÖNCE / SONRA arasında geçiş yap.
            </p>
            <div className="mt-5 space-y-5">
              {samples.map((s) => (
                <div key={s.id}>
                  {samples.length > 1 && s.title && <p className="mb-2 text-sm font-bold">{s.title}</p>}
                  <BeforeAfter beforeSrc={s.a_url!} afterSrc={s.b_url!} beforeLabel="HAM DEMO" afterLabel="HITY7 MİX" />
                </div>
              ))}
            </div>
          </section>
        )}

        <form onSubmit={submitOrder} className="grid gap-8 lg:grid-cols-[1fr_350px]">
          <div className="space-y-12">
            <section>
              <Step number="01" title="Hizmetini seç" />

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <ServiceCard
                  active={service === "mix"}
                  title="Mix & Mastering"
                  price="3.000 TL'den başlayan"
                  description="Stereo beat ve vokallerin profesyonel mix ve mastering işlemi."
                  onClick={() => setService("mix")}
                />
                <ServiceCard
                  active={service === "stems"}
                  title="Stems Mix & Mastering"
                  price="10.000 TL'den başlayan"
                  description="Beat ve vokal kanallarının ayrı ayrı işlendiği detaylı mix."
                  onClick={() => setService("stems")}
                />
              </div>
            </section>

            <section>
              <Step number="02" title="Prodüktörünü seç" />
              <p className="mt-2 text-base text-[#686868]">
                HITY7 ekibiyle çalışabilir veya bağımsız prodüktörler
                arasından seçim yapabilirsin.
              </p>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {producers.map((producer) => {
                  const active = producerId === producer.id;
                  const producerPrice =
                    service === "mix"
                      ? producer.mixPrice
                      : producer.stemsPrice;

                  return (
                    <button
                      type="button"
                      key={producer.id}
                      onClick={() => setProducerId(producer.id)}
                      className={`relative rounded-3xl border-[2.5px] border-[#111] p-5 text-left transition ${
                        active
                          ? "-translate-y-0.5 bg-[#f5c518] shadow-[0_5px_0_#111]"
                          : "bg-white hover:-translate-y-0.5 hover:shadow-[0_4px_0_#111]"
                      }`}
                    >
                      {producer.hity7 && (
                        <span className="mb-4 inline-block rounded-full bg-[#111] px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#f5c518]">
                          HITY7 OFFICIAL
                        </span>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="hd flex h-14 w-14 items-center justify-center rounded-2xl bg-[#111] text-xl font-extrabold text-[#f5c518]">
                          {producer.initials}
                        </div>
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full border-[2.5px] border-[#111] text-xs ${
                            active
                              ? "bg-[#111] text-[#f5c518]"
                              : "bg-white text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      </div>

                      <h3 className="hd mt-5 text-xl font-extrabold">
                        {producer.name}
                      </h3>
                      <p className="mt-1 text-xs font-bold text-[#242424]">
                        {producer.role}
                      </p>
                      <p className="mt-3 min-h-10 text-[13px] leading-5 text-[#242424]/70">
                        {producer.description}
                      </p>

                      <div className="mt-5 border-t-2 border-[#111]/15 pt-4">
                        <span className="text-xs font-semibold text-[#242424]/70">
                          Seçili hizmet fiyatı
                        </span>
                        <div className="hd mt-1 text-2xl font-extrabold">
                          {money(producerPrice)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <p className="mt-4 text-[13px] leading-6 text-[#686868]">
                HITY7 Prodüktörleri için HITY7 sabit fiyat politikası
                uygulanır. Bağımsız prodüktörler kendi fiyatlarını belirler.
                {sampleProducers && " Gösterilen bağımsız prodüktör profilleri ve fiyatları örnek veridir."}
              </p>
            </section>

            <section>
              <Step number="03" title="Ses dosyalarını yükle" />
              <p className="mt-2 text-base text-[#686868]">
                Dosyalarını tek ZIP arşivinde veya ayrı ayrı WAV formatında
                gönderebilirsin.
              </p>

              <input
                ref={fileInput}
                type="file"
                multiple
                accept=".zip,.wav,.mp3"
                className="hidden"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />

              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="mt-5 flex w-full flex-col items-center justify-center rounded-3xl border-[2.5px] border-dashed border-[#111] bg-white px-5 py-10 text-center transition hover:bg-[#fffdf2]"
              >
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-3xl shadow-[0_4px_0_#111]">
                  ↑
                </div>
                <span className="hd text-xl font-extrabold">Dosyalarınızı ZIP olarak yükleyin</span>
                <span className="mt-2 text-sm text-[#686868]">
                  ZIP, WAV veya MP3 (dosya başına en fazla 50 MB)
                </span>
                <span className="mt-5 rounded-full bg-[#111] px-6 py-3 text-xs font-bold tracking-[0.1em] text-white">
                  DOSYA SEÇ
                </span>
              </button>

              {files.length > 0 && (
                <div className="mt-4 space-y-2">
                  {files.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border-[2.5px] border-[#111] bg-white p-4"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {file.name}
                        </div>
                        <div className="mt-1 text-xs text-[#686868]">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="shrink-0 rounded-full border-2 border-[#111] px-3 py-1 text-xs font-bold transition hover:bg-[#f5c518]"
                      >
                        Kaldır
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-5 rounded-2xl border-[2.5px] border-[#111] bg-[#fff6cf] p-5">
                <h3 className="hd text-lg font-extrabold">Yüklemeden önce dikkat et</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[#242424]">
                  <li>• Vokallerini mümkünse efekt uygulanmamış şekilde gönder.</li>
                  <li>• Beat dosyanı WAV formatında ekle.</li>
                  <li>• Stems siparişinde kanalları ayrı ayrı gönder.</li>
                  <li>• Dosyaları düzenli isimlendir.</li>
                  <li>• ZIP dosyanın içerisinde gerekli tüm kayıtları bulundur.</li>
                </ul>
              </div>
            </section>

            <section>
              <Step number="04" title="Nasıl bir ses istiyorsun?" />

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <Field label="Mix karakteri">
                  <Select
                    value={mixStyle}
                    onChange={setMixStyle}
                    options={[
                      "Modern / Parlak",
                      "Karanlık / Sert",
                      "Doğal / Temiz",
                      "Trap / Agresif",
                      "Melodik / Atmosferik",
                      "Old School",
                    ]}
                  />
                </Field>

                <Field label="Vokal beat üzerinde nasıl duyulsun?">
                  <Select
                    value={vocalPosition}
                    onChange={setVocalPosition}
                    options={[
                      "Beat'in önünde ve net",
                      "Beat ile dengeli",
                      "Beat'in içinde ve atmosferik",
                      "Güçlü ve yüksek",
                      "Daha doğal ve yumuşak",
                    ]}
                  />
                </Field>

                <Field label="Auto-Tune">
                  <Select
                    value={autotune}
                    onChange={setAutotune}
                    options={["Yok", "Hafif", "Belirgin", "Yoğun"]}
                  />
                </Field>

                <Field label="Reverb">
                  <Select
                    value={reverb}
                    onChange={setReverb}
                    options={["Yok", "Az", "Orta", "Yoğun"]}
                  />
                </Field>

                <Field label="Delay">
                  <Select
                    value={delay}
                    onChange={setDelay}
                    options={["Yok", "Az", "Orta", "Yoğun"]}
                  />
                </Field>
              </div>
            </section>

            <section>
              <Step number="AI" title="Yapay zekâ ile hemen mixle" />
              <div className="mt-5 overflow-visible rounded-[28px] border-[3px] border-[#111] bg-[#111] p-6 text-white shadow-[0_8px_0_#f5c518] sm:p-8">
                <div className="grid items-center gap-6 sm:grid-cols-[1fr_170px]">
                  <div>
                    <span className="inline-block rounded-full bg-[#f5c518] px-3 py-1 text-[11px] font-extrabold tracking-[0.14em] text-[#111]">
                      AI MIX · ANINDA ÖNİZLEME
                    </span>
                    <h3 className="hd mt-4 text-3xl font-extrabold leading-tight tracking-[-0.03em] text-[#f5c518]">
                      Şarkını yükle, kulağınla karşılaştır.
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-white/75">
                      Yüklediğin ses analiz edilir; yukarıda seçtiğin mix karakteri,
                      vokal konumu, reverb ve delay ayarlarına göre EQ, kompresyon,
                      efekt ve mastering uygulanır. İşlem tarayıcında yapılır, dosyan
                      sunucuya gönderilmez.
                    </p>
                  </div>
                  <div className="kid-wrap mx-auto h-[200px] w-[155px]">
                    <KidMascot />
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border-2 border-white/20 bg-white/5 p-4 text-sm">
                  {aiCandidate ? (
                    <>
                      <span className="text-white/60">İşlenecek dosya: </span>
                      <span className="font-bold text-[#f5c518]">{aiCandidate.name}</span>
                    </>
                  ) : (
                    <span className="text-white/75">
                      Önce 03. adımda bir WAV veya MP3 dosyası yükle (ZIP bu özellikte kullanılamaz).
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={startAiMix}
                  disabled={!aiCandidate || aiStatus === "working"}
                  className="mt-5 inline-flex items-center gap-3 rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-6 py-4 text-sm font-extrabold tracking-[0.08em] text-[#111] shadow-[0_4px_0_#fff] transition hover:-translate-y-0.5 hover:bg-[#e5b600] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  {aiStatus === "working" ? (
                    <>
                      <span className="spin inline-block h-4 w-4 rounded-full border-[3px] border-[#111] border-t-transparent" />
                      {aiStage || "İşleniyor…"}
                    </>
                  ) : (
                    <>✦ YAPAY ZEKÂYLA MİXLE</>
                  )}
                </button>

                {aiStatus === "error" && (
                  <p role="alert" className="mt-4 rounded-2xl border-2 border-[#f5c518] p-3 text-sm font-semibold text-[#f5c518]">
                    {aiError}
                  </p>
                )}

                {aiStatus === "done" && aiOriginalUrl && aiMixedUrl && (
                  <div className="mt-6 text-[#111]">
                    <BeforeAfter
                      beforeSrc={aiOriginalUrl}
                      afterSrc={aiMixedUrl}
                      beforeLabel="SENİN DOSYAN"
                      afterLabel="AI MİX"
                    />
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <a
                        href={aiMixedUrl}
                        download={`${aiFileName || "hity7"}-ai-mix.wav`}
                        className="rounded-full border-[2.5px] border-white bg-white px-5 py-3 text-xs font-extrabold tracking-[0.1em] text-[#111] transition hover:bg-[#f5c518]"
                      >
                        ↓ WAV OLARAK İNDİR
                      </a>
                    </div>
                  </div>
                )}

                <p className="mt-5 text-xs leading-5 text-white/55">
                  AI Mix hızlı bir önizlemedir ve Auto-Tune ayarını uygulamaz. En iyi sonuç için
                  prodüktör seçip sipariş oluşturabilirsin.
                </p>
              </div>
            </section>

            <section>
              <Step number="05" title="Referans şarkı ve özel notlar" />

              <input
                ref={referenceInput}
                type="file"
                accept=".wav,.mp3"
                className="hidden"
                onChange={(event) =>
                  setReference(event.target.files?.[0] || null)
                }
              />

              <button
                type="button"
                onClick={() => referenceInput.current?.click()}
                className="mt-5 flex w-full items-center justify-between rounded-2xl border-[2.5px] border-dashed border-[#111] bg-white p-5 text-left transition hover:bg-[#fffdf2]"
              >
                <div>
                  <div className="text-base font-bold">
                    Referans şarkı yükle
                  </div>
                  <div className="mt-1 text-sm text-[#686868]">
                    Beğendiğin bir şarkının ses karakterini örnek göster.
                  </div>
                  {reference && (
                    <div className="mt-2 text-sm font-bold text-[#111] underline decoration-[#f5c518] decoration-4 underline-offset-2">
                      {reference.name}
                    </div>
                  )}
                </div>
                <span className="grid h-10 w-10 flex-none place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] text-xl">+</span>
              </button>

              <div className="mt-5">
                <label className="mb-2 block text-sm font-bold">
                  Prodüktöre iletmek istediğin notlar
                </label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={5}
                  placeholder="Örneğin: Vokal daha tok duyulsun. Nakaratta vokal genişlesin. Ad-libler sağdan ve soldan gelsin. Beat çok baskın olmasın..."
                  className="field w-full resize-y rounded-2xl border-[2.5px] border-[#111] bg-white p-4 text-base outline-none placeholder:text-[#686868]/70"
                />
              </div>
            </section>
          </div>

          <aside className="h-fit rounded-[32px] border-[3px] border-[#111] bg-white p-6 shadow-[0_10px_0_#111] lg:sticky lg:top-8">
            <span className="inline-block rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]">
              ORDER SUMMARY
            </span>
            <h2 className="hd mt-3 text-3xl font-extrabold tracking-[-0.04em]">Sipariş Özeti</h2>

            <div className="mt-7 space-y-4 border-b-2 border-[#e6e6e6] pb-6">
              <SummaryRow
                label="Hizmet"
                value={
                  service === "mix"
                    ? "Mix & Mastering"
                    : "Stems Mix & Mastering"
                }
              />
              <SummaryRow label="Prodüktör" value={selectedProducer.name} />
              <SummaryRow label="Dosya sayısı" value={`${files.length} dosya`} />
              <SummaryRow label="Mix karakteri" value={mixStyle} />
              <SummaryRow label="Vokal" value={vocalPosition} />
              {addonItem && <SummaryRow label="Ek hizmet" value={`+ ${addonItem.name} · ${money(addonTotal)}`} />}
            </div>

            <div className="mt-6">
              <span className="text-xs font-semibold text-[#686868]">
                {addonItem ? "Toplam (ek hizmet dahil)" : "Toplam hizmet bedeli"}
              </span>
              <div className="hd mt-2 text-4xl font-extrabold tracking-[-0.04em]">
                {money(orderTotal)}
              </div>
            </div>

            <div className="mt-6">
              <SozlesmeOnay tur="siparis" checked={onay} onChange={setOnay} />
            </div>

            <button
              type="submit"
              disabled={sending}
              className="mt-7 w-full rounded-full border-[2.5px] border-[#111] bg-[#f5c518] py-4 text-sm font-bold tracking-[0.1em] text-[#111] shadow-[0_5px_0_#111] transition hover:-translate-y-0.5 hover:bg-[#e5b600] hover:shadow-[0_7px_0_#111] active:translate-y-[3px] active:shadow-[0_1px_0_#111] disabled:cursor-wait disabled:opacity-60"
            >
              {`${money(orderTotal)} · SİPARİŞ VER →`}
            </button>

            {notice && (
              <p role="alert" className="mt-4 rounded-2xl border-[2.5px] border-[#111] bg-[#fff6cf] p-3 text-sm font-semibold leading-6">
                {notice}
                {needLogin && (
                  <>
                    {" "}
                    <a href="/giris?next=/mix-mastering" className="font-bold underline">
                      Giriş yap →
                    </a>
                  </>
                )}
              </p>
            )}

            {doneCode && (
              <div role="status" className="mt-4 rounded-2xl border-[2.5px] border-[#111] bg-[#f5c518] p-4 text-sm leading-6 text-[#111]">
                <strong>Siparişin alındı ✓</strong>
                <br />
                Sipariş numaran: <b>{doneCode}</b>. Tutar bakiyenden düşüldü.{" "}
                <a href="/panel" className="font-bold underline">
                  Siparişlerim →
                </a>
              </div>
            )}

            <p className="mt-4 text-center text-[12px] leading-5 text-[#686868]">
              Siparişi onayladığında tutar bakiyenden tek seferde düşülür. Dosyaların prodüktöre iletilir;
              teslimatı ve revizyon taleplerini hesabındaki Siparişlerim bölümünden takip edersin.
            </p>
          </aside>
        </form>
      </div>

      <SiparisOnizleme
        acik={onizleme}
        baslik={`${service === "mix" ? "Mix & Mastering" : "Stems Mix & Mastering"} · ${selectedProducer.name}`}
        kalemler={[
          {
            ad: service === "mix" ? "Mix & Mastering" : "Stems Mix & Mastering",
            not: `${selectedProducer.name} · ${files.length} dosya${reference ? " + referans" : ""}`,
            tutar: price,
          },
          ...(addonItem ? [{ ad: `Ek hizmet · ${addonItem.name}`, tutar: addonItem.price }] : []),
        ]}
        araToplam={orderTotal}
        toplam={orderTotal}
        gonderiliyor={sending}
        hata={progress || onizHata}
        eksik={eksik}
        onOnayla={confirmOrder}
        onKapat={() => setOnizleme(false)}
      />
    </main>
  );
}

function Step({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="hd grid h-11 min-w-11 place-items-center rounded-full border-[2.5px] border-[#111] bg-[#f5c518] px-2 text-sm font-extrabold">
        {number}
      </span>
      <h2 className="hd text-2xl font-extrabold tracking-[-0.03em] md:text-3xl">{title}</h2>
    </div>
  );
}

function ServiceCard({
  active,
  title,
  price,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  price: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-3xl border-[2.5px] border-[#111] p-5 text-left transition ${
        active
          ? "-translate-y-0.5 bg-[#f5c518] shadow-[0_5px_0_#111]"
          : "bg-white hover:-translate-y-0.5 hover:shadow-[0_4px_0_#111]"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="hd text-xl font-extrabold">{title}</span>
        <span className={active ? "text-[#111]" : "text-[#686868]"}>
          {active ? "●" : "○"}
        </span>
      </div>
      <div className="hd mt-4 text-2xl font-extrabold">{price}</div>
      <p className="mt-3 text-sm leading-6 text-[#242424]/75">{description}</p>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-bold">{label}</label>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="field w-full rounded-2xl border-[2.5px] border-[#111] bg-white p-4 text-base outline-none"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-[#686868]">{label}</span>
      <span className="max-w-[60%] text-right font-semibold">{value}</span>
    </div>
  );
}
