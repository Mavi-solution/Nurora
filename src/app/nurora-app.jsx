"use client";

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";

// Runs the instant this script loads — before React mounts or paints anything —
// because a viewport fix applied only after first paint is often too late for
// the browser to un-zoom content it already laid out at the wrong scale.
(function fitViewport() {
  if (typeof document === "undefined") return;
  const CONTENT = "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, shrink-to-fit=no, interactive-widget=resizes-content";
  const apply = () => {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.appendChild(meta);
    }
    // WebKit sometimes locks in whatever scale it computed at first layout and
    // ignores a later attribute change, so force a recompute by toggling the
    // value before setting the real one.
    meta.setAttribute("content", "width=device-width, initial-scale=0.9");
    meta.setAttribute("content", CONTENT);
    requestAnimationFrame(() => meta.setAttribute("content", CONTENT));
    if (!document.querySelector('style[data-nurora="reset"]')) {
      const style = document.createElement("style");
      style.setAttribute("data-nurora", "reset");
      style.textContent = `
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; width: 100%; max-width: 100vw; overflow-x: hidden; }
        html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; touch-action: manipulation; }
        @keyframes nurora-fade-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
        /* iOS Safari auto-zooms into any focused text field under 16px —
           forcing 16px here (not just in each input's own style) stops the
           zoom-then-pinch-out-to-fix problem everywhere in the app at once. */
        input, select, textarea { font-size: 16px !important; }
        /* A slightly-long press on a button was triggering iOS's native
           text-selection popup (Copy/Look Up/Translate) instead of a tap,
           since button text is selectable by default — this silently
           blocked the actual click underneath. Text inputs stay selectable. */
        button, a, [role="button"] {
          -webkit-user-select: none; user-select: none;
          -webkit-touch-callout: none;
        }
      `;
      document.head.appendChild(style);
    }
  };
  if (document.head) apply();
  else document.addEventListener("DOMContentLoaded", apply, { once: true });
})();
import {
  Menu, Bell, Calendar, Clock, Play, Square, ChevronDown, ChevronUp, ChevronRight,
  ChevronLeft, Filter, Users, FileText, MoreHorizontal, Plus, X, Check, ArrowLeft,
  LogOut, Settings as SettingsIcon, BarChart3, CalendarOff, Trash2, Download, Share2, Search,
  Mic, ArrowUp, ScanFace, ArrowRight, Headphones, Phone, ThumbsUp, Pencil, User, Tag, Hash, CalendarClock, Flag, Baby,
  Send, Copy, MessageCircle, MapPin, FileCheck, Link as LinkIcon, UserCheck, Star, Zap, Shield,
} from "lucide-react";

/* ---------------------------------------------------------------- tokens */
const C = {
  ink: "#111111",
  mid: "#52525b",
  soft: "#8e8e93",
  faint: "#c7c7cc",
  ghost: "#e2e2e5",
  line: "#ededed",
  hair: "#f4f4f4",
  chip: "#f5f5f5",
};
const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/* --------------------------------------------------------------- helpers */
const pad = (n) => String(n).padStart(2, "0");
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* ---------------------------------------------------- biometric sign-in */
// Uses the device's own Face ID / Touch ID / fingerprint sensor via the
// browser's WebAuthn platform authenticator. There's no server here to
// issue or verify signed challenges against, so this isn't a full
// cryptographic auth system — it's used as a local "prove it's still you"
// gate: register once, and the browser will only satisfy future requests
// after a real biometric check on this device.
async function biometricSupported() {
  try {
    if (!window.PublicKeyCredential || !navigator.credentials) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) { return false; }
}
function b64urlToBuffer(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const str = atob(b64 + pad);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}
async function registerBiometric(identityKey, displayName) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge, rp: { name: "Nurora" },
      user: { id: userId, name: identityKey, displayName },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000, attestation: "none",
    },
  });
  return cred.id;
}
async function verifyBiometric(credId) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge, allowCredentials: [{ id: b64urlToBuffer(credId), type: "public-key" }],
      userVerification: "required", timeout: 60000,
    },
  });
  return !!assertion;
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CHAT_TAGS = ["Coffee meet", "High priority", "Immediately", "Dinner", "WAY - Where are You", "Awesome", "Have Concern"];
const MILESTONES = ["Personalize message", "Call the client", "Start and end session", "NuBills", "Fill the Persona"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const to12 = (t) => {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${pad(hh)}:${pad(m)} ${ap}`;
};
const longDate = (s) => { const d = fromYmd(s); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const shortDate = (s) => { const d = fromYmd(s); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
// "Thursday 5th February 2026 at 11am" — used in the personalize-message template.
function messageDate(dateStr, timeStr) {
  const d = fromYmd(dateStr);
  const day = DAYS_LONG[d.getDay()];
  const n = d.getDate();
  const suf = (n >= 11 && n <= 13) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  let timePart = "";
  if (timeStr) {
    const [hh, mm] = timeStr.split(":").map(Number);
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    const ap = hh >= 12 ? "pm" : "am";
    timePart = ` at ${h12}${mm ? `:${pad(mm)}` : ""}${ap}`;
  }
  return `${day} ${n}${suf} ${month} ${year}${timePart}`;
}
const clockStr = (sec) => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(Math.floor(sec % 60))}`;
const hm = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const durStr = (sec) => {
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
};
const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const isSecondSat = (d) => d.getDay() === 6 && Math.ceil(d.getDate() / 7) === 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/* --------------------------------------------------------------- storage */
const KEY = "nurora:data:v1";
const SKEY = "nurora:session:v1";
let memory = {};
const store = {
  // Tries window.storage first (Claude's own artifact-preview runtime), then
  // falls back to localStorage — which is what actually persists across
  // reloads in any real browser, including once this is deployed on its own
  // domain where window.storage won't exist at all. The in-memory `memory`
  // object is the last resort, for a single session with neither available.
  async get(k) {
    try {
      if (typeof window !== "undefined" && window.storage && window.storage.get) {
        const r = await window.storage.get(k);
        if (r) return JSON.parse(r.value);
      }
    } catch (e) { /* fall through to localStorage */ }
    try {
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem(k);
        if (raw != null) return JSON.parse(raw);
      }
    } catch (e) { /* fall through to memory */ }
    return memory[k] ?? null;
  },
  async set(k, v) {
    memory[k] = v;
    try {
      if (typeof window !== "undefined" && window.storage && window.storage.set) {
        await window.storage.set(k, JSON.stringify(v));
      }
    } catch (e) { /* fall through to localStorage */ }
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { /* quota exceeded or unavailable — memory fallback above still holds for this session */ }
  },
};

/* ------------------------------------------------------------- seed data */
function seed() {
  const today = ymd(new Date());
  const DEFAULT_PERMISSIONS = { attendance: true, nubills: true, personas: true, bric: true, reviews: true, followups: true, mysummary: true, weekoffs: true };
  const probFrom = ymd(new Date());
  const probToDate = new Date(); probToDate.setDate(probToDate.getDate() + 90);
  const mk = (name, role, slots, weekOffDates = {}, isNuLancer = false) => ({
    id: uid("c"), name, role, workStart: "09:00", workEnd: "20:00",
    slots, weekOffDates, pin: "1234", active: true, isNuLancer,
    benefitsEnabled: false, benefits: [],
    // Onboarding / TPIN-MPIN — existing counsellors start on TPIN/probation
    // rather than being grandfathered in as fully signed up.
    accountStatus: "tpin", tpin: "1234", mpin: null,
    probationFrom: probFrom, probationTo: ymd(probToDate),
    personalPhone: "", bloodGroup: "", aadharImage: null, businessPhone: "", dob: "", dateOfJoining: "",
    photo: null, agreementSignedAt: null, signatureDataUrl: null,
    frontPageTextOverride: null, agreementAgreeTextOverride: null,
    permissions: { ...DEFAULT_PERMISSIONS },
    isOwner: false, workHoursEnabled: true,
  });
  const counsellors = [
    mk("Anisha", "Senior Counsellor", ["11:00", "18:00"]),
    mk("Shefrin", "Counsellor", ["10:00", "14:00"]),
    mk("Ramya", "Counsellor", ["11:00"]),
    mk("Mahek", "Counsellor", ["14:00", "17:00"]),
    mk("Saranya", "Counsellor", ["14:00", "17:00"]),
    mk("Samuel Rednus", "Counsellor", ["11:00"]),
    mk("Deepa", "NuLancer", [], {}, true),
    mk("Nithyashree", "NuLancer", [], {}, true),
    mk("Ashika", "NuLancer", [], {}, true),
  ];
  const byName = (n) => counsellors.find((c) => c.name === n).id;
  const cl = (name, age, phone) => ({ id: uid("cl"), name, age, phone, email: "", notes: "" });
  const clients = [
    cl("Ravi Kumar", 36, "98400 11223"), cl("Neha R.", 31, "98400 22334"),
    cl("Priya S.", 29, "98400 33445"), cl("Kavya M.", 27, "98400 44556"),
    cl("Neha P.", 32, "98400 55667"), cl("Sneha T.", 24, "98400 66778"),
    cl("Arun B.", 28, "98400 77889"), cl("Vikram R.", 41, "98400 88990"),
  ];
  const byClient = (n) => clients.find((c) => c.name === n).id;
  const relDate = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return ymd(d); };
  const yesterday = relDate(-1), tomorrow = relDate(1), dayAfter = relDate(2);
  const ap = (cName, date, time, clName, advance, messageSent = false) => ({
    id: uid("a"), date, counsellorId: byName(cName), time,
    clientId: byClient(clName), type: "Individual", advance,
    chips: ["AP", "IC", "IS"], status: "Scheduled", note: "", createdAt: Date.now(), messageSent,
  });
  const appointments = [
    // Yesterday — all wrapped up (message sent), so the calendar shows green dots for a completed day.
    ap("Anisha", yesterday, "11:00", "Ravi Kumar", 500, true), ap("Anisha", yesterday, "18:00", "Neha R.", 500, true),
    ap("Shefrin", yesterday, "10:00", "Priya S.", 300, true),
    // Today — a mix, so both red and green dots show at once.
    ap("Anisha", today, "11:00", "Ravi Kumar", 500, true), ap("Anisha", today, "18:00", "Neha R.", 500, false),
    ap("Shefrin", today, "10:00", "Priya S.", 300, true), ap("Shefrin", today, "14:00", "Kavya M.", 500, false),
    ap("Mahek", today, "14:00", "Neha P.", 500, false), ap("Mahek", today, "17:00", "Sneha T.", 300, true),
    ap("Saranya", today, "14:00", "Arun B.", 300, false), ap("Saranya", today, "17:00", "Vikram R.", 500, false),
    // Tomorrow — freshly booked, nothing sent yet, so all dots show red/orange.
    ap("Anisha", tomorrow, "11:00", "Kavya M.", 500, false), ap("Shefrin", tomorrow, "10:00", "Sneha T.", 300, false),
    ap("Mahek", tomorrow, "14:00", "Arun B.", 500, false),
    // Day after tomorrow — just one booking, to show a single dot.
    ap("Saranya", dayAfter, "14:00", "Vikram R.", 300, false),
  ];
  // --- DEMO DATA (remove this block once real reviews are being logged) ---
  // Spans the current month so the milestone badge on the Google Reviews
  // screen has something to show — Anisha's individual count crosses into
  // the theme-colored "fire" tier (8+), and the team total sits a bit above that.
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
  const rv = (clName, cName, rating, days, text) => ({
    id: uid("review"), clientId: byClient(clName), reviewerName: clName, counsellorId: byName(cName),
    rating, date: daysAgo(days), text, submittedBy: "Demo data", createdAt: Date.now() - days * 86400000,
  });
  const reviews = [
    rv("Ravi Kumar", "Anisha", 5, 1, "Anisha helped me work through a really difficult time. Grateful for her patience and clarity every session."),
    rv("Neha R.", "Anisha", 5, 2, "Best decision I made was booking with Anisha. She actually listens and gives practical steps, not just advice."),
    rv("Priya S.", "Shefrin", 4, 4, "Good sessions overall, felt heard. Would have liked slightly longer sessions but the guidance was solid."),
    rv("Kavya M.", "Shefrin", 5, 6, "Two months in and I feel like a different person. Thank you for the support through everything."),
    rv("Neha P.", "Mahek", 5, 8, "Mahek's approach is calm and non-judgmental. Made it so much easier to open up."),
    rv("Sneha T.", "Mahek", 5, 10, "Highly recommend. The clinic is welcoming and the counselling itself has genuinely helped my anxiety."),
    rv("Arun B.", "Saranya", 4, 13, "Solid experience, saw real progress after a few sessions."),
    rv("Vikram R.", "Saranya", 5, 15, "Couldn't have asked for a better counsellor. Truly grateful."),
  ];
  // --- end demo data ---
  return {
    counsellors, clients, appointments,
    sessions: [], invoices: [], leaves: [], notifications: [], messages: [], webauthn: {}, interests: [], holidays: [], attendance: [], bills: [], reviews,
    invoiceSeq: 1,
    settings: {
      basePrice: 2000, includedMinutes: 120, extensionMinutes: 30, extensionPrice: 500,
      graceMinutes: 5, gstEnabled: false, gstPercent: 18, monthlyLeaveDays: 4,
      sessionTypes: ["Individual", "Couple", "Family", "Follow-up"],
      chipLabels: ["AP", "IC", "IS", "NC"],
      // CHANGE BEFORE LAUNCH — this is the placeholder demo PIN used
      // throughout development. Set a real Admin PIN from Settings on
      // first login.
      invoicePrefix: "NUR", notificationSound: true, adminPin: "1234", designerUrl: "",
      loginQuoteGrey: "Always believe something wonderful", loginQuoteBlack: "About to Happen.",
      // Signup agreement: page 1 is this personalized text template
      // ({{name}} gets substituted per counsellor), page 2 is a PDF that
      // differs by counsellor type (Resource vs NuLancer), and
      // agreementAgreeText is the wording next to the final "I agree" box.
      frontPageTextTemplate: "Welcome to Nurora, {{name}}.\n\nBefore you get started, please read through the agreement on the following page carefully. It covers what's expected of you as part of the team, and what you can expect from us in return.\n\nTake your time — this only needs to be done once.",
      agreementAgreeText: "I have read and agree to the terms of this agreement.",
      resourceAgreementPdfLegal: null, resourceAgreementPdfLayman: null,
      nulancerAgreementPdfLegal: null, nulancerAgreementPdfLayman: null,

      // Booking form configuration — editable from Settings by Admin.
      // Each bookable service has its own price ("value"). The advance owed
      // is derived from that value via a tier formula, not configured per
      // service — see advanceRequirement().
      services: [
        { name: "Geriatric Therapy – Home Visit (Above 5 km)", value: 4000 },
        { name: "Child Therapy", value: 2000 },
        { name: "Child Therapy & Parental Counselling", value: 2000 },
        { name: "Adolescent Counselling & Therapy", value: 2000 },
        { name: "Special Session", value: 500 },
        { name: "Psychological / Therapy Report", value: 500 },
        { name: "NRI Individual Therapy", value: 3000 },
        { name: "NRI Couple Therapy", value: 4500 },
        { name: "Family Counselling & Therapy (2 members)", value: 3000 },
        { name: "Family Counselling & Therapy (3 members)", value: 3500 },
        { name: "Family Counselling & Therapy (4 members)", value: 4000 },
        { name: "Family Counselling & Therapy (5 members)", value: 5000 },
        { name: "Geriatric Therapy – Clinic Session", value: 3000 },
        { name: "Geriatric Therapy – Home Visit (Within 5 km)", value: 3000 },
        { name: "General Therapy – Mental Health Care", value: 500 },
        { name: "Individual Psychotherapy – Mental Health Care", value: 2000 },
        { name: "Mental Health Counselling & Psychotherapy Session", value: 3000 },
        { name: "Advanced Individual Session", value: 2500 },
        { name: "Advance Couple Session", value: 3500 },
        { name: "Couple Therapy", value: 3000 },
      ],
      // Advance tiers: services priced at or below the threshold use the
      // lower fixed advance; anything above uses the higher one.
      advanceTierThreshold: 2000,
      advanceTierAtOrBelow: 500,
      advanceTierAbove: 1000,
      modes: ["Online", "Offline", "Offline - Walk-in"],
      // Modes in this list always require full payment (the service's own
      // value), overriding the tier formula above.
      fullPaymentModes: ["Online", "Offline - Walk-in"],
      tags: [
        { code: "CO", label: "Counselling" }, { code: "PT", label: "Psychotherapy" },
        { code: "Ch", label: "Child" }, { code: "Ges", label: "Gestalt" },
      ],
      attachmentTypes: ["Recording", "Voice note", "Note"],
      attachmentRetentionDays: 30,
      // NuLancer freelancers get paid per completed session, not a salary —
      // rate depends on whether it was an Individual or Couple session.
      nulancerRateIndividual: 300,
      nulancerRateCouple: 500,
      // Personalize-message template — {{name}} and {{date}} get swapped in
      // per client when a counsellor opens the message for a specific booking.
      appointmentMessageTemplate:
        "*Appointment Confirmation*\n\n" +
        "Hi {{name}}, \n\n" +
        "          Your appointment has been confirmed for *{{date}}.*\n" +
        "          Kindly arrive at the clinic at least *10 minutes* before your scheduled time.\n\n" +
        "*Important Note:* We kindly request you to avoid rescheduling or canceling your appointment, as this time is reserved exclusively for you. Each slot is precious and could be used to support someone in urgent need.\n\n" +
        "                          Thank you for your understanding. We\u2019re here to help, and we look forward to seeing you!",
      // Shared with an Interest entry (QR + policy text) before they confirm
      // a booking. Admin can edit or replace either from Settings.
      paymentQrImage: null,
      cancellationPolicyText:
        "*No Cancellation Policy*\n" +
        "         At Nurora, your session is reserved exclusively for you.\n\n" +
        "Once booked, the slot is no longer available to others\u2014many of whom may be seeking urgent support, including those experiencing suicidal thoughts. A cancellation may result in someone else missing timely help.\n\n" +
        "For this reason, we follow a strict no-cancellation policy. Please confirm your booking only if you are certain to attend.",
      timingPolicyText:
        "*Being There at a Time*\n" +
        "    At Nurora, your session is not rushed. We don\u2019t want to stop you in the middle when you are sharing your feelings.\n\n" +
        "However, we are strict about timing. Please come on time. If you are late by more than 10 minutes, your session will be limited to 1 hour.",
      // Shown right after a booking is confirmed (whether direct or an
      // Interest turning into a booking) — {{name}} gets swapped in per client.
      bookingConfirmedMessageTemplate:
        "Thank you {{name}}, advance received. Kindly be here on time \u2014 you will get your appointment confirmation and location from your Therapist\u2019s number, so kindly save it for future bookings. Kindly be at the location 10 minutes before your appointment time.",
    },
  };
}

/* --------------------------------------------------------------- billing */
function computeBill(durationSec, s) {
  const mins = durationSec / 60;
  const extra = Math.max(0, mins - s.includedMinutes - s.graceMinutes);
  const blocks = Math.ceil(extra / s.extensionMinutes);
  const base = s.basePrice;
  const additional = blocks * s.extensionPrice;
  const sub = base + additional;
  const gst = s.gstEnabled ? Math.round((sub * s.gstPercent) / 100) : 0;
  return { base, additional, gst, total: sub + gst, extraMinutes: Math.round(extra) };
}

/* -------------------------------------------------- advance payment rule */
// Each service carries its own price. If the booking's mode is one of the
// "full payment" modes (Online, Offline - Walk-in by default), the full
// service value is required upfront. Otherwise the advance is a fixed
// amount derived from where the service's value sits against the
// configured tier threshold — this is a formula, not a per-service setting.
function advanceRequirement(settings, serviceName, mode) {
  const service = (settings.services || []).find((sv) => sv.name === serviceName);
  const value = service ? service.value : settings.basePrice;

  if (mode && (settings.fullPaymentModes || []).includes(mode)) {
    return { kind: "full", amount: value, reason: `${mode} requires full payment.` };
  }
  if (!service) {
    return { kind: "full", amount: value, reason: "Choose a service to see the advance required." };
  }
  const threshold = settings.advanceTierThreshold ?? 2000;
  const amount = value <= threshold ? (settings.advanceTierAtOrBelow ?? 500) : (settings.advanceTierAbove ?? 1000);
  return { kind: "fixed", amount, reason: null };
}

// Attachments (recordings/voice notes/notes) auto-expire — strip them off
// appointments past their retention window without touching anything else.
// Whole-day auto-leave: if an active counsellor never checked in at all on
// a past working day (not already a scheduled week-off, holiday, or
// covered by an existing leave), mark that whole day automatically —
// week-off first if quota's available that month, else LOP. Silent, no
// notification. Bounded to the last 7 days so this can't retroactively
// flag a long history the first time it runs.
function markMissedAttendanceAsLeave(data) {
  const today = new Date();
  const todayKey = ymd(today);
  let leaves = data.leaves;
  let changed = false;

  for (const c of data.counsellors) {
    if (!c.active || c.isOwner || c.workHoursEnabled === false) continue;
    for (let back = 1; back <= 7; back++) {
      const d = new Date(today); d.setDate(d.getDate() - back);
      const dateKey = ymd(d);
      if (dateKey >= todayKey) continue;

      const hasAttendance = (data.attendance || []).some((a) => a.counsellorId === c.id && a.date === dateKey);
      if (hasAttendance) continue;
      const alreadyOnLeave = leaves.some((l) => l.counsellorId === c.id && l.from <= dateKey && dateKey <= l.to);
      if (alreadyOnLeave) continue;
      const isHoliday = (data.holidays || []).some((h) => h.date === dateKey);
      if (isHoliday) continue;
      const monthKeyForDate = monthKeyOf(dateKey);
      const dayNum = d.getDate();
      const isScheduledWeekOff = ((c.weekOffDates || {})[monthKeyForDate] || []).includes(dayNum);
      if (isScheduledWeekOff) continue;

      const newLeave = { id: uid("l"), counsellorId: c.id, type: "Leave", from: dateKey, to: dateKey, half: false, halfFrom: null, halfTill: null, autoMarked: true };
      const units = leaveUnits(newLeave);
      const withUnits = { ...newLeave, units, paidUnits: 0, lopUnits: 0, monthKey: monthKeyForDate };
      const quota = weekOffQuotaForMonth(monthKeyForDate);
      leaves = recomputeLeaveSplits([...leaves, withUnits], c.id, monthKeyForDate, quota);
      changed = true;
    }
  }
  return changed ? { ...data, leaves } : data;
}

function purgeExpiredAttachments(data) {
  const now = Date.now();
  let changed = false;
  const appointments = data.appointments.map((a) => {
    if (a.attachmentExpiresAt && a.attachmentExpiresAt <= now && (a.attachmentType || a.attachmentNote)) {
      changed = true;
      return { ...a, attachmentType: null, attachmentNote: "", attachmentFileName: null, attachmentAudioData: null, attachmentDurationSec: 0, attachmentExpiresAt: null };
    }
    return a;
  });
  return changed ? { ...data, appointments } : data;
}

// "Interest" entries (people who called but haven't paid/booked yet) are
// kept for a year for the monthly Interest & Booked browser, then cleared.
function purgeOldInterests(data) {
  if (!data.interests || data.interests.length === 0) return data;
  const cutoff = Date.now() - 365 * 86400000;
  const interests = data.interests.filter((it) => it.createdAt >= cutoff);
  return interests.length === data.interests.length ? data : { ...data, interests };
}

/* ------------------------------------------------------------ primitives */
function Btn({ children, onClick, kind = "line", size = "md", disabled, full, icon }) {
  const base = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 12, fontSize: size === "sm" ? 13 : 14, fontWeight: 400,
    padding: size === "sm" ? "8px 12px" : "12px 16px",
    width: full ? "100%" : undefined, transition: "opacity .15s",
    opacity: disabled ? 0.35 : 1, cursor: disabled ? "default" : "pointer",
  };
  const kinds = {
    line: { border: `1px solid ${C.line}`, background: "#fff", color: C.ink },
    solid: { border: "1px solid #111", background: "#111", color: "#fff" },
    quiet: { border: "1px solid transparent", background: "transparent", color: C.mid },
    danger: { border: `1px solid ${C.line}`, background: "#fff", color: "#b42318" },
  };
  return (
    <button disabled={disabled} onClick={onClick} style={{ ...base, ...kinds[kind] }}>
      {icon}{children}
    </button>
  );
}

const CHIP_TONES = {
  sage: { bg: "#e9f7ef", border: "#a6e0bf", text: "#1f7a4d" },
  blue: { bg: "#eaf2fe", border: "#a9c8f5", text: "#2159b3" },
};
function Chip({ children, icon, glass, themed, tone }) {
  const t = tone ? CHIP_TONES[tone] : null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: t ? 600 : 400, color: t ? t.text : C.mid, borderRadius: 999,
      padding: "3px 8px", whiteSpace: "nowrap", lineHeight: 1.4,
      background: t ? t.bg : themed ? "#fff" : glass ? "rgba(255,255,255,0.55)" : C.chip,
      backdropFilter: glass ? "blur(10px) saturate(180%)" : undefined,
      WebkitBackdropFilter: glass ? "blur(10px) saturate(180%)" : undefined,
      border: t ? `1px solid ${t.border}` : themed ? `1px solid ${RING_DONE_SOLID}` : glass ? "1px solid rgba(255,255,255,0.7)" : "1px solid transparent",
      boxShadow: glass && !themed ? "0 1px 3px rgba(20,20,20,0.06)" : undefined,
      transition: "background .3s ease, border-color .3s ease",
    }}>{icon}{children}</span>
  );
}

// Keeps text on a single line; if it's too long for its box it auto-scrolls
// right-to-left on a loop, with the left edge fading into the background
// color so text doesn't cut off abruptly as it exits.
function TruncatedText({ text, style, textStyle }) {
  return (
    <div style={{ minWidth: 0, overflow: "hidden", ...style }}>
      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...textStyle }}>
        {text}
      </span>
    </div>
  );
}

// Compact horizontal stepper for an appointment's workflow: Booking ->
// Personalize message -> Call the client -> Session Process -> Fill Persona.
// Dots are tappable to jump directly to a stage; filled dots are done,
// the current stage is a ring, later stages stay hollow.
function MilestoneBar({ value, onChange, messageSent, onOpenMessage, callMade, onOpenCall, sessionEnded, billLogged, onOpenBill, personaFilled, onOpenPersona, canManage = true }) {
  const specialDone = (i) => (i === 0 ? messageSent : i === 1 ? callMade : i === 2 ? sessionEnded : i === 3 ? billLogged : i === 4 ? personaFilled : false);
  // Every step before this one must be genuinely done — not just "tapped
  // past" — before this one unlocks. Keeps the flow strictly 1→2→3→4→5.
  const allDoneBefore = (i) => { for (let j = 0; j < i; j++) if (!specialDone(j)) return false; return true; };
  // The displayed "current step" tracks real completion (message sent, call
  // made, session ended, bill logged, persona filled) rather than the raw
  // milestone index, which never moved on its own and would otherwise sit
  // frozen on "Step 1" for the whole flow even as earlier steps complete.
  let realIdx = 0;
  while (realIdx < 4 && specialDone(realIdx)) realIdx++;
  return (
    <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {MILESTONES.map((label, i) => {
          const done = specialDone(i);
          const unlocked = allDoneBefore(i);
          const clickable = canManage && i !== 2 && unlocked;
          return (
            <React.Fragment key={label}>
              <button onClick={() => {
                if (!canManage || !unlocked) return;
                if (i === 0) onOpenMessage && onOpenMessage();
                else if (i === 1) onOpenCall && onOpenCall();
                else if (i === 2) { /* automatic — reflects actual session state, not a manual action */ }
                else if (i === 3) onOpenBill && onOpenBill();
                else if (i === 4) onOpenPersona && onOpenPersona();
              }} disabled={!clickable} aria-label={label}
                title={!canManage ? `${label} — only their own counsellor can update this` : !unlocked ? `${label} — finish the previous step first` : label} style={{
                width: 17, height: 17, borderRadius: 999, flexShrink: 0, cursor: clickable ? "pointer" : "default", padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 0,
                background: (i === 3 || i === 4) ? (done ? RING_DONE_GRADIENT : C.chip) : (done ? RING_DONE_GRADIENT : "#fff"),
                border: done ? "1.5px solid transparent" : `1.5px solid ${C.ghost}`,
                opacity: !canManage ? 0.55 : !unlocked && i !== 2 ? 0.45 : 1,
                transition: "background .3s ease, border-color .3s ease, opacity .2s ease",
              }}>
                {i === 0 && <Send size={9} strokeWidth={2} color={done ? "#fff" : C.faint} style={{ display: "block" }} />}
                {i === 1 && <Phone size={9} strokeWidth={2} color={done ? "#fff" : C.faint} style={{ display: "block" }} />}
                {i === 2 && <Square size={8} strokeWidth={0} fill={done ? "#fff" : C.faint} style={{ display: "block" }} />}
                {i === 3 && <FileCheck size={9} strokeWidth={2} color={done ? "#fff" : C.soft} style={{ display: "block" }} />}
                {i === 4 && <UserCheck size={9} strokeWidth={2} color={done ? "#fff" : C.soft} style={{ display: "block" }} />}
              </button>
              {i < MILESTONES.length - 1 && (
                <div style={{ flex: 1, height: 1.5, background: i < realIdx ? "#111" : C.ghost, minWidth: 8 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: C.soft, marginTop: 6 }}>
        Step {realIdx + 1} of {MILESTONES.length} · <span style={{ color: C.ink, fontWeight: 500 }}>{MILESTONES[realIdx]}</span>
      </div>
    </div>
  );
}

// Shows the personalize-message template with this appointment's client name
// and date filled in, plus a Copy button. Copying is what turns the step-1
// icon in MilestoneBar its themed color, via onCopied.
function PersonalizeMessageSheet({ open, onClose, template, clientName, clientPhone, apptDate, apptTime, onCopied }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (open) setCopied(false); }, [open]);

  const message = (template || "")
    .split("{{name}}").join(clientName || "there")
    .split("{{date}}").join(messageDate(apptDate, apptTime));

  const doCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(message);
    } catch (e) { /* clipboard permission denied — still mark as sent below */ }
    setCopied(true);
    onCopied && onCopied();
  };

  const digits = (clientPhone || "").replace(/\D/g, "");
  const hasPhone = digits.length >= 10;
  const waNumber = digits.length === 10 ? `91${digits}` : digits; // assumes India (+91) for bare 10-digit numbers

  const shareAndCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(message);
    } catch (e) { /* clipboard permission denied — still open WhatsApp below */ }
    window.open(`https://wa.me/${hasPhone ? waNumber : ""}?text=${encodeURIComponent(message)}`, "_blank");
    setCopied(true);
    onCopied && onCopied();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Personalize message">
      <div style={{ padding: "0 4px 4px" }}>
        <div style={{
          background: C.chip, borderRadius: 16, padding: 16, fontSize: 13.5, color: C.ink,
          whiteSpace: "pre-wrap", lineHeight: 1.6, marginBottom: 16,
        }}>
          {message}
        </div>
        <button onClick={shareAndCopy} style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "13px 14px", borderRadius: 14, border: "none", cursor: "pointer",
          background: "#25D366", fontFamily: FONT,
        }}>
          <MessageCircle size={16} strokeWidth={1.8} color="#fff" fill="#25D366" />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{copied ? "Copied · opened WhatsApp" : "WhatsApp & Copy"}</span>
        </button>
        {!hasPhone && (
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, textAlign: "center" }}>
            No phone number on file for this client — WhatsApp needs one to open a chat.
          </div>
        )}
      </div>
    </Sheet>
  );
}

// Confirms before actually placing the call — tapping Call opens the
// device's phone dialer via tel: and marks this appointment's call as made,
// turning the step-2 icon in MilestoneBar its themed color.
function CallConfirmSheet({ open, onClose, clientName, clientPhone, onCalled }) {
  const hasPhone = !!(clientPhone && clientPhone.trim());
  const doCall = () => {
    if (!hasPhone) return;
    window.location.href = `tel:${clientPhone.replace(/\s+/g, "")}`;
    onCalled && onCalled();
    onClose && onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Call client">
      <div style={{ padding: "0 4px 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.chip, borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 999, background: "#fff", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Phone size={17} strokeWidth={1.6} color={C.mid} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{clientName || "Client"}</div>
            <div style={{ fontSize: 13, color: C.soft, marginTop: 2 }}>{hasPhone ? clientPhone : "No phone number on file"}</div>
          </div>
        </div>
        <Btn full kind="solid" disabled={!hasPhone} onClick={doCall} icon={<Phone size={15} strokeWidth={1.8} />}>
          Call {clientName || "client"}
        </Btn>
      </div>
    </Sheet>
  );
}

function TimelineStep({ icon: Icon, done, active, isLast, children }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 999, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: done ? "#111" : "#fff",
          border: `1.5px ${done || active ? "solid" : "dashed"} ${done ? "#111" : active ? "#3f3f46" : C.faint}`,
          transition: "background .25s ease, border-color .25s ease",
        }}>
          <Icon size={15} strokeWidth={1.7} color={done ? "#fff" : active ? "#3f3f46" : C.faint} />
        </div>
        {!isLast && (
          <div style={{ flex: 1, width: 1.5, minHeight: 20, background: done ? "#111" : C.line, marginTop: 4, transition: "background .3s ease" }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 4 : 22 }}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------- 5-segment progress ring */
// Placeholder gradient — swap for the exact color once it's shared.
const RING_DONE_GRADIENT = "linear-gradient(135deg, #8b7fe8 0%, #c589cf 55%, #f0b199 100%)";
const RING_DONE_SOLID = "#8b7fe8"; // used for SVG strokes, which can't take a CSS gradient string directly

// Leave calendar day colors: free week-off days (paid, within the monthly
// quota) read as calm sage → aqua; days that spill past the quota and become
// LOP (loss of pay) read as a warmer cherry → peach. Admin-marked holidays
// reuse the app's signature purple/pink/peach theme gradient above, so they
// read as distinctly "special" rather than another leave state.
const WEEKOFF_GRADIENT = "linear-gradient(135deg, #7fb88f 0%, #7fd6c9 100%)";
const LOP_GRADIENT = "linear-gradient(135deg, #c0463f 0%, #f2b39c 100%)";

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

/* ------------------------------------------------- custom silhouette icons */
// Built as plain inline SVG rather than pulled from an icon library — some
// preview environments only support a limited lucide-react bundle (Mars and
// Venus failed to load there earlier), so these can never break that way.
function MaleSilhouette({ size = 14, color = C.faint }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4.2" fill={color} />
      <path d="M4 21c0-4.6 3.6-8.3 8-8.3s8 3.7 8 8.3" fill={color} />
    </svg>
  );
}
function FemaleSilhouette({ size = 14, color = C.faint }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M16.6 5.2c1.7 0.4 2.6 2.2 1.9 4.3-0.4 1.1-1 1.9-1.4 2.3l1.1 6.6h-2.1l-0.6-4.1" fill={color} />
      <circle cx="12" cy="8" r="4.2" fill={color} />
      <path d="M4 21c0-4.6 3.6-8.3 8-8.3s8 3.7 8 8.3" fill={color} />
    </svg>
  );
}
function ChildSilhouette({ size = 14, color = C.faint, female = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {female && <path d="M16.2 7c1.3 0.5 1.9 2 1.3 3.6-0.4 1-0.9 1.6-1.2 1.9l0.8 4.7h-1.8l-0.5-3.2" fill={color} />}
      <circle cx="12" cy="10" r="5" fill={color} />
      <path d="M5 21c0-3.7 3.1-6.7 7-6.7s7 3 7 6.7" fill={color} />
    </svg>
  );
}
function CoupleSilhouette({ size = 16, color = C.faint }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 34 24" fill="none">
      <g transform="translate(0,0)">
        <circle cx="9" cy="7.5" r="3.8" fill={color} />
        <path d="M2.5 20.5c0-4.1 2.9-7.3 6.5-7.3s6.5 3.2 6.5 7.3" fill={color} />
      </g>
      <g transform="translate(15,0)">
        <path d="M20.6 4.7c1.5 0.4 2.3 2 1.7 3.9-0.3 1-0.9 1.7-1.2 2l1 6h-1.9l-0.5-3.7" fill={color} />
        <circle cx="16" cy="7.5" r="3.8" fill={color} />
        <path d="M9.5 20.5c0-4.1 2.9-7.3 6.5-7.3s6.5 3.2 6.5 7.3" fill={color} />
      </g>
    </svg>
  );
}
function FamilySilhouette({ size = 16, color = C.faint }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 40 24" fill="none">
      <g>
        <circle cx="7" cy="6.5" r="3.4" fill={color} />
        <path d="M1.2 20.5c0-3.7 2.6-6.5 5.8-6.5s5.8 2.8 5.8 6.5" fill={color} />
      </g>
      <g>
        <path d="M23.4 4.2c1.3 0.4 2 1.8 1.5 3.4-0.3 0.9-0.8 1.5-1.1 1.8l0.9 5.3h-1.7l-0.4-3.3" fill={color} />
        <circle cx="19.5" cy="6.5" r="3.4" fill={color} />
        <path d="M13.7 20.5c0-3.7 2.6-6.5 5.8-6.5s5.8 2.8 5.8 6.5" fill={color} />
      </g>
      <g>
        <circle cx="32" cy="12" r="2.6" fill={color} />
        <path d="M27.6 21.5c0-2.7 1.9-4.9 4.4-4.9s4.4 2.2 4.4 4.9" fill={color} />
      </g>
    </svg>
  );
}

function FlameIcon({ size = 16, lit = true }) {
  const [id] = useState(() => "flame-" + Math.random().toString(36).slice(2, 9));
  return (
    <svg width={size} height={size * 1.28} viewBox="0 0 100 128" style={{
      filter: lit ? `drop-shadow(0 0 ${size * 0.5}px rgba(139,127,232,0.55))` : "grayscale(1) opacity(0.4)",
      transition: "filter .3s ease",
    }}>
      <defs>
        <linearGradient id={id} x1="20%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%" stopColor="#8b7fe8" />
          <stop offset="45%" stopColor="#d98fc4" />
          <stop offset="100%" stopColor="#f5b98f" />
        </linearGradient>
      </defs>
      <path d="M50 4C38 20 30 30 30 46c0 10 6 16 6 16s-10-4-10-20c0-6 2-11 2-11S16 44 16 68c0 22 16 38 38 38s38-16 38-38c0-18-10-30-18-40 2 8-2 16-2 16s4-14-6-26c-4 10-2 18-2 18S54 26 50 4Z"
        fill={`url(#${id})`} />
      <ellipse cx="50" cy="94" rx="16" ry="18" fill="#2a2c3d" />
    </svg>
  );
}

// Which client-type marker sits in the middle of the ring. Individual and
// Child clients show a matching male/female silhouette; Couple and Family
// show grouped silhouettes; falls back to a plain neutral icon if gender
// wasn't captured for an Individual booking.
function categoryIcon(category, gender) {
  const c = (category || "").toLowerCase();
  const isChild = c.includes("child") || c.includes("adolescent");
  if (c.includes("family")) return { Icon: (p) => <FamilySilhouette {...p} /> };
  if (c.includes("couple")) return { Icon: (p) => <CoupleSilhouette {...p} /> };
  if (isChild) {
    if (gender === "Male") return { Icon: (p) => <ChildSilhouette {...p} /> };
    if (gender === "Female") return { Icon: (p) => <ChildSilhouette {...p} female /> };
    return { Icon: Baby };
  }
  if (gender === "Male") return { Icon: (p) => <MaleSilhouette {...p} /> };
  if (gender === "Female") return { Icon: (p) => <FemaleSilhouette {...p} /> };
  return { Icon: User };
}

// One appointment's 5-task progress, shown as a segmented ring (not a solid
// fill) — each of the 5 wedges corresponds to one milestone stage, filling
// in as that stage is reached. Center shows the client-type icon or a
// gender letter, whichever categoryIcon() returned.
function SegmentRing({ size = 30, filled, total = 5, Icon, label }) {
  const r = size / 2 - 3.5;
  const cx = size / 2, cy = size / 2;
  const gap = 14; // degrees of gap between wedges
  const seg = 360 / total;
  const allDone = filled >= total;
  const centerColor = allDone ? RING_DONE_SOLID : C.faint;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ position: "absolute", top: 0, left: 0 }}>
        {Array.from({ length: total }).map((_, i) => {
          const start = i * seg + gap / 2;
          const end = (i + 1) * seg - gap / 2;
          const done = i < filled;
          return (
            <path key={i} d={describeArc(cx, cy, r, start, end)}
              stroke={done ? RING_DONE_SOLID : C.faint} strokeWidth={3.2} fill="none" strokeLinecap="round" />
          );
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {label
          ? <span style={{ fontSize: 10, fontWeight: 700, color: centerColor }}>{label}</span>
          : <Icon size={11} strokeWidth={1.8} color={centerColor} />}
      </div>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.faint, marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

// Left-side step tracker for a short sequence of fields — icon fills in
// dark once that field has a value, the very next unfilled field gets an
// "active" outline, everything after stays dashed and quiet.
function TimelineField({ icon: Icon, done, active, isLast, children }) {
  return (
    <div style={{ display: "flex", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 999, flexShrink: 0,
          border: `1.5px ${done ? "solid" : active ? "solid" : "dashed"} ${done ? "#3f3f46" : active ? C.mid : C.faint}`,
          background: done ? "#3f3f46" : "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background .25s ease, border-color .25s ease",
        }}>
          <Icon size={15} strokeWidth={1.6} color={done ? "#fff" : active ? C.mid : C.faint} />
        </div>
        {!isLast && (
          <div style={{
            width: 1.5, flex: 1, minHeight: 26, marginTop: 4, borderRadius: 2,
            background: done ? "#3f3f46" : C.line, transition: "background .25s ease",
          }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 4 }}>{children}</div>
    </div>
  );
}

const inputStyle = {
  width: "100%", border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px",
  fontSize: 14, color: C.ink, background: "#fff", outline: "none", fontFamily: FONT,
};

function Input(props) { return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />; }
function Select({ children, ...p }) {
  return <select {...p} style={{ ...inputStyle, paddingRight: 34, ...(p.style || {}) }}>{children}</select>;
}

// Custom glassmorphism dropdown replacing native <select> chrome everywhere,
// so every picker in the app matches the same frosted-glass style instead of
// the OS's own popup. Positioned fixed (measured from the trigger) so it
// always escapes clipping from a scrollable sheet.
function GlassSelect({ value, onChange, options, placeholder = "Select", style }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const selected = opts.find((o) => o.value === value);

  const openMenu = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setRect({ top: r.bottom + 6, left: r.left, width: r.width });
    }
    setOpen(true);
  };

  return (
    <>
      <button ref={btnRef} type="button" onClick={openMenu} style={{
        ...inputStyle, paddingRight: 34, display: "flex", alignItems: "center", justifyContent: "space-between",
        cursor: "pointer", textAlign: "left", ...(style || {}),
      }}>
        <span style={{ color: selected ? C.ink : C.faint, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={15} strokeWidth={1.7} color={C.soft}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0, marginLeft: 6 }} />
      </button>

      {open && rect && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90, touchAction: "pan-y" }} />
          <div style={{
            position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 91,
            maxHeight: 280, overflowY: "auto", borderRadius: 20, padding: 6,
            background: "rgba(255,255,255,0.6)", backdropFilter: "blur(26px) saturate(190%)", WebkitBackdropFilter: "blur(26px) saturate(190%)",
            border: "1px solid rgba(255,255,255,0.8)", boxShadow: "0 14px 36px rgba(20,20,20,0.16), 0 4px 12px rgba(20,20,20,0.08)",
          }}>
            {opts.map((o, i) => o.divider ? (
              <div key={`div-${i}`} style={{ textAlign: "center", padding: "10px 6px 7px", marginTop: i === 0 ? 0 : 4 }}>
                <span style={{ fontSize: 14, color: C.soft, letterSpacing: "0.03em" }}>{o.label}</span>
              </div>
            ) : (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "11px 13px", background: value === o.value ? "rgba(0,0,0,0.05)" : "transparent",
                  border: "none", cursor: "pointer", textAlign: "left", borderRadius: 14, fontFamily: FONT,
                }}>
                <span style={{ fontSize: 14, color: C.ink, fontWeight: value === o.value ? 600 : 400 }}>{o.label}</span>
                {value === o.value && <Check size={15} strokeWidth={2.2} color={C.ink} />}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderBottom: `1px solid ${C.hair}` }}>
      <span style={{ fontSize: 13, color: C.soft }}>{label}</span>
      <span style={{ fontSize: strong ? 15 : 14, fontWeight: strong ? 500 : 400, color: C.ink }}>{value}</span>
    </div>
  );
}

/* --------------------------------------------------- grouped-list system */
// Reusable pieces echoing a grouped-list style: uppercase eyebrow labels,
// pill actions, squircle icon chips, initials avatars, and one bordered
// container per section with hairline dividers between rows.
function SectionLabel({ children, action }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <span style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em" }}>{children}</span>
      {action}
    </div>
  );
}

function Pill({ children, onClick, icon, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.line}`, borderRadius: 999,
      padding: "8px 14px", fontSize: 13, color: C.ink, background: "#fff", cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.4 : 1, whiteSpace: "nowrap",
    }}>{icon}{children}</button>
  );
}

function IconSquircle({ children, size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.32, background: C.chip,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>{children}</div>
  );
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

function Avatar({ name, size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 999, background: C.chip, color: C.mid,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      fontSize: size * 0.36, fontWeight: 500,
    }}>{initials(name)}</div>
  );
}

// Ring reflects onboarding status: peach/cherry-red while on a TPIN
// (probation, not yet fully signed up), sage-green/teal-blue once they've
// completed signup and have their own MPIN.
function StatusAvatar({ name, size = 40, photo, accountStatus, isOwner, onClick }) {
  const ringGradient = (isOwner || accountStatus !== "tpin")
    ? "linear-gradient(135deg, #8fd9b6 0%, #4fc3d9 100%)"
    : "linear-gradient(135deg, #ffb199 0%, #d64550 100%)";
  const Wrap = onClick ? "button" : "div";
  return (
    <Wrap onClick={onClick} style={{
      width: size + 6, height: size + 6, borderRadius: 999, background: ringGradient,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      border: "none", padding: 0, cursor: onClick ? "pointer" : "default",
    }}>
      <div style={{
        width: size, height: size, borderRadius: 999, background: photo ? "transparent" : C.chip, color: C.mid,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        fontSize: size * 0.36, fontWeight: 500, overflow: "hidden", border: "2px solid #fff",
      }}>
        {photo ? <img src={photo} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(name)}
      </div>
    </Wrap>
  );
}

function GroupedCard({ children }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 18, background: "#fff", overflow: "hidden" }}>{children}</div>
  );
}

function GroupedRow({ leading, title, subtitle, trailing, onClick, chevron = true, first, strongTitle }) {
  const Wrap = onClick ? "button" : "div";
  return (
    <Wrap onClick={onClick} style={{
      width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 16px",
      borderWidth: first ? "0 0 0 0" : "1px 0 0 0", borderStyle: "solid", borderColor: C.line,
      background: "#fff",
      cursor: onClick ? "pointer" : "default", textAlign: "left", fontFamily: FONT,
    }}>
      {leading}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, color: "#0a0a0a", fontWeight: strongTitle ? 700 : 400 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: C.soft, marginTop: 3 }}>{subtitle}</div>}
      </div>
      {trailing && <div style={{ fontSize: 14, color: C.ink, flexShrink: 0, textAlign: "right" }}>{trailing}</div>}
      {chevron && onClick && <ChevronRight size={17} strokeWidth={1.3} color={C.faint} style={{ flexShrink: 0 }} />}
    </Wrap>
  );
}

function SummaryStats({ items }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 18, background: "#fff", display: "flex" }}>
      {items.map((it, i) => (
        <div key={it.label} style={{
          flex: 1, textAlign: "center", padding: "18px 8px",
          borderLeft: i === 0 ? "none" : `1px solid ${C.hair}`,
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.06em" }}>{it.label}</div>
          <div style={{ fontSize: 19, fontWeight: 700, color: C.ink, marginTop: 6, letterSpacing: "-0.3px" }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}


function useIsWide(bp = 640) {
  const [wide, setWide] = useState(typeof window !== "undefined" ? window.innerWidth >= bp : false);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return wide;
}

function Sheet({ open, onClose, title, children, footer, wide, headerExtra }) {
  const isWide = useIsWide();
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(17,17,17,0.28)",
        display: "flex", alignItems: isWide ? "center" : "flex-end", justifyContent: "center",
        padding: isWide ? 24 : 0,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: wide ? 640 : 460, background: "#fff",
          borderRadius: isWide ? 22 : "20px 20px 0 0", border: `1px solid ${C.line}`,
          maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${C.hair}`, gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 500 }}>{title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {headerExtra}
            <button onClick={onClose} style={{ padding: 4, cursor: "pointer" }}><X size={18} strokeWidth={1.4} color={C.soft} /></button>
          </div>
        </div>
        <div style={{ padding: "18px 20px", overflowY: "auto", overflowX: "hidden", flex: 1 }}>{children}</div>
        {footer && <div style={{ padding: "14px 20px", borderTop: `1px solid ${C.hair}`, display: "flex", gap: 10 }}>{footer}</div>}
      </div>
    </div>
  );
}

function Empty({ text, action }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px" }}>
      <div style={{ fontSize: 14, color: C.soft }}>{text}</div>
      {action && <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>{action}</div>}
    </div>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 150, zIndex: 80,
      background: "#111", color: "#fff", fontSize: 13, padding: "10px 16px", borderRadius: 999,
      maxWidth: "88%", textAlign: "center",
    }}>{msg}</div>
  );
}

/* ------------------------------------------------------------ date strip */
function haptic(ms = 10) {
  try { if (navigator && navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not supported */ }
}

const EMPTY_DOT_STATUS = new Map();
function DateStrip({ selected, onSelect, markedDates, completedDates, scheduleDotStatus = EMPTY_DOT_STATUS }) {
  const sel = fromYmd(selected);
  const days = [-3, -2, -1, 0, 1, 2, 3].map((o) => addDays(sel, o));
  const todayKey = ymd(new Date());
  const scale = [
    { f: 34, w: 800, c: C.ink, n: 13, nc: C.ink, dot: C.ink },
    { f: 21, w: 400, c: "#3a3a3c", n: 12, nc: C.soft, dot: C.faint },
    { f: 19, w: 400, c: C.soft, n: 12, nc: C.faint, dot: C.ghost },
    { f: 17, w: 400, c: C.ghost, n: 11, nc: C.ghost, dot: C.ghost },
  ];

  const startX = useRef(null);
  const dragging = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [sliding, setSliding] = useState(false);

  const onTouchStart = (e) => { startX.current = e.touches[0].clientX; dragging.current = true; setSliding(false); };
  const onTouchMove = (e) => {
    if (!dragging.current || startX.current == null) return;
    const dx = e.touches[0].clientX - startX.current;
    setDragX(Math.max(-70, Math.min(70, dx)));
  };
  const onTouchEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setSliding(true);
    if (Math.abs(dragX) > 36) {
      const direction = dragX < 0 ? 1 : -1; // swipe left -> next day, swipe right -> previous day
      haptic(10);
      onSelect(ymd(addDays(sel, direction)));
    }
    setDragX(0);
    startX.current = null;
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px 0",
        transform: `translateX(${dragX}px)`,
        transition: sliding ? "transform .24s cubic-bezier(.34,1.3,.4,1)" : "none",
        touchAction: "pan-y",
      }}>
      {days.map((d, i) => {
        const dist = Math.abs(i - 3);
        const s = scale[dist];
        const key = ymd(d);
        const marked = markedDates.has(key);
        const isToday = key === todayKey;
        const isPast = key < todayKey;
        return (
          <button key={key} onClick={() => onSelect(key)}
            style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "4px 0", cursor: "pointer", background: "none", border: "none" }}>
            <span style={{ fontSize: s.n, color: s.nc, lineHeight: 1.6, fontWeight: dist === 0 ? 500 : 400 }}>{DAYS[d.getDay()]}</span>
            <span style={{ position: "relative", display: "inline-block" }}>
              <span style={{ fontSize: s.f, fontWeight: s.w, color: s.c, lineHeight: 1.15, letterSpacing: dist === 0 ? "-1px" : 0 }}>{d.getDate()}</span>
              {dist === 0 && (
                <span style={{
                  position: "absolute", top: -1, right: -7, width: 7, height: 7, borderRadius: 999,
                  background: scheduleDotStatus.get(key) === "done"
                    ? "linear-gradient(135deg, #8fd9b6 0%, #4fc3d9 100%)"
                    : "linear-gradient(135deg, #ffb199 0%, #d64550 100%)",
                  opacity: scheduleDotStatus.has(key) ? 1 : 0,
                  transition: "opacity .5s ease, background .3s ease", pointerEvents: "none",
                }} />
              )}
            </span>
            {isToday && (
              <span style={{ fontSize: 10, color: C.faint, marginTop: dist === 0 ? 2 : 0, lineHeight: 1 }}>Today</span>
            )}
            {dist === 0 && (marked || isPast || isToday) ? (
              <span style={{ display: "block" }}>
                <FlameIcon size={16} lit={!!(completedDates && completedDates.has(key))} />
              </span>
            ) : dist === 0 ? (
              <span style={{ width: 4, height: 4 }} />
            ) : (
              <span style={{
                width: 7, height: 7, borderRadius: 999,
                background: scheduleDotStatus.get(key) === "done"
                  ? "linear-gradient(135deg, #8fd9b6 0%, #4fc3d9 100%)"
                  : scheduleDotStatus.has(key) ? "linear-gradient(135deg, #ffb199 0%, #d64550 100%)"
                  : isPast ? C.ghost : "transparent",
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------- month calendar */
function MonthCalendar({ selected, onSelect, markedDates, scheduleDotStatus = EMPTY_DOT_STATUS }) {
  const sel = fromYmd(selected);
  const [cursor, setCursor] = useState(new Date(sel.getFullYear(), sel.getMonth(), 1));
  useEffect(() => { setCursor(new Date(sel.getFullYear(), sel.getMonth(), 1)); }, [selected]);
  const today = ymd(new Date());
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];

  return (
    <div style={{ padding: "6px 12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={{ padding: 6, cursor: "pointer" }}>
          <ChevronLeft size={18} strokeWidth={1.4} color={C.soft} />
        </button>
        <div style={{ fontSize: 15, fontWeight: 500 }}>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</div>
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={{ padding: 6, cursor: "pointer" }}>
          <ChevronRight size={18} strokeWidth={1.4} color={C.soft} />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", rowGap: 2 }}>
        {DAYS.map((d) => (
          <div key={d} style={{ textAlign: "center", fontSize: 11, color: C.faint, paddingBottom: 6 }}>{d}</div>
        ))}
        {cells.map((n, i) => {
          if (!n) return <div key={`e${i}`} />;
          const key = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), n));
          const isSel = key === selected;
          const isToday = key === today;
          return (
            <button key={key} onClick={() => onSelect(key)}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "7px 0", cursor: "pointer", background: "none", border: "none" }}>
              <span style={{ position: "relative", display: "inline-block" }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, color: isSel ? "#fff" : isToday ? C.ink : C.mid,
                  fontWeight: isSel || isToday ? 500 : 400,
                  background: isSel ? "#111" : "transparent",
                  border: !isSel && isToday ? `1px solid ${C.ghost}` : "1px solid transparent",
                }}>{n}</span>
                <span style={{
                  position: "absolute", top: 1, right: 1, width: 7, height: 7, borderRadius: 999,
                  background: scheduleDotStatus.get(key) === "done"
                    ? "linear-gradient(135deg, #8fd9b6 0%, #4fc3d9 100%)"
                    : "linear-gradient(135deg, #ffb199 0%, #d64550 100%)",
                  opacity: scheduleDotStatus.has(key) ? 1 : 0,
                  transition: "opacity .5s ease, background .3s ease", pointerEvents: "none",
                }} />
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
        <button onClick={() => onSelect(today)} style={{ fontSize: 12, color: C.soft, padding: "6px 12px", cursor: "pointer" }}>Back to today</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- login */
function Login({ data, onLogin, saveCredential, updateQuote }) {
  const [mode, setMode] = useState("resource");
  const [who, setWho] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [bioReady, setBioReady] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [pending, setPending] = useState(null); // {key, user} — verified, deciding on Face ID setup
  const [quoteEditor, setQuoteEditor] = useState(false);
  const [quoteAuthed, setQuoteAuthed] = useState(false);
  const [quoteAuthPin, setQuoteAuthPin] = useState("");
  const [quoteAuthErr, setQuoteAuthErr] = useState("");
  const [editGrey, setEditGrey] = useState("");
  const [editBlack, setEditBlack] = useState("");

  useEffect(() => { biometricSupported().then(setBioReady); }, []);

  useEffect(() => {
    if (!document.querySelector('link[data-nurora="inter"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@500;800;900&display=swap";
      link.setAttribute("data-nurora", "inter");
      document.head.appendChild(link);
    }
  }, []);

  const identityKey = mode === "admin" ? "admin" : who;
  const selectedCounsellor = mode === "resource" ? data.counsellors.find((x) => x.id === who) : null;
  const hasCredential = identityKey && !!(data.webauthn || {})[identityKey] && (mode === "admin" || (selectedCounsellor && (selectedCounsellor.isOwner || selectedCounsellor.accountStatus !== "tpin")));

  const submit = () => {
    if (mode === "admin") {
      if (pin !== data.settings.adminPin) return setErr("That PIN doesn't match. Try again.");
      finishOrOfferBiometric("admin", { role: "admin", name: "Admin" }, true);
    } else {
      const c = data.counsellors.find((x) => x.id === who);
      if (!c) return setErr("Choose your name to continue.");
      if (c.isOwner) {
        if (pin !== c.pin) return setErr("That PIN doesn't match. Try again.");
        finishOrOfferBiometric(c.id, { role: "resource", name: c.name, counsellorId: c.id, isNuLancer: !!c.isNuLancer }, true);
        return;
      }
      const isMpin = c.accountStatus === "mpin" && c.mpin;
      if (isMpin) {
        if (pin !== c.mpin) return setErr("That PIN doesn't match. Try again.");
      } else {
        const today = ymd(new Date());
        if (c.probationTo && today > c.probationTo) {
          return setErr("Your temporary access has expired. Ask Admin for a new TPIN, or complete signup.");
        }
        // Older accounts saved before TPIN existed only have the original
        // `pin` field — fall back to it rather than locking them out.
        const effectivePin = c.tpin || c.pin;
        if (pin !== effectivePin) return setErr("That PIN doesn't match. Try again.");
      }
      const allowBiometricOffer = isMpin || !c.accountStatus;
      finishOrOfferBiometric(c.id, { role: "resource", name: c.name, counsellorId: c.id, isNuLancer: !!c.isNuLancer }, allowBiometricOffer);
    }
  };

  const finishOrOfferBiometric = (key, u, allowBiometricOffer) => {
    if (allowBiometricOffer && bioReady && !(data.webauthn || {})[key]) setPending({ key, user: u });
    else onLogin(u);
  };

  const signInWithBiometric = async () => {
    setErr(""); setBioBusy(true);
    try {
      const credId = (data.webauthn || {})[identityKey];
      const ok = await verifyBiometric(credId);
      if (!ok) throw new Error("no assertion");
      if (mode === "admin") onLogin({ role: "admin", name: "Admin" });
      else {
        const c = data.counsellors.find((x) => x.id === who);
        if (!c) { setErr("Choose your name to continue."); setBioBusy(false); return; }
        onLogin({ role: "resource", name: c.name, counsellorId: c.id, isNuLancer: !!c.isNuLancer });
      }
    } catch (e) {
      setErr("Face ID / Touch ID didn't go through. Use your PIN instead.");
    } finally {
      setBioBusy(false);
    }
  };

  if (pending) {
    return (
      <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 340, textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 999, background: C.chip, margin: "0 auto 20px",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <ScanFace size={28} strokeWidth={1.4} color={C.ink} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: C.ink, marginBottom: 6 }}>Enable Face ID?</div>
          <div style={{ fontSize: 13, color: C.soft, marginBottom: 28, lineHeight: 1.5 }}>
            Sign in faster next time as {pending.user.name} using Face ID or Touch ID on this device.
          </div>
          <Btn kind="solid" full onClick={async () => {
            try {
              const credId = await registerBiometric(pending.key, pending.user.name);
              saveCredential(pending.key, credId);
            } catch (e) { /* declined or unavailable */ }
            onLogin(pending.user);
          }}>Enable Face ID</Btn>
          <div style={{ height: 10 }} />
          <Btn full onClick={() => onLogin(pending.user)}>Not now</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, position: "relative" }}>
      <button
        onClick={() => {
          setEditGrey(data.settings.loginQuoteGrey || "");
          setEditBlack(data.settings.loginQuoteBlack || "");
          setQuoteAuthed(false); setQuoteAuthPin(""); setQuoteAuthErr("");
          setQuoteEditor(true);
        }}
        style={{
          position: "absolute", top: "calc(18px + env(safe-area-inset-top,0px))", right: 20,
          display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer",
        }}>
        <span style={{ fontSize: 12.5, color: C.soft }}>Solulu Therapy <b style={{ color: C.ink, fontWeight: 700 }}>Quotes</b></span>
        <ArrowRight size={13} strokeWidth={2} color={C.soft} />
      </button>

      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{
          fontFamily: "'Inter', " + FONT, lineHeight: 1.08, letterSpacing: "-1.2px",
          marginBottom: 32, textAlign: "left",
        }}>
          <div style={{ fontSize: 34, fontWeight: 500, color: "#b4b4b8" }}>{data.settings.loginQuoteGrey || "Always believe something wonderful"}</div>
          <div style={{ fontSize: 34, fontWeight: 900, color: "#111114" }}>{data.settings.loginQuoteBlack || "About to Happen."}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontFamily: "'Inter', " + FONT, fontSize: 18, fontWeight: 800, letterSpacing: "-1.2px", lineHeight: 1,
            backgroundImage: "linear-gradient(180deg, rgba(28,28,30,0.55), rgba(28,28,30,0.14))",
            WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          }}>Nurora</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#1c1c1e", letterSpacing: "-0.2px", marginTop: -7, lineHeight: 1.3, position: "relative" }}>
            Schedule's
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {[["resource", "Counsellor"], ["admin", "Admin"]].map(([k, l]) => (
            <button key={k} onClick={() => { setMode(k); setErr(""); setPin(""); }}
              style={{
                flex: 1, padding: "10px 0", fontSize: 13, borderRadius: 12, cursor: "pointer",
                border: `1px solid ${mode === k ? "#111" : C.line}`,
                background: mode === k ? "#111" : "#fff", color: mode === k ? "#fff" : C.mid,
              }}>{l}</button>
          ))}
        </div>

        {mode === "resource" && (
          <Field label="Name">
            <GlassSelect value={who} onChange={(v) => { setWho(v); setErr(""); }}
              placeholder="Select counsellor"
              options={(() => {
                const activeC = data.counsellors.filter((c) => c.active);
                const regular = activeC.filter((c) => !c.isNuLancer).map((c) => ({ value: c.id, label: c.name }));
                const nulancers = activeC.filter((c) => c.isNuLancer).map((c) => ({ value: c.id, label: c.name }));
                return nulancers.length
                  ? [...regular, { divider: true, label: "——NuLancers——" }, ...nulancers]
                  : regular;
              })()} />
          </Field>
        )}

        {bioReady && hasCredential && (mode === "admin" || who) && (
          <button onClick={signInWithBiometric} disabled={bioBusy} style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "12px 0", marginBottom: 16, borderRadius: 12, border: `1px solid ${C.line}`,
            background: "#fff", cursor: bioBusy ? "default" : "pointer", opacity: bioBusy ? 0.6 : 1,
          }}>
            <ScanFace size={17} strokeWidth={1.6} color={C.ink} />
            <span style={{ fontSize: 14, color: C.ink }}>{bioBusy ? "Verifying…" : "Sign in with Face ID"}</span>
          </button>
        )}

        <Field label="PIN">
          <Input type="password" inputMode="numeric" value={pin} placeholder="••••"
            onChange={(e) => { setPin(e.target.value); setErr(""); }}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </Field>

        {err && <div style={{ fontSize: 12, color: "#b42318", marginBottom: 12 }}>{err}</div>}
        <Btn kind="solid" full onClick={submit}>Sign in</Btn>

        {!bioReady && (
          <div style={{ fontSize: 11, color: C.faint, marginTop: 16, textAlign: "center" }}>
            Face ID / Touch ID isn't available on this device or preview.
          </div>
        )}
      </div>

      <Sheet open={quoteEditor} onClose={() => setQuoteEditor(false)}
        title={quoteAuthed ? "Edit login quote" : "Admin authorization"}
        footer={quoteAuthed ? (
          <>
            <Btn full onClick={() => setQuoteEditor(false)}>Cancel</Btn>
            <Btn full kind="solid" onClick={() => { updateQuote(editGrey.trim(), editBlack.trim()); setQuoteEditor(false); }}>Save quote</Btn>
          </>
        ) : (
          <>
            <Btn full onClick={() => setQuoteEditor(false)}>Cancel</Btn>
            <Btn full kind="solid" onClick={() => {
              if (quoteAuthPin === data.settings.adminPin) { setQuoteAuthed(true); setQuoteAuthErr(""); }
              else setQuoteAuthErr("That PIN doesn't match. Try again.");
            }}>Unlock</Btn>
          </>
        )}>
        {quoteAuthed ? (
          <>
            <Field label="Grey line" hint="The lighter, first line of the quote.">
              <Input value={editGrey} onChange={(e) => setEditGrey(e.target.value)} />
            </Field>
            <Field label="Black line" hint="The bold, emphasized line underneath.">
              <Input value={editBlack} onChange={(e) => setEditBlack(e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: C.soft, marginBottom: 16, lineHeight: 1.5 }}>
              Changing the quote on the sign-in screen needs the Admin PIN.
            </div>
            <Field label="Admin PIN">
              <Input type="password" inputMode="numeric" value={quoteAuthPin} placeholder="••••"
                onChange={(e) => { setQuoteAuthPin(e.target.value); setQuoteAuthErr(""); }} />
            </Field>
            {quoteAuthErr && <div style={{ fontSize: 12, color: "#b42318" }}>{quoteAuthErr}</div>}
          </>
        )}
      </Sheet>

      <div style={{
        position: "absolute", bottom: "calc(8px + env(safe-area-inset-bottom,0px))", left: 0, right: 0,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}>
        <span style={{ fontSize: 9, color: "#b4b4b8", letterSpacing: "-0.01em" }}>Made in LEUMAS</span>
        <span style={{ fontSize: 9, color: "#d4d4d8" }}>|</span>
        <span style={{ fontSize: 9, color: "#b4b4b8", letterSpacing: "-0.01em" }}>
          Designed by{" "}
          <a href={data.settings.designerUrl || undefined} target="_blank" rel="noreferrer"
            onClick={(e) => { if (!data.settings.designerUrl) e.preventDefault(); }}
            style={{ color: "#b4b4b8", textDecoration: "none" }}>
            Samuel Rednus
          </a>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------- availability helpers */
function leaveOn(data, counsellorId, date) {
  return data.leaves.find((l) => l.counsellorId === counsellorId && date >= l.from && date <= l.to) || null;
}
function weekOffOn(data, counsellor, date) {
  if ((counsellor.weekOffExceptions || {})[date]) return null; // explicitly working despite being marked off
  const monthKey = date.slice(0, 7);
  const dates = (counsellor.weekOffDates || {})[monthKey] || [];
  return dates.includes(date) ? true : null;
}
function runningSession(data, appointmentId) {
  return data.sessions.find((s) => s.appointmentId === appointmentId && !s.endedAt) || null;
}
function sessionFor(data, appointmentId) {
  return data.sessions.find((s) => s.appointmentId === appointmentId) || null;
}

// How many of the 5 milestone stages are actually complete for this
// appointment — driven by the real signals (message copied/sent, call
// placed, session ended) rather than the raw milestone index, which only
// tracks which stage's *sheet* is currently open and would otherwise read
// as "1 done" the instant a booking is created, before anything happened.
// A cancelled row shouldn't just say "Cancelled" — it should say exactly
// what happened: refunded or not, or rescheduled (and to when, if known).
function cancelStatusLabel(data, appt) {
  if (appt.rescheduleStatus === "pending") return "Reschedule — date TBD";
  if (appt.rescheduleStatus === "moved") {
    const moved = data.appointments.find((x) => x.id === appt.rescheduledToId);
    return moved ? `Reschedule to ${shortDate(moved.date)}` : "Reschedule to new date";
  }
  if (appt.cancelType === "refund") return "Cancelled With Refund";
  if (appt.cancelType === "no-refund") return "Cancelled Without Refund";
  return "Cancelled";
}

function apptProgressCount(data, appt) {
  let n = 0;
  if (appt.messageSent) n++;
  if (appt.callMade) n++;
  const sess = sessionFor(data, appt.id);
  if (sess && sess.endedAt) n++;
  if (appt.billLogged) n++;
  if (appt.personaFilled) n++;
  return n;
}

// A day is "fully done" once every booked (non-cancelled) appointment that
// day has reached the last milestone stage — used to light up the fire icon.
function dayFullyDone(data, dateStr) {
  const appts = data.appointments.filter((a) => a.date === dateStr && a.status !== "Cancelled");
  if (appts.length === 0) return false;
  return appts.every((a) => apptProgressCount(data, a) >= MILESTONES.length);
}

// Same idea, scoped to one counsellor — lights up their initials circle on
// the schedule once every one of their own bookings that day is fully done.
function counsellorDayFullyDone(data, counsellorId, dateStr) {
  const appts = data.appointments.filter((a) => a.date === dateStr && a.counsellorId === counsellorId && a.status !== "Cancelled");
  if (appts.length === 0) return false;
  return appts.every((a) => apptProgressCount(data, a) >= MILESTONES.length);
}

/* -------------------------------------------------- per-date slot edits */
// A counsellor's normal working slots repeat every day. Editing a specific
// date (changing a time, adding/removing a slot) creates an override for
// just that date, without touching their regular recurring schedule.
function slotsForDate(counsellor, date) {
  const override = (counsellor.slotOverrides || {})[date];
  return override !== undefined ? override : (counsellor.slots || []);
}

// If someone deliberately edits a day down to fewer than the normal 2
// slots, that's read as reduced availability: exactly 1 slot => half day,
// 0 slots => full day off — but only when there's an explicit override for
// that date, never inferred from someone's ordinary recurring schedule.
// Admin can attach a reason (workshop, lunch, therapy meet, etc.) to a date,
// which replaces the auto Half day/Leave flag with that note instead.
function inferredDayStatus(counsellor, date) {
  const exception = (counsellor.dayExceptions || {})[date];
  if (exception) return { kind: "excused", comment: exception.comment };
  const override = (counsellor.slotOverrides || {})[date];
  if (override === undefined) return null;
  if (override.length === 0) return { kind: "leave" };
  if (override.length === 1) return { kind: "half" };
  return null;
}

/* --------------------------------------------------------- chat log fmt */
// "04:30pm" — zero-padded 12-hour clock, no space, lowercase am/pm.
function chatTime(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  const hh = pad(h % 12 === 0 ? 12 : h % 12);
  const mm = pad(d.getMinutes());
  return `${hh}:${mm}${h >= 12 ? "pm" : "am"}`;
}
// "Sat 22 Aug' 2026, Today" — day header for the activity log, with
// Today/Yesterday only applying to those two specific dates.
function chatDayHeader(dateKey) {
  const d = fromYmd(dateKey);
  const base = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}' ${d.getFullYear()}`;
  const today = ymd(new Date());
  const yesterday = ymd(addDays(new Date(), -1));
  if (dateKey === today) return `${base}, Today`;
  if (dateKey === yesterday) return `${base}, Yesterday`;
  return base;
}
// System activity entries authored as "Nurora" — always built and merged
// into the same setData call as the action they describe, since a separate
// dispatch would read a stale `data` closure and clobber the primary change.
function systemMsg(text) {
  return { id: uid("m"), text, ts: Date.now(), senderId: "system", senderName: "Nurora", senderRole: "system", kind: "text", tag: null };
}

/* ------------------------------------------------------ leave & LOP math */
// Business rule: counsellors get a fixed number of paid leave days per month
// (default 4). Two half-days count as one full day. Anything beyond the
// monthly quota is recorded as LOP (Loss of Pay) rather than blocked.
function daysInclusive(fromStr, toStr) {
  const diff = Math.round((fromYmd(toStr) - fromYmd(fromStr)) / 86400000);
  return Math.max(1, diff + 1);
}
function leaveUnits(l) {
  const days = daysInclusive(l.from, l.to);
  return l.half ? days * 0.5 : days;
}
function monthKeyOf(dateStr) { return dateStr.slice(0, 7); }

// NuLancer staffing signal: how many Resources are out on a given day,
// and whether any single one of them is on a long (3+ day) stretch.
// Resource-only — NuLancers and Owners never count toward this.
function staffingStatusForDate(data, dateKey) {
  const resources = data.counsellors.filter((c) => c.active && !c.isNuLancer && !c.isOwner);
  const absentToday = resources.filter((c) =>
    data.leaves.some((l) => l.counsellorId === c.id && l.from <= dateKey && dateKey <= l.to && !l.half)
  );
  const anyLongLeave = absentToday.some((c) => {
    const l = data.leaves.find((x) => x.counsellorId === c.id && x.from <= dateKey && dateKey <= x.to && !x.half);
    if (!l) return false;
    const days = Math.round((fromYmd(l.to) - fromYmd(l.from)) / 86400000) + 1;
    return days >= 3;
  });
  const count = absentToday.length;
  if (count > 2) return "highly";
  if (count > 1 || (count === 1 && anyLongLeave)) return "requiring";
  return null;
}

function leaveUnitsUsedInMonth(data, counsellorId, monthKey, excludeId) {
  return data.leaves
    .filter((l) => l.counsellorId === counsellorId && l.id !== excludeId && l.type !== "Paid-off" && monthKeyOf(l.from) === monthKey)
    .reduce((t, l) => t + leaveUnits(l), 0);
}
function splitPaidLop(existingUnits, newUnits, quota) {
  const remaining = Math.max(0, quota - existingUnits);
  const lopUnits = Math.max(0, newUnits - remaining);
  return { paidUnits: newUnits - lopUnits, lopUnits };
}
// The paid/LOP split must not depend on the order leave was tapped in — the
// earliest date in the month should always get first claim on the quota.
// So whenever this counsellor's leave for a month changes, every record for
// that month gets its paid/LOP re-derived from scratch, walking dates
// earliest-first. Paid-off records sit outside the quota entirely.
function recomputeLeaveSplits(leaves, counsellorId, monthKey, quota) {
  const chronological = leaves
    .filter((l) => l.counsellorId === counsellorId && monthKeyOf(l.from) === monthKey && l.type !== "Paid-off")
    .sort((a, b) => a.from.localeCompare(b.from) || String(a.id).localeCompare(String(b.id)));
  let used = 0;
  const next = {};
  for (const l of chronological) {
    const units = leaveUnits(l);
    next[l.id] = { ...splitPaidLop(used, units, quota), units };
    used += units;
  }
  return leaves.map((l) => (next[l.id] ? { ...l, ...next[l.id] } : l));
}
function fmtDays(n) {
  const r = Math.round(n * 10) / 10;
  return `${r} day${r === 1 ? "" : "s"}`;
}
// A month is split into real Sun–Sat calendar weeks, then any boundary week
// with 3 or fewer of its days actually in this month gets folded into its
// neighbor rather than counted on its own — confirmed against Aug 2026
// (4 weeks: the lone Aug 1 and the Aug 30–31 pair both merge in) and Sept
// 2026 (5 weeks: both boundary rows already have >3 days, nothing merges).
function getMonthWeeks(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const rows = [];
  let current = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(y, m - 1, d);
    current.push(ymd(dt));
    if (dt.getDay() === 6 || d === daysInMonth) { rows.push(current); current = []; }
  }
  if (rows.length > 1 && rows[0].length <= 3) { rows[1] = [...rows[0], ...rows[1]]; rows.shift(); }
  if (rows.length > 1 && rows[rows.length - 1].length <= 3) {
    rows[rows.length - 2] = [...rows[rows.length - 2], ...rows[rows.length - 1]];
    rows.pop();
  }
  return rows.map((dates, i) => ({ weekNumber: i + 1, dates }));
}

// The monthly paid-leave quota now tracks the month's own week count instead
// of a fixed number — 4 in a 4-week month, 5 in a 5-week month — using the
// same week-merging rule as the calendar rows above.
function weekOffQuotaForMonth(monthKey) { return getMonthWeeks(monthKey).length; }

// Org-wide holiday/festival/special-leave marker for a date, set by Admin.
// Applies to every counsellor's calendar — not tied to one person.
function holidayOn(data, date) {
  return (data.holidays || []).find((h) => h.date === date) || null;
}

// Of this counsellor's leave records this month, how many landed inside the
// paid quota ("week-off" days) vs. spilled past it into LOP.
function weekOffLeaveCountInMonth(data, counsellorId, monthKey) {
  return data.leaves.filter((l) => l.counsellorId === counsellorId && monthKeyOf(l.from) === monthKey && l.type !== "Paid-off" && (l.paidUnits ?? 0) > 0).length;
}
function lopLeaveCountInMonth(data, counsellorId, monthKey) {
  return data.leaves.filter((l) => l.counsellorId === counsellorId && monthKeyOf(l.from) === monthKey && (l.lopUnits ?? 0) > 0).length;
}

/* ------------------------------------------------------------ attendance */
// One record per counsellor per day: check-in and check-out, each with an
// optional captured location. "auto" means the device's own location was
// successfully read at that moment; without it (denied/unsupported), the
// time is still logged, just without a location attached.
function attendanceToday(data, counsellorId) {
  const today = ymd(new Date());
  return (data.attendance || []).find((a) => a.counsellorId === counsellorId && a.date === today) || null;
}

// Attendance records saved before check-in stopped reading location still
// carry coordinates, so the Attendance screen can still link them out to a
// map. Nothing writes new ones.
function mapsLink(lat, lng) { return `https://maps.google.com/?q=${lat},${lng}`; }

/* ------------------------------------------------------------ nubills */
// Nubills reads a pasted text feed from the separate billing web app (the
// counsellor pastes what they receive after logging a payment there) and
// pulls out the structured fields, rather than making anyone retype them.
function grabField(text, label) {
  const re = new RegExp(`${label}\\s*:\\s*(.+)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}
function parseAmount(str) {
  const m = (str || "").match(/[\d,]+(\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, "")) : 0;
}
// The "Calculation" line lists any number of ₹amount (label) pairs —
// e.g. "₹500 (Advance) + ₹0 (Cash) + ₹1500 (QR or Link)" — parsed generically
// rather than assuming exactly those three, since the breakdown may vary.
function parseCalculationLine(line) {
  const out = [];
  const re = /₹\s*([\d,]+(?:\.\d+)?)\s*\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(line || ""))) out.push({ label: m[2].trim(), amount: Number(m[1].replace(/,/g, "")) });
  return out;
}
function parseBillText(text) {
  const calcLine = grabField(text, "Calculation");
  return {
    clientName: grabField(text, "Client Name"),
    counsellorName: grabField(text, "Counsellor Name"),
    date: grabField(text, "Date"),
    billNo: grabField(text, "Bill No"),
    totalAmount: parseAmount(grabField(text, "Total Amount")),
    breakdown: parseCalculationLine(calcLine),
    calculationText: calcLine,
    rawText: (text || "").trim(),
  };
}
function safeShortDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? shortDate(d) : (d || "—"); }
// "2026-08-23" -> "23-08-2026" — the pasted feed's date reformatted for display.
function toDDMMYYYY(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (d || "");
}


// Week-offs are freely chosen specific dates per month (not a recurring
// weekday), so the count is just how many dates they picked for that month.
function weekOffCountInMonth(counsellor, monthKey) {
  return ((counsellor.weekOffDates || {})[monthKey] || []).length;
}

// Visual breakdown of a month's real weeks (per getMonthWeeks), each shown
// as "Aug'26 1st Week" with a scrollable row of Aug 1 / Sat style day cells,
// the counsellor's recurring week-off day(s) highlighted within each week.
function ordinalWeek(n) {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}
function WeekOffStrip({ monthKey, data, counsellorId, canManage, onDayTap }) {
  const weeks = getMonthWeeks(monthKey);
  const [y, m] = monthKey.split("-").map(Number);
  const label = `${MONTHS[m - 1].slice(0, 3)}'${String(y).slice(-2)}`;
  const today = ymd(new Date());

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {weeks.map((wk) => {
        // Merged boundary weeks can hold more than 7 dates — size the grid to
        // this row's own count so every cell stays on screen instead of
        // spilling past the edge and needing a scroll.
        const count = wk.dates.length;
        const compact = count > 7;
        return (
          <div key={wk.weekNumber}>
            <div style={{ fontSize: 12.5, color: C.soft, fontWeight: 600, marginBottom: 8 }}>
              {label} {ordinalWeek(wk.weekNumber)} Week
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${count}, 1fr)`, gap: compact ? 4 : 6 }}>
              {wk.dates.map((dk) => {
                const dt = fromYmd(dk);
                const isPast = dk < today;
                const holiday = holidayOn(data, dk);
                const leave = !holiday ? leaveOn(data, counsellorId, dk) : null;
                const paidU = leave?.paidUnits ?? 0;
                const lopU = leave?.lopUnits ?? 0;
                // A record can be split between the two — e.g. it lands right
                // on the quota boundary — in which case neither solid color
                // is accurate; show the real proportion instead.
                const leaveKind = !leave ? null : lopU <= 0 ? "weekoff" : paidU <= 0 ? "lop" : "partly";
                const colored = !!holiday || !!leave;
                const bg = holiday ? RING_DONE_GRADIENT : leaveKind === "lop" ? LOP_GRADIENT : leaveKind === "weekoff" ? WEEKOFF_GRADIENT : null;
                const isPartly = leaveKind === "partly";
                const paidFraction = isPartly ? paidU / (paidU + lopU) : null;
                // Half-day leave (fully one status) only shades the half of
                // the cell matching which half of the day is off — a
                // diagonal split through the center — rather than the full
                // cell, so a glance shows morning vs afternoon.
                const isHalfSplit = !!leave && leave.half && !!leave.halfFrom && !!leave.halfTill && !isPartly;
                const firstHalf = isHalfSplit ? halfDayIsFirstHalf(leave.halfFrom, leave.halfTill) : null;
                // Interactive only for a manageable, non-past, non-holiday day —
                // holidays are Admin-only and past days can't be edited.
                const interactive = canManage && !isPast && !holiday;
                const Tag = interactive ? "button" : "div";
                const compactHour = (t) => { const h = Number((t || "0:0").split(":")[0]); const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}`; };
                const subLabel = holiday ? holiday.type
                  : leave && leave.half ? `${compactHour(leave.halfFrom)}–${compactHour(leave.halfTill)}`
                  : isPartly ? "Partly"
                  : DAYS[dt.getDay()];
                return (
                  <Tag key={dk} onClick={interactive ? () => onDayTap(dk, leave) : undefined} style={{
                    position: "relative", overflow: "hidden",
                    minWidth: 0, borderRadius: compact ? 10 : 14, padding: compact ? "7px 2px" : "10px 4px", textAlign: "center",
                    border: `1px solid ${colored && !isHalfSplit ? "transparent" : C.line}`,
                    background: isPartly
                      ? `linear-gradient(135deg, #7fb88f 0%, #7fb88f ${paidFraction * 100}%, #c0463f ${paidFraction * 100}%, #c0463f 100%)`
                      : isHalfSplit ? "#fff" : bg || "#fff",
                    cursor: interactive ? "pointer" : "default", fontFamily: FONT,
                    opacity: isPast && !colored ? 0.45 : 1,
                  }}>
                    {isHalfSplit && (
                      <span aria-hidden style={{
                        position: "absolute", inset: 0, borderRadius: "inherit", background: bg,
                        // First half (off before noon): lower-left triangle.
                        // Second half (off after noon): upper-right triangle.
                        clipPath: firstHalf ? "polygon(0% 0%, 0% 100%, 100% 100%)" : "polygon(0% 0%, 100% 0%, 100% 100%)",
                      }} />
                    )}
                    <div style={{ position: "relative", fontSize: compact ? 13 : 15, fontWeight: 700, color: isHalfSplit ? C.ink : colored ? "#fff" : isPast ? C.faint : C.ink }}>
                      {dt.getDate()}
                    </div>
                    <div style={{
                      position: "relative", fontSize: compact ? 9 : 10.5, color: isHalfSplit ? C.mid : colored ? "rgba(255,255,255,0.85)" : C.faint, marginTop: 2,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{subLabel}</div>
                  </Tag>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Small color-key explaining what each calendar shading means.
function LeaveLegend() {
  const items = [
    ["Week-off", WEEKOFF_GRADIENT],
    ["LOP", LOP_GRADIENT],
    ["Holiday / Festival / Special", RING_DONE_GRADIENT],
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: "2px 2px 4px" }}>
      {items.map(([label, grad]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: grad, flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: C.soft }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// Bottom sheet opened by tapping a date in the leave calendar. Shows the
// selected date, asks half-day + time if relevant, and applies the leave —
// which the paid/LOP split then classifies automatically. If a leave already
// sits on this date it shows that instead, with the option to remove it.
// A half day's from–till range determines which half of the day it covers —
// used to decide which diagonal triangle gets colored on the calendar.
function halfDayIsFirstHalf(halfFrom, halfTill) {
  const toMin = (t) => { const [h, m] = (t || "00:00").split(":").map(Number); return h * 60 + m; };
  const mid = (toMin(halfFrom) + toMin(halfTill)) / 2;
  return mid < 12 * 60; // before noon reads as the first half of the day
}

function DayLeaveSheet({ open, date, existing, onClose, act, counsellorId }) {
  const [half, setHalf] = useState(false);
  const [halfFrom, setHalfFrom] = useState("09:00");
  const [halfTill, setHalfTill] = useState("14:00");

  useEffect(() => {
    if (open) { setHalf(false); setHalfFrom("09:00"); setHalfTill("14:00"); }
  }, [open, date]);

  if (!open || !date) return null;

  if (existing) {
    const paidU = existing.paidUnits ?? 0;
    const lopU = existing.lopUnits ?? 0;
    const statusText = lopU <= 0 ? "Week-off (paid)" : paidU <= 0 ? "LOP (loss of pay)" : `Partly LOP · ${fmtDays(paidU)} paid, ${fmtDays(lopU)} LOP`;
    return (
      <Sheet open onClose={onClose} title={longDate(date)}
        footer={<>
          <Btn full onClick={onClose}>Close</Btn>
          <Btn full kind="danger" onClick={() => { act.removeLeave(existing.id); onClose(); }} icon={<Trash2 size={14} strokeWidth={1.4} />}>
            Remove leave
          </Btn>
        </>}>
        <Row label="Status" value={statusText} strong />
        <Row label="Type" value={existing.half ? "Half day" : "Full day"} />
        {existing.half && existing.halfFrom && existing.halfTill && (
          <Row label="Time" value={`${to12(existing.halfFrom)} – ${to12(existing.halfTill)}`} />
        )}
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={longDate(date)}
      footer={<>
        <Btn full onClick={onClose}>Cancel</Btn>
        <Btn full kind="solid" onClick={() => {
          act.addLeave({
            counsellorId, type: "Leave", from: date, to: date, half,
            halfFrom: half ? halfFrom : null, halfTill: half ? halfTill : null,
          });
          onClose();
        }}>Apply leave</Btn>
      </>}>
      <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 18 }}>
        This counts toward this month's paid week-off quota automatically — once that's used up, further days this month are recorded as LOP.
      </div>
      <button onClick={() => setHalf((v) => !v)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 0 16px", cursor: "pointer", background: "none", border: "none" }}>
        <span style={{ fontSize: 14 }}>Half day</span>
        <span style={{ width: 44, height: 26, borderRadius: 999, background: half ? "#111" : C.ghost, display: "flex", alignItems: "center", padding: 3 }}>
          <span style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", marginLeft: half ? 18 : 0, transition: "margin .2s" }} />
        </span>
      </button>
      {half && (
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}><Field label="From"><Input type="time" value={halfFrom} onChange={(e) => setHalfFrom(e.target.value)} /></Field></div>
          <div style={{ flex: 1, minWidth: 0 }}><Field label="Till"><Input type="time" value={halfTill} onChange={(e) => setHalfTill(e.target.value)} /></Field></div>
        </div>
      )}
    </Sheet>
  );
}

// Admin-only sheet for marking a date as a Holiday, Festival, or Special
// leave — org-wide, so it shows on every counsellor's calendar.
function HolidaySheet({ open, onClose, act, defaultDate }) {
  const [date, setDate] = useState(defaultDate || ymd(new Date()));
  const [type, setType] = useState("Holiday");
  const [label, setLabel] = useState("");
  useEffect(() => { if (open) { setDate(defaultDate || ymd(new Date())); setType("Holiday"); setLabel(""); } }, [open, defaultDate]);
  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title="Mark holiday"
      footer={<>
        <Btn full onClick={onClose}>Cancel</Btn>
        <Btn full kind="solid" onClick={() => { act.addHoliday({ date, type, label: label.trim() || type }); onClose(); }}>Save</Btn>
      </>}>
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Type">
        <div style={{ display: "flex", gap: 8 }}>
          {["Holiday", "Festival", "Special"].map((t) => (
            <button key={t} onClick={() => setType(t)}
              style={{ flex: 1, padding: "10px 0", fontSize: 13, borderRadius: 12, cursor: "pointer", border: `1px solid ${type === t ? "#111" : C.line}`, background: type === t ? "#111" : "#fff", color: type === t ? "#fff" : C.mid }}>{t}</button>
          ))}
        </div>
      </Field>
      <Field label="Label" hint="Optional — e.g. Diwali, Independence Day.">
        <Input placeholder={type} value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
    </Sheet>
  );
}

/* ------------------------------------------------------------ attendance */
// The "cute toggle capsule" on the main page — check in/out for the day.
// Tapping it stamps the time and nothing else. It used to read the device's
// location first and refuse a check-in taken outside a radius of the clinic,
// which meant every tap waited on the GPS ("Locating…") and could be turned
// down by a permission prompt or a bad fix. The time is the thing that
// matters here, so it is taken directly.
function AttendanceToggle({ data, act, user }) {
  const rec = attendanceToday(data, user.counsellorId);
  const state = !rec ? "out" : !rec.outAt ? "in" : "done";

  const handleTap = () => {
    if (state === "done") return;
    // null: recorded without a location fix, which is what inAuto/outAuto
    // already mean everywhere the attendance record is read back.
    if (state === "out") act.recordCheckIn(user.counsellorId, null);
    else act.recordCheckOut(user.counsellorId, null);
  };

  const label = state === "out" ? "Tap to check In"
    : state === "in" ? `In since ${hm(rec.inAt)}`
    : `In ${hm(rec.inAt)} · Out ${hm(rec.outAt)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "2px 16px 14px" }}>
      <button onClick={handleTap} disabled={state === "done"} style={{
        display: "flex", alignItems: "center", gap: 10, borderRadius: 999, padding: "6px 6px 6px 16px",
        background: state === "in" ? "linear-gradient(135deg, #7fb88f 0%, #7fd6c9 100%)" : "#fff",
        border: `1px solid ${state === "in" ? "transparent" : C.line}`,
        cursor: state === "done" ? "default" : "pointer", fontFamily: FONT,
        boxShadow: state === "in" ? "0 4px 14px rgba(127,182,143,0.35)" : "none",
        transition: "background .3s ease, box-shadow .3s ease",
      }}>
        <MapPin size={13} strokeWidth={1.8} color={state === "in" ? "#fff" : state === "done" ? C.faint : C.soft} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: state === "in" ? "#fff" : state === "done" ? C.soft : C.mid }}>
          {label}
        </span>
        <span style={{
          width: 42, height: 25, borderRadius: 999, flexShrink: 0,
          background: state === "in" ? "rgba(255,255,255,0.35)" : C.ghost,
          display: "flex", alignItems: "center", padding: 3, transition: "background .2s ease",
        }}>
          <span style={{
            width: 19, height: 19, borderRadius: 999, flexShrink: 0,
            background: state === "done" ? "#9a9aa1" : "#fff",
            marginLeft: state === "out" ? 0 : 17, transition: "margin .2s ease",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {state === "done" && <Check size={10} strokeWidth={2.4} color="#fff" />}
          </span>
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- persona */
const PERSONA_SOURCES = ["Google", "Walk-in", "Referral", "AI"];
const PERSONA_AI_TOOLS = ["ChatGPT", "Claude", "Gemini", "Other"];
const PERSONA_TYPES = ["Individual Counselling", "Couple Counselling", "Child Counselling"];

// Segmented pill-choice control shared by the few single-select questions
// in the Persona form, matching the app's existing pill-button language.
function PersonaChoice({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} type="button" style={{
          padding: "10px 14px", fontSize: 13, borderRadius: 12, cursor: "pointer",
          border: `1px solid ${value === o ? "#111" : C.line}`, background: value === o ? "#111" : "#fff",
          color: value === o ? "#fff" : C.mid, fontFamily: FONT,
        }}>{o}</button>
      ))}
    </div>
  );
}

// The 5th milestone — a short, calm intake form, not a diagnostic
// questionnaire. Saved onto the client record so it stays editable anytime,
// not just at first fill-in, and (when opened from a specific appointment)
// marks that appointment's own Persona milestone in the same atomic update
// as saving the data — bundling both, the same fix pattern used for Nubills,
// so one write can't clobber the other.
function PersonaSheet({ open, onClose, client, act, data, appointmentId }) {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  const linkedAppt = appointmentId && data ? data.appointments.find((a) => a.id === appointmentId) : null;
  const linkedCounsellor = linkedAppt && data ? data.counsellors.find((c) => c.id === linkedAppt.counsellorId) : null;
  useEffect(() => {
    if (open && client) {
      const p = client.persona || {};
      setForm({
        clientName: p.clientName || client.name || "",
        counsellorName: p.counsellorName || (linkedCounsellor ? linkedCounsellor.name : ""),
        status: p.status || "New",
        counsellingType: p.counsellingType || "Individual Counselling",
        partnerName: p.partnerName || "",
        age: p.age || client.age || "",
        whatsapp: p.whatsapp || client.whatsapp || client.phone || "",
        address: p.address || "",
        area: p.area || "",
        education: p.education || "",
        job: p.job || "",
        foundUs: p.foundUs || "",
        googleSearch: p.googleSearch || "",
        referredBy: p.referredBy || "",
        aiTool: p.aiTool || "",
        aiOtherName: p.aiOtherName || "",
        primaryConcern: p.primaryConcern || "",
        needForCounselling: p.needForCounselling || "",
        nextFollowUpDate: p.nextFollowUpDate || "",
        thingsToSend: p.thingsToSend && p.thingsToSend.length ? p.thingsToSend : [
          { id: uid("tts"), label: "Autogenic voice notes", done: false },
          { id: uid("tts"), label: "Grounding Exercises for anxiety", done: false },
        ],
      });
      setSaved(false);
      setNewItemText("");
    }
  }, [open, client]);

  if (!open || !client || !form) return null;
  const set = (patch) => setForm({ ...form, ...patch });

  const submit = () => {
    const priorDate = client.persona?.nextFollowUpDate || "";
    const dateChanged = form.nextFollowUpDate && form.nextFollowUpDate !== priorDate;
    const withDate = {
      ...form, date: (linkedAppt && linkedAppt.date) || client.persona?.date || ymd(new Date()), savedAt: Date.now(),
      followUpDone: dateChanged ? false : (client.persona?.followUpDone || false),
    };
    act.updatePersona(client.id, withDate, appointmentId);
    setSaved(true);
    setTimeout(() => { onClose(); }, 850);
  };

  if (saved) {
    return (
      <Sheet open onClose={onClose} title="Persona">
        <div style={{ textAlign: "center", padding: "34px 0" }}>
          <Check size={26} strokeWidth={1.3} color={C.ink} />
          <div style={{ fontSize: 15, color: C.ink, marginTop: 12 }}>Persona saved</div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title="Persona" wide
      footer={<><Btn full onClick={onClose}>Cancel</Btn><Btn full kind="solid" onClick={submit}>Save Persona</Btn></>}>
      <SectionLabel>Client Details</SectionLabel>
      <Field label="Client Name"><Input value={form.clientName} onChange={(e) => set({ clientName: e.target.value })} /></Field>
      <Field label="Counsellor Name"><Input value={form.counsellorName} onChange={(e) => set({ counsellorName: e.target.value })} /></Field>
      <Field label="Status"><PersonaChoice options={["New", "Follow-up"]} value={form.status} onChange={(v) => set({ status: v })} /></Field>
      <Field label="Counselling Type"><PersonaChoice options={PERSONA_TYPES} value={form.counsellingType} onChange={(v) => set({ counsellingType: v })} /></Field>

      {form.counsellingType === "Couple Counselling" && (
        <Field label="Partner Name"><Input value={form.partnerName} onChange={(e) => set({ partnerName: e.target.value })} /></Field>
      )}

      <Field label="Age"><Input inputMode="numeric" value={form.age} onChange={(e) => set({ age: e.target.value })} /></Field>
      <Field label="WhatsApp Number"><Input inputMode="tel" value={form.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} /></Field>
      {form.status === "New" && (
        <>
          <Field label="Address"><Input value={form.address} onChange={(e) => set({ address: e.target.value })} /></Field>
          <Field label="Area"><Input value={form.area} onChange={(e) => set({ area: e.target.value })} /></Field>
          <Field label="Education"><Input value={form.education} onChange={(e) => set({ education: e.target.value })} /></Field>
          <Field label="Job"><Input value={form.job} onChange={(e) => set({ job: e.target.value })} /></Field>
        </>
      )}

      {form.status === "New" && (
        <>
          <div style={{ height: 6 }} />
          <SectionLabel>How Did You Find Us?</SectionLabel>
          <Field label="Source"><PersonaChoice options={PERSONA_SOURCES} value={form.foundUs} onChange={(v) => set({ foundUs: v })} /></Field>
          {form.foundUs === "Google" && (
            <Field label="What did you search?"><Input value={form.googleSearch} onChange={(e) => set({ googleSearch: e.target.value })} /></Field>
          )}
          {form.foundUs === "Referral" && (
            <Field label="Referred by"><Input value={form.referredBy} onChange={(e) => set({ referredBy: e.target.value })} /></Field>
          )}
          {form.foundUs === "AI" && (
            <Field label="Which AI?"><PersonaChoice options={PERSONA_AI_TOOLS} value={form.aiTool} onChange={(v) => set({ aiTool: v })} /></Field>
          )}
          {form.foundUs === "AI" && form.aiTool === "Other" && (
            <Field label="AI Name"><Input value={form.aiOtherName} onChange={(e) => set({ aiOtherName: e.target.value })} /></Field>
          )}
        </>
      )}

      <div style={{ height: 6 }} />
      <SectionLabel>Counselling</SectionLabel>
      <Field label="Primary Concern / Therapy Focus"><Input value={form.primaryConcern} onChange={(e) => set({ primaryConcern: e.target.value })} /></Field>
      <Field label="Need for Counselling">
        <textarea value={form.needForCounselling} onChange={(e) => set({ needForCounselling: e.target.value })}
          rows={3} placeholder="A brief note — keep it short."
          style={{ ...inputStyle, height: "auto", resize: "vertical", lineHeight: 1.5 }} />
      </Field>

      <div style={{ height: 6 }} />
      <SectionLabel>Follow-up</SectionLabel>
      <Field label="Next Follow-up Date"><Input type="date" value={form.nextFollowUpDate} onChange={(e) => set({ nextFollowUpDate: e.target.value })} /></Field>

      <Field label="Things to Send">
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          {form.thingsToSend.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  border: `1.5px solid ${t.done ? "transparent" : C.line}`, background: t.done ? "#111" : "#fff",
                }}>
                  {t.done && <Check size={12} strokeWidth={3} color="#fff" />}
                </span>
                <span style={{ fontSize: 13.5, color: t.done ? C.faint : C.ink, textDecoration: t.done ? "line-through" : "none" }}>{t.label}</span>
              </div>
              {!t.done && (
                <button onClick={() => set({ thingsToSend: form.thingsToSend.filter((x) => x.id !== t.id) })} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}>
                  <X size={14} strokeWidth={1.6} color={C.faint} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={newItemText} onChange={(e) => setNewItemText(e.target.value)} placeholder="e.g. Journaling worksheet" />
          <Btn onClick={() => {
            if (!newItemText.trim()) return;
            set({ thingsToSend: [...form.thingsToSend, { id: uid("tts"), label: newItemText.trim(), done: false }] });
            setNewItemText("");
          }}>Add more</Btn>
        </div>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>
          These get sent (and checked off) from Follow-up &amp; Commitments in the hamburger menu — checking one there actually opens WhatsApp with that item, so it can't get ticked without something being sent.
        </div>
      </Field>

      {(() => {
        const clientReviews = (data.reviews || []).filter((r) => r.clientId === client.id)
          .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        if (clientReviews.length === 0) return null;
        return (
          <>
            <div style={{ height: 6 }} />
            <SectionLabel>Google Reviews</SectionLabel>
            <div style={{ display: "grid", gap: 8 }}>
              {clientReviews.map((r) => (
                <div key={r.id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <StarPicker value={r.rating || 0} onChange={() => {}} size={13} />
                    <span style={{ fontSize: 11, color: C.faint }}>{shortDate(r.date)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: C.mid, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{r.text}</div>
                </div>
              ))}
            </div>
          </>
        );
      })()}
    </Sheet>
  );
}

/* ------------------------------------------------------------ nubills */
// Shared paste sheet — used both from the Session-completed screen (right
// after ending a session) and from the Nubills screen itself ("+ Add").
function NubillsPasteSheet({ open, onClose, data, act, user, appointmentId }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setText(""); setErr(""); } }, [open]);
  if (!open) return null;

  const preview = text.trim() ? parseBillText(text) : null;

  // If this sheet was opened from a specific appointment's own "NuBills"
  // milestone, pull that appointment's already-computed session bill
  // (Session amount / Extra time / Total) for a separate reference card —
  // distinct from the pasted feed above, which is the external payment record.
  const appt = appointmentId && data ? data.appointments.find((a) => a.id === appointmentId) : null;
  const sess = appt && data ? data.sessions.find((s) => s.appointmentId === appointmentId && s.endedAt) : null;
  const inv = sess && sess.invoiceId && data ? data.invoices.find((i) => i.id === sess.invoiceId) : null;

  const doPaste = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clip = await navigator.clipboard.readText();
        if (clip) setText(clip);
      }
    } catch (e) {
      setErr("Couldn't read the clipboard — paste manually into the box instead.");
    }
  };

  const submit = () => {
    if (!text.trim()) return setErr("Paste the billing text first.");
    const parsed = parseBillText(text);
    if (!parsed.clientName && !parsed.billNo && !parsed.totalAmount) {
      return setErr("Couldn't find any recognizable fields in this text — check it matches the usual format.");
    }
    try {
      const withContext = { ...parsed };
      if (appointmentId) withContext.appointmentId = appointmentId;
      if (inv) {
        withContext.sessionAmount = inv.base;
        withContext.extraMinutes = inv.extraMinutes || 0;
        withContext.extraAmount = inv.additional;
        withContext.sessionTotal = inv.total;
      }
      act.addBill(withContext);
      onClose();
    } catch (e) {
      setErr(`Couldn't save this bill: ${e && e.message ? e.message : "unknown error"}`);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Add to Nubills"
      footer={<>
        <Btn full onClick={onClose}>Cancel</Btn>
        <Btn full kind="solid" onClick={submit}>Save bill</Btn>
      </>}>
      <a href="https://app.nurora.in" target="_blank" rel="noreferrer" style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
        marginBottom: 18, padding: "15px 16px", borderRadius: 999, background: "#fff",
        border: `1px solid ${C.line}`, boxShadow: "0 1px 3px rgba(20,20,20,0.05)", textDecoration: "none",
      }}>
        <FileCheck size={17} strokeWidth={1.6} color={C.ink} />
        <span style={{ fontSize: 14.5, color: C.ink, fontWeight: 500 }}>Nubills · app.nurora.in</span>
      </a>
      {data.settings.paymentQrImage && (
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <img src={data.settings.paymentQrImage} alt="Payment QR" style={{ width: 160, height: 160, borderRadius: 16, border: `1px solid ${C.line}`, objectFit: "cover" }} />
        </div>
      )}
      <Field label="Billing text">
        <textarea value={text} onChange={(e) => { setText(e.target.value); setErr(""); }}
          rows={8} placeholder="Hi, the session has got over and the client has paid…"
          style={{ ...inputStyle, height: "auto", resize: "vertical", lineHeight: 1.5 }} />
      </Field>
      <Btn onClick={doPaste} icon={<Copy size={14} strokeWidth={1.6} />}>Paste from clipboard</Btn>

      {preview && (preview.clientName || preview.billNo || preview.totalAmount > 0) && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px", marginTop: 16 }}>
          {preview.clientName && (
            <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.55, paddingBottom: 12, borderBottom: `1px solid ${C.hair}`, marginBottom: 4 }}>
              Hi, the Session has got over and the client <b>{preview.clientName}{preview.date ? ` (${toDDMMYYYY(preview.date)})` : ""}</b> has paid the balance amount
            </div>
          )}
          {preview.clientName && <Row label="Client" value={preview.clientName} />}
          {preview.counsellorName && <Row label="Counsellor" value={preview.counsellorName} />}
          {preview.date && <Row label="Date" value={toDDMMYYYY(preview.date)} />}
          {preview.billNo && <Row label="Bill No" value={preview.billNo} />}
          {preview.calculationText && <Row label="Calculation" value={preview.calculationText} />}
          {preview.totalAmount > 0 && <Row label="Total" value={money(preview.totalAmount)} strong />}
        </div>
      )}

      {inv && (
        <>
          <div style={{ height: 18 }} />
          <div style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
            Payment Summary
          </div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px" }}>
            <Row label="Session amount" value={money(inv.base)} />
            <Row label={`Extra time${inv.extraMinutes ? ` ${inv.extraMinutes} min` : ""}`} value={money(inv.additional)} />
            <Row label="Total" value={money(inv.total)} strong />
          </div>
        </>
      )}
      {err && <div style={{ fontSize: 12.5, color: "#b42318", marginTop: 10 }}>{err}</div>}
    </Sheet>
  );
}

function BillDetailSheet({ bill, onClose }) {
  if (!bill) return null;
  return (
    <Sheet open onClose={onClose} title={bill.billNo || "Bill"} footer={<Btn full onClick={onClose}>Close</Btn>}>
      <Row label="Client" value={bill.clientName || "—"} />
      <Row label="Counsellor" value={bill.counsellorName || "—"} />
      <Row label="Date" value={bill.date ? toDDMMYYYY(bill.date) : "—"} />
      <Row label="Bill No" value={bill.billNo || "—"} />
      {bill.calculationText && <Row label="Calculation" value={bill.calculationText} />}
      {(bill.breakdown || []).map((b, i) => <Row key={i} label={b.label} value={money(b.amount)} />)}
      <Row label="Total" value={money(bill.totalAmount)} strong />

      {bill.sessionTotal != null && (
        <>
          <div style={{ height: 18 }} />
          <div style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
            Payment Summary
          </div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px" }}>
            <Row label="Session amount" value={money(bill.sessionAmount)} />
            <Row label={`Extra time${bill.extraMinutes ? ` ${bill.extraMinutes} min` : ""}`} value={money(bill.extraAmount)} />
            <Row label="Total" value={money(bill.sessionTotal)} strong />
          </div>
        </>
      )}

      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 16, marginBottom: 6 }}>Original text</div>
      <div style={{ background: C.chip, borderRadius: 14, padding: 14, fontSize: 12.5, color: C.mid, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
        {bill.rawText}
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------- personas */
function personaRangeDates(kind, customFrom, customTo) {
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  if (kind === "custom") return { from: customFrom || ymd(today), to: customTo || ymd(today) };
  if (kind === "monthly") return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
  if (kind === "bimonthly") return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m + 1, 0)) };
  if (kind === "quarterly") return { from: ymd(new Date(y, m - 2, 1)), to: ymd(new Date(y, m + 1, 0)) };
  if (kind === "yearly") return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: ymd(today), to: ymd(today) };
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadTextFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url; el.download = filename;
  document.body.appendChild(el); el.click(); document.body.removeChild(el);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ bric */
// BRIC = Booked, Reschedule, Interest, Cancelled — a lightweight, everyone-
// can-see companion to the admin-only Interest & Booked screen. Counsellors
// see just names and reasons (no contact details); Admin also sees phone
// numbers and can export the current tab as a spreadsheet.
function BRICScreen({ data, act, user }) {
  const isAdmin = user.role === "admin";
  const [tab, setTab] = useState("Booked");
  const inScope = (counsellorId) => isAdmin || counsellorId === user.counsellorId;

  const booked = data.appointments.filter((a) => a.status !== "Cancelled" && inScope(a.counsellorId))
    .sort((a, b) => b.date.localeCompare(a.date));
  const rescheduled = data.appointments.filter((a) => (a.rescheduleStatus === "pending" || a.rescheduleStatus === "moved") && inScope(a.counsellorId))
    .sort((a, b) => b.date.localeCompare(a.date));
  const interested = (data.interests || []).filter((it) => isAdmin || it.counsellorId === user.counsellorId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const cancelled = data.appointments.filter((a) => a.status === "Cancelled" && !a.rescheduleStatus && inScope(a.counsellorId))
    .sort((a, b) => b.date.localeCompare(a.date));

  const rowsFor = (t) => t === "Booked" ? booked : t === "Reschedule" ? rescheduled : t === "Interest" ? interested : cancelled;

  const phoneOf = (clientId) => { const c = data.clients.find((x) => x.id === clientId); return c ? (c.phone || c.whatsapp || "") : ""; };
  const nameFor = (row) => tab === "Interest" ? (row.clientName || "Unnamed") : (data.clients.find((c) => c.id === row.clientId)?.name || "Client");
  const reasonFor = (row) => {
    if (tab === "Reschedule") return row.rescheduleStatus === "moved"
      ? `Rescheduled to ${data.appointments.find((x) => x.id === row.rescheduledToId) ? shortDate(data.appointments.find((x) => x.id === row.rescheduledToId).date) : "—"}`
      : (row.rescheduleReason || "Date not given yet");
    if (tab === "Cancelled") return `${row.cancelType === "refund" ? "With refund" : "No refund"}${row.cancelReason ? ` — ${row.cancelReason}` : ""}`;
    if (tab === "Booked") return `${shortDate(row.date)} · ${to12(row.time)}`;
    return row.category || "Interest";
  };

  const downloadCsv = () => {
    const rows = rowsFor(tab);
    const header = isAdmin ? ["Name", "Phone", "Reason"] : ["Name", "Reason"];
    const body = rows.map((r) => {
      const name = nameFor(r);
      const reason = reasonFor(r);
      const phone = tab === "Interest" ? (r.whatsapp || "") : phoneOf(r.clientId);
      return isAdmin ? [name, phone, reason] : [name, reason];
    });
    const csv = [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n");
    downloadTextFile(`Nurora-BRIC-${tab}.csv`, csv, "text/csv");
  };

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <SegTabs value={tab} onChange={setTab} options={["Booked", "Reschedule", "Interest", "Cancelled"]} />
      <div style={{ height: 16 }} />
      {rowsFor(tab).length === 0 ? (
        <Empty text={`Nothing here yet.`} />
      ) : (
        <GroupedCard>
          {rowsFor(tab).map((row, i) => (
            <GroupedRow key={row.id} first={i === 0} chevron={false}
              leading={<Avatar name={nameFor(row)} />}
              title={nameFor(row)}
              subtitle={`${reasonFor(row)}${isAdmin ? ((tab === "Interest" ? row.whatsapp : phoneOf(row.clientId)) ? ` · ${tab === "Interest" ? row.whatsapp : phoneOf(row.clientId)}` : "") : ""}`} />
          ))}
        </GroupedCard>
      )}

      {isAdmin && rowsFor(tab).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <Btn full kind="solid" onClick={downloadCsv} icon={<Download size={14} strokeWidth={1.6} />}>Download as Google Sheet</Btn>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ reviews */
function StarPicker({ value, onChange, size = 22 }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(n)} type="button" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}>
          <Star size={size} strokeWidth={1.4} color={n <= value ? "#f5a623" : C.line} fill={n <= value ? "#f5a623" : "none"} />
        </button>
      ))}
    </div>
  );
}

// Searchable client picker sourced from clients who already have a Persona
// filled in — deliberately not a free-text field, so every review is
// reliably linked back to a real client record.
function ClientPicker({ data, value, onChange }) {
  const [query, setQuery] = useState("");
  const clients = (data.clients || []).filter((c) => c.persona);
  const selectedClient = clients.find((c) => c.id === value);
  const filtered = clients.filter((c) => (c.persona.clientName || c.name || "").toLowerCase().includes(query.trim().toLowerCase()));

  if (selectedClient) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px" }}>
        <span style={{ fontSize: 14, color: C.ink }}>{selectedClient.persona.clientName || selectedClient.name}</span>
        <button onClick={() => { onChange(null); setQuery(""); }} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}>
          <X size={15} strokeWidth={1.6} color={C.faint} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing a client name…" />
      {query.trim() && (
        <div style={{ marginTop: 8, border: `1px solid ${C.line}`, borderRadius: 14, maxHeight: 200, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 13, color: C.faint }}>No matching client with a Persona filled in.</div>
          ) : filtered.map((c, i) => (
            <button key={c.id} onClick={() => { onChange(c.id); setQuery(""); }} style={{
              width: "100%", textAlign: "left", padding: "11px 14px", background: "none", border: "none", cursor: "pointer",
              fontSize: 13.5, fontFamily: FONT, borderTop: i === 0 ? "none" : `1px solid ${C.hair}`,
            }}>{c.persona.clientName || c.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewSheet({ open, onClose, act, data }) {
  const [clientId, setClientId] = useState(null);
  const [rating, setRating] = useState(5);
  const [date, setDate] = useState(ymd(new Date()));
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setClientId(null); setRating(5); setDate(ymd(new Date())); setText(""); setErr(""); } }, [open]);
  if (!open) return null;

  const doPaste = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clip = await navigator.clipboard.readText();
        if (clip) setText(clip);
      }
    } catch (e) {
      setErr("Couldn't read the clipboard — paste manually into the box instead.");
    }
  };

  const submit = () => {
    if (!clientId) return setErr("Select which client this review is from.");
    if (!text.trim()) return setErr("Paste or type the review text first.");
    const client = data.clients.find((c) => c.id === clientId);
    const counsellorName = client?.persona?.counsellorName || "";
    const matchedCounsellor = data.counsellors.find((c) => counsellorName && counsellorName.toLowerCase().includes(c.name.toLowerCase()));
    act.addReview({
      clientId,
      reviewerName: client?.persona?.clientName || client?.name || "",
      counsellorId: matchedCounsellor ? matchedCounsellor.id : null,
      rating, date, text: text.trim(),
    });
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="Add Google review"
      footer={<><Btn full onClick={onClose}>Cancel</Btn><Btn full kind="solid" onClick={submit}>Save review</Btn></>}>
      <Field label="Client"><ClientPicker data={data} value={clientId} onChange={setClientId} /></Field>
      <Field label="Rating"><StarPicker value={rating} onChange={setRating} /></Field>
      <Field label="Date of review"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Review text">
        <textarea value={text} onChange={(e) => { setText(e.target.value); setErr(""); }}
          rows={6} placeholder="Paste the review text here…"
          style={{ ...inputStyle, height: "auto", resize: "vertical", lineHeight: 1.5 }} />
      </Field>
      <Btn onClick={doPaste} icon={<Copy size={14} strokeWidth={1.6} />}>Paste from clipboard</Btn>
      {err && <div style={{ fontSize: 12.5, color: "#b42318", marginTop: 10 }}>{err}</div>}
    </Sheet>
  );
}

// Custom icons for the two highest milestone tiers — nothing in the icon
// library captures "black hole" or "the Nurora mark itself", so these are
// built the same way FlameIcon is: small gradient SVGs.
// Same gradient FlameIcon uses, applied to any path — so Star and Thunder
// match the flame's look instead of being flat solid-purple lucide icons.
function GradientPathIcon({ size = 24, path, viewBox = "0 0 24 24", lit = true }) {
  const [id] = useState(() => "grad-" + Math.random().toString(36).slice(2, 9));
  return (
    <svg width={size} height={size} viewBox={viewBox} style={{
      filter: lit ? `drop-shadow(0 0 ${size * 0.4}px rgba(139,127,232,0.55))` : "grayscale(1) opacity(0.4)",
      transition: "filter .3s ease",
    }}>
      <defs>
        <linearGradient id={id} x1="20%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%" stopColor="#8b7fe8" />
          <stop offset="45%" stopColor="#d98fc4" />
          <stop offset="100%" stopColor="#f5b98f" />
        </linearGradient>
      </defs>
      <path d={path} fill={`url(#${id})`} />
    </svg>
  );
}
const ZAP_PATH = "M13 2 3 14h9l-1 8 10-12h-9l1-8z";
const STAR_PATH = "M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279L12 19.771l-7.416 3.642 1.48-8.279L0 9.306l8.332-1.151z";

function BlackHoleIcon({ size = 24, lit = true }) {
  const [id] = useState(() => "bh-" + Math.random().toString(36).slice(2, 9));
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{
      filter: lit ? `drop-shadow(0 0 ${size * 0.45}px rgba(139,127,232,0.6))` : "grayscale(1) opacity(0.4)",
      transition: "filter .3s ease",
    }}>
      <defs>
        <radialGradient id={id} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0a0a0f" />
          <stop offset="58%" stopColor="#0a0a0f" />
          <stop offset="72%" stopColor="#8b7fe8" />
          <stop offset="86%" stopColor="#d98fc4" />
          <stop offset="100%" stopColor="#f5b98f" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${id})`} />
      <circle cx="50" cy="50" r="28" fill="#0a0a0f" />
    </svg>
  );
}
function NuroraOrbIcon({ size = 28 }) {
  const [id] = useState(() => "nu-" + Math.random().toString(36).slice(2, 9));
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: `drop-shadow(0 0 ${size * 0.6}px rgba(139,127,232,0.75))` }}>
      <defs>
        <radialGradient id={id} cx="42%" cy="38%" r="65%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="30%" stopColor="#f5b98f" />
          <stop offset="65%" stopColor="#d98fc4" />
          <stop offset="100%" stopColor="#8b7fe8" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${id})`} />
    </svg>
  );
}

// Anchor sizes given explicitly for reviews 1–8, then a smooth continued
// growth curve beyond that (capped) so tiers 16/32/64/100 keep visibly
// escalating without needing a hand-picked size for every single count.
function milestoneSize(n) {
  const anchors = { 1: 1, 2: 2, 3: 5, 4: 7, 5: 8, 6: 13, 7: 19, 8: 27 };
  if (n <= 0) return 0;
  if (n <= 8) return anchors[n];
  return Math.min(80, 27 + Math.sqrt(n - 7) * 6);
}
function milestoneTier(n) {
  if (n <= 0) return "none";
  if (n <= 4) return "dot";
  if (n <= 7) return "fire-grey";
  if (n <= 15) return "fire";
  if (n <= 31) return "thunder";
  if (n <= 63) return "star";
  if (n <= 99) return "blackhole";
  return "nurora";
}
const MILESTONE_TIER_NAMES = { dot: "", "fire-grey": "", fire: "On Fire", thunder: "Thunder", star: "Star", blackhole: "Black Hole", nurora: "Nurora" };

function MilestoneBadge({ count }) {
  const tier = milestoneTier(count);
  const size = milestoneSize(count);
  const tierName = MILESTONE_TIER_NAMES[tier];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "22px 0 6px" }}>
      <div style={{ height: 84, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {tier === "none" ? (
          <span style={{ fontSize: 15, color: C.faint, fontWeight: 600 }}>0</span>
        ) : tier === "dot" ? (
          <span style={{ width: size, height: size, borderRadius: 999, background: C.faint, display: "block" }} />
        ) : tier === "fire-grey" ? (
          <FlameIcon size={size} lit={false} />
        ) : tier === "fire" ? (
          <FlameIcon size={size} lit={true} />
        ) : tier === "thunder" ? (
          <GradientPathIcon size={size} path={ZAP_PATH} lit={true} />
        ) : tier === "star" ? (
          <GradientPathIcon size={size} path={STAR_PATH} lit={true} />
        ) : tier === "blackhole" ? (
          <BlackHoleIcon size={size} lit={true} />
        ) : (
          <NuroraOrbIcon size={size} />
        )}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{count} review{count === 1 ? "" : "s"}</div>
        {tierName && <div style={{ fontSize: 11.5, color: C.soft, marginTop: 2 }}>{tierName} tier</div>}
      </div>
    </div>
  );
}

function reviewRangeDates(kind) {
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  if (kind === "weekly") { const from = new Date(today); from.setDate(d - 6); return { from: ymd(from), to: ymd(today) }; }
  if (kind === "monthly") return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
  if (kind === "3months") return { from: ymd(new Date(y, m - 2, 1)), to: ymd(new Date(y, m + 1, 0)) };
  if (kind === "6months") return { from: ymd(new Date(y, m - 5, 1)), to: ymd(new Date(y, m + 1, 0)) };
  return { from: ymd(today), to: ymd(today) };
}

/* ------------------------------------------------------ follow-up & commitments */
/* ---------------------------------------------------- resource special benefits */
function ResourceBenefitsScreen({ data, act, user }) {
  const isAdmin = user.role === "admin";
  const [addingFor, setAddingFor] = useState(null);
  const [benefitName, setBenefitName] = useState("");
  const [policyNo, setPolicyNo] = useState("");

  if (!isAdmin) {
    const myCounsellor = data.counsellors.find((c) => c.id === user.counsellorId);
    const benefits = myCounsellor ? (myCounsellor.benefits || []) : [];
    return (
      <div style={{ padding: "8px 16px 24px" }}>
        <SectionLabel>Resource Special Benefits</SectionLabel>
        {benefits.length === 0 ? (
          <Empty text="No benefits added yet." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {benefits.map((b) => (
              <div key={b.id} style={{ border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, marginBottom: b.policyNo ? 4 : 0 }}>{b.name}</div>
                {b.policyNo && <div style={{ fontSize: 13, color: C.mid }}>Policy No: {b.policyNo}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const openAdd = (id) => { setAddingFor(id); setBenefitName(""); setPolicyNo(""); };
  const submitAdd = () => {
    if (!benefitName.trim()) return;
    act.addBenefit(addingFor, { name: benefitName.trim(), policyNo: policyNo.trim() });
    setAddingFor(null);
  };

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <SectionLabel>Resource Special Benefits</SectionLabel>
      <div style={{ fontSize: 12, color: C.soft, marginBottom: 16 }}>
        Only counsellors you enable here can see this section at all — it stays fully hidden from their hamburger menu otherwise.
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {data.counsellors.filter((c) => c.active).map((c) => (
          <div key={c.id} style={{ border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: c.benefitsEnabled ? 12 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar name={c.name} />
                <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{c.name}</span>
              </div>
              <button onClick={() => act.setBenefitsEnabled(c.id, !c.benefitsEnabled)} style={{
                width: 44, height: 26, borderRadius: 999, background: c.benefitsEnabled ? RING_DONE_SOLID : C.ghost,
                border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: 3, flexShrink: 0,
              }}>
                <span style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", marginLeft: c.benefitsEnabled ? 18 : 0, transition: "margin .2s" }} />
              </button>
            </div>
            {c.benefitsEnabled && (
              <>
                {(c.benefits || []).length > 0 && (
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {c.benefits.map((b) => (
                      <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.chip, borderRadius: 10, padding: "8px 10px" }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: C.ink }}>{b.name}</div>
                          {b.policyNo && <div style={{ fontSize: 11.5, color: C.soft }}>Policy No: {b.policyNo}</div>}
                        </div>
                        <button onClick={() => act.removeBenefit(c.id, b.id)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}>
                          <X size={13} strokeWidth={1.6} color={C.faint} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <Pill icon={<Plus size={13} strokeWidth={1.6} />} onClick={() => openAdd(c.id)}>Add benefit</Pill>
              </>
            )}
          </div>
        ))}
      </div>

      <Sheet open={!!addingFor} onClose={() => setAddingFor(null)} title="Add benefit"
        footer={<><Btn full onClick={() => setAddingFor(null)}>Cancel</Btn><Btn full kind="solid" onClick={submitAdd}>Add</Btn></>}>
        <Field label="Benefit"><Input value={benefitName} onChange={(e) => setBenefitName(e.target.value)} placeholder="e.g. Health Insurance" /></Field>
        <Field label="Policy No"><Input value={policyNo} onChange={(e) => setPolicyNo(e.target.value)} placeholder="Optional" /></Field>
      </Sheet>
    </div>
  );
}

function FollowUpCommitmentsScreen({ data, act, user }) {
  const [tab, setTab] = useState("Follow-up");
  const isAdmin = user.role === "admin";
  const myCounsellor = data.counsellors.find((c) => c.id === user.counsellorId);
  const todayKey = ymd(new Date());
  const inScope = (counsellorName) => isAdmin || (myCounsellor && counsellorName && counsellorName.toLowerCase().includes(myCounsellor.name.toLowerCase()));

  const followUps = data.clients
    .filter((c) => c.persona && c.persona.nextFollowUpDate && !c.persona.followUpDone && inScope(c.persona.counsellorName))
    .map((c) => ({ client: c, date: c.persona.nextFollowUpDate }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const hasEndedSession = (clientId) => data.appointments
    .filter((a) => a.clientId === clientId)
    .some((a) => { const s = sessionFor(data, a.id); return s && s.endedAt; });

  const commitments = data.clients
    .filter((c) => c.persona && (c.persona.thingsToSend || []).some((t) => !t.done) && inScope(c.persona.counsellorName))
    .flatMap((c) => (c.persona.thingsToSend || []).filter((t) => !t.done).map((t) => ({ client: c, item: t, due: hasEndedSession(c.id) })))
    .sort((a, b) => (b.due ? 1 : 0) - (a.due ? 1 : 0));

  const sendItem = (client, item) => {
    const name = client.persona.clientName || client.name;
    const phone = (client.persona.whatsapp || client.whatsapp || client.phone || "").replace(/[^\d]/g, "");
    const text = encodeURIComponent(`Hi ${name}, sending you the ${item.label} we discussed.`);
    window.open(`https://wa.me/${phone}?text=${text}`, "_blank");
    act.markThingSent(client.id, item.id);
  };

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <SegTabs value={tab} onChange={setTab} options={["Follow-up", "Commitments"]} />
      <div style={{ height: 16 }} />

      {tab === "Follow-up" ? (
        followUps.length === 0 ? (
          <Empty text="No upcoming follow-ups." />
        ) : (
          <GroupedCard>
            {followUps.map((f, i) => {
              const overdue = f.date < todayKey;
              const dueToday = f.date === todayKey;
              return (
                <GroupedRow key={f.client.id} first={i === 0} chevron={false}
                  leading={
                    <button onClick={() => act.markFollowUpDone(f.client.id)} style={{
                      width: 22, height: 22, borderRadius: 7, border: `1.5px solid ${C.line}`, background: "#fff",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }} />
                  }
                  title={f.client.persona.clientName || f.client.name}
                  subtitle={`Follow up on ${shortDate(f.date)}${isAdmin && f.client.persona.counsellorName ? ` · ${f.client.persona.counsellorName}` : ""}`}
                  trailing={
                    overdue ? <span style={{ fontSize: 11, color: "#e74c3c", fontWeight: 600, background: "#fdecea", borderRadius: 999, padding: "3px 8px" }}>Overdue</span>
                      : dueToday ? <Chip>Today</Chip> : null
                  } />
              );
            })}
          </GroupedCard>
        )
      ) : (
        commitments.length === 0 ? (
          <Empty text="Nothing pending to send." />
        ) : (
          <GroupedCard>
            {commitments.map(({ client, item, due }, i) => (
              <GroupedRow key={item.id} first={i === 0} chevron={false}
                leading={<Avatar name={client.persona.clientName || client.name} />}
                title={`Send ${item.label}`}
                subtitle={
                  `to ${client.persona.clientName || client.name}` +
                  (isAdmin && client.persona.counsellorName ? ` · ${client.persona.counsellorName}` : "") +
                  (due ? "" : " · session not held yet")
                }
                trailing={
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {due && <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: "#e74c3c", borderRadius: 999, padding: "2px 7px" }}>Due</span>}
                    <Pill icon={<MessageCircle size={13} strokeWidth={1.6} />} onClick={() => sendItem(client, item)}>Send</Pill>
                  </div>
                } />
            ))}
          </GroupedCard>
        )
      )}
    </div>
  );
}

function GoogleReviewsScreen({ data, act, user }) {
  const [addOpen, setAddOpen] = useState(false);
  const [filterMode, setFilterMode] = useState("range");
  const [rangeKind, setRangeKind] = useState("monthly");
  const [selectedDate, setSelectedDate] = useState(ymd(new Date()));
  const isAdmin = user.role === "admin";
  const [scope, setScope] = useState(isAdmin ? "team" : "individual");
  const [viewCounsellorId, setViewCounsellorId] = useState(isAdmin ? (data.counsellors[0]?.id || "") : user.counsellorId);
  const [milestoneMonth, setMilestoneMonth] = useState(() => ymd(new Date()).slice(0, 7)); // "YYYY-MM" — its own month, independent of the range capsules above

  const allReviews = data.reviews || [];
  const markedDates = useMemo(() => new Set(allReviews.filter((r) => r.date).map((r) => r.date)), [allReviews]);

  const range = filterMode === "range" ? reviewRangeDates(rangeKind) : { from: selectedDate, to: selectedDate };
  const filtered = allReviews.filter((r) => r.date && r.date >= range.from && r.date <= range.to)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt);
  const avg = filtered.length ? filtered.reduce((s, r) => s + (r.rating || 0), 0) / filtered.length : 0;

  const [milestoneY, milestoneM] = milestoneMonth.split("-").map(Number);
  const monthRange = { from: `${milestoneMonth}-01`, to: ymd(new Date(milestoneY, milestoneM, 0)) };
  const monthLabel = new Date(milestoneY, milestoneM - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const shiftMonth = (delta) => {
    const d = new Date(milestoneY, milestoneM - 1 + delta, 1);
    setMilestoneMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const monthReviews = allReviews.filter((r) => r.date && r.date >= monthRange.from && r.date <= monthRange.to);
  const scopedMonthReviews = scope === "individual" && viewCounsellorId
    ? monthReviews.filter((r) => r.counsellorId === viewCounsellorId)
    : monthReviews;
  const individualName = isAdmin
    ? (data.counsellors.find((c) => c.id === viewCounsellorId)?.name || "Individual")
    : (user.name || "Individual");

  return (
    <div>
      <DateStrip selected={selectedDate} onSelect={(d) => { setSelectedDate(d); setFilterMode("date"); }} markedDates={markedDates} completedDates={new Set()} />
      <div style={{ padding: "8px 16px 24px" }}>
        <SectionLabel action={<Pill icon={<Plus size={13} strokeWidth={1.6} />} onClick={() => setAddOpen(true)}>Add review</Pill>}>
          Google Reviews
        </SectionLabel>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {[["weekly", "Weekly"], ["monthly", "Monthly"], ["3months", "Last 3 months"], ["6months", "Last 6 months"]].map(([k, l]) => (
            <button key={k} onClick={() => { setRangeKind(k); setFilterMode("range"); }} style={{
              padding: "8px 13px", fontSize: 12.5, borderRadius: 999, cursor: "pointer",
              border: `1px solid ${filterMode === "range" && rangeKind === k ? "#111" : C.line}`,
              background: filterMode === "range" && rangeKind === k ? "#111" : "#fff",
              color: filterMode === "range" && rangeKind === k ? "#fff" : C.mid,
            }}>{l}</button>
          ))}
        </div>

        {filtered.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <StarPicker value={Math.round(avg)} onChange={() => {}} size={16} />
            <span style={{ fontSize: 13, color: C.mid }}>{avg.toFixed(1)} · {filtered.length} review{filtered.length === 1 ? "" : "s"}</span>
          </div>
        )}

        {filtered.length === 0 ? (
          <Empty text="No reviews in this period." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {filtered.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{r.reviewerName || "Anonymous"}</span>
                  <StarPicker value={r.rating || 0} onChange={() => {}} size={14} />
                </div>
                <div style={{ fontSize: 13.5, color: C.mid, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{r.text}</div>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>{shortDate(r.date)}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ height: 30 }} />
        <div style={{
          border: `1px solid ${C.line}`, borderRadius: 22, padding: "18px 18px 20px",
          background: "linear-gradient(180deg, #fafafa 0%, #ffffff 100%)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10 }}>
            <button onClick={() => shiftMonth(-1)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 4 }}>
              <ChevronLeft size={16} strokeWidth={1.6} color={C.soft} />
            </button>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              Milestones · {monthLabel}
            </div>
            <button onClick={() => shiftMonth(1)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 4 }}>
              <ChevronRight size={16} strokeWidth={1.6} color={C.soft} />
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
            <div style={{ display: "flex", flexShrink: 0, border: `1px solid ${C.line}`, borderRadius: 999, padding: 2 }}>
              {["individual", "team"].map((s) => (
                <button key={s} onClick={() => setScope(s)} style={{
                  padding: "5px 11px", fontSize: 11.5, borderRadius: 999, cursor: "pointer",
                  border: "none", background: scope === s ? "#4a4a4a" : "transparent", color: scope === s ? "#fff" : C.mid,
                }}>{s === "individual" ? individualName : "Team"}</button>
              ))}
            </div>
          </div>
          {isAdmin && scope === "individual" && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              <select value={viewCounsellorId} onChange={(e) => setViewCounsellorId(e.target.value)} style={{
                fontSize: 12, color: C.mid, border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px",
                background: "#fff", fontFamily: FONT,
              }}>
                {data.counsellors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <MilestoneBadge count={scopedMonthReviews.length} />
        </div>
      </div>
      <ReviewSheet open={addOpen} onClose={() => setAddOpen(false)} act={act} data={data} />
    </div>
  );
}

function PersonasScreen({ data, act, user }) {
  const isAdmin = user.role === "admin";
  const myCounsellor = data.counsellors.find((c) => c.id === user.counsellorId);
  const [selected, setSelected] = useState(ymd(new Date()));
  const [detailClient, setDetailClient] = useState(null);
  const [rangeKind, setRangeKind] = useState("monthly");
  const [customFrom, setCustomFrom] = useState(ymd(new Date()));
  const [customTo, setCustomTo] = useState(ymd(new Date()));

  const inScope = (p) => isAdmin || (myCounsellor && p.counsellorName && p.counsellorName.toLowerCase().includes(myCounsellor.name.toLowerCase()));

  const allPersonas = data.clients
    .filter((c) => c.persona && c.persona.date)
    .map((c) => ({ client: c, persona: c.persona }))
    .filter(({ persona }) => inScope(persona));

  const markedDates = useMemo(() => {
    const set = new Set();
    allPersonas.forEach(({ persona }) => set.add(persona.date));
    return set;
  }, [allPersonas]);

  const dayList = allPersonas.filter(({ persona }) => persona.date === selected)
    .sort((a, b) => (b.persona.savedAt || 0) - (a.persona.savedAt || 0));

  const range = personaRangeDates(rangeKind, customFrom, customTo);
  const inRange = allPersonas.filter(({ persona }) => persona.date >= range.from && persona.date <= range.to);

  const exportRows = () => [
    ["Date", "Client Name", "Counsellor Name", "Status", "Counselling Type", "Partner Name", "Age", "WhatsApp", "Address", "Area", "Education", "Job", "Found Us", "Primary Concern", "Need for Counselling"],
    ...inRange.map(({ persona: p }) => [
      p.date || "", p.clientName || "", p.counsellorName || "", p.status || "", p.counsellingType || "",
      p.partnerName || "", p.age || "", p.whatsapp || "", p.address || "", p.area || "", p.education || "", p.job || "",
      p.foundUs || "", p.primaryConcern || "", p.needForCounselling || "",
    ]),
  ];

  // No PDF library is available in this runtime, so — same honest approach
  // used elsewhere in the app — this downloads a clean, readable text file
  // rather than a binary PDF.
  const downloadText = () => {
    const rows = exportRows();
    const lines = [`Nurora — Persona Report`, `Range: ${shortDate(range.from)} – ${shortDate(range.to)}`, ""];
    inRange.forEach(({ persona: p }) => {
      lines.push(
        `${shortDate(p.date)} · ${p.clientName || "—"} · ${p.counsellorName || "—"}`,
        `  Status: ${p.status || "—"} · Type: ${p.counsellingType || "—"}`,
        p.primaryConcern ? `  Concern: ${p.primaryConcern}` : null,
        ""
      );
    });
    downloadTextFile(`Nurora-Persona-Report-${rangeKind}.txt`, lines.filter((l) => l !== null).join("\n"));
  };

  // Real CSV — this one genuinely opens correctly in Google Sheets (File >
  // Import) or Excel, unlike the text export above.
  const downloadCsv = () => {
    const csv = exportRows().map((row) => row.map(csvCell).join(",")).join("\n");
    downloadTextFile(`Nurora-Persona-Report-${rangeKind}.csv`, csv, "text/csv");
  };

  return (
    <div>
      <DateStrip selected={selected} onSelect={setSelected} markedDates={markedDates} completedDates={new Set()} />
      <div style={{ padding: "8px 16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Calendar size={17} strokeWidth={1.3} color={C.ink} />
          <span style={{ fontSize: 15, color: C.ink }}>{longDate(selected)}</span>
        </div>

        <SectionLabel>{isAdmin ? "All personas" : "My personas"}</SectionLabel>
        {dayList.length === 0 ? (
          <Empty text="No personas filled for this date." />
        ) : (
          <GroupedCard>
            {dayList.map(({ client, persona }, i) => (
              <GroupedRow key={client.id} first={i === 0}
                leading={<Avatar name={persona.clientName || client.name} />}
                title={persona.clientName || client.name}
                subtitle={`${persona.status || "—"} · ${persona.counsellingType || "—"}${isAdmin && persona.counsellorName ? ` · ${persona.counsellorName}` : ""}`}
                onClick={() => setDetailClient(client)} />
            ))}
          </GroupedCard>
        )}

        {isAdmin && (
          <>
            <div style={{ height: 30 }} />
            <SectionLabel>Download</SectionLabel>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 18, padding: "16px" }}>
              <div style={{ fontSize: 12, color: C.soft, marginBottom: 10 }}>Range</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {[["monthly", "Monthly"], ["bimonthly", "Bi-monthly"], ["quarterly", "Quarterly"], ["yearly", "Yearly"], ["custom", "Custom"]].map(([k, l]) => (
                  <button key={k} onClick={() => setRangeKind(k)} style={{
                    padding: "8px 13px", fontSize: 12.5, borderRadius: 999, cursor: "pointer",
                    border: `1px solid ${rangeKind === k ? "#111" : C.line}`, background: rangeKind === k ? "#111" : "#fff", color: rangeKind === k ? "#fff" : C.mid,
                  }}>{l}</button>
                ))}
              </div>

              {rangeKind === "custom" ? (
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><Field label="From"><Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></Field></div>
                  <div style={{ flex: 1, minWidth: 0 }}><Field label="To"><Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></Field></div>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 16 }}>{shortDate(range.from)} – {shortDate(range.to)} · {inRange.length} persona{inRange.length === 1 ? "" : "s"}</div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <Btn full onClick={downloadText} icon={<Download size={14} strokeWidth={1.6} />}>PDF</Btn>
                <Btn full kind="solid" onClick={downloadCsv} icon={<Download size={14} strokeWidth={1.6} />}>Google Sheet</Btn>
              </div>
            </div>
          </>
        )}
      </div>
      <PersonaSheet open={!!detailClient} onClose={() => setDetailClient(null)} client={detailClient} act={act} data={data} />
    </div>
  );
}

function NubillsScreen({ data, act, user }) {
  const isAdmin = user.role === "admin";
  const [pasteOpen, setPasteOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const inScope = isAdmin
    ? () => true
    : (counsellorId) => counsellorId === user.counsellorId;

  const allBills = (data.bills || [])
    .filter((b) => isAdmin || b.counsellorId === user.counsellorId || b.submittedByCounsellorId === user.counsellorId);

  // Open on whichever date the most recently logged bill actually belongs
  // to, rather than blindly defaulting to today — a bill's own date is
  // often not the same day it gets pasted in, so "today" can look empty
  // even when a bill was just saved successfully.
  const [selected, setSelected] = useState(() => {
    const mostRecent = allBills.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
    return (mostRecent && mostRecent.date) || ymd(new Date());
  });

  const bills = allBills.filter((b) => b.date === selected).sort((a, b) => b.createdAt - a.createdAt);

  // Completed sessions that day, in the same scope, vs bills logged that
  // day — the tally below flags any day where sessions ran but a bill
  // never got logged for them.
  const completedSessionsOn = (dateStr) => data.appointments
    .filter((a) => a.date === dateStr && inScope(a.counsellorId))
    .filter((a) => { const s = sessionFor(data, a.id); return s && s.endedAt; }).length;
  const billsOn = (dateStr) => allBills.filter((b) => b.date === dateStr).length;

  const sessionsToday = completedSessionsOn(selected);
  const billsToday = billsOn(selected);
  const reconciled = billsToday >= sessionsToday;

  const markedDates = useMemo(() => {
    const set = new Set();
    data.appointments.filter((a) => inScope(a.counsellorId)).forEach((a) => set.add(a.date));
    allBills.forEach((b) => { if (b.date) set.add(b.date); });
    return set;
  }, [data.appointments, allBills, isAdmin, user.counsellorId]);
  const completedDates = useMemo(() => {
    const set = new Set();
    for (const d of markedDates) if (completedSessionsOn(d) > 0 && billsOn(d) >= completedSessionsOn(d)) set.add(d);
    return set;
  }, [markedDates, data.appointments, allBills]);

  return (
    <div>
      <DateStrip selected={selected} onSelect={setSelected} markedDates={markedDates} completedDates={completedDates} />
      <div style={{ padding: "8px 16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Calendar size={17} strokeWidth={1.3} color={C.ink} />
          <span style={{ fontSize: 15, color: C.ink }}>{longDate(selected)}</span>
        </div>

        <SectionLabel action={<Pill icon={<Plus size={13} strokeWidth={1.6} />} onClick={() => setPasteOpen(true)}>Add bill</Pill>}>
          {isAdmin ? "All bills" : "My bills"}
        </SectionLabel>
        {bills.length === 0 ? (
          <Empty text="No bills logged for this date yet." />
        ) : (
          <GroupedCard>
            {bills.map((b, i) => (
              <GroupedRow key={b.id} first={i === 0}
                leading={<IconSquircle><FileText size={16} strokeWidth={1.4} color={C.mid} /></IconSquircle>}
                title={b.clientName || "Client"}
                subtitle={`${b.billNo || "No bill no."} · ${safeShortDate(b.date)}${isAdmin && b.counsellorName ? ` · ${b.counsellorName}` : ""}`}
                trailing={money(b.totalAmount)}
                onClick={() => setDetail(b)} />
            ))}
          </GroupedCard>
        )}

        <div style={{ height: 26 }} />
        <SectionLabel>Tally</SectionLabel>
        <SummaryStats items={[
          { label: "No. sessions today", value: sessionsToday },
          { label: "No. of NuBills generated", value: billsToday },
        ]} />

        <div style={{ height: 16 }} />
        <div style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
          Status
        </div>
        <div style={{
          border: `1px solid ${reconciled ? C.line : "#f3c6c0"}`, background: reconciled ? "#fff" : "#fdecea",
          borderRadius: 14, padding: "13px 15px",
        }}>
          <span style={{ fontSize: 13.5, color: reconciled ? C.ink : "#b42318", fontWeight: 500 }}>
            {reconciled ? "All Bills Update - All Good \uD83D\uDC4D\uD83C\uDFFB" : "Update the Bills soon"}
          </span>
        </div>
      </div>
      <NubillsPasteSheet open={pasteOpen} onClose={() => setPasteOpen(false)} data={data} act={act} user={user} />
      <BillDetailSheet bill={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/* --------------------------------------------------------- schedule screen */
function ScheduleScreen({ data, act, user, now, go, counsellorFilter, scheduleFilter, setScheduleFilter }) {
  const isDesktop = useIsWide(1024);
  const [selected, setSelected] = useState(ymd(new Date()));
  const [expanded, setExpanded] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const touchY = useRef(null);
  const stripRef = useRef(null);
  const monthRef = useRef(null);
  const [stripH, setStripH] = useState(0);
  const [monthH, setMonthH] = useState(0);
  const [newApptOpen, setNewApptOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [detail, setDetail] = useState(null);
  const [endTarget, setEndTarget] = useState(null);
  const [startTarget, setStartTarget] = useState(null);
  const [editSlotsTarget, setEditSlotsTarget] = useState(null);

  // Measure actual content height so the collapse animates to a real pixel
  // value instead of relying on CSS auto-collapse, which doesn't reliably
  // shrink nested grid content to zero in every webview.
  useLayoutEffect(() => {
    if (stripRef.current) setStripH(stripRef.current.scrollHeight);
    if (monthRef.current) setMonthH(monthRef.current.scrollHeight);
  }, [selected, expanded]);

  const markedDates = useMemo(() => new Set(data.appointments.map((a) => a.date)), [data.appointments]);
  const completedDates = useMemo(() => {
    const set = new Set();
    for (const key of markedDates) if (dayFullyDone(data, key)) set.add(key);
    return set;
  }, [data, markedDates]);
  // One dot per date, scoped to the logged-in counsellor (Admin sees the
  // aggregate across everyone): red if there's a booking that day at all,
  // green once every one of that day's bookings is fully complete through
  // Persona — not just the first milestone.
  const scheduleDotStatus = useMemo(() => {
    const map = new Map();
    const isAdminView = user.role === "admin";
    const dates = new Set(
      data.appointments
        .filter((a) => a.status !== "Cancelled")
        .filter((a) => isAdminView || a.counsellorId === user.counsellorId)
        .map((a) => a.date)
    );
    for (const d of dates) {
      const done = isAdminView ? dayFullyDone(data, d) : counsellorDayFullyDone(data, user.counsellorId, d);
      map.set(d, done ? "done" : "pending");
    }
    return map;
  }, [data.appointments, user.role, user.counsellorId]);
  const isAdmin = user.role === "admin";

  const eligible = data.counsellors.filter((c) => c.active)
    .filter((c) => (counsellorFilter ? c.id === counsellorFilter : true))
    .sort((a, b) => (b.id === user.counsellorId ? 1 : 0) - (a.id === user.counsellorId ? 1 : 0));

  // Counsellors on leave or a week-off for this date are unavailable, so their
  // container doesn't show at all rather than showing an empty/blocked card.
  const offToday = [];
  const counsellors = eligible.filter((c) => {
    const lv = leaveOn(data, c.id, selected);
    const wo = weekOffOn(data, c, selected);
    if (lv || wo) { offToday.push({ c, reason: lv ? (lv.half ? "half-day leave" : "leave") : "week off" }); return false; }
    return true;
  });

  // Every counsellor's configured slots show for the day whether booked or
  // not; a slot with a matching appointment renders the booking, otherwise
  // it renders as open and can be tapped to book.
  const slotsFor = (c) => {
    const appts = data.appointments
      .filter((a) => a.date === selected && a.counsellorId === c.id);
    const byTime = new Map(appts.map((a) => [a.time, a]));
    const daySlots = slotsForDate(c, selected);
    const allTimes = [...new Set([...daySlots, ...appts.map((a) => a.time)])].sort();
    return allTimes.map((t) => (byTime.has(t) ? { type: "appt", time: t, appt: byTime.get(t) } : { type: "open", time: t }));
  };

  const cards = counsellors.map((c) => ({ c, slots: slotsFor(c) }));

  const selDate = fromYmd(selected);

  const openBooking = (pf) => { setPrefill(pf || null); setNewApptOpen(true); };

  return (
    <div>
      {user.role === "resource" && <AttendanceToggle data={data} act={act} user={user} />}
      {user.role === "resource" && user.isNuLancer && (() => {
        const status = staffingStatusForDate(data, ymd(new Date()));
        if (!status) return null;
        const isHighly = status === "highly";
        return (
          <div style={{
            margin: "0 16px 14px", padding: "10px 14px", borderRadius: 12,
            background: isHighly ? "linear-gradient(135deg, #ffb199 0%, #d64550 100%)" : "linear-gradient(135deg, #8fd9b6 0%, #4fc3d9 100%)",
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{isHighly ? "Highly Required" : "Requiring"}</span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", marginLeft: 8 }}>
              {isHighly ? "Several Resources are out today — extra sessions likely available." : "A Resource is out today — sessions may be available."}
            </span>
          </div>
        );
      })()}
      {/* calendar */}
      <div
        style={{ paddingBottom: 4 }}
        onTouchStart={(e) => { touchY.current = e.touches[0].clientY; }}
        onTouchEnd={(e) => {
          if (touchY.current == null) return;
          const dy = e.changedTouches[0].clientY - touchY.current;
          touchY.current = null;
          if (dy < -44 && expanded) setExpanded(false);
          if (dy > 44 && !expanded) setExpanded(true);
        }}
      >
        <div style={{
          maxHeight: expanded ? 0 : stripH, opacity: expanded ? 0 : 1, overflow: "hidden",
          transition: "max-height .4s cubic-bezier(.65,0,.35,1), opacity .18s ease",
        }}>
          <div ref={stripRef}>
            <DateStrip selected={selected} onSelect={(d) => { setSelected(d); setExpanded(false); }} markedDates={markedDates} completedDates={completedDates} scheduleDotStatus={scheduleDotStatus} />
          </div>
        </div>
        <div style={{
          maxHeight: expanded ? monthH : 0, opacity: expanded ? 1 : 0, overflow: "hidden",
          transition: `max-height .4s cubic-bezier(.65,0,.35,1), opacity .28s ease ${expanded ? "0.1s" : "0s"}`,
        }}>
          <div ref={monthRef}>
            <MonthCalendar selected={selected} onSelect={(d) => { setSelected(d); setExpanded(false); }} markedDates={markedDates} scheduleDotStatus={scheduleDotStatus} />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <button onClick={() => setExpanded((v) => !v)} style={{ padding: "2px 32px 8px", cursor: "pointer" }}
            aria-label={expanded ? "Collapse calendar" : "Expand calendar"}>
            <ChevronDown size={20} strokeWidth={1.3} color={C.soft}
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .45s cubic-bezier(.65,0,.35,1)" }} />
          </button>
        </div>
      </div>

      {/* selected date bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
          <Calendar size={19} strokeWidth={1.3} color={C.ink} />
          <span style={{ fontSize: 16, color: C.ink, whiteSpace: "nowrap" }}>{shortDate(selected)}</span>
          <span style={{ color: C.ghost }}>|</span>
          <span style={{ fontSize: 13, color: C.soft, whiteSpace: "nowrap" }}>{DAYS_LONG[selDate.getDay()]}</span>
          {selected === ymd(new Date()) ? (() => {
            const myDayDone = user.role === "admin" ? completedDates.has(selected) : counsellorDayFullyDone(data, user.counsellorId, selected);
            return (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                <span style={{
                  fontSize: 11, borderRadius: 999, padding: "3px 9px",
                  color: myDayDone ? "#fff" : C.soft,
                  background: myDayDone ? "linear-gradient(135deg, #8fd9b6 0%, #4fc3d9 100%)" : C.chip,
                }}>Today</span>
                <span title={myDayDone ? "Every booking today is fully wrapped up" : "Still in progress"} style={{ display: "inline-flex" }}>
                  <FlameIcon size={15} lit={myDayDone} />
                </span>
              </span>
            );
          })() : (
            <span title={completedDates.has(selected) ? "Every booking that day was fully wrapped up" : "Still in progress"} style={{ display: "inline-flex" }}>
              <FlameIcon size={15} lit={completedDates.has(selected)} />
            </span>
          )}
        </div>

        {setScheduleFilter && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button onClick={() => setFilterMenuOpen((v) => !v)} style={{
              display: "flex", alignItems: "center", gap: 4, border: `1px solid ${C.line}`, borderRadius: 999,
              padding: "6px 10px", background: "#fff", cursor: "pointer",
            }}>
              <span style={{ fontSize: 12.5, color: "#1c1c1e" }}>
                {scheduleFilter === "all" ? "All" : scheduleFilter === "mine" ? "Mine" : (data.counsellors.find((c) => c.id === scheduleFilter)?.name || "All")}
              </span>
              <ChevronDown size={13} strokeWidth={1.8} color={C.soft}
                style={{ transform: filterMenuOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
            </button>

            {filterMenuOpen && (
              <>
                <div onClick={() => setFilterMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90, touchAction: "pan-y" }} />
                <div style={{
                  position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 91,
                  minWidth: 180, maxHeight: 320, overflowY: "auto", borderRadius: 20, padding: 6,
                  background: "rgba(255,255,255,0.9)", backdropFilter: "blur(26px) saturate(190%)", WebkitBackdropFilter: "blur(26px) saturate(190%)",
                  border: "1px solid rgba(255,255,255,0.85)", boxShadow: "0 16px 40px rgba(20,20,20,0.16), 0 4px 12px rgba(20,20,20,0.08)",
                }}>
                  {[
                    { key: "all", label: "All" },
                    ...(user.role === "resource" ? [{ key: "mine", label: "Mine" }] : []),
                    ...data.counsellors.filter((c) => c.active).map((c) => ({ key: c.id, label: c.name })),
                  ].map((opt) => (
                    <button key={opt.key} onClick={() => { setScheduleFilter(opt.key); setFilterMenuOpen(false); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 12px", background: "transparent", border: "none", cursor: "pointer",
                        textAlign: "left", borderRadius: 14, fontFamily: FONT,
                      }}>
                      <span style={{ fontSize: 13.5, color: "#1c1c1e", fontWeight: scheduleFilter === opt.key ? 600 : 400 }}>{opt.label}</span>
                      {scheduleFilter === opt.key && <Check size={14} strokeWidth={2.2} color="#1c1c1e" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* counsellor cards */}
      <div style={{ padding: "0 16px 24px", display: "grid", gap: 14, gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr" }}>
        {cards.length === 0 && (
          <Empty text={`No counsellors available on ${shortDate(selected)}.`}
            action={<Btn onClick={() => openBooking(null)} icon={<Plus size={15} strokeWidth={1.5} />}>Book an appointment</Btn>} />
        )}
        {(() => {
          const elements = [];
          let dividerShown = false;
          cards.forEach(({ c, slots }) => {
            if (c.isNuLancer && !dividerShown) {
              dividerShown = true;
              elements.push(
                <div key="nulancer-divider" style={{ textAlign: "center", padding: "8px 0 2px", gridColumn: "1 / -1" }}>
                  <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 22, fontWeight: 700, letterSpacing: "0.01em", color: C.soft }}>
                    NuLancers
                  </span>
                </div>
              );
            }
            elements.push(
              <CounsellorCard key={c.id} data={data} counsellor={c} slots={slots}
                now={now} user={user} act={act} isPast={selected < ymd(new Date())} selected={selected}
                onOpenAppt={(a) => setDetail(a)}
                onStart={(a) => setStartTarget(a)}
                onEnd={(a) => setEndTarget(a)}
                onBookSlot={(time) => openBooking({ counsellorId: c.id, time })}
                onOpenCounsellor={() => go({ screen: "counsellor", id: c.id })}
                onEditSlots={(coun) => setEditSlotsTarget(coun)} />
            );
          });
          return elements;
        })()}
      </div>

      {offToday.length > 0 && (
        <div style={{ padding: "0 16px 24px", fontSize: 12, color: C.faint }}>
          Not working today: {offToday.map((o) => `${o.c.name} (${o.reason})`).join(", ")}
        </div>
      )}

      <NewAppointmentSheet open={newApptOpen} onClose={() => { setNewApptOpen(false); setPrefill(null); }}
        data={data} act={act} date={selected} user={user} prefill={prefill} />

      <AppointmentDetail appt={detail} onClose={() => setDetail(null)} data={data} act={act} user={user} now={now}
        onStart={(a) => { setDetail(null); setStartTarget(a); }}
        onEnd={(a) => { setDetail(null); setEndTarget(a); }} />

      <StartSessionSheet appt={startTarget} onClose={() => setStartTarget(null)} data={data} act={act} />
      <EndSessionSheet appt={endTarget} onClose={() => setEndTarget(null)} data={data} act={act} now={now} user={user} />
      <EditDaySlotsSheet counsellor={editSlotsTarget} date={selected} onClose={() => setEditSlotsTarget(null)} data={data} act={act} user={user}
        onBookSlot={(time) => { const c = editSlotsTarget; setEditSlotsTarget(null); openBooking({ counsellorId: c.id, time }); }} />
    </div>
  );
}

/* ------------------------------------------------------- counsellor card */
function CounsellorCard({ data, counsellor, slots, now, user, act, isPast, selected, onOpenAppt, onStart, onEnd, onBookSlot, onOpenCounsellor, onEditSlots }) {
  const bookedAppts = slots.filter((s) => s.type === "appt").map((s) => s.appt);
  const running = bookedAppts.map((a) => runningSession(data, a.id)).find(Boolean);
  const canRun = user.role === "admin" || user.counsellorId === counsellor.id;
  const canBook = !isPast; // can't book a slot on a day that's already passed
  const canEditSlots = user.role === "admin" || user.counsellorId === counsellor.id;

  const bookedCount = bookedAppts.length;
  const openCount = slots.length - bookedCount;
  const completedCount = bookedAppts.filter((a) => { const s = sessionFor(data, a.id); return s && s.endedAt; }).length;
  const personaPendingCount = bookedAppts.filter((a) => {
    const s = sessionFor(data, a.id);
    const isDone = s && s.endedAt;
    return !isDone && (a.milestone ?? 0) >= MILESTONES.length - 1;
  }).length;
  const dayStatus = inferredDayStatus(counsellor, selected);
  const fullyDoneForDay = counsellorDayFullyDone(data, counsellor.id, selected);

  // New-client badge: any unreviewed new-client (non-followup) booking
  // today shows "New Client" in orange; once every one has been expanded
  // at least once (reviewedByCounsellor), it flips to "Checked" in sage
  // green/teal. No new-client bookings at all — no badge.
  const newClientAppts = bookedAppts.filter((a) => !a.isFollowup);
  const allMessagesSent = newClientAppts.length > 0 && newClientAppts.every((a) => a.messageSent);
  const allFullyComplete = newClientAppts.length > 0 && newClientAppts.every((a) => apptProgressCount(data, a) >= MILESTONES.length);
  const newClientBadge = newClientAppts.length === 0 ? null : allFullyComplete ? "completed" : allMessagesSent ? "checked" : "new";
  const showNewClientBadge = newClientBadge && (user.role === "admin" || user.counsellorId === counsellor.id);

  let statusPill = null;
  if (running) statusPill = <Chip tone="blue" icon={<Clock size={11} strokeWidth={1.6} />}>Session in process</Chip>;
  else if (bookedCount > 0 && completedCount === bookedCount) statusPill = <Chip tone="sage" icon={<Check size={11} strokeWidth={1.8} />}>Completed</Chip>;
  else if (personaPendingCount > 0) statusPill = <Chip icon={<Clock size={11} strokeWidth={1.6} />}>Persona pending</Chip>;

  const initial = counsellor.name.trim().charAt(0).toUpperCase();

  return (
    <div style={{ position: "relative" }}>
      {showNewClientBadge && newClientBadge !== "completed" && (
        <div style={{ position: "absolute", top: -6, right: 18, zIndex: 2 }}>
          {newClientBadge === "checked" ? (
            <span style={{
              fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap",
              background: "linear-gradient(135deg, #f5e050 0%, #ffb347 100%)",
              WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent",
            }}>Checked</span>
          ) : (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#d64550", whiteSpace: "nowrap" }}>New Client</span>
          )}
        </div>
      )}
    <div style={{
      borderRadius: 20, background: "#fff", overflow: "hidden",
      border: `1px solid ${C.hair}`,
      boxShadow: "0 1px 2px rgba(20,20,20,0.03), 0 14px 28px -14px rgba(20,20,20,0.14)",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "26px minmax(0, 1fr)", columnGap: 8 }}>
        {/* header row — rail cell holds the counsellor's initial, aligned to their name via matching top padding */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 14 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 999, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: fullyDoneForDay ? RING_DONE_GRADIENT : "#fff",
            border: `1.5px solid ${fullyDoneForDay ? "transparent" : C.faint}`,
            transition: "background .3s ease",
          }} title={fullyDoneForDay ? "Every booking today is fully wrapped up" : undefined}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: fullyDoneForDay ? "#fff" : C.faint }}>{initial}</span>
          </div>
          <div style={{
            width: 1.5, flex: 1, marginTop: 4,
            background: bookedAppts.length > 0 && sessionFor(data, bookedAppts[0].id) ? C.faint : "transparent",
            transition: "background .3s ease",
          }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "14px 8px 14px 0" }}>
          <button onClick={onOpenCounsellor} style={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "flex-start", gap: 10,
            background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT, padding: 0,
          }}>
            <div style={{ marginTop: -8 }}><Avatar name={counsellor.name} size={36} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "#0a0a0a" }}>{counsellor.name}</div>
              <div style={{ fontSize: 12, color: C.soft, marginTop: 2 }}>
                {bookedCount} booked{openCount > 0 ? ` · ${openCount} open` : ""}
              </div>
            </div>
          </button>
          {statusPill && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {statusPill}
            </div>
          )}
          {canEditSlots && !isPast && (
            <button onClick={() => onEditSlots(counsellor)} aria-label="Edit this day's slots" style={{
              width: 28, height: 28, borderRadius: 999, background: C.chip, border: "none",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
            }}>
              <Pencil size={12} strokeWidth={1.6} color={C.mid} />
            </button>
          )}
        </div>

        {slots.length === 0 && (
          <>
            <div />
            <div style={{ padding: "0 14px 16px", fontSize: 13, color: C.faint }}>No slots configured for this day</div>
          </>
        )}

        {slots.map((s, i) =>
          s.type === "appt" ? (
            (() => {
              const started = !!sessionFor(data, s.appt.id);
              const nextAppt = slots.slice(i + 1).find((x) => x.type === "appt");
              const nextStarted = nextAppt ? !!sessionFor(data, nextAppt.appt.id) : false;
              return (
                <React.Fragment key={s.appt.id}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ width: 1.5, height: 14, background: started ? C.faint : "transparent", transition: "background .3s ease" }} />
                    <SegmentRing size={24} filled={apptProgressCount(data, s.appt)}
                      {...categoryIcon(s.appt.category || (data.clients.find((c) => c.id === s.appt.clientId)?.category), data.clients.find((c) => c.id === s.appt.clientId)?.gender)} />
                    <div style={{ width: 1.5, flex: 1, background: nextStarted ? C.faint : "transparent", transition: "background .3s ease" }} />
                  </div>
                  <AppointmentRow appt={s.appt} data={data} now={now} canRun={canRun} act={act} user={user}
                    first={i === 0} onOpen={() => onOpenAppt(s.appt)} onStart={() => onStart(s.appt)} onEnd={() => onEnd(s.appt)} />
                </React.Fragment>
              );
            })()
          ) : (
            <React.Fragment key={s.time}>
              <div />
              <OpenSlotRow time={s.time} first={i === 0} canBook={canBook} isPast={isPast} onBook={() => onBookSlot(s.time)} />
            </React.Fragment>
          )
        )}
      </div>
    </div>
    </div>
  );
}

function OpenSlotRow({ time, first, canBook, isPast, onBook }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "13px 12px",
      borderTop: `1px solid ${C.hair}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: 90, flexShrink: 0 }}>
        <IconSquircle size={28}><Clock size={13} strokeWidth={1.4} color={C.faint} /></IconSquircle>
        <span style={{ fontSize: 13, color: C.faint, whiteSpace: "nowrap" }}>{to12(time)}</span>
      </div>
      <span style={{ flex: 1, fontSize: 13, color: C.faint }}>Available</span>
      {isPast ? (
        <Chip>No Booking</Chip>
      ) : (
        <Pill icon={<Plus size={13} strokeWidth={1.6} />} onClick={onBook}>Book</Pill>
      )}
    </div>
  );
}

function AppointmentRow({ appt, data, now, canRun, act, first, user, onOpen, onStart, onEnd }) {
  const client = data.clients.find((c) => c.id === appt.clientId);
  const sess = sessionFor(data, appt.id);
  const running = sess && !sess.endedAt;
  const done = sess && sess.endedAt;
  const elapsed = running ? Math.max(0, Math.floor((now - sess.startedAt) / 1000)) : 0;
  const cancelled = appt.status === "Cancelled";
  const canManageMilestones = !!(user && appt.counsellorId === user.counsellorId);
  const canRunSession = !!(user && appt.counsellorId === user.counsellorId);
  const [expanded, setExpanded] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [recreateOpen, setRecreateOpen] = useState(false);
  const [pickTimeOpen, setPickTimeOpen] = useState(false);

  return (
    <>
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 12px",
      borderTop: first ? `1px solid ${C.hair}` : `1px solid ${C.hair}`,
      opacity: cancelled ? 0.45 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, width: 90, flexShrink: 0, paddingTop: 2 }}>
        <Clock size={14} strokeWidth={1.3} color={C.soft} />
        <span style={{ fontSize: 13, color: C.mid, whiteSpace: "nowrap" }}>{to12(appt.time)}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <button onClick={() => {
          setExpanded((v) => !v);
          if (!expanded && user && user.role !== "admin" && appt.counsellorId === user.counsellorId && !appt.reviewedByCounsellor) act.setReviewed(appt.id);
        }} style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {expanded ? (
              <span style={{
                flex: 1, minWidth: 0, fontSize: 15, color: C.ink, wordBreak: "break-word", overflowWrap: "anywhere",
                textDecoration: cancelled ? "line-through" : "none",
              }}>{client ? client.name : "Client"}</span>
            ) : (
              <TruncatedText text={client ? client.name : "Client"} style={{ flex: 1, minWidth: 0 }}
                textStyle={{ fontSize: 15, color: C.ink, textDecoration: cancelled ? "line-through" : "none" }} />
            )}
            <span style={{ fontSize: 12, color: C.soft, flexShrink: 0 }}>{client ? client.age : ""}</span>
            <ChevronDown size={13} strokeWidth={1.4} color={C.faint}
              style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s ease" }} />
          </div>
        </button>

        <div style={{
          maxHeight: expanded ? 30 : 0, opacity: expanded ? 1 : 0, overflow: "hidden",
          transition: "max-height .2s ease, opacity .16s ease",
        }}>
          {client && (client.phone || client.whatsapp) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <button onClick={(e) => { e.stopPropagation(); window.location.href = `tel:${(client.phone || client.whatsapp).replace(/\s+/g, "")}`; }}
                aria-label="Call client" style={{
                  width: 20, height: 20, borderRadius: 999, background: C.chip, border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
                }}>
                <Phone size={10} strokeWidth={1.8} color={C.mid} />
              </button>
              <span style={{ fontSize: 12, color: C.soft }}>{client.phone || client.whatsapp}</span>
            </div>
          )}
        </div>

        <div style={{
          maxHeight: expanded ? 190 : 0, opacity: expanded ? 1 : 0, overflow: "hidden",
          transition: "max-height .24s ease, opacity .18s ease",
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 2 }}>
            {(appt.chips || []).map((c) => <Chip key={c} themed={!!appt.reviewedByCounsellor}>{c}</Chip>)}
          </div>
          {!cancelled && (
            <MilestoneBar value={appt.milestone} onChange={(i) => act.setMilestone(appt.id, i)}
              messageSent={!!appt.messageSent} onOpenMessage={() => setMessageOpen(true)}
              callMade={!!appt.callMade} onOpenCall={() => setCallOpen(true)}
              sessionEnded={!!done} billLogged={!!appt.billLogged} onOpenBill={() => setBillOpen(true)}
              personaFilled={!!appt.personaFilled} onOpenPersona={() => setPersonaOpen(true)}
              canManage={canManageMilestones} />
          )}
        </div>
      </div>

      <div style={{ flexShrink: 0 }}>
        {cancelled ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ fontSize: 12, color: C.soft, textAlign: "right" }}>{cancelStatusLabel(data, appt)}</span>
            <button onClick={() => setRecreateOpen(true)} style={{
              display: "flex", alignItems: "center", gap: 4, border: `1px solid ${C.line}`, borderRadius: 999,
              padding: "6px 10px", background: "#fff", cursor: "pointer",
            }}>
              <Plus size={11} strokeWidth={1.8} color={C.mid} />
              <span style={{ fontSize: 11.5, color: C.mid }}>Recreate slot</span>
            </button>
          </div>
        ) : done ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
            <button onClick={onOpen} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
              <Chip tone="sage" icon={<Check size={11} strokeWidth={1.8} />}>Session Completed</Chip>
            </button>
            <span style={{ fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>
              Session ended · {durStr(sess.durationSec)}
            </span>
            <span style={{ fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>{hm(sess.startedAt)} – {hm(sess.endedAt)}</span>
          </div>
        ) : running ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: C.ink }}>{clockStr(elapsed)}</span>
            <span style={{ fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>Since {hm(sess.startedAt)}</span>
            <button disabled={!canRunSession} onClick={onEnd} style={{
              display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.line}`, borderRadius: 12,
              padding: "9px 11px", background: "#fff", cursor: canRunSession ? "pointer" : "default", opacity: canRunSession ? 1 : 0.4,
            }}>
              <Square size={12} strokeWidth={0} fill="#111" />
              <span style={{ fontSize: 13, color: C.ink }}>End</span>
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={onOpen} aria-label="Appointment details" style={{
              display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34,
              border: `1px solid ${C.line}`, borderRadius: 12, background: "#fff", cursor: "pointer",
            }}>
              <MoreHorizontal size={15} strokeWidth={1.6} color={C.mid} />
            </button>
            <button disabled={!canRunSession} onClick={onStart} style={{
              display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.line}`, borderRadius: 12,
              padding: "9px 11px", background: "#fff", cursor: canRunSession ? "pointer" : "default", opacity: canRunSession ? 1 : 0.4,
            }}>
              <Play size={13} strokeWidth={0} fill="#111" />
              <span style={{ fontSize: 13, color: C.ink }}>Start</span>
            </button>
          </div>
        )}
      </div>
    </div>
    <PersonalizeMessageSheet open={messageOpen} onClose={() => setMessageOpen(false)}
      template={data.settings.appointmentMessageTemplate} clientName={client ? client.name : ""}
      clientPhone={client ? (client.whatsapp || client.phone) : ""}
      apptDate={appt.date} apptTime={appt.time}
      onCopied={() => act.setMessageSent(appt.id)} />
    <CallConfirmSheet open={callOpen} onClose={() => setCallOpen(false)}
      clientName={client ? client.name : ""} clientPhone={client ? (client.phone || client.whatsapp) : ""}
      onCalled={() => act.setCallMade(appt.id)} />
    <NubillsPasteSheet open={billOpen} onClose={() => setBillOpen(false)} data={data} act={act} user={user}
      appointmentId={appt.id} />
    <PersonaSheet open={personaOpen} onClose={() => setPersonaOpen(false)} client={client} act={act} data={data}
      appointmentId={appt.id} />
    <Sheet open={recreateOpen} onClose={() => setRecreateOpen(false)} title="Recreate slot">
      <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 16 }}>
        Books the same client back in — no need to re-enter anything.
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <Btn full kind="solid" onClick={() => { setRecreateOpen(false); act.rescheduleAppointment(appt.id, appt.date, appt.time); }} icon={<Clock size={14} strokeWidth={1.6} />}>
          Same time · {to12(appt.time)}
        </Btn>
        <Btn full onClick={() => { setRecreateOpen(false); setPickTimeOpen(true); }} icon={<CalendarClock size={14} strokeWidth={1.6} />}>
          Pick a new time
        </Btn>
      </div>
    </Sheet>
    <CancelRescheduleSheet appt={pickTimeOpen ? appt : null} data={data} act={act} onClose={() => setPickTimeOpen(false)} initialMode="reschedule-date" />
    </>
  );
}

/* ------------------------------------------------------- voice recorder */
// Records real audio from the device microphone (MediaRecorder API) and
// hands the caller a base64 data URL once stopped, so it can be saved as
// text (this app's storage only holds text/JSON, no raw binary files) and
// played back later with a plain <audio> element.
const MAX_VOICE_NOTE_SECONDS = 120;

function VoiceRecorder({ audioData, durationSec, onRecorded, onClear }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [err, setErr] = useState("");
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
  }, []);

  const start = async () => {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => onRecorded(reader.result, seconds);
        reader.readAsDataURL(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_VOICE_NOTE_SECONDS) { stop(); return s; }
          return s + 1;
        });
      }, 1000);
    } catch (e) {
      setErr("Microphone access was blocked or isn't available in this browser.");
    }
  };

  const stop = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    setRecording(false);
  };

  if (audioData) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px" }}>
          <Headphones size={16} strokeWidth={1.5} color={C.mid} />
          <audio controls src={audioData} style={{ height: 32, flex: 1 }} />
        </div>
        <button onClick={onClear} style={{ marginTop: 8, fontSize: 12, color: C.soft, cursor: "pointer", background: "none", border: "none", padding: 0 }}>
          Re-record
        </button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={recording ? stop : start} type="button" style={{
        display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 999,
        border: `1px solid ${recording ? "#b42318" : C.line}`, background: recording ? "#fdecea" : "#fff", cursor: "pointer",
      }}>
        {recording ? <Square size={14} strokeWidth={0} fill="#b42318" /> : <Mic size={16} strokeWidth={1.6} color={C.ink} />}
        <span style={{ fontSize: 13, color: recording ? "#b42318" : C.ink }}>
          {recording ? `Recording… ${clockStr(seconds).slice(3)}` : "Record voice note"}
        </span>
      </button>
      {recording && <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Tap again to stop. Max {MAX_VOICE_NOTE_SECONDS / 60} minutes.</div>}
      {err && <div style={{ fontSize: 12, color: "#b42318", marginTop: 6 }}>{err}</div>}
    </div>
  );
}


/* ------------------------------------------------- new appointment sheet */
function NewAppointmentSheet({ open, onClose, data, act, date, user, prefill, initialClientName }) {
  const s = data.settings;
  const services = s.services || [];
  const modes = s.modes || ["Online", "Offline"];
  const tagOptions = s.tags || [{ code: "CO", label: "Counselling" }, { code: "PT", label: "Psychotherapy" }];
  const attachmentTypes = s.attachmentTypes || ["Recording", "Voice note", "Note"];
  const isAdmin = user && user.role === "admin";
  const isResource = user && user.role === "resource";

  const [form, setForm] = useState(null);
  const [err, setErr] = useState("");
  const [interestOpen, setInterestOpen] = useState(false);
  const [bookedConfirm, setBookedConfirm] = useState(null);
  const [confirmCopied, setConfirmCopied] = useState(false);
  const recentInterests = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000;
    return (data.interests || [])
      .filter((it) => it.createdAt >= cutoff)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [data.interests]);

  useEffect(() => {
    if (open) {
      setErr("");
      setBookedConfirm(null);
      setForm({
        date, counsellorId: user.isNuLancer ? user.counsellorId : (prefill?.counsellorId || (isResource ? user.counsellorId : "")), time: prefill?.time || "",
        bookingStatus: "interest", // "interest" | "booked"
        bookingKind: "new", // "new" | "followup"
        clientId: "", followupPhone: "", followupName: "",
        clientName: prefill?.clientName || initialClientName || "", clientAge: prefill?.clientAge || "",
        gender: prefill?.gender || "",
        mode: prefill?.mode || "", category: prefill?.category || "",
        parentName: prefill?.parentName || "", guardianName: prefill?.guardianName || "", whatsapp: prefill?.whatsapp || "",
        advance: "", tags: [],
        attachmentType: "", attachmentNote: "", attachmentFileName: "",
        attachmentAudioData: "", attachmentDurationSec: 0,
        paymentScreenshotName: "", paidCapsuleAmount: "", sourceInterestId: null,
        chips: ["AP", "IC", "IS"], status: "Scheduled",
      });
    }
  }, [open, date, prefill, initialClientName]);

  // Auto-confirm the client once the name/phone search narrows to exactly
  // one unambiguous match, instead of forcing an extra tap.
  useEffect(() => {
    if (!form || form.bookingKind !== "followup") return;
    const nameQuery = (form.followupName || "").trim().toLowerCase();
    const digits = (form.followupPhone || "").replace(/\D/g, "");
    if (nameQuery.length < 2 && digits.length < 4) return;
    const matches = data.clients.filter((c) =>
      (nameQuery.length >= 2 && c.name.toLowerCase().includes(nameQuery)) ||
      (digits.length >= 4 && (c.phone || c.whatsapp || "").replace(/\D/g, "").includes(digits))
    );
    if (matches.length === 1 && form.clientId !== matches[0].id) {
      setForm((f) => (f ? { ...f, clientId: matches[0].id } : f));
    }
  }, [form?.followupName, form?.followupPhone, form?.bookingKind, data.clients]);

  if (!form) return null;

  if (bookedConfirm) {
    const template = data.settings.bookingConfirmedMessageTemplate || "Thank you {{name}}, advance received.";
    const text = template.replace(/\{\{name\}\}/g, bookedConfirm.clientName || "there");
    const waLink = () => {
      const phone = (bookedConfirm.whatsapp || "").replace(/[^\d]/g, "");
      const encoded = encodeURIComponent(text);
      return phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    };
    const shareAndCopy = async () => {
      try { await navigator.clipboard.writeText(text); setConfirmCopied(true); } catch (e) { /* clipboard unavailable */ }
      window.open(waLink(), "_blank");
    };
    return (
      <Sheet open onClose={onClose} title="Booking confirmed" footer={<Btn full kind="solid" onClick={onClose}>Done</Btn>}>
        <div style={{ textAlign: "center", padding: "6px 0 18px" }}>
          <Check size={26} strokeWidth={1.3} color={C.ink} />
        </div>
        <div style={{ background: C.chip, borderRadius: 16, padding: 16, fontSize: 13.5, color: C.mid, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 18 }}>
          {text}
        </div>
        <Btn full kind="solid" onClick={shareAndCopy} icon={<MessageCircle size={14} strokeWidth={1.6} />}>
          {confirmCopied ? "Copied · opened WhatsApp" : "WhatsApp & Copy"}
        </Btn>
      </Sheet>
    );
  }

  const counsellor = data.counsellors.find((c) => c.id === form.counsellorId);
  const slotOptions = counsellor
    ? (counsellor.slots.length ? counsellor.slots : ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"])
    : [];
  const taken = new Set(data.appointments
    .filter((a) => a.date === form.date && a.counsellorId === form.counsellorId && a.status !== "Cancelled")
    .map((a) => a.time));

  const isFollowup = form.bookingKind === "followup";
  const existingClient = isFollowup ? data.clients.find((c) => c.id === form.clientId) : null;
  const effCategory = isFollowup ? (existingClient?.category || "") : form.category;
  const effMode = isFollowup ? (existingClient?.mode || "") : form.mode;
  const nameCheck = /child|adolescent/i.test(effCategory);
  const geriCheck = /geriatric/i.test(effCategory);
  const needsParent = !isFollowup && nameCheck;
  const needsGuardian = !isFollowup && geriCheck;

  const req = effCategory || effMode ? advanceRequirement(s, effCategory, effMode) : null;
  const isInterest = form.bookingStatus === "interest";

  // Timeline checkpoint states — decorative, doesn't gate submission.
  const doneClient = isFollowup ? !!form.clientId : !!(form.clientName && form.clientName.trim());
  const doneSchedule = !!(form.date && form.counsellorId && form.time);
  const donePayment = (form.tags && form.tags.length > 0) && (isInterest || !!(form.paymentScreenshotName || form.paidCapsuleAmount));
  const doneAll = doneClient && doneSchedule && donePayment;

  const save = () => {
    setErr("");
    if (!form.counsellorId) return setErr("Choose a counsellor.");
    if (!form.time) return setErr("Choose a time slot.");

    if (isFollowup) {
      if (!form.clientId) return setErr("Choose the client for this follow-up.");
    } else {
      if (!form.clientName.trim()) return setErr("Enter the client's name.");
      if (!form.mode) return setErr("Choose Online or Offline.");
      if (!form.category) return setErr("Choose a service.");
      if (!form.clientAge) return setErr("Enter the client's age.");
      if (needsParent && !form.parentName.trim()) return setErr("Parent's name is required for this category.");
      if (!form.whatsapp.trim()) return setErr("Enter a WhatsApp number.");
    }

    if (!form.tags || form.tags.length === 0) return setErr("Choose at least one tag.");

    if (isInterest) {
      // Interest doesn't hold the slot and doesn't need payment proof —
      // everything else about the client is still captured for the call.
      act.saveInterest(form, "interest");
      onClose();
      return;
    }

    if (req) {
      const advanceNum = Number(form.advance) || Number(form.paidCapsuleAmount) || 0;
      if (advanceNum < req.amount) {
        return setErr(req.kind === "full"
          ? `Full payment of ${money(req.amount)} is required for this booking.`
          : `Advance of at least ${money(req.amount)} is required for this category.`);
      }
    }

    if (!isAdmin && !form.paymentScreenshotName) {
      return setErr("Upload a screenshot of the advance payment.");
    }

    const chips = [...(form.tags || []), effMode].filter(Boolean);
    const res = act.createAppointment({
      ...form, advance: form.advance || form.paidCapsuleAmount,
      category: form.category, mode: form.mode, chips, newClient: !isFollowup,
    });
    if (res.error) return setErr(res.error);
    if (form.sourceInterestId) act.deleteInterest(form.sourceInterestId);
    const confirmedName = isFollowup ? (existingClient?.name || "") : form.clientName;
    const confirmedWhatsapp = isFollowup ? (existingClient?.whatsapp || existingClient?.phone || "") : form.whatsapp;
    setBookedConfirm({ clientName: confirmedName, whatsapp: confirmedWhatsapp });
  };

  // If someone closes out of an unfinished Interest entry (call ended,
  // client didn't confirm), don't lose what was already typed — save it
  // as a draft rather than discarding it silently.
  const handleClose = () => {
    if (isInterest && !isFollowup && form.clientName && form.clientName.trim()) {
      act.saveInterest(form, "draft");
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={handleClose} title={isInterest ? "New interest" : "New appointment"} wide
      headerExtra={
        <div style={{ position: "relative" }}>
          <button onClick={() => setInterestOpen((v) => !v)} style={{
            display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.line}`, borderRadius: 999,
            padding: "6px 11px", background: "#fff", cursor: "pointer",
          }}>
            <span style={{ fontSize: 12, color: C.ink }}>Interest</span>
            {recentInterests.length > 0 && (
              <span style={{ fontSize: 10, color: "#fff", background: "#111", borderRadius: 999, padding: "1px 6px", minWidth: 15, textAlign: "center" }}>
                {recentInterests.length}
              </span>
            )}
            <ChevronDown size={12} strokeWidth={1.8} color={C.soft}
              style={{ transform: interestOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>

          {interestOpen && (
            <>
              <div onClick={() => setInterestOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 95, touchAction: "pan-y" }} />
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 96,
                minWidth: 220, maxWidth: 260, maxHeight: 300, overflowY: "auto", overflowX: "hidden", borderRadius: 20, padding: 6,
                background: "rgba(255,255,255,0.9)", backdropFilter: "blur(26px) saturate(190%)", WebkitBackdropFilter: "blur(26px) saturate(190%)",
                border: "1px solid rgba(255,255,255,0.85)", boxShadow: "0 16px 40px rgba(20,20,20,0.16), 0 4px 12px rgba(20,20,20,0.08)",
              }}>
                <div style={{ fontSize: 10, color: C.soft, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px 4px" }}>
                  Last 7 days
                </div>
                {recentInterests.length === 0 && (
                  <div style={{ fontSize: 12, color: C.faint, padding: "10px 10px 12px" }}>No recent interest entries.</div>
                )}
                {recentInterests.map((it) => (
                  <button key={it.id} onClick={() => {
                    setInterestOpen(false);
                    setForm({
                      ...form,
                      counsellorId: it.counsellorId || form.counsellorId,
                      clientName: it.clientName, clientAge: it.clientAge, gender: it.gender,
                      mode: it.mode, category: it.category,
                      parentName: it.parentName, guardianName: it.guardianName, whatsapp: it.whatsapp,
                      bookingKind: "new",
                      sourceInterestId: it.id,
                    });
                  }} style={{
                    width: "100%", display: "block", textAlign: "left", padding: "9px 10px", borderRadius: 14,
                    background: "transparent", border: "none", cursor: "pointer", fontFamily: FONT,
                  }}>
                    <div style={{ fontSize: 13, color: "#1c1c1e" }}>{it.clientName || "Unnamed"}</div>
                    <div style={{ fontSize: 11, color: C.soft, marginTop: 1 }}>{it.whatsapp || "No number"}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      }
      footer={<><Btn full onClick={handleClose}>Cancel</Btn>
        <Btn full kind="solid" onClick={save}>{isInterest ? "Save as Interest" : "Book appointment"}</Btn></>}>
      <Field label="Client type">
        <div style={{
          borderRadius: 16, overflow: "hidden",
          background: "rgba(255,255,255,0.6)", backdropFilter: "blur(18px) saturate(180%)", WebkitBackdropFilter: "blur(18px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.8)", boxShadow: "0 4px 16px rgba(20,20,20,0.05)",
        }}>
          {[["new", "New client"], ["followup", "Follow-up"]].map(([k, l], i) => {
            const on = form.bookingKind === k;
            return (
              <button key={k} onClick={() => setForm({ ...form, bookingKind: k })}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px",
                  background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT,
                  borderTop: i === 0 ? "none" : "1px solid rgba(0,0,0,0.06)",
                }}>
                <span style={{
                  width: 20, height: 20, borderRadius: 999, flexShrink: 0,
                  border: `1.5px solid ${on ? "#3f3f46" : C.faint}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {on && <span style={{ width: 10, height: 10, borderRadius: 999, background: "#3f3f46" }} />}
                </span>
                <span style={{ fontSize: 14, color: on ? "#1c1c1e" : C.mid, fontWeight: on ? 600 : 400 }}>{l}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Booking status" hint={isInterest ? "They haven't paid yet — this won't hold the slot." : "Payment confirmed, this locks in the slot."}>
        <div style={{ display: "flex", gap: 8 }}>
          {[["interest", "Interest"], ["booked", "Booked"]].map(([k, l]) => (
            <button key={k} onClick={() => setForm({ ...form, bookingStatus: k })}
              style={{ flex: 1, padding: "10px 0", fontSize: 13, borderRadius: 12, cursor: "pointer", border: `1px solid ${form.bookingStatus === k ? "#111" : C.line}`, background: form.bookingStatus === k ? "#111" : "#fff", color: form.bookingStatus === k ? "#fff" : C.mid }}>{l}</button>
          ))}
        </div>
      </Field>

      <TimelineStep icon={User} done={doneClient} active={!doneClient}>
      <div key={isFollowup ? "followup" : "new"} style={{ animation: "nurora-fade-in .28s ease" }}>
      {isFollowup ? (
        <>
          <Field label="Client name">
            <Input placeholder="Search by name" value={form.followupName || ""}
              onChange={(e) => setForm({ ...form, followupName: e.target.value, clientId: "" })} />
          </Field>

          <Field label="WhatsApp / Phone number" hint="Unique to each client — either field will find them.">
            <Input inputMode="tel" placeholder="e.g. 98400 11223" value={form.followupPhone || ""}
              onChange={(e) => setForm({ ...form, followupPhone: e.target.value, clientId: "" })} />
          </Field>

          {(() => {
            const nameQuery = (form.followupName || "").trim().toLowerCase();
            const digits = (form.followupPhone || "").replace(/\D/g, "");
            if (nameQuery.length < 2 && digits.length < 4) return null;
            const matches = data.clients.filter((c) =>
              (nameQuery.length >= 2 && c.name.toLowerCase().includes(nameQuery)) ||
              (digits.length >= 4 && (c.phone || c.whatsapp || "").replace(/\D/g, "").includes(digits))
            );
            if (matches.length === 1) {
              const m = matches[0];
              return (
                <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                  <Check size={16} strokeWidth={2} color={C.ink} />
                  <div>
                    <div style={{ fontSize: 14, color: C.ink }}>{m.name} <span style={{ color: C.soft, fontWeight: 400 }}>· {m.age}</span></div>
                    <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
                      {[m.phone || m.whatsapp, m.category, m.mode].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
              );
            }
            if (matches.length > 1) {
              return (
                <Field label="Multiple matches — pick one">
                  <div style={{ display: "grid", gap: 8 }}>
                    {matches.map((m) => (
                      <button key={m.id} onClick={() => setForm({ ...form, clientId: m.id })}
                        style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "10px 13px", borderRadius: 12, cursor: "pointer",
                          border: `1px solid ${form.clientId === m.id ? "#111" : C.line}`,
                          background: form.clientId === m.id ? "#111" : "#fff",
                        }}>
                        <span style={{ fontSize: 13.5, color: form.clientId === m.id ? "#fff" : C.ink }}>{m.name} · {m.age}</span>
                        <span style={{ fontSize: 12, color: form.clientId === m.id ? "rgba(255,255,255,0.7)" : C.soft }}>{m.phone || m.whatsapp}</span>
                      </button>
                    ))}
                  </div>
                </Field>
              );
            }
            return <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 16 }}>No client found with this number. Check it, or switch to New client.</div>;
          })()}
        </>
      ) : (
        <>
          <Field label="Client name">
            <Input placeholder="Full name" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
          </Field>

          <Field label="Gender">
            <GlassSelect value={form.gender} onChange={(v) => setForm({ ...form, gender: v })}
              placeholder="Select gender"
              options={["Male", "Female"]} />
          </Field>

          <Field label="Age">
            <Input inputMode="numeric" placeholder="Age" value={form.clientAge} onChange={(e) => setForm({ ...form, clientAge: e.target.value })} />
          </Field>

          <Field label="Service / Category">
            <GlassSelect value={form.category} onChange={(v) => setForm({ ...form, category: v })}
              placeholder="Select service"
              options={services.map((sv) => ({ value: sv.name, label: `${sv.name} — ${money(sv.value)}` }))} />
          </Field>

          {(form.category || form.gender) && (() => {
            const { Icon } = categoryIcon(form.category, form.gender);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "9px 12px", border: `1px solid ${C.line}`, borderRadius: 12 }}>
                <div style={{ width: 26, height: 26, borderRadius: 999, background: C.chip, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={14} color={C.mid} />
                </div>
                <span style={{ fontSize: 12, color: C.soft }}>This is how they'll show up on the schedule.</span>
              </div>
            );
          })()}
        </>
      )}
      </div>
      </TimelineStep>

      <TimelineStep icon={CalendarClock} done={doneSchedule} active={doneClient && !doneSchedule}>
      <Field label="Date">
        <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value, time: "" })} />
      </Field>
      <Field label="Counsellor">
        {user.isNuLancer ? (
          <div style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px", fontSize: 16, color: C.mid, background: C.chip }}>
            {counsellor ? counsellor.name : user.name}
          </div>
        ) : (
          <GlassSelect value={form.counsellorId} onChange={(v) => setForm({ ...form, counsellorId: v, time: "" })}
            placeholder="Select counsellor"
            options={data.counsellors
              .filter((c) => c.active)
              .filter((c) => {
                const lv = leaveOn(data, c.id, form.date);
                return !weekOffOn(data, c, form.date) && !(lv && !lv.half);
              })
              .map((c) => ({ value: c.id, label: c.name }))} />
        )}
      </Field>

      {counsellor && (
        <Field label="Time slot">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {slotOptions.map((t) => {
              const isTaken = taken.has(t);
              const on = form.time === t;
              return (
                <button key={t} disabled={isTaken} onClick={() => setForm({ ...form, time: t })}
                  style={{
                    position: "relative", fontSize: 13, padding: "9px 13px", borderRadius: 12, cursor: isTaken ? "default" : "pointer",
                    border: `1px solid ${on ? "#111" : C.line}`, background: on ? "#111" : "#fff",
                    color: on ? "#fff" : isTaken ? C.faint : C.ink,
                  }}>
                  {isTaken && (
                    <span style={{
                      position: "absolute", top: -8, right: -8,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "#fff", borderRadius: 999,
                    }}>
                      <ThumbsUp size={15} strokeWidth={1.8} color={C.mid} fill="none" />
                    </span>
                  )}
                  {to12(t)}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      </TimelineStep>

      <TimelineStep icon={Tag} done={donePayment} active={doneSchedule && !donePayment}>
      {!isFollowup && (
        <>
          <Field label="Mode">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {modes.map((m) => (
                <button key={m} onClick={() => setForm({ ...form, mode: m })}
                  style={{ padding: "10px 14px", fontSize: 13, borderRadius: 12, cursor: "pointer", border: `1px solid ${form.mode === m ? "#111" : C.line}`, background: form.mode === m ? "#111" : "#fff", color: form.mode === m ? "#fff" : C.mid }}>{m}</button>
              ))}
            </div>
          </Field>

          {needsParent && (
            <Field label="Parent's name">
              <Input placeholder="Required for Adolescent / Child" value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} />
            </Field>
          )}
          {needsGuardian && (
            <Field label="Guardian's name" hint="Optional">
              <Input placeholder="Optional" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} />
            </Field>
          )}

          <Field label="WhatsApp number">
            <Input inputMode="tel" placeholder="e.g. 98400 11223" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
          </Field>
        </>
      )}

      {req && !isInterest && (
        <Field label="Advance"
          hint={req.kind === "full" ? req.reason : `Minimum advance for ${effCategory}: ${money(req.amount)}`}>
          <Input inputMode="numeric" placeholder={String(req.amount)} value={form.advance} onChange={(e) => setForm({ ...form, advance: e.target.value, paidCapsuleAmount: "" })} />
        </Field>
      )}

      <Field label="Tags" hint="Select any that apply — shown to the counsellor under the client's name.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {tagOptions.map((tg) => {
            const on = (form.tags || []).includes(tg.code);
            return (
              <button key={tg.code}
                onClick={() => setForm({
                  ...form,
                  tags: on ? form.tags.filter((c) => c !== tg.code) : [...(form.tags || []), tg.code],
                })}
                style={{
                  padding: "6px 11px", fontSize: 12, borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${on ? "#111" : C.line}`, background: on ? "#111" : "#fff", color: on ? "#fff" : C.mid,
                }}>
                {tg.label} <span style={{ opacity: 0.7 }}>({tg.code})</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Attachment" hint={`Optional. Automatically deleted after ${s.attachmentRetentionDays || 30} days.`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: form.attachmentType ? 10 : 0 }}>
          <button onClick={() => setForm({ ...form, attachmentType: "" })}
            style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 999, cursor: "pointer", border: `1px solid ${!form.attachmentType ? "#111" : C.line}`, background: !form.attachmentType ? "#111" : "#fff", color: !form.attachmentType ? "#fff" : C.mid }}>None</button>
          {attachmentTypes.map((t) => {
            const on = form.attachmentType === t;
            return (
              <button key={t} onClick={() => setForm({ ...form, attachmentType: t })}
                style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 999, cursor: "pointer", border: `1px solid ${on ? "#111" : C.line}`, background: on ? "#111" : "#fff", color: on ? "#fff" : C.mid }}>{t}</button>
            );
          })}
        </div>
        {form.attachmentType === "Note" && (
          <Input placeholder="Write a short note…" value={form.attachmentNote} onChange={(e) => setForm({ ...form, attachmentNote: e.target.value })} />
        )}
        {form.attachmentType === "Recording" && (
          <div>
            <input type="file" accept="audio/*"
              onChange={(e) => { const f2 = e.target.files && e.target.files[0]; setForm({ ...form, attachmentFileName: f2 ? f2.name : "" }); }}
              style={{ fontSize: 13 }} />
            <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>
              File name is saved as a reference — this preview environment doesn't store the audio file itself.
            </div>
          </div>
        )}
        {form.attachmentType === "Voice note" && (
          <VoiceRecorder
            audioData={form.attachmentAudioData}
            durationSec={form.attachmentDurationSec}
            onRecorded={(dataUrl, secs) => setForm({ ...form, attachmentAudioData: dataUrl, attachmentDurationSec: secs, attachmentFileName: "" })}
            onClear={() => setForm({ ...form, attachmentAudioData: "", attachmentDurationSec: 0 })}
          />
        )}
      </Field>

      {!isInterest && (
        <Field label="Advance payment" hint={isAdmin ? "Upload proof, or mark it paid directly." : "Required — upload proof of the advance payment."}>
          <input type="file" accept="image/*"
            onChange={(e) => { const f2 = e.target.files && e.target.files[0]; setForm({ ...form, paymentScreenshotName: f2 ? f2.name : "" }); }}
            style={{ fontSize: 13 }} />
          {form.paymentScreenshotName && <div style={{ fontSize: 12, color: C.mid, marginTop: 6 }}>Attached: {form.paymentScreenshotName}</div>}

          {isAdmin && req && (
            <div style={{ marginTop: 10 }}>
              <button onClick={() => setForm({
                ...form,
                paidCapsuleAmount: form.paidCapsuleAmount === req.amount ? "" : req.amount,
                advance: form.paidCapsuleAmount === req.amount ? form.advance : req.amount,
              })}
                style={{
                  fontSize: 12.5, padding: "8px 13px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${form.paidCapsuleAmount === req.amount ? "#111" : C.line}`,
                  background: form.paidCapsuleAmount === req.amount ? "#111" : "#fff",
                  color: form.paidCapsuleAmount === req.amount ? "#fff" : C.mid,
                }}>
                {req.kind === "full" ? `Paid in full ${money(req.amount)}` : `Paid advance ${money(req.amount)}`}
              </button>
            </div>
          )}
        </Field>
      )}
      </TimelineStep>

      <TimelineStep icon={Flag} done={doneAll} active={donePayment && !doneAll} isLast>
      <Field label="Status">
        <GlassSelect value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={["Scheduled", "Cancelled"]} />
      </Field>
      </TimelineStep>

      {err && <div style={{ fontSize: 13, color: "#b42318", marginTop: 4 }}>{err}</div>}
    </Sheet>
  );
}

/* --------------------------------------------------- appointment detail */
// Covers all four cancel/reschedule paths: cancel with a refund owed, cancel
// with nothing owed, reschedule to a specific new slot, or reschedule with
// no date yet (parked in the Rescheduling list to follow up on later).
// TPIN → MPIN signup wizard. OTP has no real backend to verify against in
// this app, so per explicit direction it's a formality confirmation step,
// not a functioning verification — flagged clearly in the UI as such.
// Admin-only editor for the 3 agreement pages shown in the counsellor
// signup wizard. Each page renders as an A4-proportioned "paper" card so
// it's clear what the counsellor will actually see.
function AgreementEditorSheet({ open, onClose, data, act, go }) {
  const [frontPageText, setFrontPageText] = useState("");
  const [agreeText, setAgreeText] = useState("");
  const [resourcePdfLegal, setResourcePdfLegal] = useState(null);
  const [resourcePdfLayman, setResourcePdfLayman] = useState(null);
  const [nulancerPdfLegal, setNulancerPdfLegal] = useState(null);
  const [nulancerPdfLayman, setNulancerPdfLayman] = useState(null);
  const [newCounsellorOpen, setNewCounsellorOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pdfType, setPdfType] = useState("Resource");
  useEffect(() => {
    if (open) {
      setFrontPageText(data.settings.frontPageTextTemplate || "");
      setAgreeText(data.settings.agreementAgreeText || "");
      setResourcePdfLegal(data.settings.resourceAgreementPdfLegal || null);
      setResourcePdfLayman(data.settings.resourceAgreementPdfLayman || null);
      setNulancerPdfLegal(data.settings.nulancerAgreementPdfLegal || null);
      setNulancerPdfLayman(data.settings.nulancerAgreementPdfLayman || null);
      setPdfType("Resource");
    }
  }, [open]);
  if (!open) return null;

  const save = () => {
    act.updateSettings({
      ...data.settings, frontPageTextTemplate: frontPageText, agreementAgreeText: agreeText,
      resourceAgreementPdfLegal: resourcePdfLegal, resourceAgreementPdfLayman: resourcePdfLayman,
      nulancerAgreementPdfLegal: nulancerPdfLegal, nulancerAgreementPdfLayman: nulancerPdfLayman,
    });
    onClose();
  };

  const pdfUpload = (label, current, setter) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 13, color: current ? C.ink : C.faint }}>{current ? "PDF uploaded" : "No PDF yet"}</div>
        <label style={{ cursor: "pointer" }}>
          <span style={{ fontSize: 13, color: RING_DONE_SOLID, fontWeight: 500 }}>{current ? "Replace" : "Upload"}</span>
          <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => setter(reader.result);
            reader.readAsDataURL(file);
          }} />
        </label>
        {current && (
          <button onClick={() => setter(null)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}>
            <X size={13} strokeWidth={1.6} color={C.faint} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Sheet open onClose={onClose} title="Agreement"
      footer={<><Btn full onClick={onClose}>Cancel</Btn><Btn full kind="solid" onClick={save}>Save</Btn></>}>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <Pill icon={<Plus size={13} strokeWidth={1.6} />} onClick={() => setNewCounsellorOpen(true)}>New Counsellor</Pill>
        <Pill icon={<Users size={13} strokeWidth={1.6} />} onClick={() => setPickerOpen(true)}>Select Counsellors</Pill>
      </div>
      <div style={{ fontSize: 12, color: C.soft, marginBottom: 16 }}>
        This is what counsellors see during signup — page 1 is this text (personalized with their name), page 2 is the agreement PDF for their type. Each type gets a Legal version and a plain-language Layman version — counsellors can switch between them.
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
        Page 1 — use {"{{name}}"} for their name
      </div>
      <div style={{
        background: "#eef6ec", border: "1px solid #d3e6ce", borderRadius: 4,
        aspectRatio: "210 / 297", maxHeight: 360, padding: "20px 18px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)", display: "flex", overflow: "hidden", marginBottom: 20,
      }}>
        <textarea
          value={frontPageText}
          onChange={(e) => setFrontPageText(e.target.value)}
          style={{
            width: "100%", height: "100%", border: "none", background: "transparent", resize: "none",
            fontSize: 13, lineHeight: 1.7, color: "#2c3b28", fontFamily: FONT, outline: "none",
          }}
        />
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
        Page 2 — agreement PDFs
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["Resource", "NuLancer"].map((t) => (
          <button key={t} onClick={() => setPdfType(t)} style={{
            flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, cursor: "pointer",
            border: `1.5px solid ${pdfType === t ? "#111" : C.line}`,
            background: pdfType === t ? "#111" : "#fff", color: pdfType === t ? "#fff" : C.ink, fontWeight: 500,
          }}>{t}</button>
        ))}
      </div>
      {pdfType === "Resource"
        ? <>
            {pdfUpload("Resource agreement (Legal version)", resourcePdfLegal, setResourcePdfLegal)}
            {pdfUpload("Resource agreement (Layman version)", resourcePdfLayman, setResourcePdfLayman)}
          </>
        : <>
            {pdfUpload("NuLancer agreement (Legal version)", nulancerPdfLegal, setNulancerPdfLegal)}
            {pdfUpload("NuLancer agreement (Layman version)", nulancerPdfLayman, setNulancerPdfLayman)}
          </>
      }

      <Field label={"\"I agree\" wording"}>
        <Input value={agreeText} onChange={(e) => setAgreeText(e.target.value)} />
      </Field>

      <SelectCounsellorsSheet open={pickerOpen} onClose={() => setPickerOpen(false)} data={data} go={go} onNavigate={onClose} />
      <NewCounsellorSheet open={newCounsellorOpen} onClose={() => setNewCounsellorOpen(false)} data={data} act={act} />
    </Sheet>
  );
}

// Read-only agreement review, available for 7 days after signup completes.
// Shared PDF viewer with a Legal/Layman toggle — used everywhere a
// counsellor actually sees their agreement PDF.
function AgreementPdfViewer({ counsellor, data }) {
  const [version, setVersion] = useState("layman");
  const legal = counsellor.isNuLancer ? data.settings.nulancerAgreementPdfLegal : data.settings.resourceAgreementPdfLegal;
  const layman = counsellor.isNuLancer ? data.settings.nulancerAgreementPdfLayman : data.settings.resourceAgreementPdfLayman;
  const pdf = version === "legal" ? legal : layman;
  if (!legal && !layman) {
    return <div style={{ fontSize: 13, color: C.faint, marginBottom: 16 }}>Admin hasn't uploaded the agreement PDF yet — ask them to add it before continuing.</div>;
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {["layman", "legal"].map((v) => (
          <button key={v} onClick={() => setVersion(v)} disabled={v === "legal" ? !legal : !layman} style={{
            flex: 1, padding: "8px 0", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
            border: `1.5px solid ${version === v ? "#111" : C.line}`,
            background: version === v ? "#111" : "#fff", color: version === v ? "#fff" : C.ink, fontWeight: 500,
            opacity: (v === "legal" ? !legal : !layman) ? 0.4 : 1,
          }}>{v === "legal" ? "Legal Version" : "Layman Version"}</button>
        ))}
      </div>
      {pdf ? (
        <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${C.line}`, height: 420 }}>
          <iframe src={pdf} title="Agreement" style={{ width: "100%", height: "100%", border: "none" }} />
        </div>
      ) : (
        <div style={{ fontSize: 13, color: C.faint }}>The {version === "legal" ? "Legal" : "Layman"} version hasn't been uploaded yet.</div>
      )}
    </div>
  );
}

function ageFromDob(dob) {
  if (!dob) return null;
  const d = fromYmd(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const beforeBirthday = now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}
function experienceFromDoj(doj) {
  if (!doj) return null;
  const d = fromYmd(doj);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  if (months < 0) return null;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (years === 0) return `${remMonths} month${remMonths === 1 ? "" : "s"}`;
  return `${years} year${years === 1 ? "" : "s"}${remMonths ? ` ${remMonths} month${remMonths === 1 ? "" : "s"}` : ""}`;
}

// Counsellor self-service — filled in by them, not Admin, reachable from
// their own avatar in the drawer.
function MyDetailsSheet({ open, onClose, counsellor, act, data }) {
  const [form, setForm] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState("");
  const [step, setStep] = useState("form"); // form | otp | done
  const [otpConfirmed, setOtpConfirmed] = useState(false);
  const [mpin, setMpin] = useState(null);
  useEffect(() => {
    if (open && counsellor) {
      setForm({ name: counsellor.name || "", dob: counsellor.dob || "", personalPhone: counsellor.personalPhone || "", aadharImage: counsellor.aadharImage || null, dateOfJoining: counsellor.dateOfJoining || "" });
      setAgreed(false); setSignature(""); setStep("form"); setOtpConfirmed(false); setMpin(null);
    }
  }, [open, counsellor]);
  if (!open || !counsellor || !form) return null;

  const needsSignup = counsellor.accountStatus === "tpin" && !counsellor.isOwner;
  const frontPageText = (counsellor.frontPageTextOverride || data.settings.frontPageTextTemplate || "").replace(/\{\{name\}\}/g, counsellor.name);
  const agreeText = counsellor.agreementAgreeTextOverride || data.settings.agreementAgreeText || "I have read and agree to the terms of this agreement.";
  const age = ageFromDob(form.dob);
  const experience = experienceFromDoj(form.dateOfJoining);

  const saveDetails = () => act.updateCounsellor(counsellor.id, { ...form, name: form.name.trim() || counsellor.name });

  if (step === "otp") {
    return (
      <Sheet open onClose={onClose} title="Verify OTP"
        footer={<>
          <Btn full onClick={() => setStep("form")}>Back</Btn>
          <Btn full kind="solid" disabled={!otpConfirmed} onClick={() => {
            saveDetails();
            const generated = act.completeSignup(counsellor.id, signature.trim());
            setMpin(generated);
            setStep("done");
          }}>Complete Signup</Btn>
        </>}>
        <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 16 }}>
          There's no SMS service connected here, so this step is a confirmation only, not a real verification.
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={otpConfirmed} onChange={(e) => setOtpConfirmed(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, accentColor: "#111" }} />
          <span style={{ fontSize: 13.5, color: C.ink }}>I confirm I've received and entered the OTP sent to my registered number.</span>
        </label>
      </Sheet>
    );
  }

  if (step === "done") {
    return (
      <Sheet open onClose={onClose} title="Signup Complete" footer={<Btn full kind="solid" onClick={onClose}>Done</Btn>}>
        <div style={{ textAlign: "center", padding: "10px 0 6px" }}>
          <Check size={26} strokeWidth={1.3} color={C.ink} />
          <div style={{ fontSize: 15, color: C.ink, marginTop: 12, marginBottom: 20 }}>You're fully signed up.</div>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>Your permanent MPIN</div>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "4px", color: C.ink, marginBottom: 16 }}>{mpin}</div>
          <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}>Save this — you'll need it to sign in from now on. Your TPIN no longer works, and Face ID / Touch ID is now available.</div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title="My Details"
      footer={<>
        <Btn full onClick={onClose}>Cancel</Btn>
        {needsSignup ? (
          <Btn full kind="solid" disabled={!agreed || !signature.trim()} onClick={() => setStep("otp")}>Next</Btn>
        ) : (
          <Btn full kind="solid" onClick={() => { saveDetails(); onClose(); }}>Save</Btn>
        )}
      </>}>
      <label style={{ cursor: "pointer", display: "inline-block", marginBottom: 20 }}>
        <StatusAvatar name={counsellor.name} size={56} photo={counsellor.photo} accountStatus={counsellor.accountStatus} isOwner={counsellor.isOwner} />
        <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => act.updateCounsellor(counsellor.id, { photo: reader.result });
          reader.readAsDataURL(file);
        }} />
      </label>
      <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Role"><Input value={counsellor.role} disabled /></Field>
      <Field label="Date of Birth"><Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></Field>
      {age != null && <div style={{ fontSize: 12, color: C.soft, marginTop: -12, marginBottom: 16 }}>Age: {age}</div>}
      <Field label="Mobile No."><Input inputMode="tel" value={form.personalPhone} onChange={(e) => setForm({ ...form, personalPhone: e.target.value })} /></Field>
      <Field label="Aadhar Upload">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {form.aadharImage ? (
            <img src={form.aadharImage} alt="Aadhar" style={{ width: 56, height: 40, borderRadius: 8, objectFit: "cover", border: `1px solid ${C.line}` }} />
          ) : (
            <div style={{ width: 56, height: 40, borderRadius: 8, border: `1px dashed ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <FileText size={16} strokeWidth={1.3} color={C.faint} />
            </div>
          )}
          <label style={{ cursor: "pointer" }}>
            <span style={{ fontSize: 13, color: RING_DONE_SOLID, fontWeight: 500 }}>{form.aadharImage ? "Replace" : "Upload"}</span>
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
              const file = e.target.files && e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setForm({ ...form, aadharImage: reader.result });
              reader.readAsDataURL(file);
            }} />
          </label>
        </div>
      </Field>
      <Field label="Date of Joining"><Input type="date" value={form.dateOfJoining} onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })} /></Field>
      {experience && <div style={{ fontSize: 12, color: C.soft, marginTop: -12, marginBottom: needsSignup ? 24 : 0 }}>Experience so far: {experience}</div>}

      {needsSignup && (
        <>
          <div style={{ borderTop: `1px solid ${C.hair}`, paddingTop: 20, marginTop: 4 }} />
          <SectionLabel>Signup Agreement</SectionLabel>
          <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.75, whiteSpace: "pre-wrap", marginBottom: 20 }}>{frontPageText}</div>

          <AgreementPdfViewer counsellor={counsellor} data={data} />
          <div style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>E-Signature</div>
          <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 14 }}>Type your full name below to sign the agreement.</div>
          <Field label="Signature">
            <Input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={counsellor.name} />
          </Field>
          {signature.trim() && (
            <div style={{ fontFamily: "cursive", fontSize: 26, color: C.ink, borderBottom: `1.5px solid ${C.line}`, padding: "10px 4px 8px" }}>{signature}</div>
          )}
        </>
      )}
    </Sheet>
  );
}

function AgreementViewSheet({ open, onClose, counsellor, data }) {
  if (!open || !counsellor) return null;
  const frontPageText = (counsellor.frontPageTextOverride || data.settings.frontPageTextTemplate || "").replace(/\{\{name\}\}/g, counsellor.name);
  const daysLeft = counsellor.agreementSignedAt ? Math.max(0, Math.ceil(7 - (Date.now() - counsellor.agreementSignedAt) / 86400000)) : 0;
  return (
    <Sheet open onClose={onClose} title="Your Agreement" footer={<Btn full kind="solid" onClick={onClose}>Close</Btn>}>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 14 }}>
        {daysLeft > 0 ? `Viewable for ${daysLeft} more day${daysLeft === 1 ? "" : "s"}.` : "This viewing window has ended — contact Admin if you need access again."}
      </div>
      <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 18 }}>{frontPageText}</div>
      <AgreementPdfViewer counsellor={counsellor} data={data} />
    </Sheet>
  );
}

function SignupWizard({ open, onClose, counsellor, act, data }) {
  const [step, setStep] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState("");
  const [otpConfirmed, setOtpConfirmed] = useState(false);
  const [mpin, setMpin] = useState(null);
  useEffect(() => { if (open) { setStep(0); setAgreed(false); setSignature(""); setOtpConfirmed(false); setMpin(null); } }, [open]);
  if (!open || !counsellor) return null;

  const frontPageText = (counsellor.frontPageTextOverride || data.settings.frontPageTextTemplate || "").replace(/\{\{name\}\}/g, counsellor.name);
  const agreeText = counsellor.agreementAgreeTextOverride || data.settings.agreementAgreeText || "I have read and agree to the terms of this agreement.";

  if (step === 0) {
    return (
      <Sheet open onClose={onClose} title="Agreement"
        footer={<>
          <Btn full onClick={onClose}>Cancel</Btn>
          <Btn full kind="solid" disabled={!agreed || !signature.trim()} onClick={() => setStep(1)}>Next</Btn>
        </>}>
        <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.75, whiteSpace: "pre-wrap", marginBottom: 20 }}>{frontPageText}</div>

        <AgreementPdfViewer counsellor={counsellor} data={data} />
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 20 }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, accentColor: "#111" }} />
          <span style={{ fontSize: 13.5, color: C.ink }}>{agreeText}</span>
        </label>

        <div style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>E-Signature</div>
        <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 14 }}>Type your full name below to sign the agreement.</div>
        <Field label="Signature">
          <Input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={counsellor.name} />
        </Field>
        {signature.trim() && (
          <div style={{ fontFamily: "cursive", fontSize: 26, color: C.ink, borderBottom: `1.5px solid ${C.line}`, padding: "10px 4px 8px" }}>{signature}</div>
        )}
      </Sheet>
    );
  }

  if (step === 3) {
    return (
      <Sheet open onClose={onClose} title="Verify OTP"
        footer={<>
          <Btn full onClick={() => setStep(0)}>Back</Btn>
          <Btn full kind="solid" disabled={!otpConfirmed} onClick={() => {
            const generated = act.completeSignup(counsellor.id, signature.trim());
            setMpin(generated);
            setStep(4);
          }}>Complete Signup</Btn>
        </>}>
        <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 16 }}>
          There's no SMS service connected here, so this step is a confirmation only, not a real verification.
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={otpConfirmed} onChange={(e) => setOtpConfirmed(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, accentColor: "#111" }} />
          <span style={{ fontSize: 13.5, color: C.ink }}>I confirm I've received and entered the OTP sent to my registered number.</span>
        </label>
      </Sheet>
    );
  }

  // step === 4 — done, show the generated MPIN
  return (
    <Sheet open onClose={onClose} title="Signup Complete" footer={<Btn full kind="solid" onClick={onClose}>Done</Btn>}>
      <div style={{ textAlign: "center", padding: "10px 0 6px" }}>
        <Check size={26} strokeWidth={1.3} color={C.ink} />
        <div style={{ fontSize: 15, color: C.ink, marginTop: 12, marginBottom: 20 }}>You're fully signed up.</div>
        <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>Your permanent MPIN</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "4px", color: C.ink, marginBottom: 16 }}>{mpin}</div>
        <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}>Save this — you'll need it to sign in from now on. Your TPIN no longer works, and Face ID / Touch ID is now available. You can review this agreement for 7 days from the drawer, after which you'll need to ask Admin for renewed access.</div>
      </div>
    </Sheet>
  );
}

function CancelRescheduleSheet({ appt, data, act, onClose, initialMode }) {
  const [mode, setMode] = useState(null);
  const [refund, setRefund] = useState(false);
  const [reason, setReason] = useState("");
  const [newDate, setNewDate] = useState(appt ? appt.date : ymd(new Date()));
  const [newTime, setNewTime] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (appt) { setMode(initialMode || null); setRefund(false); setReason(""); setNewDate(ymd(new Date())); setNewTime(""); setErr(""); }
  }, [appt]);

  if (!appt) return null;
  const counsellor = data.counsellors.find((c) => c.id === appt.counsellorId);
  const slotOptions = counsellor
    ? (counsellor.slots.length ? counsellor.slots : ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"])
    : [];
  const taken = new Set(data.appointments
    .filter((a) => a.date === newDate && a.counsellorId === appt.counsellorId && a.status !== "Cancelled" && a.id !== appt.id)
    .map((a) => a.time));

  if (mode === null) {
    return (
      <Sheet open onClose={onClose} title="Cancel or Reschedule">
        <div style={{ display: "grid", gap: 10 }}>
          <Btn full kind="danger" onClick={() => setMode("cancel")}>Cancel appointment</Btn>
          <Btn full kind="solid" onClick={() => setMode("reschedule")}>Reschedule appointment</Btn>
        </div>
      </Sheet>
    );
  }

  if (mode === "cancel") {
    return (
      <Sheet open onClose={onClose} title="Cancel appointment"
        footer={<>
          <Btn full onClick={() => setMode(null)}>Back</Btn>
          <Btn full kind="danger" onClick={() => { act.cancelAppointment(appt.id, { refund, reason }); onClose(); }}>Confirm cancel</Btn>
        </>}>
        <button onClick={() => setRefund((v) => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 0 18px", cursor: "pointer", background: "none", border: "none" }}>
          <span style={{ fontSize: 14 }}>Client wants a refund</span>
          <span style={{ width: 44, height: 26, borderRadius: 999, background: refund ? "#111" : C.ghost, display: "flex", alignItems: "center", padding: 3 }}>
            <span style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", marginLeft: refund ? 18 : 0, transition: "margin .2s" }} />
          </span>
        </button>
        <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. client unwell" /></Field>
        {refund && <div style={{ fontSize: 12, color: C.soft }}>This marks the refund as pending in the Refunds list — close it out once it's actually been paid back.</div>}
      </Sheet>
    );
  }

  if (mode === "reschedule") {
    return (
      <Sheet open onClose={onClose} title="Reschedule">
        <div style={{ fontSize: 13, color: C.soft, marginBottom: 16 }}>Does the client already have a new date in mind?</div>
        <div style={{ display: "grid", gap: 10 }}>
          <Btn full kind="solid" onClick={() => setMode("reschedule-date")}>Yes — pick a new date</Btn>
          <Btn full onClick={() => setMode("reschedule-pending")}>Not yet — mark for later</Btn>
        </div>
      </Sheet>
    );
  }

  if (mode === "reschedule-pending") {
    return (
      <Sheet open onClose={onClose} title="Mark for rescheduling"
        footer={<>
          <Btn full onClick={() => setMode("reschedule")}>Back</Btn>
          <Btn full kind="solid" onClick={() => { act.markRescheduling(appt.id, reason); onClose(); }}>Confirm</Btn>
        </>}>
        <div style={{ fontSize: 13, color: C.soft, marginBottom: 16 }}>This frees up the slot and adds them to the Rescheduling list so nothing gets forgotten once they give you a date.</div>
        <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Sheet>
    );
  }

  // mode === "reschedule-date"
  return (
    <Sheet open onClose={onClose} title="Pick new date & time"
      footer={<>
        <Btn full onClick={() => setMode("reschedule")}>Back</Btn>
        <Btn full kind="solid" onClick={() => {
          if (!newTime) return setErr("Choose a time slot.");
          const r = act.rescheduleAppointment(appt.id, newDate, newTime);
          if (r && r.error) return setErr(r.error);
          onClose();
        }}>Confirm reschedule</Btn>
      </>}>
      <Field label="Date"><Input type="date" value={newDate} onChange={(e) => { setNewDate(e.target.value); setNewTime(""); }} /></Field>
      <Field label="Time slot">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {slotOptions.map((t) => {
            const isTaken = taken.has(t);
            return (
              <button key={t} disabled={isTaken} onClick={() => setNewTime(t)} style={{
                fontSize: 13, padding: "9px 13px", borderRadius: 12, cursor: isTaken ? "default" : "pointer",
                border: `1px solid ${newTime === t ? "#111" : C.line}`, background: newTime === t ? "#111" : "#fff",
                color: newTime === t ? "#fff" : isTaken ? C.faint : C.ink,
              }}>{to12(t)}</button>
            );
          })}
        </div>
      </Field>
      {err && <div style={{ fontSize: 12.5, color: "#b42318", marginTop: 8 }}>{err}</div>}
    </Sheet>
  );
}

function AppointmentDetail({ appt, onClose, data, act, user, now, onStart, onEnd }) {
  const [crOpen, setCrOpen] = useState(false);
  if (!appt) return null;
  const a = data.appointments.find((x) => x.id === appt.id) || appt;
  const client = data.clients.find((c) => c.id === a.clientId);
  const counsellor = data.counsellors.find((c) => c.id === a.counsellorId);
  const sess = sessionFor(data, a.id);
  const inv = sess && sess.invoiceId ? data.invoices.find((i) => i.id === sess.invoiceId) : null;
  const canRun = user.role === "admin" || user.counsellorId === a.counsellorId;
  const canRunSession = user.counsellorId === a.counsellorId;
  const running = sess && !sess.endedAt;
  const elapsed = running ? Math.max(0, Math.floor((now - sess.startedAt) / 1000)) : 0;
  const isAdmin = user.role === "admin";

  return (
    <>
    <Sheet open onClose={onClose} title="Session details"
      footer={
        running ? <Btn full kind="solid" disabled={!canRunSession} onClick={() => onEnd(a)} icon={<Square size={13} strokeWidth={0} fill="#fff" />}>End Timer</Btn>
          : !sess && a.status === "Scheduled" ? (
            <>
              {canRun && <Btn full kind="danger" onClick={() => setCrOpen(true)}>Cancel or Reschedule</Btn>}
              <Btn full kind="solid" disabled={!canRunSession} onClick={() => onStart(a)} icon={<Play size={13} strokeWidth={0} fill="#fff" />}>Start Timer</Btn>
            </>
          ) : <Btn full onClick={onClose}>Close</Btn>
      }>
      {running && (
        <div style={{ textAlign: "center", padding: "8px 0 18px" }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-1px", fontVariantNumeric: "tabular-nums" }}>{clockStr(elapsed)}</div>
          <div style={{ fontSize: 12, color: C.soft, marginTop: 4 }}>Session running</div>
        </div>
      )}
      <Row label="Client" value={client ? client.name : "—"} />
      <Row label="Age" value={client ? client.age : "—"} />
      {client && client.category && <Row label="Category" value={client.category} />}
      {(a.mode || (client && client.mode)) && <Row label="Mode" value={a.mode || client.mode} />}
      {client && client.whatsapp && <Row label="WhatsApp" value={client.whatsapp} />}
      {client && client.parentName && <Row label="Parent's name" value={client.parentName} />}
      {client && client.guardianName && <Row label="Guardian's name" value={client.guardianName} />}
      <Row label="Counsellor" value={counsellor ? counsellor.name : "—"} strong />
      <Row label="Session" value={a.category || a.type || "—"} />
      {a.tags && a.tags.length > 0 && <Row label="Tags" value={a.tags.join(", ")} />}
      <Row label="Date" value={shortDate(a.date)} />
      <Row label="Scheduled" value={to12(a.time)} />
      {sess && <Row label="Started" value={new Date(sess.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />}
      {sess && sess.endedAt && <Row label="Ended" value={new Date(sess.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />}
      {sess && sess.endedAt && <Row label="Duration" value={durStr(sess.durationSec)} strong />}
      {inv && <>
        <Row label="Base fee" value={money(inv.base)} />
        <Row label="Additional fee" value={money(inv.additional)} />
        {inv.gst > 0 && <Row label={`GST ${data.settings.gstPercent}%`} value={money(inv.gst)} />}
        <Row label="Advance paid" value={money(inv.advance)} />
        <Row label="Total" value={money(inv.total)} strong />
        <Row label="Payment" value={inv.paymentStatus} />
        <Row label="Invoice" value={inv.number} />
      </>}
      {!sess && <Row label="Advance paid" value={money(a.advance)} />}
      {!sess && <Row label="Status" value={a.status} />}
      {a.paymentScreenshotName && <Row label="Payment proof" value={a.paymentScreenshotName} />}
      {a.status === "Cancelled" && a.cancelType && (
        <Row label="Cancellation" value={a.cancelType === "refund" ? `Refund ${a.refundStatus === "given" ? "given" : "pending"}` : "No refund"} strong />
      )}
      {a.status === "Cancelled" && a.rescheduleStatus === "pending" && (
        <Row label="Rescheduling" value="Waiting on a new date" strong />
      )}
      {a.status === "Cancelled" && a.rescheduleStatus === "moved" && (
        <Row label="Rescheduled to" value={data.appointments.find((x) => x.id === a.rescheduledToId) ? shortDate(data.appointments.find((x) => x.id === a.rescheduledToId).date) : "—"} strong />
      )}
      {a.attachmentType === "Voice note" && a.attachmentAudioData ? (
        <div style={{ padding: "10px 0", borderBottom: `1px solid ${C.hair}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: C.soft }}>Voice note</span>
            <span style={{ fontSize: 12, color: C.faint }}>{a.attachmentDurationSec ? durStr(a.attachmentDurationSec) : ""}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 12px" }}>
            <Headphones size={16} strokeWidth={1.5} color={C.mid} />
            <audio controls src={a.attachmentAudioData} style={{ height: 32, flex: 1 }} />
          </div>
        </div>
      ) : a.attachmentType && (
        <Row label={a.attachmentType} value={a.attachmentNote || a.attachmentFileName || "Attached"} />
      )}
    </Sheet>
    <CancelRescheduleSheet appt={crOpen ? a : null} data={data} act={act} onClose={() => { setCrOpen(false); onClose(); }} />
    </>
  );
}

/* ------------------------------------------------ start session confirm */
// Starting a timer begins billing the client immediately, so this guards
// against an accidental tap the same way ending a session already does.
function StartSessionSheet({ appt, onClose, data, act }) {
  if (!appt) return null;
  const client = data.clients.find((c) => c.id === appt.clientId);
  const counsellor = data.counsellors.find((c) => c.id === appt.counsellorId);
  const bill = computeBill(data.settings.includedMinutes * 60, data.settings);

  return (
    <Sheet open onClose={onClose} title="Start this session?"
      footer={<>
        <Btn full onClick={onClose}>Cancel</Btn>
        <Btn full kind="solid" onClick={() => { act.startSession(appt.id); onClose(); }} icon={<Play size={13} strokeWidth={0} fill="#fff" />}>
          Start Timer
        </Btn>
      </>}>
      <div style={{ textAlign: "center", padding: "6px 0 20px" }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: C.ink }}>{client ? client.name : "Client"}</div>
        <div style={{ fontSize: 12.5, color: C.soft, marginTop: 4 }}>with {counsellor ? counsellor.name : "—"} · {to12(appt.time)}</div>
      </div>
      <Row label="Base session fee" value={money(bill.base)} />
      <div style={{ fontSize: 12, color: C.faint, marginTop: 14 }}>
        This starts the billed timer right away. Double-check this is the right client and slot before continuing.
      </div>
    </Sheet>
  );
}


/* ------------------------------------------------------ end session flow */
function EndSessionSheet({ appt, onClose, data, act, now, user }) {
  const [summary, setSummary] = useState(null);
  if (!appt && !summary) return null;

  if (summary) {
    const inv = data.invoices.find((i) => i.id === summary.invoiceId);
    return (
      <Sheet open onClose={() => { setSummary(null); onClose(); }} title="Session completed"
        footer={<Btn full kind="solid" onClick={() => { setSummary(null); onClose(); }}>Done</Btn>}>
        <div style={{ textAlign: "center", padding: "6px 0 18px" }}>
          <Check size={26} strokeWidth={1.3} color={C.ink} />
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-1px", marginTop: 10 }}>{durStr(summary.durationSec)}</div>
          <div style={{ fontSize: 12, color: C.soft, marginTop: 4 }}>Total duration</div>
        </div>
        {inv && <>
          <Row label="Session amount" value={money(inv.base)} />
          <Row label={`Extra time${inv.extraMinutes ? ` ${inv.extraMinutes} min` : ""}`} value={money(inv.additional)} />
          {inv.gst > 0 && <Row label={`GST ${data.settings.gstPercent}%`} value={money(inv.gst)} />}
          <Row label="Total" value={money(inv.total)} strong />
          <Row label="Advance paid" value={money(inv.advance)} />
          <Row label="Balance to Pay" value={money(Math.max(0, inv.total - inv.advance))} strong />
        </>}
      </Sheet>
    );
  }

  const sess = runningSession(data, appt.id);
  const elapsed = sess ? Math.max(0, Math.floor((now - sess.startedAt) / 1000)) : 0;
  const bill = computeBill(elapsed, data.settings);
  const advancePaid = Number(appt.advance) || 0;

  return (
    <Sheet open onClose={onClose} title="End this session?"
      footer={<>
        <Btn full onClick={onClose}>Cancel</Btn>
        <Btn full kind="solid" onClick={() => { const r = act.endSession(appt.id); if (r) setSummary(r); }}>End Session</Btn>
      </>}>
      <div style={{ textAlign: "center", padding: "10px 0 20px" }}>
        <div style={{ fontSize: 12, color: C.soft }}>Duration</div>
        <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-1.2px", marginTop: 6 }}>{durStr(elapsed)}</div>
      </div>
      <Row label="Session amount" value={money(bill.base)} />
      <Row label={`Extra time${bill.extraMinutes ? ` ${bill.extraMinutes} min` : ""}`} value={money(bill.additional)} />
      {bill.gst > 0 && <Row label={`GST ${data.settings.gstPercent}%`} value={money(bill.gst)} />}
      <Row label="Total" value={money(bill.total)} strong />
      <Row label="Advance paid" value={money(advancePaid)} />
      <Row label="Balance to Pay" value={money(Math.max(0, bill.total - advancePaid))} strong />
      <div style={{ fontSize: 12, color: C.soft, marginTop: 14 }}>
        Ending the session stores the end time, calculates the bill and creates the invoice.
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------- edit a day's slots */
// Changing a specific date's slots doesn't touch the counsellor's regular
// recurring schedule — it's stored as a one-off override for that date.
// Dropping below 2 slots reads as reduced availability (half day / day
// off); Admin can attach a reason instead, which replaces that reading.
const DAY_EXCEPTION_PRESETS = ["Lunch", "Therapy meet", "Workshop"];

function EditDaySlotsSheet({ counsellor, date, onClose, data, act, user, onBookSlot }) {
  const [times, setTimes] = useState([]);
  const [newTime, setNewTime] = useState("");
  const [comment, setComment] = useState("");
  const isAdmin = user.role === "admin";

  useEffect(() => {
    if (counsellor) {
      setTimes(slotsForDate(counsellor, date));
      setNewTime("");
      setComment((counsellor.dayExceptions || {})[date]?.comment || "");
    }
  }, [counsellor, date]);

  if (!counsellor) return null;
  const sorted = [...times].sort();
  const preview = sorted.length === 0 ? "Full day off" : sorted.length === 1 ? "Half day" : "Working normally";
  const hasOverride = (counsellor.slotOverrides || {})[date] !== undefined;
  const apptAt = (t) => {
    // A slot's date+time+counsellor can have more than one historical
    // record (start/cancel/reschedule leaves the old one in place) — the
    // active booking, if any, always wins over an older cancelled one.
    const list = data.appointments.filter((a) => a.date === date && a.counsellorId === counsellor.id && a.time === t);
    return list.find((a) => a.status !== "Cancelled") || list[list.length - 1] || null;
  };

  const save = () => {
    act.setDaySlots(counsellor.id, date, times, isAdmin ? (comment.trim() || null) : undefined);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={`${counsellor.name} · ${shortDate(date)}`}
      footer={<><Btn full onClick={onClose}>Cancel</Btn><Btn full kind="solid" onClick={save}>Save</Btn></>}>
      <div style={{ fontSize: 12, color: C.soft, marginBottom: 16 }}>
        Editing just this date — {counsellor.name}'s regular recurring schedule stays the same.
      </div>

      <Field label="Slots for this day">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {sorted.length === 0 && <div style={{ fontSize: 13, color: C.faint }}>No slots — this reads as a full day off.</div>}
          {sorted.map((t) => {
            const appt = apptAt(t);
            const booked = appt && appt.status !== "Cancelled";
            const freedUp = appt && appt.status === "Cancelled";
            const client = appt ? data.clients.find((c) => c.id === appt.clientId) : null;
            return (
              <div key={t} style={{
                display: "flex", flexDirection: "column", gap: 4, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 12px",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  {to12(t)}
                  {!booked && (
                    <button onClick={() => setTimes(times.filter((x) => x !== t))} style={{ cursor: "pointer", display: "flex" }}>
                      <X size={13} strokeWidth={1.5} color={C.faint} />
                    </button>
                  )}
                </span>
                {booked && (
                  <span style={{ fontSize: 11, color: C.soft }}>Booked{client ? ` · ${client.name}` : ""}</span>
                )}
                {freedUp && (
                  <button onClick={() => { onBookSlot && onBookSlot(t); }} style={{
                    display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, cursor: "pointer",
                  }}>
                    <span style={{ fontSize: 11, color: RING_DONE_SOLID }}>Available — tap for new booking</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
          <Btn onClick={() => { if (!newTime || times.includes(newTime)) return; setTimes([...times, newTime]); setNewTime(""); }}>Add slot</Btn>
        </div>
      </Field>

      <div style={{
        border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", marginTop: 4, marginBottom: 4,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <CalendarOff size={16} strokeWidth={1.3} color={C.soft} />
        <div>
          <div style={{ fontSize: 13.5, color: C.ink }}>{preview}</div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>
            {sorted.length >= 2 ? "2 or more slots reads as a normal working day." : "Fewer than 2 slots reads as reduced availability."}
          </div>
        </div>
      </div>

      {isAdmin && sorted.length < 2 && (
        <div style={{ marginTop: 18 }}>
          <Field label="Reason (optional)" hint="Replaces the automatic Half day / Leave note with this instead.">
            <Input placeholder="e.g. Workshop" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: -6, marginBottom: 6 }}>
            {DAY_EXCEPTION_PRESETS.map((p) => (
              <button key={p} onClick={() => setComment(p)}
                style={{ fontSize: 12, padding: "7px 12px", borderRadius: 999, cursor: "pointer", border: `1px solid ${comment === p ? "#111" : C.line}`, background: comment === p ? "#111" : "#fff", color: comment === p ? "#fff" : C.mid }}>{p}</button>
            ))}
          </div>
        </div>
      )}

      {hasOverride && (
        <button onClick={() => { act.clearDaySlots(counsellor.id, date); onClose(); }}
          style={{ fontSize: 12.5, color: C.soft, cursor: "pointer", background: "none", border: "none", padding: "8px 0", marginTop: 4 }}>
          Reset to usual schedule for this date
        </button>
      )}
    </Sheet>
  );
}


function SessionsScreen({ data, user, now }) {
  const isDesktop = useIsWide(1024);
  const [status, setStatus] = useState("All");
  const [cid, setCid] = useState(user.role === "admin" ? "" : user.counsellorId);
  const [date, setDate] = useState(ymd(new Date()));
  const [anyDate, setAnyDate] = useState(false);

  const rows = data.appointments
    .filter((a) => (anyDate ? true : a.date === date))
    .filter((a) => (cid ? a.counsellorId === cid : true))
    .filter((a) => (user.role === "admin" ? true : a.counsellorId === user.counsellorId))
    .map((a) => {
      const s = sessionFor(data, a.id);
      const st = a.status === "Cancelled" ? "Cancelled" : s ? (s.endedAt ? "Completed" : "Running") : "Scheduled";
      return { a, s, st };
    })
    .filter((r) => (status === "All" ? true : r.st === status))
    .sort((x, y) => (x.a.date + x.a.time).localeCompare(y.a.date + y.a.time));

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <SegTabs value={status} onChange={setStatus} options={["All", "Running", "Scheduled", "Completed", "Cancelled"]} />
      <div style={{ display: "flex", gap: 10, margin: "14px 0 18px" }}>
        <Input type="date" value={date} disabled={anyDate} onChange={(e) => setDate(e.target.value)} style={{ opacity: anyDate ? 0.4 : 1 }} />
        <Btn size="sm" onClick={() => setAnyDate((v) => !v)}>{anyDate ? "All dates" : "By date"}</Btn>
      </div>
      {user.role === "admin" && (
        <div style={{ marginBottom: 18 }}>
          <GlassSelect value={cid} onChange={setCid}
            options={[{ value: "", label: "All counsellors" }, ...data.counsellors.map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
      )}

      {rows.length === 0 && <Empty text="No sessions match these filters." />}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr" }}>
        {rows.map(({ a, s, st }) => {
          const client = data.clients.find((c) => c.id === a.clientId);
          const coun = data.counsellors.find((c) => c.id === a.counsellorId);
          const inv = s && s.invoiceId ? data.invoices.find((i) => i.id === s.invoiceId) : null;
          const live = s && !s.endedAt ? Math.max(0, Math.floor((now - s.startedAt) / 1000)) : 0;
          return (
            <div key={a.id} style={{ border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 15 }}>{client ? client.name : "Client"}</span>
                <span style={{ fontSize: 12, color: C.soft }}>{st === "Running" ? clockStr(live) : st}</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.soft, marginTop: 5 }}>
                {coun ? coun.name : ""} · {shortDate(a.date)} · {to12(a.time)}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                {s && s.endedAt && <Chip>{durStr(s.durationSec)}</Chip>}
                {inv && <Chip>{money(inv.total)}</Chip>}
                {inv && <Chip>{inv.paymentStatus}</Chip>}
                {(a.category || a.type) && <Chip>{a.category || a.type}</Chip>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SegTabs({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          style={{
            fontSize: 13, padding: "8px 14px", borderRadius: 999, whiteSpace: "nowrap", cursor: "pointer",
            border: `1px solid ${value === o ? "#111" : C.line}`, background: value === o ? "#111" : "#fff",
            color: value === o ? "#fff" : C.mid,
          }}>{o}</button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------- clients screen */
function ClientsScreen({ data, act, user, go }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", age: "", phone: "", email: "", notes: "" });
  const list = data.clients.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.line}`, borderRadius: 12, padding: "0 12px", marginBottom: 20 }}>
        <Search size={16} strokeWidth={1.4} color={C.faint} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients"
          style={{ border: "none", outline: "none", padding: "11px 0", fontSize: 14, width: "100%", fontFamily: FONT }} />
      </div>

      <SectionLabel action={user.role === "admin" && <Pill icon={<Plus size={13} strokeWidth={1.6} />} onClick={() => { setForm({ name: "", age: "", phone: "", email: "", notes: "" }); setOpen(true); }}>Add client</Pill>}>
        Clients
      </SectionLabel>

      {list.length === 0 ? (
        <Empty text="No clients yet. Add one to start booking." />
      ) : (
        <GroupedCard>
          {list.map((c, i) => {
            const count = data.appointments.filter((a) => a.clientId === c.id).length;
            return (
              <GroupedRow key={c.id} first={i === 0}
                leading={<Avatar name={c.name} />}
                title={<>{c.name} <span style={{ fontSize: 12, color: C.soft, fontWeight: 400 }}>{c.age}</span></>}
                subtitle={`${c.phone || "No contact"} · ${count} appointment${count === 1 ? "" : "s"}`}
                onClick={() => go({ screen: "client", id: c.id })} />
            );
          })}
        </GroupedCard>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="Add client"
        footer={<><Btn full onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn full kind="solid" onClick={() => { if (!form.name.trim()) return; act.addClient(form); setOpen(false); }}>Save client</Btn></>}>
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Age"><Input inputMode="numeric" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </Sheet>
    </div>
  );
}

function ClientDetail({ data, act, id, user }) {
  const c = data.clients.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState(c || {});
  if (!c) return <Empty text="This client no longer exists." />;
  const appts = data.appointments.filter((a) => a.clientId === id).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const invs = data.invoices.filter((i) => i.clientId === id);
  const paid = invs.filter((i) => i.paymentStatus === "Paid").reduce((s, i) => s + i.total, 0);
  const outstanding = invs.filter((i) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Refunded").reduce((s, i) => s + (i.total - i.advance), 0);

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <div style={{ fontSize: 22, letterSpacing: "-0.3px" }}>{c.name}</div>
      <div style={{ fontSize: 13, color: C.soft, marginTop: 4, marginBottom: 20 }}>{c.age} years · {c.phone || "No contact"}</div>

      <Row label="Sessions booked" value={appts.length} />
      <Row label="Total paid" value={money(paid)} />
      <Row label="Outstanding" value={money(outstanding)} />
      {c.email && <Row label="Email" value={c.email} />}
      {c.notes && <Row label="Notes" value={c.notes} />}

      {user.role === "admin" && (
        <div style={{ marginTop: 18 }}><Btn full onClick={() => { setForm(c); setEdit(true); }}>Edit client</Btn></div>
      )}

      <div style={{ fontSize: 13, color: C.soft, margin: "26px 0 12px" }}>History</div>
      {appts.length === 0 && <Empty text="No sessions yet." />}
      <div style={{ display: "grid", gap: 10 }}>
        {appts.map((a) => {
          const s = sessionFor(data, a.id);
          const coun = data.counsellors.find((x) => x.id === a.counsellorId);
          const inv = s && s.invoiceId ? data.invoices.find((i) => i.id === s.invoiceId) : null;
          return (
            <div key={a.id} style={{ border: `1px solid ${C.line}`, borderRadius: 16, padding: "13px 15px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14 }}>{shortDate(a.date)} · {to12(a.time)}</span>
                <span style={{ fontSize: 12, color: C.soft }}>{coun ? coun.name : ""}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
                <Chip>{a.status === "Cancelled" ? "Cancelled" : s ? (s.endedAt ? "Completed" : "Running") : "Scheduled"}</Chip>
                {s && s.endedAt && <Chip>{durStr(s.durationSec)}</Chip>}
                {inv && <Chip>{money(inv.total)}</Chip>}
                {inv && <Chip>{inv.paymentStatus}</Chip>}
              </div>
            </div>
          );
        })}
      </div>

      <Sheet open={edit} onClose={() => setEdit(false)} title="Edit client"
        footer={<><Btn full onClick={() => setEdit(false)}>Cancel</Btn>
          <Btn full kind="solid" onClick={() => { act.updateClient(id, form); setEdit(false); }}>Save changes</Btn></>}>
        <Field label="Name"><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Age"><Input value={form.age || ""} onChange={(e) => setForm({ ...form, age: e.target.value })} /></Field>
        <Field label="Phone"><Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email"><Input value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Notes"><Input value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------- invoices screen */
function InvoicesScreen({ data, act, user }) {
  const isDesktop = useIsWide(1024);
  const [status, setStatus] = useState("All");
  const [open, setOpen] = useState(null);
  const list = data.invoices
    .filter((i) => (user.role === "admin" ? true : i.counsellorId === user.counsellorId))
    .filter((i) => (status === "All" ? true : i.paymentStatus === status))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <SegTabs value={status} onChange={setStatus} options={["All", "Pending", "Partially Paid", "Paid", "Refunded"]} />
      <div style={{ height: 16 }} />
      {list.length === 0 && <Empty text="Invoices appear here once a session ends." />}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr" }}>
        {list.map((i) => {
          const client = data.clients.find((c) => c.id === i.clientId);
          const coun = data.counsellors.find((c) => c.id === i.counsellorId);
          return (
            <button key={i.id} onClick={() => setOpen(i.id)}
              style={{ textAlign: "left", border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px", background: "#fff", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 15 }}>{client ? client.name : "Client"}</span>
                <span style={{ fontSize: 15, fontWeight: 500 }}>{money(i.total)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ fontSize: 12.5, color: C.soft }}>{i.number} · {coun ? coun.name : ""} · {shortDate(i.sessionDate)}</span>
                <span style={{ fontSize: 12, color: C.soft }}>{i.paymentStatus}</span>
              </div>
            </button>
          );
        })}
      </div>
      <InvoiceSheet id={open} onClose={() => setOpen(null)} data={data} act={act} isAdmin={user.role === "admin"} />
    </div>
  );
}

function InvoiceSheet({ id, onClose, data, act, isAdmin }) {
  if (!id) return null;
  const i = data.invoices.find((x) => x.id === id);
  if (!i) return null;
  const client = data.clients.find((c) => c.id === i.clientId);
  const coun = data.counsellors.find((c) => c.id === i.counsellorId);

  const text = [
    `NURORA — Invoice ${i.number}`, `Date: ${shortDate(i.date)}`, ``,
    `Client: ${client ? client.name : ""}`, `Counsellor: ${coun ? coun.name : ""}`,
    `Session date: ${shortDate(i.sessionDate)}`,
    `Start: ${new Date(i.startedAt).toLocaleTimeString()}`, `End: ${new Date(i.endedAt).toLocaleTimeString()}`,
    `Duration: ${durStr(i.durationSec)}`, ``,
    `Base fee: ${money(i.base)}`, `Additional fee: ${money(i.additional)}`,
    i.gst ? `GST: ${money(i.gst)}` : null, `Total: ${money(i.total)}`,
    `Advance paid: ${money(i.advance)}`, `Payment status: ${i.paymentStatus}`,
  ].filter(Boolean).join("\n");

  const download = () => {
    try {
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${i.number}.txt`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { navigator.clipboard && navigator.clipboard.writeText(text); }
  };
  const share = () => {
    if (navigator.share) navigator.share({ title: i.number, text }).catch(() => { });
    else if (navigator.clipboard) navigator.clipboard.writeText(text);
  };

  return (
    <Sheet open onClose={onClose} title={i.number}
      footer={<>
        <Btn full onClick={download} icon={<Download size={15} strokeWidth={1.4} />}>Download</Btn>
        <Btn full onClick={share} icon={<Share2 size={15} strokeWidth={1.4} />}>Share</Btn>
      </>}>
      <Row label="Client" value={client ? client.name : "—"} />
      <Row label="Counsellor" value={coun ? coun.name : "—"} strong />
      <Row label="Session date" value={shortDate(i.sessionDate)} />
      <Row label="Started" value={new Date(i.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
      <Row label="Ended" value={new Date(i.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
      <Row label="Duration" value={durStr(i.durationSec)} />
      <Row label="Base fee" value={money(i.base)} />
      <Row label="Additional fee" value={money(i.additional)} />
      {i.gst > 0 && <Row label={`GST ${data.settings.gstPercent}%`} value={money(i.gst)} />}
      <Row label="Advance paid" value={money(i.advance)} />
      <Row label="Total" value={money(i.total)} strong />
      <Row label="Payment" value={i.paymentStatus} />
      {isAdmin && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 8 }}>Update payment status</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["Pending", "Partially Paid", "Paid", "Refunded"].map((s) => (
              <button key={s} onClick={() => act.setPayment(i.id, s)}
                style={{
                  fontSize: 13, padding: "9px 13px", borderRadius: 12, cursor: "pointer",
                  border: `1px solid ${i.paymentStatus === s ? "#111" : C.line}`,
                  background: i.paymentStatus === s ? "#111" : "#fff", color: i.paymentStatus === s ? "#fff" : C.mid,
                }}>{s}</button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* ----------------------------------------------------------- more screen */
function MoreScreen({ user, go, act, data }) {
  const myC = data.counsellors.find((c) => c.id === user.counsellorId);
  const items = user.role === "admin"
    ? [["counsellors", "Nurora Roster\u2019s", Users], ["nulancers", "NuLancers", Users], ["leaves", "Leave & week offs", CalendarOff], ["interestBooked", "Interest & Booked", FileText], ["reports", "Reports", BarChart3], ["settings", "Settings", SettingsIcon]]
    : user.isNuLancer && !(myC && myC.isOwner)
      ? [["salary", "Salary", Tag]]
      : [];
  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <GroupedCard>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px" }}>
          <Avatar name={user.name} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, color: C.ink }}>{user.name}</div>
            <div style={{ fontSize: 12.5, color: C.soft, marginTop: 3 }}>{user.role === "admin" ? "Administrator" : user.isNuLancer ? "NuLancer" : "Counsellor"}</div>
          </div>
          <Chip>Active</Chip>
        </div>
      </GroupedCard>

      <div style={{ height: 22 }} />
      {items.length > 0 && (
        <>
          <SectionLabel>{user.role === "admin" ? "Manage" : "Account"}</SectionLabel>
          <GroupedCard>
            {items.map(([k, label, Icon], idx) => (
              <GroupedRow key={k} first={idx === 0}
                leading={<IconSquircle><Icon size={17} strokeWidth={1.3} color={C.mid} /></IconSquircle>}
                title={label}
                onClick={() => go({ screen: k, id: user.counsellorId })} />
            ))}
          </GroupedCard>
        </>
      )}
      <div style={{ marginTop: 18 }}>
        <Btn full onClick={act.logout} icon={<LogOut size={15} strokeWidth={1.4} />}>Sign out</Btn>
      </div>
      <div style={{ textAlign: "center", fontSize: 11, color: C.faint, marginTop: 22 }}>Nurora · {data.counsellors.length} counsellors · {data.clients.length} clients</div>
    </div>
  );
}

/* --------------------------------------------------------- counsellors */
function NewCounsellorSheet({ open, onClose, data, act, defaultNuLancer, onCreated }) {
  const blankForm = () => ({
    type: defaultNuLancer ? "NuLancer" : "Resource",
    name: "", role: defaultNuLancer ? "NuLancer" : "Counsellor",
    probationFrom: ymd(new Date()), probationTo: (() => { const d = new Date(); d.setDate(d.getDate() + 90); return ymd(d); })(),
  });
  const [form, setForm] = useState(blankForm());
  useEffect(() => { if (open) setForm(blankForm()); }, [open]);
  if (!open) return null;
  const isOwnerType = form.type === "Owner";
  const isNuLancerType = form.type === "NuLancer";

  const submit = () => {
    if (!form.name.trim()) return;
    act.addCounsellor({ ...form, isNuLancer: isNuLancerType, isOwner: isOwnerType, role: isOwnerType ? "Owner" : form.role });
    onClose();
    if (onCreated) onCreated();
  };

  return (
    <Sheet open onClose={onClose} title="New Counsellor"
      footer={<><Btn full onClick={onClose}>Cancel</Btn>
        <Btn full kind="solid" onClick={submit}>{isOwnerType ? "Save" : "Create TPIN"}</Btn></>}>
      <Field label="Counsellor Type">
        <div style={{ display: "flex", gap: 8 }}>
          {["Resource", "NuLancer", "Owner"].map((t) => (
            <button key={t} onClick={() => setForm({ ...form, type: t })} style={{
              flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, cursor: "pointer",
              border: `1.5px solid ${form.type === t ? "#111" : C.line}`,
              background: form.type === t ? "#111" : "#fff", color: form.type === t ? "#fff" : C.ink, fontWeight: 500,
            }}>{t}</button>
          ))}
        </div>
      </Field>
      <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      {!isOwnerType && (
        <Field label="Role"><Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
      )}

      {isOwnerType ? (
        <div style={{ fontSize: 12, color: C.soft, marginTop: 6 }}>
          Owners sign in on their own PIN directly — no TPIN, probation, or signup agreement needed.
        </div>
      ) : (
        <>
          <div style={{ height: 6 }} />
          <SectionLabel>Probation Period</SectionLabel>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            <div style={{ flex: "0 1 150px", minWidth: 0 }}>
              <Field label="From"><Input type="date" value={form.probationFrom} onChange={(e) => setForm({ ...form, probationFrom: e.target.value })} style={{ padding: "8px 10px", fontSize: 13 }} /></Field>
            </div>
            <div style={{ flex: "0 1 150px", minWidth: 0 }}>
              <Field label="To"><Input type="date" value={form.probationTo} onChange={(e) => setForm({ ...form, probationTo: e.target.value })} style={{ padding: "8px 10px", fontSize: 13 }} /></Field>
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.soft }}>
            "Create TPIN" generates their temporary sign-in PIN for this window. Everything else — DOB, mobile, Aadhar, date of joining, the signup agreement — can be filled in afterward, either by you from their profile or by them from their own avatar in the drawer.
          </div>
        </>
      )}
    </Sheet>
  );
}

function SelectCounsellorsSheet({ open, onClose, data, go, onNavigate }) {
  if (!open) return null;
  const jumpTo = (id) => { onClose(); if (onNavigate) onNavigate(); go({ screen: "counsellor", id }); };
  return (
    <Sheet open onClose={onClose} title="Select Counsellors">
      <div style={{ fontSize: 12, color: C.soft, marginBottom: 16 }}>
        <span style={{ color: "#d64550", fontWeight: 600 }}>Red</span> — still on TPIN. <span style={{ color: "#4fa876", fontWeight: 600 }}>Green</span> — MPIN registered.
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {data.counsellors.filter((c) => !c.isOwner).map((c) => (
          <button key={c.id} onClick={() => jumpTo(c.id)} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12,
            border: `1px solid ${C.line}`, background: "#fff", cursor: "pointer", textAlign: "left",
          }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: c.accountStatus === "mpin" ? "#4fa876" : "#d64550", flexShrink: 0 }} />
            <span style={{ fontSize: 13.5, color: C.ink, flex: 1 }}>{c.name}</span>
            <span style={{ fontSize: 11.5, color: C.faint }}>{c.isNuLancer ? "NuLancer" : "Resource"}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function CounsellorsScreen({ data, act, go, nuLancerMode }) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const list = data.counsellors.filter((c) => !!c.isNuLancer === !!nuLancerMode);

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <SectionLabel action={<Pill icon={<Plus size={13} strokeWidth={1.6} />} onClick={() => setOpen(true)}>New Counsellor</Pill>}>
        {nuLancerMode ? "NuLancers" : "Nurora Roster’s"}
      </SectionLabel>
      {nuLancerMode && (
        <div style={{ fontSize: 12.5, color: C.soft, marginTop: -8, marginBottom: 16 }}>
          Freelancers who pick up individual sessions — not part of the regular team, no team chat, and they only see their own bookings.
        </div>
      )}
      <div style={{ marginBottom: 16 }}>
        <Pill icon={<Users size={13} strokeWidth={1.6} />} onClick={() => setPickerOpen(true)}>Select Counsellors</Pill>
      </div>
      {list.length === 0 ? (
        <Empty text={nuLancerMode ? "No NuLancers added yet." : "No counsellors yet."} />
      ) : (
        <GroupedCard>
          {list.map((c, i) => (
            <GroupedRow key={c.id} first={i === 0}
              leading={<StatusAvatar name={c.name} photo={c.photo} accountStatus={c.accountStatus} isOwner={c.isOwner} />}
              title={c.name}
              subtitle={`${c.role} · ${c.slots.length ? `${c.slots.length} slots` : "No slots set"}${c.accountStatus === "tpin" ? " · On TPIN" : ""}`}
              trailing={!c.active && <Chip>Inactive</Chip>}
              strongTitle
              onClick={() => go({ screen: "counsellor", id: c.id })} />
          ))}
        </GroupedCard>
      )}
      <SelectCounsellorsSheet open={pickerOpen} onClose={() => setPickerOpen(false)} data={data} go={go} />
      <NewCounsellorSheet open={open} onClose={() => setOpen(false)} data={data} act={act} defaultNuLancer={nuLancerMode} />
    </div>
  );
}

function CounsellorDetail({ data, act, id, user, go }) {
  const c = data.counsellors.find((x) => x.id === id);
  const isAdmin = user.role === "admin";
  const canManageOwn = isAdmin || (user.role === "resource" && user.counsellorId === id);
  const [slot, setSlot] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dayLeaveTarget, setDayLeaveTarget] = useState(null); // { date, existing } | null
  const [holidaySheetOpen, setHolidaySheetOpen] = useState(false);
  const [businessPhoneDraft, setBusinessPhoneDraft] = useState("");
  if (!c) return <Empty text="This counsellor no longer exists." />;
  const leaves = data.leaves.filter((l) => l.counsellorId === id).sort((a, b) => a.from.localeCompare(b.from));
  const upd = (patch) => act.updateCounsellor(id, patch);
  const apptCount = data.appointments.filter((a) => a.counsellorId === id).length;
  const thisMonth = ymd(new Date()).slice(0, 7);
  const quota = weekOffQuotaForMonth(thisMonth);
  const usedThisMonth = leaveUnitsUsedInMonth(data, id, thisMonth, null);
  const remaining = Math.max(0, quota - usedThisMonth);
  const weekOffsThisMonth = weekOffLeaveCountInMonth(data, id, thisMonth);
  const lopThisMonth = lopLeaveCountInMonth(data, id, thisMonth);
  const holidaysThisMonth = (data.holidays || []).filter((h) => monthKeyOf(h.date) === thisMonth).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <GroupedCard>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px" }}>
          <StatusAvatar name={c.name} size={44} photo={c.photo} accountStatus={c.accountStatus} isOwner={c.isOwner} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0a0a0a" }}>{c.name}</div>
            <div style={{ fontSize: 12.5, color: C.soft, marginTop: 3 }}>{c.role}</div>
          </div>
          <Chip>{c.active ? "Active" : "Inactive"}</Chip>
        </div>
      </GroupedCard>

      {isAdmin && !c.isOwner && c.accountStatus === "mpin" && !c.agreementSignedAt && (
        <div style={{ marginTop: 24, padding: "12px 14px", borderRadius: 12, background: "#fdecea", border: "1px solid #f3c6c0" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#b42318", marginBottom: 3 }}>Never actually signed up</div>
          <div style={{ fontSize: 12, color: "#b42318", lineHeight: 1.5 }}>
            {c.name} has full access but was previously an Owner, so they were never issued a TPIN and never went through the signup agreement. Use "Allocate re-signup" below if you want them to go through it properly.
          </div>
        </div>
      )}

      {isAdmin && (
        <>
          <div style={{ height: 24 }} />
          <SectionLabel>Account &amp; Permissions</SectionLabel>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0 12px" }}>
              <div>
                <div style={{ fontSize: 13.5, color: C.ink, fontWeight: 500 }}>Owner</div>
                <div style={{ fontSize: 11.5, color: C.soft, marginTop: 2 }}>Skips TPIN/MPIN signup, signs in on their own PIN directly. No leave or salary options.</div>
              </div>
              <button onClick={() => {
                const turningOn = !c.isOwner;
                upd({ isOwner: turningOn, permissions: { ...(c.permissions || {}), ...(turningOn ? { weekoffs: false } : {}) } });
              }} style={{
                width: 44, height: 26, borderRadius: 999, background: c.isOwner ? RING_DONE_SOLID : C.ghost,
                border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: 3, flexShrink: 0, marginLeft: 12,
              }}>
                <span style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", marginLeft: c.isOwner ? 18 : 0, transition: "margin .2s" }} />
              </button>
            </div>
            {!c.isOwner && (
              <>
                <div style={{ borderTop: `1px solid ${C.hair}`, paddingTop: 12, marginBottom: 4 }} />
                <Row label="Status" value={c.accountStatus === "mpin" ? "Fully signed up (MPIN)" : "On probation (TPIN)"} strong />
                {c.accountStatus === "tpin" ? (
                  <>
                    <Row label="TPIN" value={c.tpin || "—"} />
                    <div style={{ marginTop: 10, marginBottom: 4 }}>
                      <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>Probation period</div>
                      <div style={{ display: "flex", gap: 24 }}>
                        <div style={{ flex: "0 1 150px", minWidth: 0 }}><Input type="date" value={c.probationFrom || ""} onChange={(e) => upd({ probationFrom: e.target.value })} style={{ padding: "8px 10px", fontSize: 13 }} /></div>
                        <div style={{ flex: "0 1 150px", minWidth: 0 }}><Input type="date" value={c.probationTo || ""} onChange={(e) => upd({ probationTo: e.target.value })} style={{ padding: "8px 10px", fontSize: 13 }} /></div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <Btn full onClick={() => {
                        const newTpin = String(Math.floor(1000 + Math.random() * 9000));
                        const d = new Date(); d.setDate(d.getDate() + 90);
                        upd({ tpin: newTpin, probationFrom: ymd(new Date()), probationTo: ymd(d) });
                      }}>Issue new TPIN</Btn>
                    </div>
                  </>
                ) : (
                  <>
                    <Row label="MPIN" value={c.mpin || "—"} />
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <Btn full onClick={() => {
                        if (!confirm(`Reset ${c.name}'s access? They'll need to redo the full signup to get a new MPIN.`)) return;
                        const newTpin = String(Math.floor(1000 + Math.random() * 9000));
                        const d = new Date(); d.setDate(d.getDate() + 90);
                        upd({ accountStatus: "tpin", mpin: null, tpin: newTpin, probationFrom: ymd(new Date()), probationTo: ymd(d), agreementSignedAt: null });
                      }}>Allocate re-signup</Btn>
                    </div>
                    <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>
                      Use this when they request renewed access after their 7-day agreement view window has passed.
                    </div>
                  </>
                )}
              </>
            )}
            {c.isOwner && (
              <div style={{ borderTop: `1px solid ${C.hair}`, paddingTop: 12 }}>
                <Row label="PIN" value={c.pin || "—"} />
              </div>
            )}
            <Row label="Personal Phone" value={c.personalPhone || "Not added yet"} />
            <Row label="Business Phone" value={c.businessPhone || "Not added yet"} />
            <Row label="Blood Group" value={c.bloodGroup || "—"} />
            <Row label="Date of Birth" value={c.dob ? `${shortDate(c.dob)}${ageFromDob(c.dob) != null ? ` (age ${ageFromDob(c.dob)})` : ""}` : "Not added yet"} />
            <Row label="Aadhar" value={c.aadharImage ? "Uploaded" : "Not added yet"} />
            <Row label="Date of Joining" value={c.dateOfJoining ? `${shortDate(c.dateOfJoining)}${experienceFromDoj(c.dateOfJoining) ? ` (${experienceFromDoj(c.dateOfJoining)})` : ""}` : "Not added yet"} />
            {!c.businessPhone && (
              <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <Field label="Add Business Phone No."><Input inputMode="tel" value={businessPhoneDraft} onChange={(e) => setBusinessPhoneDraft(e.target.value)} /></Field>
                </div>
                <Btn disabled={!businessPhoneDraft.trim()} onClick={() => { upd({ businessPhone: businessPhoneDraft.trim() }); setBusinessPhoneDraft(""); }}>Save</Btn>
              </div>
            )}
          </div>

          <div style={{ border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px" }}>
            <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 10 }}>What this counsellor can access — Schedule is always on for everyone.</div>
            {[
              ["attendance", "Attendance"], ["nubills", "Nubills"], ["personas", "Persona"], ["bric", "BRIC"],
              ["reviews", "Google Reviews"], ["followups", "Follow-up & Commitments"], ["mysummary", "My Summary"], ["weekoffs", "Week-offs and Leave"],
            ].map(([key, label]) => {
              const enabled = (c.permissions || {})[key] !== false;
              const lockedOff = c.isOwner && key === "weekoffs";
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.hair}` }}>
                  <span style={{ fontSize: 13.5, color: lockedOff ? C.faint : C.ink }}>{label}{lockedOff ? " (owner — no leave)" : ""}</span>
                  <button disabled={lockedOff} onClick={() => upd({ permissions: { ...(c.permissions || {}), [key]: !enabled } })} style={{
                    width: 40, height: 24, borderRadius: 999, background: enabled && !lockedOff ? RING_DONE_SOLID : C.ghost,
                    border: "none", cursor: lockedOff ? "default" : "pointer", display: "flex", alignItems: "center", padding: 3, opacity: lockedOff ? 0.5 : 1,
                  }}>
                    <span style={{ width: 18, height: 18, borderRadius: 999, background: "#fff", marginLeft: enabled && !lockedOff ? 16 : 0, transition: "margin .2s" }} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ height: 24 }} />
      <SectionLabel action={isAdmin && (
        <button onClick={() => upd({ workHoursEnabled: !(c.workHoursEnabled !== false) })} style={{
          width: 40, height: 24, borderRadius: 999, background: c.workHoursEnabled !== false ? RING_DONE_SOLID : C.ghost,
          border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: 3,
        }}>
          <span style={{ width: 18, height: 18, borderRadius: 999, background: "#fff", marginLeft: c.workHoursEnabled !== false ? 16 : 0, transition: "margin .2s" }} />
        </button>
      )}>Working hours</SectionLabel>
      {isAdmin && c.workHoursEnabled === false && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: -6, marginBottom: 10 }}>
          Disabled — no early/late flagging on Attendance for {c.isNuLancer ? "this NuLancer" : "this counsellor"}.
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, opacity: c.workHoursEnabled === false ? 0.4 : 1 }}>
        <Input type="time" value={c.workStart} disabled={!isAdmin || c.workHoursEnabled === false} onChange={(e) => upd({ workStart: e.target.value })} />
        <Input type="time" value={c.workEnd} disabled={!isAdmin || c.workHoursEnabled === false} onChange={(e) => upd({ workEnd: e.target.value })} />
      </div>

      <SectionLabel>Appointment slots</SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {c.slots.length === 0 && <div style={{ fontSize: 13, color: C.faint }}>No slots configured yet.</div>}
        {c.slots.map((t) => (
          <span key={t} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 12px", fontSize: 13 }}>
            {to12(t)}
            {isAdmin && <button onClick={() => upd({ slots: c.slots.filter((x) => x !== t) })} style={{ cursor: "pointer", display: "flex" }}>
              <X size={13} strokeWidth={1.5} color={C.faint} />
            </button>}
          </span>
        ))}
      </div>
      {isAdmin && (
        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          <Input type="time" value={slot} onChange={(e) => setSlot(e.target.value)} />
          <Btn onClick={() => { if (!slot || c.slots.includes(slot)) return; upd({ slots: [...c.slots, slot].sort() }); setSlot(""); }}>Add slot</Btn>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.soft }}>Week off</div>
        {isAdmin && <Pill icon={<Plus size={13} strokeWidth={1.6} />} onClick={() => setHolidaySheetOpen(true)}>Holiday</Pill>}
      </div>
      <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 12 }}>
        {getMonthWeeks(thisMonth).length} weeks this Month
      </div>
      <div style={{ fontSize: 13, color: C.ink, marginBottom: 14 }}>
        Tap a date to apply leave — past dates can't be changed.
      </div>
      <WeekOffStrip monthKey={thisMonth} data={data} counsellorId={id} canManage={canManageOwn}
        onDayTap={(date, existing) => setDayLeaveTarget({ date, existing })} />
      <div style={{ height: 10 }} />
      <LeaveLegend />

      {holidaysThisMonth.length > 0 && (
        <>
          <div style={{ height: 6 }} />
          <GroupedCard>
            {holidaysThisMonth.map((h, i) => (
              <GroupedRow key={h.id} first={i === 0} chevron={false}
                leading={<IconSquircle><Flag size={15} strokeWidth={1.4} color={C.mid} /></IconSquircle>}
                title={h.label || h.type}
                subtitle={`${shortDate(h.date)} · ${h.type}`}
                trailing={isAdmin && (
                  <button onClick={() => act.removeHoliday(h.id)} style={{ cursor: "pointer", display: "flex" }}>
                    <Trash2 size={14} strokeWidth={1.3} color={C.faint} />
                  </button>
                )} />
            ))}
          </GroupedCard>
        </>
      )}

      <div style={{ height: 26 }} />
      <SectionLabel>Leave</SectionLabel>
      <GroupedCard>
        <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: C.soft }}>Paid leave used this month</span>
          <span style={{ fontSize: 14 }}>{fmtDays(usedThisMonth)} of {fmtDays(quota)}</span>
        </div>
        <div style={{ padding: "0 16px 13px", fontSize: 12, color: C.faint }}>
          {remaining > 0
            ? `${fmtDays(remaining)} remaining. Two half-days count as one day.`
            : "Quota used up. Further leave this month is recorded as LOP (loss of pay)."}
        </div>
        <div style={{ padding: "0 16px 13px", display: "flex", gap: 18 }}>
          <span style={{ fontSize: 12, color: C.mid }}><span style={{ fontWeight: 700, color: C.ink }}>{weekOffsThisMonth}</span> week-off{weekOffsThisMonth === 1 ? "" : "s"}</span>
          <span style={{ fontSize: 12, color: C.mid }}><span style={{ fontWeight: 700, color: "#b42318" }}>{lopThisMonth}</span> LOP</span>
          <span style={{ fontSize: 12, color: C.mid }}><span style={{ fontWeight: 700, color: C.ink }}>{holidaysThisMonth.length}</span> holiday{holidaysThisMonth.length === 1 ? "" : "s"}</span>
        </div>
      </GroupedCard>

      <div style={{ height: 12 }} />
      {leaves.length === 0 ? (
        <div style={{ fontSize: 13, color: C.faint, padding: "4px 2px" }}>No leave recorded.</div>
      ) : (
        <GroupedCard>
          {leaves.map((l, i) => {
            const lop = l.lopUnits ?? 0;
            const paid = l.paidUnits ?? leaveUnits(l);
            const status = l.type === "Paid-off" ? "Paid-off" : lop <= 0 ? "Week off" : paid <= 0 ? "LOP" : "Partly LOP";
            return (
              <GroupedRow key={l.id} first={i === 0}
                leading={<IconSquircle><CalendarOff size={16} strokeWidth={1.3} color={C.mid} /></IconSquircle>}
                title={`${status}${l.half ? " · Half day" : ""}`}
                subtitle={`${shortDate(l.from)}${l.from !== l.to ? ` – ${shortDate(l.to)}` : ""}`}
                trailing={
                  canManageOwn && <button onClick={(e) => { e.stopPropagation(); act.removeLeave(l.id); }} style={{ cursor: "pointer", display: "flex" }}><Trash2 size={15} strokeWidth={1.3} color={C.faint} /></button>
                } />
            );
          })}
        </GroupedCard>
      )}

      {isAdmin && (
        <div style={{ marginTop: 22, display: "grid", gap: 10 }}>
          <Btn full kind="danger" onClick={() => act.setCounsellorActive(id, !c.active)}>{c.active ? "Mark as inactive" : "Reactivate counsellor"}</Btn>

          {!confirmDelete ? (
            <Btn full kind="danger" onClick={() => setConfirmDelete(true)} icon={<Trash2 size={15} strokeWidth={1.4} />}>
              Delete counsellor
            </Btn>
          ) : (
            <div style={{ border: `1px solid #f3c6c0`, background: "#fdecea", borderRadius: 14, padding: "13px 15px" }}>
              <div style={{ fontSize: 13, color: "#7a2016", marginBottom: 4 }}>Delete {c.name} permanently?</div>
              <div style={{ fontSize: 12, color: "#8a3a30", marginBottom: 12 }}>
                {apptCount > 0
                  ? `This counsellor has ${apptCount} appointment${apptCount === 1 ? "" : "s"} on record. Their name will show as removed on those, but the history stays.`
                  : "This can't be undone."}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn full onClick={() => setConfirmDelete(false)}>Cancel</Btn>
                <Btn full kind="danger" onClick={() => { act.deleteCounsellor(id); go && go({ screen: "counsellors" }); }}>
                  Yes, delete
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}

      <DayLeaveSheet open={!!dayLeaveTarget} date={dayLeaveTarget?.date} existing={dayLeaveTarget?.existing}
        onClose={() => setDayLeaveTarget(null)} act={act} counsellorId={id} />
      {isAdmin && <HolidaySheet open={holidaySheetOpen} onClose={() => setHolidaySheetOpen(false)} act={act} />}
    </div>
  );
}

function LeaveApplySheet({ open, onClose, lf, setLf, data, act, counsellorId }) {
  if (!open) return null;
  const mk = monthKeyOf(lf.from);
  const quota = weekOffQuotaForMonth(mk);
  const used = leaveUnitsUsedInMonth(data, counsellorId, mk, null);
  const units = leaveUnits(lf);
  const isPaidOff = lf.type === "Paid-off";
  const { paidUnits, lopUnits } = isPaidOff ? { paidUnits: units, lopUnits: 0 } : splitPaidLop(used, units, quota);

  return (
    <Sheet open={open} onClose={onClose} title="Apply for leave"
      footer={<><Btn full onClick={onClose}>Cancel</Btn>
        <Btn full kind="solid" onClick={() => { act.addLeave({ ...lf, counsellorId }); onClose(); }}>Save leave</Btn></>}>
      <Field label="Type" hint={isPaidOff ? "A designated paid day off. Always paid, doesn't use the monthly quota." : "Counts against the monthly paid-leave quota."}>
        <GlassSelect value={lf.type} onChange={(v) => setLf({ ...lf, type: v })} options={["Leave", "Paid-off"]} />
      </Field>
      <Field label="From"><Input type="date" value={lf.from} onChange={(e) => setLf({ ...lf, from: e.target.value, to: e.target.value > lf.to ? e.target.value : lf.to })} /></Field>
      <Field label="To"><Input type="date" value={lf.to} onChange={(e) => setLf({ ...lf, to: e.target.value })} /></Field>
      <button onClick={() => setLf({ ...lf, half: !lf.half })}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 0 18px", cursor: "pointer", background: "none", border: "none" }}>
        <span style={{ fontSize: 14 }}>Half day</span>
        <span style={{ width: 44, height: 26, borderRadius: 999, background: lf.half ? "#111" : C.ghost, display: "flex", alignItems: "center", padding: 3 }}>
          <span style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", marginLeft: lf.half ? 18 : 0, transition: "margin .2s" }} />
        </span>
      </button>

      <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px" }}>
        <Row label="This request" value={fmtDays(units)} />
        {isPaidOff ? (
          <Row label="Status" value="Paid off · outside quota" strong />
        ) : (
          <>
            <Row label="Used before this" value={fmtDays(used)} />
            <Row label="Paid from quota" value={fmtDays(paidUnits)} />
            <Row label="LOP (unpaid)" value={fmtDays(lopUnits)} strong={lopUnits > 0} />
          </>
        )}
        {lopUnits > 0 && (
          <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>
            This month's {fmtDays(quota)} quota is used up, so {fmtDays(lopUnits)} of this leave will be unpaid.
          </div>
        )}
      </div>
    </Sheet>
  );
}

function LeavesScreen({ data, act, go }) {
  const thisMonth = ymd(new Date()).slice(0, 7);
  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <SectionLabel>Leave &amp; week offs</SectionLabel>
      <GroupedCard>
        {data.counsellors.map((c, i) => {
          const ls = data.leaves.filter((l) => l.counsellorId === c.id);
          const woCount = weekOffLeaveCountInMonth(data, c.id, thisMonth);
          return (
            <GroupedRow key={c.id} first={i === 0}
              leading={<Avatar name={c.name} />}
              title={c.name}
              subtitle={`${woCount} week-off${woCount === 1 ? "" : "s"} this month · ${ls.length} leave record${ls.length === 1 ? "" : "s"}`}
              strongTitle
              onClick={() => go({ screen: "counsellor", id: c.id })} />
          );
        })}
      </GroupedCard>
    </div>
  );
}

/* -------------------------------------------------------------- attendance */
function durHM(startMs, endMs) {
  const secs = Math.max(0, Math.floor((endMs - startMs) / 1000));
  return durStr(secs);
}
// Minutes since midnight, in the person's local time — used to compare an
// actual check-in/out timestamp against the counsellor's "HH:MM" shift times.
function minutesOfDay(ms) { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); }
function minutesFromHHMM(hhmm) { const [h, m] = (hhmm || "0:0").split(":").map(Number); return h * 60 + m; }
function fmtMins(n) { const h = Math.floor(n / 60); const m = n % 60; return h > 0 ? `${h}h ${m}m` : `${m}m`; }

function AttendanceScreen({ data, act, user }) {
  const isAdmin = user.role === "admin";
  const [date, setDate] = useState(ymd(new Date()));
  const [reportYear, setReportYear] = useState(Number(ymd(new Date()).slice(0, 4)));
  const [yearPickerOpen, setYearPickerOpen] = useState(false);

  if (isAdmin) {
    const rows = data.counsellors.filter((c) => c.active).map((c) => ({
      c, rec: (data.attendance || []).find((a) => a.counsellorId === c.id && a.date === date),
    }));
    const todayKeyAtt = ymd(new Date());
    const missedToday = date === todayKeyAtt ? data.counsellors.filter((c) =>
      data.appointments.some((a) => a.counsellorId === c.id && a.date === todayKeyAtt && a.status !== "Cancelled"
        && new Date(`${a.date}T${a.time}`).getTime() - Date.now() <= 30 * 60000)
      && !(data.attendance || []).some((att) => att.counsellorId === c.id && att.date === todayKeyAtt)
    ) : [];
    return (
      <div style={{ padding: "8px 16px 24px" }}>
        {missedToday.length > 0 && (
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "#fdecea", border: "1px solid #f3c6c0", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#b42318", marginBottom: 3 }}>Session scheduled, no check-in</div>
            <div style={{ fontSize: 12, color: "#b42318", lineHeight: 1.5 }}>
              {missedToday.map((c) => c.name).join(", ")} {missedToday.length === 1 ? "has" : "have"} a session today but haven't checked in.
            </div>
          </div>
        )}
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <SectionLabel>{rows.filter((r) => r.rec).length} of {rows.length} checked in</SectionLabel>
        <GroupedCard>
          {rows.map(({ c, rec }, i) => {
            const status = !rec ? "Not checked in" : !rec.outAt ? `In since ${hm(rec.inAt)}` : `In ${hm(rec.inAt)} · Out ${hm(rec.outAt)}`;
            return (
              <GroupedRow key={c.id} first={i === 0} chevron={false}
                leading={<Avatar name={c.name} />}
                title={c.name}
                subtitle={status}
                trailing={rec && (rec.inLat != null || rec.outLat != null) ? (
                  <a href={mapsLink(rec.outLat ?? rec.inLat, rec.outLng ?? rec.inLng)} target="_blank" rel="noreferrer"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 999, background: C.chip }}>
                    <MapPin size={13} strokeWidth={1.5} color={C.mid} />
                  </a>
                ) : undefined} />
            );
          })}
        </GroupedCard>
      </div>
    );
  }

  const counsellor = data.counsellors.find((c) => c.id === user.counsellorId);
  const mine = (data.attendance || []).filter((a) => a.counsellorId === user.counsellorId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  // Compare each day's actual check-in/out against the counsellor's own
  // shift (workStart/workEnd) to flag early/late arrivals and departures.
  const shiftStart = counsellor && counsellor.workHoursEnabled !== false ? minutesFromHHMM(counsellor.workStart) : null;
  const shiftEnd = counsellor && counsellor.workHoursEnabled !== false ? minutesFromHHMM(counsellor.workEnd) : null;
  const earlyCheckIns = shiftStart == null ? [] : mine.filter((a) => minutesOfDay(a.inAt) < shiftStart);
  const lateCheckIns = shiftStart == null ? [] : mine.filter((a) => minutesOfDay(a.inAt) > shiftStart)
    .map((a) => ({ ...a, delta: minutesOfDay(a.inAt) - shiftStart }));
  // "Early check-out" only makes sense for a session that actually reached
  // the shift — a checkout before the shift even started isn't leaving
  // early, it's outside the workday entirely, so it's excluded here rather
  // than showing a huge, meaningless gap against the shift end time.
  const earlyCheckOuts = shiftEnd == null || shiftStart == null ? [] : mine.filter((a) => a.outAt && minutesOfDay(a.outAt) < shiftEnd && minutesOfDay(a.outAt) >= shiftStart)
    .map((a) => ({ ...a, delta: shiftEnd - minutesOfDay(a.outAt) }));
  const lateCheckOuts = shiftEnd == null ? [] : mine.filter((a) => a.outAt && minutesOfDay(a.outAt) > shiftEnd)
    .map((a) => ({ ...a, delta: minutesOfDay(a.outAt) - shiftEnd }));

  const downloadYearlyReport = () => {
    const yearRows = (data.attendance || []).filter((a) => a.counsellorId === user.counsellorId && a.date.slice(0, 4) === String(reportYear));
    const yEarlyIn = shiftStart == null ? 0 : yearRows.filter((a) => minutesOfDay(a.inAt) < shiftStart).length;
    const yLateIn = shiftStart == null ? 0 : yearRows.filter((a) => minutesOfDay(a.inAt) > shiftStart).length;
    const yEarlyOut = shiftEnd == null ? 0 : yearRows.filter((a) => a.outAt && minutesOfDay(a.outAt) < shiftEnd).length;
    const yLateOut = shiftEnd == null ? 0 : yearRows.filter((a) => a.outAt && minutesOfDay(a.outAt) > shiftEnd).length;
    const totalHours = yearRows.filter((a) => a.outAt).reduce((t, a) => t + (a.outAt - a.inAt), 0) / 3600000;

    const lines = [
      `Nurora — Attendance Yearly Report ${reportYear}`,
      `Counsellor: ${counsellor ? counsellor.name : user.name}`,
      counsellor && counsellor.workHoursEnabled !== false && counsellor.workStart && counsellor.workEnd ? `Working hours: ${to12(counsellor.workStart)} – ${to12(counsellor.workEnd)}` : null,
      "",
      `Total days checked in: ${yearRows.length}`,
      `Total hours logged: ${totalHours.toFixed(1)}h`,
      `Early check-ins: ${yEarlyIn}`,
      `Late check-ins: ${yLateIn}`,
      `Early check-outs: ${yEarlyOut}`,
      `Late check-outs: ${yLateOut}`,
    ].filter(Boolean);

    // A true binary PDF isn't available in this runtime (no PDF library),
    // so — matching the same report feature on My Summary — this downloads
    // a clean text file instead of a PDF.
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `Nurora-Attendance-Report-${reportYear}.txt`;
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
    URL.revokeObjectURL(url);
  };

  const DetailList = ({ title, rows, timeLabel }) => rows.length === 0 ? null : (
    <>
      <div style={{ height: 16 }} />
      <div style={{ fontSize: 11.5, fontWeight: 500, color: C.soft, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
        {title}
      </div>
      <GroupedCard>
        {rows.map((a, i) => (
          <GroupedRow key={a.id} first={i === 0} chevron={false}
            leading={<IconSquircle><Clock size={15} strokeWidth={1.4} color={C.mid} /></IconSquircle>}
            title={shortDate(a.date)}
            subtitle={timeLabel(a)}
            trailing={<span style={{ fontSize: 13, fontWeight: 600, color: "#b42318" }}>+{fmtMins(a.delta)}</span>} />
        ))}
      </GroupedCard>
    </>
  );

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <AttendanceToggle data={data} act={act} user={user} />
      {(() => {
        const todayKeyMine = ymd(new Date());
        const missedMine = data.appointments.some((a) => a.counsellorId === user.counsellorId && a.date === todayKeyMine && a.status !== "Cancelled"
          && new Date(`${a.date}T${a.time}`).getTime() - Date.now() <= 30 * 60000)
          && !(data.attendance || []).some((att) => att.counsellorId === user.counsellorId && att.date === todayKeyMine);
        if (!missedMine) return null;
        return (
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "#fdecea", border: "1px solid #f3c6c0", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#b42318" }}>You have a session today but haven't checked in yet</div>
          </div>
        );
      })()}
      {counsellor && counsellor.workHoursEnabled !== false && counsellor.workStart && counsellor.workEnd && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: -6, marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: C.faint }}>Working hours {to12(counsellor.workStart)} – {to12(counsellor.workEnd)}</span>
        </div>
      )}
      <SectionLabel>Recent attendance</SectionLabel>
      {mine.length === 0 ? (
        <Empty text="No attendance recorded yet — tap the capsule above to check in." />
      ) : (
        <GroupedCard>
          {mine.map((a, i) => (
            <GroupedRow key={a.id} first={i === 0} chevron={false}
              leading={<IconSquircle><MapPin size={15} strokeWidth={1.4} color={C.mid} /></IconSquircle>}
              title={shortDate(a.date)}
              subtitle={!a.outAt ? `In ${hm(a.inAt)} · still checked in` : `In ${hm(a.inAt)} · Out ${hm(a.outAt)} · ${durHM(a.inAt, a.outAt)}`}
              trailing={(a.inLat != null || a.outLat != null) ? (
                <a href={mapsLink(a.outLat ?? a.inLat, a.outLng ?? a.inLng)} target="_blank" rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 999, background: C.chip }}>
                  <MapPin size={13} strokeWidth={1.5} color={C.mid} />
                </a>
              ) : undefined} />
          ))}
        </GroupedCard>
      )}

      {mine.length > 0 && shiftStart != null && (
        <>
          <div style={{ height: 26 }} />
          <SectionLabel>Attendance Summary</SectionLabel>
          <SummaryStats items={[
            { label: "Early check-ins", value: earlyCheckIns.length },
            { label: "Late check-ins", value: lateCheckIns.length },
            { label: "Early check-outs", value: earlyCheckOuts.length },
            { label: "Late check-outs", value: lateCheckOuts.length },
          ]} />

          <DetailList title="Late check-in — date and mins" rows={lateCheckIns} timeLabel={(a) => `Checked in ${hm(a.inAt)}`} />
          <DetailList title="Early check-out — date and mins" rows={earlyCheckOuts} timeLabel={(a) => `Checked out ${hm(a.outAt)}`} />
          <DetailList title="Late check-out — date and mins" rows={lateCheckOuts} timeLabel={(a) => `Checked out ${hm(a.outAt)}`} />
        </>
      )}

      <div style={{ height: 30 }} />
      <SectionLabel>Yearly Report</SectionLabel>
      <div style={{ borderRadius: 22, border: `1px solid ${C.line}`, padding: "18px 16px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: C.soft }}>Jan 1 – Dec 31</span>
          <button onClick={() => setYearPickerOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 6, background: C.chip, border: "none", borderRadius: 999, padding: "8px 14px", cursor: "pointer" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{reportYear}</span>
            <ChevronDown size={14} strokeWidth={2} color={C.mid} style={{ transform: yearPickerOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>

          {yearPickerOpen && (
            <>
              <div onClick={() => setYearPickerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 91,
                borderRadius: 18, padding: 6, minWidth: 140,
                background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px) saturate(190%)", WebkitBackdropFilter: "blur(24px) saturate(190%)",
                border: "1px solid rgba(255,255,255,0.85)", boxShadow: "0 16px 40px rgba(20,20,20,0.16), 0 4px 12px rgba(20,20,20,0.08)",
              }}>
                {Array.from({ length: 5 }, (_, i) => Number(ymd(new Date()).slice(0, 4)) - i).map((y) => (
                  <button key={y} onClick={() => { setReportYear(y); setYearPickerOpen(false); }}
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 12, background: y === reportYear ? "#111" : "transparent",
                      border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT,
                    }}>
                    <span style={{ fontSize: 14, color: y === reportYear ? "#fff" : C.ink }}>{y}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <Btn full kind="solid" onClick={downloadYearlyReport} icon={<Download size={15} strokeWidth={1.6} />}>
          Download yearly report
        </Btn>
      </div>
    </div>
  );
}

/* -------------------------------------------------- interest & booked */
function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// Shares the payment QR + cancellation/timing policy text with an Interest
// entry, right before they'd confirm a booking. WhatsApp click-to-chat links
// can't attach an image directly — the QR shows here so it can be saved and
// sent as a photo, while the policy text goes over as the prefilled message.
function ShareInterestSheet({ interest, data, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!interest) return null;
  const s = data.settings;

  const policyText = [
    s.cancellationPolicyText,
    s.timingPolicyText,
  ].filter(Boolean).join("\n\n");

  const waLink = () => {
    const phone = (interest.whatsapp || "").replace(/[^\d]/g, "");
    const text = encodeURIComponent(policyText);
    return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(policyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) { /* clipboard unavailable — nothing to fall back to here */ }
  };

  return (
    <Sheet open onClose={onClose} title={`Share with ${interest.clientName || "client"}`}
      footer={<Btn full onClick={onClose}>Close</Btn>}>
      {s.paymentQrImage ? (
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <img src={s.paymentQrImage} alt="Payment QR" style={{ width: 180, height: 180, borderRadius: 16, border: `1px solid ${C.line}`, objectFit: "cover" }} />
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>Save this image to send it separately — WhatsApp links can't attach it automatically.</div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 16 }}>No payment QR uploaded yet — add one in Settings.</div>
      )}

      {policyText ? (
        <div style={{ background: C.chip, borderRadius: 14, padding: 14, fontSize: 12.5, color: C.mid, whiteSpace: "pre-wrap", lineHeight: 1.55, marginBottom: 16, maxHeight: 260, overflowY: "auto" }}>
          {policyText}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 16 }}>No policy text set up yet — add it in Settings.</div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <a href={waLink()} target="_blank" rel="noreferrer" style={{ flex: 1, textDecoration: "none" }}>
          <Btn full kind="solid" icon={<MessageCircle size={14} strokeWidth={1.6} />}>WhatsApp</Btn>
        </a>
        <Btn full onClick={copyText} icon={<Copy size={14} strokeWidth={1.6} />}>{copied ? "Copied" : "Copy"}</Btn>
      </div>
    </Sheet>
  );
}

function InterestBookedScreen({ data, act, go }) {
  const [tab, setTab] = useState("Interest");
  const [month, setMonth] = useState(null); // null = show month list
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);

  const interestMonths = useMemo(() => {
    const map = {};
    for (const it of data.interests || []) {
      const k = it.monthKey || ymd(new Date(it.createdAt)).slice(0, 7);
      (map[k] = map[k] || []).push(it);
    }
    return map;
  }, [data.interests]);

  const bookedMonths = useMemo(() => {
    const map = {};
    for (const a of data.appointments || []) {
      const k = a.date.slice(0, 7);
      (map[k] = map[k] || []).push(a);
    }
    return map;
  }, [data.appointments]);

  const reschedulingList = data.appointments
    .filter((a) => a.status === "Cancelled" && a.rescheduleStatus === "pending")
    .sort((a, b) => b.date.localeCompare(a.date));
  const refundsList = data.appointments
    .filter((a) => a.status === "Cancelled" && a.cancelType === "refund" && a.refundStatus === "pending")
    .sort((a, b) => b.date.localeCompare(a.date));

  const months = tab === "Interest" ? interestMonths : bookedMonths;
  const monthKeys = Object.keys(months).sort().reverse();

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <SegTabs value={tab} onChange={(v) => { setTab(v); setMonth(null); }} options={["Interest", "Booked", "Rescheduling", "Refunds"]} />
      <div style={{ height: 16 }} />

      {tab === "Rescheduling" ? (
        reschedulingList.length === 0 ? (
          <Empty text="Nothing waiting to be rescheduled." />
        ) : (
          <GroupedCard>
            {reschedulingList.map((a, i) => {
              const client = data.clients.find((c) => c.id === a.clientId);
              const coun = data.counsellors.find((c) => c.id === a.counsellorId);
              return (
                <GroupedRow key={a.id} first={i === 0} chevron={false}
                  leading={<Avatar name={client ? client.name : "?"} />}
                  title={client ? client.name : "Client"}
                  subtitle={`Was ${shortDate(a.date)} · ${to12(a.time)}${coun ? ` · ${coun.name}` : ""}${a.rescheduleReason ? ` · ${a.rescheduleReason}` : ""}`}
                  trailing={<Pill onClick={() => setRescheduleTarget(a)}>Reschedule now</Pill>} />
              );
            })}
          </GroupedCard>
        )
      ) : tab === "Refunds" ? (
        refundsList.length === 0 ? (
          <Empty text="No refunds pending." />
        ) : (
          <GroupedCard>
            {refundsList.map((a, i) => {
              const client = data.clients.find((c) => c.id === a.clientId);
              const coun = data.counsellors.find((c) => c.id === a.counsellorId);
              return (
                <GroupedRow key={a.id} first={i === 0} chevron={false}
                  leading={<Avatar name={client ? client.name : "?"} />}
                  title={client ? client.name : "Client"}
                  subtitle={`${shortDate(a.date)}${coun ? ` · ${coun.name}` : ""} · ${money(a.advance)} advance${a.cancelReason ? ` · ${a.cancelReason}` : ""}`}
                  trailing={<Pill onClick={() => act.markRefundGiven(a.id)}>Mark given</Pill>} />
              );
            })}
          </GroupedCard>
        )
      ) : !month ? (
        monthKeys.length === 0 ? (
          <Empty text={`No ${tab.toLowerCase()} entries yet.`} />
        ) : (
          <GroupedCard>
            {monthKeys.map((k, i) => (
              <GroupedRow key={k} first={i === 0}
                leading={<IconSquircle><Calendar size={16} strokeWidth={1.4} color={C.mid} /></IconSquircle>}
                title={monthLabel(k)}
                subtitle={`${months[k].length} ${tab.toLowerCase()} entr${months[k].length === 1 ? "y" : "ies"}`}
                onClick={() => setMonth(k)} />
            ))}
          </GroupedCard>
        )
      ) : (
        <>
          <button onClick={() => setMonth(null)} style={{
            display: "flex", alignItems: "center", gap: 6, marginBottom: 14, cursor: "pointer",
            background: "none", border: "none", padding: 0,
          }}>
            <ChevronLeft size={16} strokeWidth={1.8} color={C.mid} />
            <span style={{ fontSize: 13, color: C.mid }}>{monthLabel(month)}</span>
          </button>

          {tab === "Interest" ? (
            <GroupedCard>
              {(months[month] || []).sort((a, b) => b.createdAt - a.createdAt).map((it, i) => {
                const coun = data.counsellors.find((c) => c.id === it.counsellorId);
                return (
                  <GroupedRow key={it.id} first={i === 0}
                    leading={<Avatar name={it.clientName || "?"} />}
                    title={it.clientName || "Unnamed"}
                    subtitle={`${it.whatsapp || "No number"} · ${it.category || "—"}${coun ? ` · ${coun.name}` : ""}`}
                    trailing={
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Chip>{it.status === "draft" ? "Draft" : "Interest"}</Chip>
                        <button onClick={(e) => { e.stopPropagation(); setShareTarget(it); }} style={{ cursor: "pointer", display: "flex" }}>
                          <Share2 size={14} strokeWidth={1.4} color={C.faint} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); act.deleteInterest(it.id); }} style={{ cursor: "pointer", display: "flex" }}>
                          <Trash2 size={14} strokeWidth={1.4} color={C.faint} />
                        </button>
                      </div>
                    }
                    chevron={false} />
                );
              })}
            </GroupedCard>
          ) : (
            <GroupedCard>
              {(months[month] || []).sort((a, b) => b.date.localeCompare(a.date)).map((a, i) => {
                const client = data.clients.find((c) => c.id === a.clientId);
                const coun = data.counsellors.find((c) => c.id === a.counsellorId);
                return (
                  <GroupedRow key={a.id} first={i === 0}
                    leading={<Avatar name={client ? client.name : "?"} />}
                    title={client ? client.name : "Client"}
                    subtitle={`${shortDate(a.date)} · ${to12(a.time)}${coun ? ` · ${coun.name}` : ""}`}
                    trailing={<Chip>{a.status}</Chip>}
                    chevron={false} />
                );
              })}
            </GroupedCard>
          )}
        </>
      )}
      <CancelRescheduleSheet appt={rescheduleTarget} data={data} act={act} onClose={() => setRescheduleTarget(null)} initialMode="reschedule-date" />
      <ShareInterestSheet interest={shareTarget} data={data} onClose={() => setShareTarget(null)} />
    </div>
  );
}

/* -------------------------------------------------------------- reports */
function ReportsScreen({ data, user }) {
  const [range, setRange] = useState("Today");
  const today = ymd(new Date());
  const month = today.slice(0, 7);
  const inRange = (d) => (range === "Today" ? d === today : d.slice(0, 7) === month);

  const appts = data.appointments
    .filter((a) => inRange(a.date))
    .filter((a) => (user.role === "admin" ? true : a.counsellorId === user.counsellorId));
  const sessions = appts.map((a) => sessionFor(data, a.id)).filter(Boolean);
  const done = sessions.filter((s) => s.endedAt);
  const invs = done.map((s) => data.invoices.find((i) => i.id === s.invoiceId)).filter(Boolean);
  const hours = done.reduce((t, s) => t + s.durationSec, 0);
  const revenue = invs.reduce((t, i) => t + i.total, 0);
  const pending = invs.filter((i) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Refunded").reduce((t, i) => t + (i.total - i.advance), 0);

  const perCounsellor = data.counsellors
    .filter((c) => (user.role === "admin" ? true : c.id === user.counsellorId))
    .map((c) => {
      const ca = appts.filter((a) => a.counsellorId === c.id);
      const cs = ca.map((a) => sessionFor(data, a.id)).filter((s) => s && s.endedAt);
      const ci = cs.map((s) => data.invoices.find((i) => i.id === s.invoiceId)).filter(Boolean);
      const secs = cs.reduce((t, s) => t + s.durationSec, 0);
      return {
        c, booked: ca.length, done: cs.length, hours: secs,
        avg: cs.length ? secs / cs.length : 0,
        revenue: ci.reduce((t, i) => t + i.total, 0),
        leaves: data.leaves.filter((l) => l.counsellorId === c.id && inRange(l.from)).length,
      };
    }).filter((r) => r.booked > 0);

  // Response time — booking time to when the personalize message was
  // actually sent. Over 8 hours gets flagged red; broken down per
  // counsellor individually, not just a pooled total.
  const responseRows = data.counsellors
    .filter((c) => (user.role === "admin" ? true : c.id === user.counsellorId))
    .map((c) => {
      const ca = appts.filter((a) => a.counsellorId === c.id && a.messageSent && a.messageSentAt && a.createdAt);
      const hrsList = ca.map((a) => (a.messageSentAt - a.createdAt) / 3600000);
      const over8 = hrsList.filter((h) => h > 8).length;
      const avg = hrsList.length ? hrsList.reduce((t, h) => t + h, 0) / hrsList.length : null;
      return { c, sent: hrsList.length, over8, avg };
    }).filter((r) => r.sent > 0);

  // Who still hasn't sent it, and for whom — the "sent" report above only
  // ever shows counsellors who've sent at least one, so it can't surface
  // what's currently outstanding on its own.
  const pendingRows = appts
    .filter((a) => a.status !== "Cancelled" && !a.messageSent && a.createdAt)
    .filter((a) => (user.role === "admin" ? true : a.counsellorId === user.counsellorId))
    .map((a) => {
      const c = data.counsellors.find((x) => x.id === a.counsellorId);
      const client = data.clients.find((x) => x.id === a.clientId);
      const hrs = (Date.now() - a.createdAt) / 3600000;
      return { id: a.id, counsellorName: c ? c.name : "—", clientName: client ? client.name : "Client", hrs };
    })
    .sort((a, b) => b.hrs - a.hrs);

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <SegTabs value={range} onChange={setRange} options={["Today", "This month"]} />
      <div style={{ height: 18 }} />

      <SummaryStats items={[
        { label: "Appointments", value: appts.length },
        { label: "Completed", value: done.length },
        { label: "Revenue", value: money(revenue) },
      ]} />
      <div style={{ height: 10 }} />
      <SummaryStats items={[
        { label: "Session hours", value: durStr(hours) },
        { label: "Cancelled", value: appts.filter((a) => a.status === "Cancelled").length },
        { label: "Pending", value: money(pending) },
      ]} />

      <div style={{ height: 26 }} />
      <SectionLabel>By counsellor</SectionLabel>
      {perCounsellor.length === 0 ? (
        <Empty text="No activity in this period." />
      ) : (
        <GroupedCard>
          {perCounsellor.map((r, i) => (
            <GroupedRow key={r.c.id} first={i === 0} chevron={false}
              leading={<Avatar name={r.c.name} />}
              title={r.c.name}
              subtitle={`${r.done} of ${r.booked} completed · ${durStr(r.hours)} · avg ${durStr(r.avg)}`}
              strongTitle
              trailing={money(r.revenue)} />
          ))}
        </GroupedCard>
      )}

      <div style={{ height: 26 }} />
      <SectionLabel>Still pending</SectionLabel>
      {pendingRows.length === 0 ? (
        <Empty text="Nothing outstanding — every booking's message has been sent." />
      ) : (
        <>
          <GroupedCard>
            {pendingRows.map((r, i) => (
              <GroupedRow key={r.id} first={i === 0} chevron={false}
                leading={<Avatar name={r.counsellorName} />}
                title={r.counsellorName}
                subtitle={`For ${r.clientName}`}
                strongTitle
                trailing={
                  <span style={{ fontSize: 13, fontWeight: 600, color: r.hrs > 8 ? "#e74c3c" : C.soft }}>
                    {r.hrs < 1 ? `${Math.round(r.hrs * 60)}m` : `${r.hrs.toFixed(1)}h`} waiting
                  </span>
                } />
            ))}
          </GroupedCard>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>
            To resolve: that counsellor opens the booking on their Schedule and taps the first milestone dot (the paper-plane icon) to send it.
          </div>
        </>
      )}

      <div style={{ height: 26 }} />
      <SectionLabel>Message response time</SectionLabel>
      {responseRows.length === 0 ? (
        <Empty text="No messages sent in this period yet." />
      ) : (
        <GroupedCard>
          {responseRows.map((r, i) => (
            <GroupedRow key={r.c.id} first={i === 0} chevron={false}
              leading={<Avatar name={r.c.name} />}
              title={r.c.name}
              subtitle={`${r.sent} sent · avg ${r.avg < 1 ? Math.round(r.avg * 60) + "m" : r.avg.toFixed(1) + "h"}`}
              strongTitle
              trailing={
                r.over8 > 0
                  ? <span style={{ fontSize: 13, fontWeight: 600, color: "#e74c3c" }}>{r.over8} over 8h</span>
                  : <span style={{ fontSize: 13, color: C.soft }}>All within 8h</span>
              } />
          ))}
        </GroupedCard>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- salary (nulancer) */
// NuLancers are paid per completed session, not a fixed salary — the rate
// depends on whether the session was Individual or Couple.
function nulancerRate(category, settings) {
  const c = (category || "").toLowerCase();
  if (c.includes("couple")) return { rate: settings.nulancerRateCouple ?? 500, kind: "Couple" };
  if (c.includes("individual")) return { rate: settings.nulancerRateIndividual ?? 300, kind: "Individual" };
  return { rate: 0, kind: null };
}

function SalaryScreen({ data, user }) {
  const [monthKey, setMonthKey] = useState(ymd(new Date()).slice(0, 7));

  const rows = data.appointments
    .filter((a) => a.counsellorId === user.counsellorId && a.date.slice(0, 7) === monthKey)
    .map((a) => {
      const sess = sessionFor(data, a.id);
      if (!sess || !sess.endedAt) return null;
      const client = data.clients.find((c) => c.id === a.clientId);
      const { rate, kind } = nulancerRate(a.category, data.settings);
      return { a, client, rate, kind };
    })
    .filter(Boolean)
    .sort((a, b) => b.a.date.localeCompare(a.a.date));

  const total = rows.reduce((t, r) => t + r.rate, 0);
  const individualCount = rows.filter((r) => r.kind === "Individual").length;
  const coupleCount = rows.filter((r) => r.kind === "Couple").length;
  const unrated = rows.filter((r) => !r.kind).length;

  const shiftMonth = (delta) => {
    const d = fromYmd(`${monthKey}-01`);
    d.setMonth(d.getMonth() + delta);
    setMonthKey(ymd(d).slice(0, 7));
  };

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 18 }}>
        <button onClick={() => shiftMonth(-1)} style={{ cursor: "pointer", padding: 6, background: "none", border: "none" }}>
          <ChevronLeft size={18} strokeWidth={1.8} color={C.mid} />
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.ink, minWidth: 140, textAlign: "center" }}>{monthLabel(monthKey)}</span>
        <button onClick={() => shiftMonth(1)} style={{ cursor: "pointer", padding: 6, background: "none", border: "none" }}>
          <ChevronRight size={18} strokeWidth={1.8} color={C.mid} />
        </button>
      </div>

      <div style={{
        borderRadius: 20, background: "#111", color: "#fff", padding: "22px 20px", marginBottom: 18,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Total earned this month</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-1px", marginTop: 4 }}>{money(total)}</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 6 }}>
          {individualCount} individual · {coupleCount} couple{unrated > 0 ? ` · ${unrated} unrated` : ""}
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty text="No completed sessions this month yet." />
      ) : (
        <GroupedCard>
          {rows.map((r, i) => (
            <GroupedRow key={r.a.id} first={i === 0}
              leading={<Avatar name={r.client ? r.client.name : "?"} />}
              title={r.client ? r.client.name : "Client"}
              subtitle={`${shortDate(r.a.date)}${r.kind ? ` · ${r.kind}` : " · Not rated"}`}
              trailing={<span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{r.rate > 0 ? money(r.rate) : "—"}</span>}
              chevron={false} />
          ))}
        </GroupedCard>
      )}

      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 14, textAlign: "center" }}>
        ₹{data.settings.nulancerRateIndividual ?? 300} per individual session · ₹{data.settings.nulancerRateCouple ?? 500} per couple session
      </div>
    </div>
  );
}

/* ------------------------------------------------------- my summary */
function categoryKind(category) {
  const c = (category || "").toLowerCase();
  if (c.includes("family")) return "Family";
  if (c.includes("couple")) return "Couple";
  if (c.includes("child") || c.includes("adolescent")) return "Child";
  if (c.includes("individual")) return "Individual";
  return null;
}

function StatRow({ label, value, valueColor, tag }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: `1px solid ${C.hair}` }}>
      <span style={{ fontSize: 14, color: C.mid }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {tag && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: "#111", borderRadius: 999, padding: "3px 8px" }}>{tag}</span>
        )}
        <span style={{ fontSize: 15, fontWeight: 600, color: valueColor || C.ink }}>{value}</span>
      </div>
    </div>
  );
}

function MySummaryScreen({ data, user }) {
  const [monthKey, setMonthKey] = useState(ymd(new Date()).slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(null); // null = whole-month view
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reportYear, setReportYear] = useState(Number(ymd(new Date()).slice(0, 4)));
  const [yearPickerOpen, setYearPickerOpen] = useState(false);

  const shiftMonth = (delta) => {
    if (selectedDay) {
      const d = fromYmd(selectedDay);
      d.setDate(d.getDate() + delta);
      const nk = ymd(d);
      setSelectedDay(nk);
      setMonthKey(nk.slice(0, 7));
      return;
    }
    const d = fromYmd(`${monthKey}-01`);
    d.setMonth(d.getMonth() + delta);
    setMonthKey(ymd(d).slice(0, 7));
  };

  // Every completed session (has ended) for this counsellor, grouped by month or day.
  const sessionsForMonth = (mk) => data.appointments
    .filter((a) => a.counsellorId === user.counsellorId && a.date.slice(0, 7) === mk)
    .map((a) => ({ a, sess: sessionFor(data, a.id) }))
    .filter((r) => r.sess && r.sess.endedAt);
  const sessionsForDay = (dk) => data.appointments
    .filter((a) => a.counsellorId === user.counsellorId && a.date === dk)
    .map((a) => ({ a, sess: sessionFor(data, a.id) }))
    .filter((r) => r.sess && r.sess.endedAt);
  const sessionsForYear = (y) => Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`).flatMap(sessionsForMonth);

  const rows = selectedDay ? sessionsForDay(selectedDay) : sessionsForMonth(monthKey);
  const totalTaken = rows.length;

  const kindCounts = { Individual: 0, Couple: 0, Child: 0 };
  rows.forEach((r) => {
    const k = categoryKind(r.a.category);
    if (k && kindCounts[k] !== undefined) kindCounts[k]++;
  });

  const followups = rows.filter((r) => r.a.isFollowup).length;
  const followupRate = totalTaken ? Math.round((followups / totalTaken) * 100) : 0;

  let prevRows, comparisonLabel;
  if (selectedDay) {
    const yest = fromYmd(selectedDay);
    yest.setDate(yest.getDate() - 1);
    prevRows = sessionsForDay(ymd(yest));
    comparisonLabel = "Follow-up rate vs yesterday";
  } else {
    const prevMonthDate = fromYmd(`${monthKey}-01`);
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    prevRows = sessionsForMonth(ymd(prevMonthDate).slice(0, 7));
    comparisonLabel = "Follow-up rate vs last month";
  }
  const prevFollowupRate = prevRows.length ? Math.round((prevRows.filter((r) => r.a.isFollowup).length / prevRows.length) * 100) : 0;
  const followupDelta = followupRate - prevFollowupRate;

  // Is this period's follow-up count the highest this counsellor has ever had?
  const allMonthKeys = new Set(data.appointments.filter((a) => a.counsellorId === user.counsellorId).map((a) => a.date.slice(0, 7)));
  const everFollowupCounts = [...allMonthKeys].map((mk) => sessionsForMonth(mk).filter((r) => r.a.isFollowup).length);
  const isHighestEver = followups > 0 && followups >= Math.max(...everFollowupCounts, 0);

  const daysWorked = selectedDay ? (rows.length > 0 ? 1 : 0) : new Set(rows.map((r) => r.a.date)).size;

  const lopDays = data.leaves
    .filter((l) => l.counsellorId === user.counsellorId && (
      selectedDay ? l.from <= selectedDay && l.to >= selectedDay : l.monthKey === monthKey
    ))
    .reduce((t, l) => t + (l.lopUnits || 0), 0);

  const counsellor = data.counsellors.find((c) => c.id === user.counsellorId);
  const periodLabel = selectedDay ? shortDate(selectedDay) : monthLabel(monthKey);
  const sessionDates = new Set(data.appointments.filter((a) => a.counsellorId === user.counsellorId).map((a) => a.date));

  const downloadYearlyReport = () => {
    const yRows = sessionsForYear(reportYear);
    const yKinds = { Individual: 0, Couple: 0, Child: 0 };
    yRows.forEach((r) => { const k = categoryKind(r.a.category); if (k && yKinds[k] !== undefined) yKinds[k]++; });
    const yFollowups = yRows.filter((r) => r.a.isFollowup).length;
    const yRate = yRows.length ? Math.round((yFollowups / yRows.length) * 100) : 0;
    const yDaysWorked = new Set(yRows.map((r) => r.a.date)).size;
    const yLop = data.leaves.filter((l) => l.counsellorId === user.counsellorId && l.monthKey.slice(0, 4) === String(reportYear))
      .reduce((t, l) => t + (l.lopUnits || 0), 0);

    const lines = [
      `Nurora — Yearly Report ${reportYear}`,
      `Counsellor: ${counsellor ? counsellor.name : user.name}`,
      "",
      `Total counselling taken: ${yRows.length}`,
      yKinds.Individual > 0 ? `Total individual counselling: ${yKinds.Individual}` : null,
      yKinds.Couple > 0 ? `Total couple counselling: ${yKinds.Couple}` : null,
      yKinds.Child > 0 ? `Total child counselling: ${yKinds.Child}` : null,
      `Total follow-ups: ${yFollowups}`,
      `Follow-up rate: ${yRate}%`,
      `Total days worked: ${yDaysWorked}`,
      `Total LOP days: ${yLop}`,
      `Total reviews: 0`,
    ].filter(Boolean);

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Nurora-Yearly-Report-${reportYear}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <GroupedCard>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px" }}>
          <Avatar name={counsellor ? counsellor.name : user.name} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0a0a0a" }}>{counsellor ? counsellor.name : user.name}</div>
            <div style={{ fontSize: 12.5, color: C.soft, marginTop: 3 }}>{counsellor ? counsellor.role : "Counsellor"}</div>
          </div>
          <Chip>{counsellor && !counsellor.active ? "Inactive" : "Active"}</Chip>
        </div>
      </GroupedCard>

      <div style={{ height: 20 }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 4 }}>
        <button onClick={() => shiftMonth(-1)} style={{ cursor: "pointer", padding: 6, background: "none", border: "none" }}>
          <ChevronLeft size={18} strokeWidth={1.8} color={C.mid} />
        </button>
        <button onClick={() => setPickerOpen((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 8px" }}>
          <Calendar size={16} strokeWidth={1.5} color={C.mid} />
          <span style={{ fontSize: 15, fontWeight: 600, color: C.ink, minWidth: 100, textAlign: "center" }}>{periodLabel}</span>
        </button>
        <button onClick={() => shiftMonth(1)} style={{ cursor: "pointer", padding: 6, background: "none", border: "none" }}>
          <ChevronRight size={18} strokeWidth={1.8} color={C.mid} />
        </button>

        {pickerOpen && (
          <>
            <div onClick={() => setPickerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
            <div style={{
              position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 8,
              zIndex: 91, width: 300, borderRadius: 22, padding: 4,
              background: "rgba(255,255,255,0.92)", backdropFilter: "blur(26px) saturate(190%)", WebkitBackdropFilter: "blur(26px) saturate(190%)",
              border: "1px solid rgba(255,255,255,0.85)", boxShadow: "0 16px 40px rgba(20,20,20,0.16), 0 4px 12px rgba(20,20,20,0.08)",
            }}>
              <MonthCalendar selected={selectedDay || `${monthKey}-01`} markedDates={sessionDates}
                onSelect={(d) => { setSelectedDay(d); setMonthKey(d.slice(0, 7)); setPickerOpen(false); }} />
              {selectedDay && (
                <button onClick={() => { setSelectedDay(null); setPickerOpen(false); }}
                  style={{ width: "100%", textAlign: "center", padding: "10px 0 12px", fontSize: 13, color: C.mid, background: "none", border: "none", cursor: "pointer" }}>
                  View whole month instead
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ height: 18 }} />
      <SectionLabel>Sessions</SectionLabel>
      <GroupedCard>
        <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: C.soft }}>Total counselling taken</span>
          <span style={{ fontSize: 14 }}>{totalTaken}</span>
        </div>
        {kindCounts.Individual > 0 && (
          <div style={{ padding: "0 16px 13px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 13, color: C.soft }}>Total individual counselling</span>
            <span style={{ fontSize: 14 }}>{kindCounts.Individual}</span>
          </div>
        )}
        {kindCounts.Couple > 0 && (
          <div style={{ padding: "0 16px 13px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 13, color: C.soft }}>Total couple counselling</span>
            <span style={{ fontSize: 14 }}>{kindCounts.Couple}</span>
          </div>
        )}
        {kindCounts.Child > 0 && (
          <div style={{ padding: "0 16px 13px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 13, color: C.soft }}>Total child counselling</span>
            <span style={{ fontSize: 14 }}>{kindCounts.Child}</span>
          </div>
        )}
      </GroupedCard>

      <div style={{ height: 24 }} />
      <SectionLabel>Follow-ups</SectionLabel>
      <GroupedCard>
        <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: C.soft }}>Total follow-ups</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isHighestEver && (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: "#111", borderRadius: 999, padding: "3px 8px" }}>Highest ever</span>
            )}
            <span style={{ fontSize: 14 }}>{followups}</span>
          </div>
        </div>
        <div style={{ padding: "0 16px 13px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: C.soft }}>Follow-up rate</span>
          <span style={{ fontSize: 14 }}>{followupRate}%</span>
        </div>
        <div style={{ padding: "0 16px 13px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: C.soft }}>{comparisonLabel}</span>
          <span style={{ fontSize: 14, color: followupDelta > 0 ? "#1a7a3a" : followupDelta < 0 ? "#b42318" : C.ink }}>
            {followupDelta >= 0 ? "+" : ""}{followupDelta}%
          </span>
        </div>
      </GroupedCard>

      <div style={{ height: 24 }} />
      <SectionLabel>Attendance</SectionLabel>
      <GroupedCard>
        <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: C.soft }}>Total days worked</span>
          <span style={{ fontSize: 14 }}>{daysWorked}</span>
        </div>
        <div style={{ padding: "0 16px 13px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: C.soft }}>Total LOP days</span>
          <span style={{ fontSize: 14, color: lopDays > 0 ? "#b42318" : C.ink }}>{lopDays}</span>
        </div>
      </GroupedCard>

      <div style={{ height: 24 }} />
      <SectionLabel>Reviews</SectionLabel>
      <GroupedCard>
        <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 13, color: C.soft }}>Total reviews</span>
          <span style={{ fontSize: 14 }}>0</span>
        </div>
      </GroupedCard>

      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 14, textAlign: "center" }}>
        Reviews aren't collected anywhere in the app yet — this will stay at 0 until that's built.
      </div>

      <div style={{ height: 30 }} />
      <SectionLabel>Yearly Report</SectionLabel>
      <div style={{
        borderRadius: 22, border: `1px solid ${C.line}`, padding: "18px 16px", position: "relative",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: C.soft }}>Jan 1 – Dec 31</span>
          <button onClick={() => setYearPickerOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 6, background: C.chip, border: "none", borderRadius: 999, padding: "8px 14px", cursor: "pointer" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{reportYear}</span>
            <ChevronDown size={14} strokeWidth={2} color={C.mid} style={{ transform: yearPickerOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>

          {yearPickerOpen && (
            <>
              <div onClick={() => setYearPickerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 91,
                borderRadius: 18, padding: 6, minWidth: 140,
                background: "rgba(255,255,255,0.95)", backdropFilter: "blur(24px) saturate(190%)", WebkitBackdropFilter: "blur(24px) saturate(190%)",
                border: "1px solid rgba(255,255,255,0.85)", boxShadow: "0 16px 40px rgba(20,20,20,0.16), 0 4px 12px rgba(20,20,20,0.08)",
              }}>
                {Array.from({ length: 5 }, (_, i) => Number(ymd(new Date()).slice(0, 4)) - i).map((y) => (
                  <button key={y} onClick={() => { setReportYear(y); setYearPickerOpen(false); }}
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 12, background: y === reportYear ? "#111" : "transparent",
                      border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT,
                    }}>
                    <span style={{ fontSize: 14, color: y === reportYear ? "#fff" : C.ink }}>{y}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <Btn full kind="solid" onClick={downloadYearlyReport} icon={<Download size={15} strokeWidth={1.6} />}>
          Download yearly report
        </Btn>
      </div>
    </div>
  );
}


function SettingsScreen({ data, act }) {
  const [s, setS] = useState(data.settings);
  const [saved, setSaved] = useState(false);
  const num = (v) => (v === "" ? "" : Number(v));
  const sample = computeBill(150 * 60, { ...s, basePrice: Number(s.basePrice) || 0, includedMinutes: Number(s.includedMinutes) || 0, extensionMinutes: Number(s.extensionMinutes) || 30, extensionPrice: Number(s.extensionPrice) || 0, graceMinutes: Number(s.graceMinutes) || 0 });

  return (
    <div style={{ padding: "8px 16px 24px" }}>
      <div style={{ fontSize: 13, color: C.soft, marginBottom: 16 }}>Pricing</div>
      <Field label="Base session price (₹)"><Input inputMode="numeric" value={s.basePrice} onChange={(e) => setS({ ...s, basePrice: num(e.target.value) })} /></Field>
      <Field label="Included duration (minutes)"><Input inputMode="numeric" value={s.includedMinutes} onChange={(e) => setS({ ...s, includedMinutes: num(e.target.value) })} /></Field>
      <Field label="Extension block (minutes)"><Input inputMode="numeric" value={s.extensionMinutes} onChange={(e) => setS({ ...s, extensionMinutes: num(e.target.value) })} /></Field>
      <Field label="Charge per extension block (₹)"><Input inputMode="numeric" value={s.extensionPrice} onChange={(e) => setS({ ...s, extensionPrice: num(e.target.value) })} /></Field>
      <Field label="Grace period (minutes)" hint="Overtime under this is not charged."><Input inputMode="numeric" value={s.graceMinutes} onChange={(e) => setS({ ...s, graceMinutes: num(e.target.value) })} /></Field>

      <div style={{ border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px", marginBottom: 22 }}>
        <div style={{ fontSize: 12, color: C.soft, marginBottom: 8 }}>A 2h 30m session would bill</div>
        <Row label="Base" value={money(sample.base)} />
        <Row label="Additional" value={money(sample.additional)} />
        {sample.gst > 0 && <Row label="GST" value={money(sample.gst)} />}
        <Row label="Total" value={money(sample.total)} strong />
      </div>

      <button onClick={() => setS({ ...s, gstEnabled: !s.gstEnabled })}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 0 16px", cursor: "pointer", background: "none", border: "none" }}>
        <span style={{ fontSize: 14 }}>Add GST to invoices</span>
        <span style={{ width: 44, height: 26, borderRadius: 999, background: s.gstEnabled ? "#111" : C.ghost, display: "flex", alignItems: "center", padding: 3 }}>
          <span style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", marginLeft: s.gstEnabled ? 18 : 0, transition: "margin .2s" }} />
        </span>
      </button>
      {s.gstEnabled && <Field label="GST percent"><Input inputMode="numeric" value={s.gstPercent} onChange={(e) => setS({ ...s, gstPercent: num(e.target.value) })} /></Field>}

      <div style={{ fontSize: 13, color: C.soft, margin: "10px 0 16px" }}>Leave</div>
      <Field label="Paid leave days per month" hint="Two half-days count as one day. Leave beyond this is recorded as LOP (loss of pay).">
        <Input inputMode="numeric" value={s.monthlyLeaveDays} onChange={(e) => setS({ ...s, monthlyLeaveDays: num(e.target.value) })} />
      </Field>

      <div style={{ fontSize: 13, color: C.soft, margin: "10px 0 16px" }}>Appointments</div>
      <Field label="Session types" hint="Separate with commas.">
        <Input value={s.sessionTypes.join(", ")} onChange={(e) => setS({ ...s, sessionTypes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
      </Field>
      <Field label="Appointment labels" hint="Short chips shown on the schedule.">
        <Input value={s.chipLabels.join(", ")} onChange={(e) => setS({ ...s, chipLabels: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
      </Field>
      <Field label="Invoice prefix"><Input value={s.invoicePrefix} onChange={(e) => setS({ ...s, invoicePrefix: e.target.value })} /></Field>
      <Field label="Admin PIN"><Input value={s.adminPin} onChange={(e) => setS({ ...s, adminPin: e.target.value })} /></Field>
      <Field label="Designer link URL" hint="Where the 'Samuel Rednus' credit on the sign-in screen opens.">
        <Input value={s.designerUrl || ""} onChange={(e) => setS({ ...s, designerUrl: e.target.value })} placeholder="https://…" />
      </Field>

      <button onClick={() => setS({ ...s, notificationSound: !s.notificationSound })}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 0 20px", cursor: "pointer", background: "none", border: "none" }}>
        <span style={{ fontSize: 14 }}>Notification sound</span>
        <span style={{ width: 44, height: 26, borderRadius: 999, background: s.notificationSound ? "#111" : C.ghost, display: "flex", alignItems: "center", padding: 3 }}>
          <span style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", marginLeft: s.notificationSound ? 18 : 0, transition: "margin .2s" }} />
        </span>
      </button>

      <div style={{ fontSize: 13, color: C.soft, margin: "10px 0 16px" }}>Booking form</div>

      <div style={{ fontSize: 12, color: C.soft, marginBottom: 10 }}>Services &amp; pricing</div>
      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        {(s.services || []).map((sv, i) => {
          const update = (patch) => setS({ ...s, services: s.services.map((x, xi) => (xi === i ? { ...x, ...patch } : x)) });
          const remove = () => setS({ ...s, services: s.services.filter((_, xi) => xi !== i) });
          const moveBy = (delta) => {
            const arr = s.services.slice();
            const j = i + delta;
            if (j < 0 || j >= arr.length) return;
            [arr[i], arr[j]] = [arr[j], arr[i]];
            setS({ ...s, services: arr });
          };
          const count = s.services.length;
          return (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 10px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                <button onClick={() => moveBy(-1)} disabled={i === 0} aria-label="Move up" style={{
                  display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 18,
                  border: "none", background: "none", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.25 : 1, padding: 0,
                }}>
                  <ChevronUp size={14} strokeWidth={1.8} color={C.mid} />
                </button>
                <button onClick={() => moveBy(1)} disabled={i === count - 1} aria-label="Move down" style={{
                  display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 18,
                  border: "none", background: "none", cursor: i === count - 1 ? "default" : "pointer", opacity: i === count - 1 ? 0.25 : 1, padding: 0,
                }}>
                  <ChevronDown size={14} strokeWidth={1.8} color={C.mid} />
                </button>
              </div>
              <Input value={sv.name} onChange={(e) => update({ name: e.target.value })} style={{ flex: 1 }} />
              <Input inputMode="numeric" value={sv.value} onChange={(e) => update({ value: Number(e.target.value) || 0 })} style={{ width: 90 }} />
              <button onClick={remove} style={{ cursor: "pointer", display: "flex", padding: 4 }}><X size={15} strokeWidth={1.6} color={C.faint} /></button>
            </div>
          );
        })}
        <Btn onClick={() => setS({ ...s, services: [...(s.services || []), { name: "New service", value: 2000 }] })} icon={<Plus size={14} strokeWidth={1.6} />}>
          Add service
        </Btn>
      </div>

      <div style={{ fontSize: 12, color: C.soft, marginBottom: 10 }}>Advance tier formula</div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", marginBottom: 20 }}>
        <div style={{ fontSize: 12.5, color: C.mid, marginBottom: 10 }}>
          Services priced ₹{s.advanceTierThreshold ?? 2000} or below need ₹{s.advanceTierAtOrBelow ?? 500} advance.
          Above that, ₹{s.advanceTierAbove ?? 1000} advance.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <Field label="Threshold (₹)"><Input inputMode="numeric" value={s.advanceTierThreshold} onChange={(e) => setS({ ...s, advanceTierThreshold: num(e.target.value) })} /></Field>
          <Field label="At/below (₹)"><Input inputMode="numeric" value={s.advanceTierAtOrBelow} onChange={(e) => setS({ ...s, advanceTierAtOrBelow: num(e.target.value) })} /></Field>
          <Field label="Above (₹)"><Input inputMode="numeric" value={s.advanceTierAbove} onChange={(e) => setS({ ...s, advanceTierAbove: num(e.target.value) })} /></Field>
        </div>
      </div>

      <Field label="Booking modes" hint="Comma separated. Shown when booking a New Client.">
        <Input value={(s.modes || []).join(", ")}
          onChange={(e) => setS({ ...s, modes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
      </Field>

      <div style={{ fontSize: 12, color: C.soft, marginBottom: 10 }}>Modes requiring full payment</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {(s.modes || []).map((m) => {
          const on = (s.fullPaymentModes || []).includes(m);
          return (
            <button key={m} onClick={() => setS({
              ...s, fullPaymentModes: on ? s.fullPaymentModes.filter((x) => x !== m) : [...(s.fullPaymentModes || []), m],
            })}
              style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 999, cursor: "pointer", border: `1px solid ${on ? "#111" : C.line}`, background: on ? "#111" : "#fff", color: on ? "#fff" : C.mid }}>{m}</button>
          );
        })}
      </div>

      <Field label="Tags" hint="Format: CODE:Label, separated by commas. e.g. CO:Counselling, PT:Psychotherapy, Ch:Child, Ges:Gestalt">
        <Input value={(s.tags || []).map((t) => `${t.code}:${t.label}`).join(", ")}
          onChange={(e) => setS({
            ...s, tags: e.target.value.split(",").map((x) => {
              const [code, label] = x.split(":");
              return { code: (code || "").trim(), label: (label || code || "").trim() };
            }).filter((t) => t.code),
          })} />
      </Field>
      <Field label="Attachment types" hint="Comma separated.">
        <Input value={(s.attachmentTypes || []).join(", ")}
          onChange={(e) => setS({ ...s, attachmentTypes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
      </Field>
      <Field label="Auto-delete attachments after (days)">
        <Input inputMode="numeric" value={s.attachmentRetentionDays} onChange={(e) => setS({ ...s, attachmentRetentionDays: num(e.target.value) })} />
      </Field>

      <div style={{ fontSize: 13, color: C.soft, margin: "10px 0 16px" }}>NuLancer pay rates</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <Field label="Per individual session (₹)">
          <Input inputMode="numeric" value={s.nulancerRateIndividual} onChange={(e) => setS({ ...s, nulancerRateIndividual: num(e.target.value) })} />
        </Field>
        <Field label="Per couple session (₹)">
          <Input inputMode="numeric" value={s.nulancerRateCouple} onChange={(e) => setS({ ...s, nulancerRateCouple: num(e.target.value) })} />
        </Field>
      </div>

      {/* The Attendance geofence block lived here. Check-in no longer reads
          the device's location, so there was nothing left for a clinic
          location or a radius to govern — the settings only described
          behaviour that had been removed. */}

      <div style={{ fontSize: 13, color: C.soft, margin: "10px 0 8px" }}>Personalize message template</div>
      <div style={{ fontSize: 12, color: C.faint, marginBottom: 10 }}>
        Sent from the Step 1 icon on each booking. Use <code style={{ background: C.chip, borderRadius: 4, padding: "1px 5px" }}>{"{{name}}"}</code> for the client's name and <code style={{ background: C.chip, borderRadius: 4, padding: "1px 5px" }}>{"{{date}}"}</code> for their appointment date and time — both get filled in automatically per booking.
      </div>
      <textarea value={s.appointmentMessageTemplate || ""} onChange={(e) => setS({ ...s, appointmentMessageTemplate: e.target.value })}
        rows={10} style={{ ...inputStyle, height: "auto", resize: "vertical", lineHeight: 1.6, marginBottom: 20 }} />

      <div style={{ fontSize: 13, color: C.soft, margin: "10px 0 16px" }}>Client sharing</div>
      <Field label="Payment QR code" hint="Shown when sharing the payment QR + policies with an Interest entry.">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {s.paymentQrImage ? (
            <img src={s.paymentQrImage} alt="Payment QR" style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", border: `1px solid ${C.line}` }} />
          ) : (
            <div style={{ width: 64, height: 64, borderRadius: 10, border: `1px dashed ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <FileText size={18} strokeWidth={1.3} color={C.faint} />
            </div>
          )}
          <label style={{ cursor: "pointer" }}>
            <span style={{ fontSize: 13, color: RING_DONE_SOLID, fontWeight: 500 }}>{s.paymentQrImage ? "Replace image" : "Upload image"}</span>
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
              const file = e.target.files && e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setS({ ...s, paymentQrImage: reader.result });
              reader.readAsDataURL(file);
            }} />
          </label>
          {s.paymentQrImage && (
            <button onClick={() => setS({ ...s, paymentQrImage: null })} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}>
              <X size={15} strokeWidth={1.6} color={C.faint} />
            </button>
          )}
        </div>
      </Field>
      <Field label="Cancellation policy" hint="Can be as long as needed — shared as text alongside the QR.">
        <textarea value={s.cancellationPolicyText || ""} onChange={(e) => setS({ ...s, cancellationPolicyText: e.target.value })}
          rows={6} style={{ ...inputStyle, height: "auto", resize: "vertical", lineHeight: 1.6 }} />
      </Field>
      <Field label="Timing policy">
        <textarea value={s.timingPolicyText || ""} onChange={(e) => setS({ ...s, timingPolicyText: e.target.value })}
          rows={6} style={{ ...inputStyle, height: "auto", resize: "vertical", lineHeight: 1.6 }} />
      </Field>
      <Field label="Booking confirmed message" hint={<>Shown right after a booking is confirmed. Use <code style={{ background: C.chip, borderRadius: 4, padding: "1px 5px" }}>{"{{name}}"}</code> for the client's name.</>}>
        <textarea value={s.bookingConfirmedMessageTemplate || ""} onChange={(e) => setS({ ...s, bookingConfirmedMessageTemplate: e.target.value })}
          rows={5} style={{ ...inputStyle, height: "auto", resize: "vertical", lineHeight: 1.6, marginBottom: 20 }} />
      </Field>

      <Btn full kind="solid" onClick={() => { act.updateSettings(s); setSaved(true); setTimeout(() => setSaved(false), 1600); }}>
        {saved ? "Saved" : "Save settings"}
      </Btn>
    </div>
  );
}

/* ---------------------------------------------------------- app shell */
const TABS = [
  ["schedule", "Schedule", Calendar],
  ["sessions", "Sessions", Clock],
  ["clients", "Clients", Users],
  ["invoices", "Invoices", FileText],
  ["more", "More", MoreHorizontal],
];

export default function App() {
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("schedule");
  const [sub, setSub] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [signupWizardOpen, setSignupWizardOpen] = useState(false);
  const [agreementEditorOpen, setAgreementEditorOpen] = useState(false);
  const [agreementViewOpen, setAgreementViewOpen] = useState(false);
  const [myDetailsOpen, setMyDetailsOpen] = useState(false);
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [menuPressed, setMenuPressed] = useState(false);
  const [scheduleFilter, setScheduleFilter] = useState("all"); // "all" | "mine" | counsellorId
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPrefill, setQuickPrefill] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [composeKind, setComposeKind] = useState("text"); // "text" | "todo" | "task"
  const [composeTag, setComposeTag] = useState(null);
  const [plusMenu, setPlusMenu] = useState(null); // null | "root" | "tags"
  const [barPlusOpen, setBarPlusOpen] = useState(false); // the "+" on the collapsed bar, before chat is open
  const [seenMsgCount, setSeenMsgCount] = useState(0);
  const fileInputRef = useRef(null);
  const chatScrollRef = useRef(null);
  const loaded = useRef(false);
  const isDesktop = useIsWide(1024);

  useEffect(() => {
    (async () => {
      let [d, s] = await Promise.all([store.get(KEY), store.get(SKEY)]);
      if (!d) { d = seed(); store.set(KEY, d); }
      d = purgeExpiredAttachments(d);
      d = purgeOldInterests(d);
      d = markMissedAttendanceAsLeave(d);
      setData(d); setUser(s || null); loaded.current = true; setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current || !data) return;
    const t = setTimeout(() => store.set(KEY, data), 400);
    return () => clearTimeout(t);
  }, [data]);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  // Safety net: re-assert before paint in case the host overwrites the tag after mount.
  useLayoutEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) meta.setAttribute("content", "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, shrink-to-fit=no");
  }, []);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2400); };

  useEffect(() => {
    if (chatOpen && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatOpen, data?.messages?.length]);

  useEffect(() => {
    if (chatOpen) {
      const t = setTimeout(() => setSeenMsgCount((data?.messages || []).length), 1400);
      return () => clearTimeout(t);
    }
  }, [chatOpen, data?.messages?.length]);

  const myMsgId = user ? (user.role === "admin" ? "admin" : user.counsellorId) : null;
  const unreadMsgCount = (data?.messages || [])
    .slice(seenMsgCount)
    .filter((m) => m.senderId !== myMsgId).length;

  const act = useMemo(() => ({
    login: (u) => { setUser(u); store.set(SKEY, u); setTab("schedule"); setSub(null); },
    logout: () => { setUser(null); store.set(SKEY, null); setSub(null); setTab("schedule"); },

    createAppointment: (f) => {
      const coun = data.counsellors.find((c) => c.id === f.counsellorId);
      if (!coun) return { error: "Choose a counsellor." };
      const wo = weekOffOn(data, coun, f.date);
      if (wo) return { error: `${coun.name} has a week off on this date (${wo}).` };
      const lv = leaveOn(data, coun.id, f.date);
      if (lv && !lv.half) return { error: `${coun.name} is on ${lv.type.toLowerCase()} on this date.` };
      const clash = data.appointments.some((a) => a.date === f.date && a.counsellorId === f.counsellorId && a.time === f.time && a.status !== "Cancelled");
      if (clash) return { error: "This counsellor is already booked for this time." };

      let clientId = f.clientId;
      let newClients = data.clients;
      if (f.newClient) {
        const c = {
          id: uid("cl"), name: f.clientName.trim(), age: Number(f.clientAge) || "",
          phone: f.whatsapp || "", email: "", notes: "",
          category: f.category, mode: f.mode, gender: f.gender || "",
          whatsapp: f.whatsapp || "",
          parentName: f.parentName || "", guardianName: f.guardianName || "",
        };
        newClients = [...data.clients, c]; clientId = c.id;
      }
      const client = newClients.find((c) => c.id === clientId);

      const attachmentExpiresAt = f.attachmentType ? Date.now() + (data.settings.attachmentRetentionDays || 30) * 86400000 : null;

      const appt = {
        id: uid("a"), date: f.date, counsellorId: f.counsellorId, time: f.time, clientId,
        type: f.type, advance: Number(f.advance) || 0, chips: f.chips, status: f.status, note: "",
        category: f.category || (client && client.category) || "",
        mode: f.mode || (client && client.mode) || "",
        tags: f.tags || [],
        attachmentType: f.attachmentType || null,
        attachmentNote: f.attachmentNote || "",
        attachmentFileName: f.attachmentFileName || null,
        attachmentAudioData: f.attachmentAudioData || null,
        attachmentDurationSec: f.attachmentDurationSec || 0,
        attachmentExpiresAt,
        paymentScreenshotName: f.paymentScreenshotName || null,
        milestone: 0,
        isFollowup: !f.newClient,
        createdAt: Date.now(),
      };
      const notif = {
        id: uid("n"), ts: Date.now(), counsellorId: f.counsellorId, title: "New appointment",
        body: `${client ? client.name : "Client"} · ${to12(f.time)} · ${shortDate(f.date)}`, read: false,
      };
      const bookedDate = fromYmd(f.date);
      const shortY = String(bookedDate.getFullYear()).slice(-2);
      const dmy = `${pad(bookedDate.getDate())}/${pad(bookedDate.getMonth() + 1)}/${shortY}`;
      const activityMsg = systemMsg(
        `${coun.name} has booked a client name ${client ? client.name : "a client"} on ${dmy} ${DAYS_LONG[bookedDate.getDay()]}`
      );
      setData({
        ...data, clients: newClients, appointments: [...data.appointments, appt],
        notifications: [notif, ...data.notifications], messages: [...(data.messages || []), activityMsg],
      });
      flash(`Booked ${client ? client.name : "client"} with ${coun.name} at ${to12(f.time)}.`);
      return { ok: true };
    },

    // "Interest" — someone called and gave their details, but hasn't paid
    // yet, so no slot is held. A deliberate save (status "interest") vs an
    // auto-save when the form gets closed unfinished (status "draft").
    saveInterest: (f, kind = "interest") => {
      const rec = {
        id: uid("it"), createdAt: Date.now(), monthKey: ymd(new Date()).slice(0, 7), status: kind,
        date: f.date, counsellorId: f.counsellorId || "", time: f.time || "",
        clientName: f.clientName || "", clientAge: f.clientAge || "", gender: f.gender || "",
        mode: f.mode || "", category: f.category || "",
        parentName: f.parentName || "", guardianName: f.guardianName || "", whatsapp: f.whatsapp || "",
        advance: f.advance || "", tags: f.tags || [],
        loggedBy: user ? user.name : "",
      };
      const messages = kind === "interest"
        ? [...(data.messages || []), systemMsg(`${user ? user.name : "Someone"} logged an Interest entry for ${f.clientName || "a client"}`)]
        : data.messages;
      setData({ ...data, interests: [rec, ...(data.interests || [])], messages });
      if (kind === "interest") flash(`Saved ${f.clientName || "entry"} as Interest.`);
      return rec;
    },

    deleteInterest: (id) => setData({ ...data, interests: (data.interests || []).filter((it) => it.id !== id) }),

    cancelAppointment: (id, opts = {}) => {
      const { refund = false, reason = "" } = opts;
      const appt = data.appointments.find((a) => a.id === id);
      const coun = appt ? data.counsellors.find((c) => c.id === appt.counsellorId) : null;
      const client = appt ? data.clients.find((c) => c.id === appt.clientId) : null;
      const reasonText = reason ? ` — ${reason}` : "";
      const activityMsg = systemMsg(
        `${user ? user.name : "Someone"} cancelled the appointment for ${client ? client.name : "a client"}${coun ? ` with ${coun.name}` : ""}${appt ? ` on ${shortDate(appt.date)}` : ""} · ${refund ? "refund requested" : "no refund"}${reasonText}`
      );
      setData({
        ...data,
        appointments: data.appointments.map((a) => (a.id === id
          ? { ...a, status: "Cancelled", cancelType: refund ? "refund" : "no-refund", refundStatus: refund ? "pending" : null, cancelReason: reason || "" }
          : a)),
        messages: [...(data.messages || []), activityMsg],
      });
      flash(refund ? "Cancelled — refund marked pending." : "Appointment cancelled.");
    },

    markRefundGiven: (id) => {
      const appt = data.appointments.find((a) => a.id === id);
      const client = appt ? data.clients.find((c) => c.id === appt.clientId) : null;
      const activityMsg = systemMsg(`${user ? user.name : "Someone"} marked the refund as given for ${client ? client.name : "a client"}`);
      setData({
        ...data,
        appointments: data.appointments.map((a) => (a.id === id ? { ...a, refundStatus: "given" } : a)),
        messages: [...(data.messages || []), activityMsg],
      });
      flash("Refund marked as given.");
    },

    // Condition 3 — client wants to reschedule but hasn't given a date yet.
    // Frees the slot (same as a cancellation) but tags it separately so it
    // surfaces in the Rescheduling list instead of just looking cancelled.
    markRescheduling: (id, reason = "") => {
      const appt = data.appointments.find((a) => a.id === id);
      const client = appt ? data.clients.find((c) => c.id === appt.clientId) : null;
      const reasonText = reason ? ` — ${reason}` : "";
      const activityMsg = systemMsg(`${user ? user.name : "Someone"} marked ${client ? client.name : "a client"}'s appointment for rescheduling${reasonText}`);
      setData({
        ...data,
        appointments: data.appointments.map((a) => (a.id === id
          ? { ...a, status: "Cancelled", rescheduleStatus: "pending", rescheduleReason: reason || "" }
          : a)),
        messages: [...(data.messages || []), activityMsg],
      });
      flash("Marked for rescheduling.");
    },

    // Condition 4 — client wants to reschedule to a specific new date/time.
    // Carries the client, advance, tags and notes over to a new booking,
    // frees the old slot, and links both records for a clean history trail.
    rescheduleAppointment: (id, newDate, newTime) => {
      const old = data.appointments.find((a) => a.id === id);
      if (!old) { flash("Original appointment not found."); return { error: "Original appointment not found." }; }
      const clash = data.appointments.some((a) => a.date === newDate && a.counsellorId === old.counsellorId && a.time === newTime && a.status !== "Cancelled");
      if (clash) { flash("This counsellor is already booked for that time."); return { error: "This counsellor is already booked for that time." }; }
      const newId = uid("a");
      const coun = data.counsellors.find((c) => c.id === old.counsellorId);
      const client = data.clients.find((c) => c.id === old.clientId);
      const newAppt = {
        ...old, id: newId, date: newDate, time: newTime, status: "Scheduled",
        milestone: 0, messageSent: false, callMade: false, billLogged: false, personaFilled: false,
        cancelType: undefined, refundStatus: undefined, cancelReason: undefined,
        rescheduleStatus: undefined, rescheduleReason: undefined,
        rescheduledFromId: id, createdAt: Date.now(),
      };
      const activityMsg = systemMsg(
        `${user ? user.name : "Someone"} rescheduled ${client ? client.name : "a client"}${coun ? ` with ${coun.name}` : ""} to ${shortDate(newDate)} at ${to12(newTime)}`
      );
      setData({
        ...data,
        appointments: [
          ...data.appointments.map((a) => (a.id === id ? { ...a, status: "Cancelled", rescheduleStatus: "moved", rescheduledToId: newId } : a)),
          newAppt,
        ],
        messages: [...(data.messages || []), activityMsg],
      });
      flash(`Rescheduled to ${shortDate(newDate)} at ${to12(newTime)}.`);
      return { ok: true };
    },

    setMilestone: (id, index) => {
      setData({ ...data, appointments: data.appointments.map((a) => (a.id === id ? { ...a, milestone: index } : a)) });
    },

    setMessageSent: (id) => {
      setData({ ...data, appointments: data.appointments.map((a) => (a.id === id ? { ...a, messageSent: true, messageSentAt: Date.now() } : a)) });
    },

    setCallMade: (id) => {
      setData({ ...data, appointments: data.appointments.map((a) => (a.id === id ? { ...a, callMade: true } : a)) });
    },

    setBillLogged: (id) => {
      setData({ ...data, appointments: data.appointments.map((a) => (a.id === id ? { ...a, billLogged: true } : a)) });
    },

    setReviewed: (id) => {
      setData({ ...data, appointments: data.appointments.map((a) => (a.id === id ? { ...a, reviewedByCounsellor: true } : a)) });
    },

    startSession: (apptId) => {
      const appt = data.appointments.find((a) => a.id === apptId);
      if (!appt) return;
      if (data.sessions.some((s) => s.appointmentId === apptId)) return;
      const busy = data.sessions.find((s) => !s.endedAt && s.counsellorId === appt.counsellorId);
      if (busy) { flash("This counsellor already has a session running."); return; }
      const sess = { id: uid("s"), appointmentId: apptId, counsellorId: appt.counsellorId, startedAt: Date.now(), endedAt: null, durationSec: 0, invoiceId: null };
      const coun = data.counsellors.find((c) => c.id === appt.counsellorId);
      const client = data.clients.find((c) => c.id === appt.clientId);
      const activityMsg = systemMsg(
        `${coun ? coun.name : "A counsellor"} starts the session of ${client ? client.name : "the client"} at ${chatTime(sess.startedAt)}`
      );
      setData({ ...data, sessions: [...data.sessions, sess], messages: [...(data.messages || []), activityMsg] });
      flash("Session started.");
    },

    endSession: (apptId) => {
      const sess = data.sessions.find((s) => s.appointmentId === apptId && !s.endedAt);
      const appt = data.appointments.find((a) => a.id === apptId);
      if (!sess || !appt) return null;
      const endedAt = Date.now();
      const durationSec = Math.max(1, Math.floor((endedAt - sess.startedAt) / 1000));
      const bill = computeBill(durationSec, data.settings);
      const seq = data.invoiceSeq;
      const d = new Date();
      const number = `${data.settings.invoicePrefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}-${pad(seq)}`;
      const advance = Number(appt.advance) || 0;
      const paymentStatus = advance >= bill.total ? "Paid" : advance > 0 ? "Partially Paid" : "Pending";
      const invoice = {
        id: uid("i"), number, date: ymd(d), createdAt: endedAt, appointmentId: apptId,
        clientId: appt.clientId, counsellorId: appt.counsellorId, sessionDate: appt.date,
        startedAt: sess.startedAt, endedAt, durationSec,
        base: bill.base, additional: bill.additional, gst: bill.gst, total: bill.total, extraMinutes: bill.extraMinutes,
        advance, paymentStatus,
      };
      const coun = data.counsellors.find((c) => c.id === appt.counsellorId);
      const client = data.clients.find((c) => c.id === appt.clientId);
      const activityMsg = systemMsg(
        `${coun ? coun.name : "A counsellor"} ends the session of ${client ? client.name : "the client"} at ${chatTime(endedAt)} and collects the Amount ${money(bill.total)}`
      );
      setData({
        ...data,
        invoiceSeq: seq + 1,
        sessions: data.sessions.map((s) => (s.id === sess.id ? { ...s, endedAt, durationSec, invoiceId: invoice.id } : s)),
        appointments: data.appointments.map((a) => (a.id === apptId ? { ...a, status: "Completed" } : a)),
        invoices: [invoice, ...data.invoices],
        messages: [...(data.messages || []), activityMsg],
      });
      return { durationSec, invoiceId: invoice.id };
    },

    setPayment: (invId, status) => {
      const inv = data.invoices.find((i) => i.id === invId);
      const client = inv ? data.clients.find((c) => c.id === inv.clientId) : null;
      const activityMsg = systemMsg(
        `${user ? user.name : "Someone"} marked ${inv ? inv.number : "an invoice"}${client ? ` (${client.name})` : ""} as ${status}`
      );
      setData({
        ...data,
        invoices: data.invoices.map((i) => (i.id === invId ? { ...i, paymentStatus: status } : i)),
        messages: [...(data.messages || []), activityMsg],
      });
      flash(`Marked ${status.toLowerCase()}.`);
    },

    addClient: (f) => {
      setData({ ...data, clients: [...data.clients, { id: uid("cl"), ...f, age: Number(f.age) || "" }] });
      flash("Client added.");
    },
    updateClient: (id, patch) => setData({ ...data, clients: data.clients.map((c) => (c.id === id ? { ...c, ...patch, age: Number(patch.age) || c.age } : c)) }),

    addCounsellor: (f) => {
      const isOwner = !!f.isOwner;
      const activityMsg = systemMsg(`${user ? user.name : "Admin"} added ${isOwner ? "owner" : f.isNuLancer ? "NuLancer" : "counsellor"} ${f.name.trim()}`);
      const generatedTpin = String(Math.floor(1000 + Math.random() * 9000));
      setData({
        ...data,
        counsellors: [...data.counsellors, {
          id: uid("c"), name: f.name.trim(), role: f.role || (isOwner ? "Owner" : f.isNuLancer ? "NuLancer" : "Counsellor"), workStart: "09:00", workEnd: "20:00",
          slots: [], weekOffDates: {}, pin: generatedTpin, active: true, isNuLancer: !isOwner && !!f.isNuLancer,
          benefitsEnabled: false, benefits: [],
          accountStatus: isOwner ? "mpin" : "tpin", tpin: isOwner ? null : generatedTpin, mpin: null,
          probationFrom: f.probationFrom || ymd(new Date()), probationTo: f.probationTo || ymd(new Date()),
          personalPhone: f.personalPhone || "", bloodGroup: f.bloodGroup || "", aadharImage: f.aadharImage || null, businessPhone: f.businessPhone || "", dob: f.dob || "", dateOfJoining: f.dateOfJoining || "",
          photo: null, agreementSignedAt: null, signatureDataUrl: null,
          frontPageTextOverride: null, agreementAgreeTextOverride: null,
          permissions: { attendance: true, nubills: true, personas: true, bric: true, reviews: true, followups: true, mysummary: true, weekoffs: !isOwner },
          isOwner, workHoursEnabled: true,
        }],
        messages: [...(data.messages || []), activityMsg],
      });
      flash(isOwner ? `Owner added — PIN ${generatedTpin}` : f.isNuLancer ? `NuLancer added — TPIN ${generatedTpin}` : `Counsellor added — TPIN ${generatedTpin}`);
    },
    updateCounsellor: (id, patch) => setData({ ...data, counsellors: data.counsellors.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
    completeSignup: (counsellorId, signatureText) => {
      const generatedMpin = String(Math.floor(1000 + Math.random() * 9000));
      setData({
        ...data,
        counsellors: data.counsellors.map((c) => (c.id === counsellorId
          ? { ...c, accountStatus: "mpin", mpin: generatedMpin, tpin: null, agreementSignedAt: Date.now(), signatureDataUrl: signatureText }
          : c)),
      });
      flash("Signup complete — MPIN generated.");
      return generatedMpin;
    },

    setDaySlots: (counsellorId, date, times, exceptionComment) => {
      const c = data.counsellors.find((x) => x.id === counsellorId);
      if (!c) return;
      const sorted = [...times].sort();
      const activityMsg = systemMsg(
        `${user ? user.name : "Someone"} changed ${c.name}'s slots on ${shortDate(date)} to ${sorted.length ? sorted.map(to12).join(", ") : "none"}`
      );
      // exceptionComment (when passed) is applied in this same update rather
      // than a separate setDayException call right after — two setData
      // calls built from the same pre-update snapshot would have the second
      // one silently discard this slot change.
      setData({
        ...data,
        counsellors: data.counsellors.map((x) => {
          if (x.id !== counsellorId) return x;
          const next = { ...x, slotOverrides: { ...(x.slotOverrides || {}), [date]: sorted } };
          if (exceptionComment !== undefined) {
            const exceptions = { ...(x.dayExceptions || {}) };
            if (exceptionComment) exceptions[date] = { comment: exceptionComment }; else delete exceptions[date];
            next.dayExceptions = exceptions;
          }
          return next;
        }),
        messages: [...(data.messages || []), activityMsg],
      });
    },

    clearDaySlots: (counsellorId, date) => {
      setData({
        ...data,
        counsellors: data.counsellors.map((c) => {
          if (c.id !== counsellorId) return c;
          const overrides = { ...(c.slotOverrides || {}) };
          delete overrides[date];
          return { ...c, slotOverrides: overrides };
        }),
      });
    },

    setDayException: (counsellorId, date, comment) => {
      const c = data.counsellors.find((x) => x.id === counsellorId);
      setData({
        ...data,
        counsellors: data.counsellors.map((x) => {
          if (x.id !== counsellorId) return x;
          const exceptions = { ...(x.dayExceptions || {}) };
          if (comment) exceptions[date] = { comment }; else delete exceptions[date];
          return { ...x, dayExceptions: exceptions };
        }),
      });
      flash(comment ? `Marked as "${comment}" for ${c ? c.name : "this counsellor"}.` : "Exception cleared.");
    },

    setCounsellorActive: (id, active) => {
      const c = data.counsellors.find((x) => x.id === id);
      const activityMsg = systemMsg(`${user ? user.name : "Admin"} marked ${c ? c.name : "a counsellor"} as ${active ? "active" : "inactive"}`);
      setData({
        ...data, counsellors: data.counsellors.map((x) => (x.id === id ? { ...x, active } : x)),
        messages: [...(data.messages || []), activityMsg],
      });
    },

    deleteCounsellor: (id) => {
      const c = data.counsellors.find((x) => x.id === id);
      const activityMsg = systemMsg(`${user ? user.name : "Admin"} removed counsellor ${c ? c.name : "a counsellor"}`);
      setData({ ...data, counsellors: data.counsellors.filter((x) => x.id !== id), messages: [...(data.messages || []), activityMsg] });
      flash(c ? `${c.name} deleted.` : "Counsellor deleted.");
    },

    addLeave: (l) => {
      const mk = monthKeyOf(l.from);
      const units = leaveUnits(l);
      const newRecord = { id: uid("l"), ...l, units, paidUnits: l.type === "Paid-off" ? units : 0, lopUnits: 0, monthKey: mk };
      const quota = weekOffQuotaForMonth(mk);
      const leavesWithNew = recomputeLeaveSplits([...data.leaves, newRecord], l.counsellorId, mk, quota);
      const saved = leavesWithNew.find((x) => x.id === newRecord.id);
      const coun = data.counsellors.find((c) => c.id === l.counsellorId);
      const range = l.from === l.to ? shortDate(l.from) : `${shortDate(l.from)} – ${shortDate(l.to)}`;
      const statusLabel = l.type === "Paid-off" ? "Paid-off" : (saved.lopUnits ?? 0) <= 0 ? "Week-off" : (saved.paidUnits ?? 0) <= 0 ? "LOP" : "Partly LOP";
      const activityMsg = systemMsg(`${coun ? coun.name : "A counsellor"} applied for leave${l.half ? " (half day)" : ""} on ${range} · ${statusLabel}`);
      setData({
        ...data, leaves: leavesWithNew,
        messages: [...(data.messages || []), activityMsg],
      });
      flash((saved.lopUnits ?? 0) > 0 ? `Leave saved · ${fmtDays(saved.lopUnits)} recorded as LOP.` : "Leave saved as a week-off.");
    },
    removeLeave: (id) => {
      const removed = data.leaves.find((l) => l.id === id);
      const after = data.leaves.filter((l) => l.id !== id);
      const recomputed = removed ? recomputeLeaveSplits(after, removed.counsellorId, monthKeyOf(removed.from), weekOffQuotaForMonth(monthKeyOf(removed.from))) : after;
      setData({ ...data, leaves: recomputed });
    },

    addHoliday: (h) => {
      const activityMsg = systemMsg(`${user ? user.name : "Admin"} marked ${shortDate(h.date)} as ${h.type}${h.label && h.label !== h.type ? ` (${h.label})` : ""}`);
      setData({ ...data, holidays: [...(data.holidays || []), { id: uid("h"), ...h }], messages: [...(data.messages || []), activityMsg] });
      flash(`Marked ${shortDate(h.date)} as ${h.type}.`);
    },
    removeHoliday: (id) => setData({ ...data, holidays: (data.holidays || []).filter((h) => h.id !== id) }),

    recordCheckIn: (counsellorId, loc) => {
      const today = ymd(new Date());
      if ((data.attendance || []).some((a) => a.counsellorId === counsellorId && a.date === today)) return; // already checked in today
      const rec = {
        id: uid("att"), counsellorId, date: today, inAt: Date.now(),
        inLat: loc?.lat ?? null, inLng: loc?.lng ?? null, inAuto: !!loc,
        outAt: null, outLat: null, outLng: null, outAuto: false,
      };
      const coun = data.counsellors.find((c) => c.id === counsellorId);
      const activityMsg = systemMsg(`${coun ? coun.name : "A counsellor"} checked in at ${chatTime(rec.inAt)}${loc ? " · location captured" : ""}`);

      // Auto-mark the first half as leave if checking in past the midpoint
      // of working hours, and they haven't already applied leave today.
      // Silent by design — no flash, no notification, no activity message
      // beyond the normal check-in one above.
      let leaves = data.leaves;
      if (coun && coun.workHoursEnabled !== false && coun.workStart && coun.workEnd) {
        const alreadyOnLeaveToday = data.leaves.some((l) => l.counsellorId === counsellorId && l.from <= today && today <= l.to);
        if (!alreadyOnLeaveToday) {
          const startMin = minutesFromHHMM(coun.workStart);
          const endMin = minutesFromHHMM(coun.workEnd);
          const midMin = (startMin + endMin) / 2;
          const checkInMin = new Date(rec.inAt).getHours() * 60 + new Date(rec.inAt).getMinutes();
          if (checkInMin > midMin) {
            const midHHMM = `${pad(Math.floor(midMin / 60))}:${pad(Math.round(midMin % 60))}`;
            const newLeave = {
              id: uid("l"), counsellorId, type: "Leave", from: today, to: today, half: true,
              halfFrom: coun.workStart, halfTill: midHHMM, autoMarked: true,
            };
            const units = leaveUnits(newLeave);
            const withUnits = { ...newLeave, units, paidUnits: 0, lopUnits: 0, monthKey: monthKeyOf(today) };
            const quota = weekOffQuotaForMonth(monthKeyOf(today));
            leaves = recomputeLeaveSplits([...data.leaves, withUnits], counsellorId, monthKeyOf(today), quota);
          }
        }
      }

      setData({ ...data, attendance: [...(data.attendance || []), rec], leaves, messages: [...(data.messages || []), activityMsg] });
      flash(`Checked in${loc ? " · location captured" : " (location unavailable)"}`);
    },
    recordCheckOut: (counsellorId, loc) => {
      const today = ymd(new Date());
      const rec = (data.attendance || []).find((a) => a.counsellorId === counsellorId && a.date === today && !a.outAt);
      if (!rec) return;
      const outAt = Date.now();
      const coun = data.counsellors.find((c) => c.id === counsellorId);
      const activityMsg = systemMsg(`${coun ? coun.name : "A counsellor"} checked out at ${chatTime(outAt)}${loc ? " · location captured" : ""}`);
      setData({
        ...data,
        attendance: (data.attendance || []).map((a) => (a.id === rec.id ? { ...a, outAt, outLat: loc?.lat ?? null, outLng: loc?.lng ?? null, outAuto: !!loc } : a)),
        messages: [...(data.messages || []), activityMsg],
      });
      flash(`Checked out${loc ? " · location captured" : " (location unavailable)"}`);
    },

    addBill: (parsed) => {
      // If this bill was logged from a specific appointment's own NuBills
      // milestone, that appointment's counsellor is the definitive owner —
      // more reliable than the pasted text's counsellor name, which could
      // name someone else entirely (e.g. a shared/templated payment message).
      const linkedAppt = parsed.appointmentId ? data.appointments.find((a) => a.id === parsed.appointmentId) : null;
      const matched = data.counsellors.find((c) => parsed.counsellorName && parsed.counsellorName.toLowerCase().includes(c.name.toLowerCase()));
      const counsellorId = linkedAppt ? linkedAppt.counsellorId : matched ? matched.id : (user && user.role === "resource" ? user.counsellorId : null);
      const submittedByCounsellorId = user && user.role === "resource" ? user.counsellorId : null;
      const rec = { id: uid("bill"), ...parsed, counsellorId, submittedBy: user ? user.name : "", submittedByCounsellorId, createdAt: Date.now() };
      const chatMsg = {
        id: uid("m"), text: parsed.rawText, ts: Date.now(),
        senderId: user ? (user.role === "admin" ? "admin" : user.counsellorId) : "system",
        senderName: user ? user.name : "Nurora", senderRole: user ? user.role : "system",
        kind: "text", tag: "Bill",
      };
      // Bundled into one update, not two — marking the appointment's
      // billLogged flag in a separate setData call right after this one
      // would clobber this bill, since both would be built from the same
      // pre-update snapshot of data in the same synchronous tick.
      setData({
        ...data,
        bills: [rec, ...(data.bills || [])],
        appointments: parsed.appointmentId
          ? data.appointments.map((a) => (a.id === parsed.appointmentId ? { ...a, billLogged: true } : a))
          : data.appointments,
        messages: [...(data.messages || []), chatMsg],
      });
      flash("Bill saved to Nubills.");
    },

    updatePersona: (clientId, persona, appointmentId) => {
      setData({
        ...data,
        clients: data.clients.map((c) => (c.id === clientId ? { ...c, persona } : c)),
        appointments: appointmentId
          ? data.appointments.map((a) => (a.id === appointmentId ? { ...a, personaFilled: true } : a))
          : data.appointments,
      });
      flash("Persona saved.");
    },

    addReview: (review) => {
      const rec = { id: uid("review"), ...review, submittedBy: user ? user.name : "", createdAt: Date.now() };
      setData({ ...data, reviews: [rec, ...(data.reviews || [])] });
      flash("Review saved.");
    },

    // Marking a "thing to send" done only ever happens right after the
    // WhatsApp send itself fires (see FollowUpCommitmentsScreen) — never as
    // a bare standalone toggle — so ticking it can't happen without the
    // send action actually running first.
    markThingSent: (clientId, itemId) => {
      setData({
        ...data,
        clients: data.clients.map((c) => {
          if (c.id !== clientId || !c.persona) return c;
          const thingsToSend = (c.persona.thingsToSend || []).map((t) =>
            t.id === itemId ? { ...t, done: true, doneAt: Date.now(), doneBy: user ? user.name : "" } : t);
          return { ...c, persona: { ...c.persona, thingsToSend } };
        }),
      });
      flash("Marked as sent.");
    },

    markFollowUpDone: (clientId) => {
      setData({
        ...data,
        clients: data.clients.map((c) => (c.id === clientId && c.persona
          ? { ...c, persona: { ...c.persona, followUpDone: true, followUpDoneAt: Date.now(), followUpDoneBy: user ? user.name : "" } }
          : c)),
      });
      flash("Follow-up marked done.");
    },

    setBenefitsEnabled: (counsellorId, enabled) => {
      setData({ ...data, counsellors: data.counsellors.map((c) => (c.id === counsellorId ? { ...c, benefitsEnabled: enabled } : c)) });
      flash(enabled ? "Benefits enabled for this counsellor." : "Benefits disabled for this counsellor.");
    },

    addBenefit: (counsellorId, benefit) => {
      const rec = { id: uid("ben"), ...benefit, addedAt: Date.now() };
      setData({ ...data, counsellors: data.counsellors.map((c) => (c.id === counsellorId ? { ...c, benefits: [...(c.benefits || []), rec] } : c)) });
      flash("Benefit added.");
    },

    removeBenefit: (counsellorId, benefitId) => {
      setData({ ...data, counsellors: data.counsellors.map((c) => (c.id === counsellorId ? { ...c, benefits: (c.benefits || []).filter((b) => b.id !== benefitId) } : c)) });
    },

    updateSettings: (s) => {
      const oldCodes = new Set((data.settings.tags || []).map((t) => t.code));
      const newTagMsgs = (s.tags || [])
        .filter((t) => !oldCodes.has(t.code))
        .map((t) => systemMsg(`Admin has added Tag (${t.label}) in Appointment Tag`));
      setData({
        ...data, settings: {
          ...s, basePrice: Number(s.basePrice) || 0, includedMinutes: Number(s.includedMinutes) || 0,
          extensionMinutes: Number(s.extensionMinutes) || 30, extensionPrice: Number(s.extensionPrice) || 0,
          graceMinutes: Number(s.graceMinutes) || 0, gstPercent: Number(s.gstPercent) || 0,
          monthlyLeaveDays: Number(s.monthlyLeaveDays) || 0, attachmentRetentionDays: Number(s.attachmentRetentionDays) || 30,
          advanceTierThreshold: Number(s.advanceTierThreshold) || 0,
          advanceTierAtOrBelow: Number(s.advanceTierAtOrBelow) || 0,
          advanceTierAbove: Number(s.advanceTierAbove) || 0,
          nulancerRateIndividual: Number(s.nulancerRateIndividual) || 0,
          nulancerRateCouple: Number(s.nulancerRateCouple) || 0,
          services: (s.services || []).map((sv) => ({ name: sv.name, value: Number(sv.value) || 0 })),
        },
        messages: newTagMsgs.length ? [...(data.messages || []), ...newTagMsgs] : data.messages,
      });
    },

    readNotifications: () => setData({ ...data, notifications: data.notifications.map((n) => ({ ...n, read: true })) }),

    // A message is always stamped with whoever is currently signed in — there
    // is no field or path that lets a sender be anyone else.
    sendMessage: (text, extra) => {
      const t = (text || "").trim();
      if (!t || !user) return;
      const msg = {
        id: uid("m"), text: t, ts: Date.now(),
        senderId: user.role === "admin" ? "admin" : user.counsellorId,
        senderName: user.name, senderRole: user.role,
        kind: (extra && extra.kind) || "text",
        tag: (extra && extra.tag) || null,
      };
      setData({ ...data, messages: [...(data.messages || []), msg] });
    },

    saveBiometricCredential: (identityKey, credId) => {
      setData({ ...data, webauthn: { ...(data.webauthn || {}), [identityKey]: credId } });
    },

    updateLoginQuote: (grey, black) => {
      setData({ ...data, settings: { ...data.settings, loginQuoteGrey: grey, loginQuoteBlack: black } });
    },
  }), [data, user]);

  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: 28, height: 28, borderRadius: 999, border: "2.5px solid #ececec", borderTopColor: "#8b7fe8",
          animation: "nurora-spin 0.7s linear infinite",
        }} />
        <style>{"@keyframes nurora-spin { to { transform: rotate(360deg); } }"}</style>
      </div>
    );
  }
  if (!user) return <Login data={data} onLogin={act.login} saveCredential={act.saveBiometricCredential} updateQuote={act.updateLoginQuote} />;

  const go = (s) => setSub(s);
  const myNotifs = data.notifications.filter((n) => user.role === "admin" || n.counsellorId === user.counsellorId);
  const todayKey = ymd(new Date());
  const myCounsellorForFollowUp = data.counsellors.find((c) => c.id === user.counsellorId);
  const inFollowUpScope = (counsellorName) => user.role === "admin" || (myCounsellorForFollowUp && counsellorName && counsellorName.toLowerCase().includes(myCounsellorForFollowUp.name.toLowerCase()));
  const hasEndedSessionForBadge = (clientId) => data.appointments
    .filter((a) => a.clientId === clientId)
    .some((a) => { const s = sessionFor(data, a.id); return s && s.endedAt; });
  const pendingFollowUpCount = data.clients.filter((c) => c.persona && c.persona.nextFollowUpDate && c.persona.nextFollowUpDate <= todayKey && !c.persona.followUpDone && inFollowUpScope(c.persona.counsellorName)).length
    + data.clients.filter((c) => c.persona && inFollowUpScope(c.persona.counsellorName) && hasEndedSessionForBadge(c.id))
        .reduce((n, c) => n + (c.persona.thingsToSend || []).filter((t) => !t.done).length, 0);
  // Session scheduled today, 15+ minutes past start, and that counsellor
  // still hasn't checked in for attendance at all today.
  const missedCheckInCounsellorIds = new Set(
    data.appointments
      .filter((a) => a.date === todayKey && a.status !== "Cancelled")
      .filter((a) => new Date(`${a.date}T${a.time}`).getTime() - now <= 30 * 60000)
      .map((a) => a.counsellorId)
      .filter((cid) => !(data.attendance || []).some((att) => att.counsellorId === cid && att.date === todayKey))
  );
  const missedCheckInCount = user.role === "admin" ? missedCheckInCounsellorIds.size
    : (missedCheckInCounsellorIds.has(user.counsellorId) ? 1 : 0);
  const nuLancerStaffingAlert = user.role === "resource" && user.isNuLancer && staffingStatusForDate(data, todayKey) ? 1 : 0;
  const unread = myNotifs.filter((n) => !n.read).length + pendingFollowUpCount + missedCheckInCount + nuLancerStaffingAlert;
  const canAccess = (key) => user.role === "admin" || !myCounsellorForFollowUp || myCounsellorForFollowUp.permissions?.[key] !== false;

  const subTitles = {
    counsellor: "Counsellor", client: "Client", counsellors: "Nurora Roster\u2019s",
    leaves: "Leave & week offs", reports: "Reports",
    settings: "Settings", myprofile: "My schedule", interestBooked: "Interest & Booked",
    nulancers: "NuLancers", salary: "Salary", mysummary: "My Summary", attendance: "Attendance",
    nubills: "Nubills", personas: "Persona", bric: "BRIC", reviews: "Google Reviews", followups: "Follow-up & Commitments",
    benefits: "Resource Special Benefits",
  };

  let body, title;
  if (sub) {
    title = subTitles[sub.screen] || "";
    const permissionKeyForScreen = { leaves: "weekoffs" };
    const screenNeedsCheck = sub.screen !== "myprofile" && sub.screen !== "benefits";
    if (screenNeedsCheck && !canAccess(permissionKeyForScreen[sub.screen] || sub.screen)) {
      body = (
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <Shield size={28} strokeWidth={1.3} color={C.faint} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: C.soft }}>Admin hasn't enabled this for your account.</div>
        </div>
      );
    }
    else if (sub.screen === "counsellor" || sub.screen === "myprofile") body = <CounsellorDetail data={data} act={act} id={sub.id} user={user} go={go} />;
    else if (sub.screen === "client") body = <ClientDetail data={data} act={act} id={sub.id} user={user} />;
    else if (sub.screen === "counsellors") body = <CounsellorsScreen data={data} act={act} go={go} />;
    else if (sub.screen === "nulancers") body = <CounsellorsScreen data={data} act={act} go={go} nuLancerMode />;
    else if (sub.screen === "leaves") body = <LeavesScreen data={data} act={act} go={go} />;
    else if (sub.screen === "interestBooked") body = <InterestBookedScreen data={data} act={act} go={go} />;
    else if (sub.screen === "reports") body = <ReportsScreen data={data} user={user} />;
    else if (sub.screen === "salary") body = <SalaryScreen data={data} user={user} />;
    else if (sub.screen === "mysummary") body = <MySummaryScreen data={data} user={user} />;
    else if (sub.screen === "attendance") body = <AttendanceScreen data={data} act={act} user={user} />;
    else if (sub.screen === "nubills") body = <NubillsScreen data={data} act={act} user={user} />;
    else if (sub.screen === "personas") body = <PersonasScreen data={data} act={act} user={user} />;
    else if (sub.screen === "bric") body = <BRICScreen data={data} act={act} user={user} />;
    else if (sub.screen === "reviews") body = <GoogleReviewsScreen data={data} act={act} user={user} />;
    else if (sub.screen === "followups") body = <FollowUpCommitmentsScreen data={data} act={act} user={user} />;
    else if (sub.screen === "benefits") body = <ResourceBenefitsScreen data={data} act={act} user={user} />;
    else if (sub.screen === "settings") body = <SettingsScreen data={data} act={act} />;
  } else {
    title = TABS.find((t) => t[0] === tab)[1];
    if (tab === "schedule") {
      const resolvedCounsellorId = user.isNuLancer ? (user.counsellorId || "")
        : scheduleFilter === "all" ? "" : scheduleFilter === "mine" ? (user.counsellorId || "") : scheduleFilter;
      body = <ScheduleScreen data={data} act={act} user={user} now={now} go={go} counsellorFilter={resolvedCounsellorId}
        scheduleFilter={scheduleFilter} setScheduleFilter={setScheduleFilter} />;
    }
    if (tab === "sessions") body = <SessionsScreen data={data} user={user} now={now} />;
    if (tab === "clients") body = <ClientsScreen data={data} act={act} user={user} go={go} />;
    if (tab === "invoices") body = <InvoicesScreen data={data} act={act} user={user} />;
    if (tab === "more") body = <MoreScreen user={user} go={go} act={act} data={data} />;
  }

  const switchTab = (t) => { setTab(t); setSub(null); };

  return (
    <div style={{ minHeight: "100vh", width: "100%", maxWidth: "100vw", overflowX: "hidden", background: "#fff", color: C.ink, fontFamily: FONT, display: "flex" }}>
      {/* desktop sidebar */}
      {isDesktop && (
      <aside style={{ width: 232, display: "flex", flexDirection: "column", borderRight: `1px solid ${C.line}`, padding: "26px 18px", position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
        <div style={{ fontSize: 19, letterSpacing: "-0.3px", padding: "0 8px 4px" }}>Nurora</div>
        <div style={{ fontSize: 12, color: C.soft, padding: "0 8px 26px" }}>{user.name} · {user.role === "admin" ? "Admin" : user.isNuLancer ? "NuLancer" : "Counsellor"}</div>
        {TABS.filter((t) => t[0] !== "more").map(([k, label, Icon]) => (
          <button key={k} onClick={() => switchTab(k)}
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", borderRadius: 12,
              fontSize: 14, color: tab === k && !sub ? C.ink : C.soft, background: tab === k && !sub ? C.chip : "transparent",
              border: "none", cursor: "pointer", textAlign: "left", marginBottom: 2,
            }}>
            <Icon size={17} strokeWidth={1.4} color={tab === k && !sub ? C.ink : C.soft} />{label}
          </button>
        ))}
        <div style={{ marginTop: "auto", display: "grid", gap: 6 }}>
          <button onClick={() => switchTab("more")} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", borderRadius: 12, fontSize: 14, color: C.soft, background: "none", border: "none", cursor: "pointer" }}>
            <SettingsIcon size={17} strokeWidth={1.4} color={C.soft} />More
          </button>
          <button onClick={act.logout} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", borderRadius: 12, fontSize: 14, color: C.soft, background: "none", border: "none", cursor: "pointer" }}>
            <LogOut size={17} strokeWidth={1.4} color={C.soft} />Sign out
          </button>
        </div>
      </aside>
      )}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* header */}
        <header style={{ background: "#fff" }}>
          <div style={{ padding: "0 16px 8px", maxWidth: 980, margin: "0 auto" }}>
            <div style={{ position: "relative", padding: "10px 4px 4px", overflow: "visible" }}>
              <button onClick={() => (sub ? setSub(null) : setDrawer(true))}
                onPointerDown={() => setMenuPressed(true)}
                onPointerUp={() => setMenuPressed(false)}
                onPointerLeave={() => setMenuPressed(false)}
                style={{
                  position: "absolute", top: 18, left: 4, padding: 6, cursor: "pointer", zIndex: 1,
                  width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                  visibility: !sub && isDesktop ? "hidden" : "visible",
                }}>
                {sub ? <ArrowLeft size={20} strokeWidth={1.6} color="#1c1c1e" /> : (
                  <span style={{ position: "relative", width: 20, height: 20 }}>
                    <span style={{
                      position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: menuPressed ? 0 : 1,
                      transform: menuPressed ? "rotate(80deg) scale(0.5)" : "rotate(0deg) scale(1)",
                      transition: "opacity .5s ease, transform .5s cubic-bezier(.4,0,.2,1)",
                    }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <rect x="2" y="3" width="16" height="2" rx="1" fill="#8e8e93" />
                        <rect x="2" y="9" width="16" height="2" rx="1" fill="#8e8e93" />
                        <rect x="2" y="15" width="16" height="2" rx="1" fill="#8e8e93" />
                      </svg>
                    </span>
                    <span style={{
                      position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: menuPressed ? 1 : 0,
                      transform: menuPressed ? "rotate(0deg) scale(1)" : "rotate(-80deg) scale(0.5)",
                      transition: "opacity .5s ease, transform .5s cubic-bezier(.4,0,.2,1)",
                    }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: "#1c1c1e", fontFamily: "'Inter', " + FONT }}>N</span>
                    </span>
                  </span>
                )}
              </button>
              <button onClick={() => { setNotifOpen(true); act.readNotifications(); }} style={{
                position: "absolute", top: 18, right: 4, padding: 6, cursor: "pointer", zIndex: 1,
              }}>
                <Bell size={19} strokeWidth={1.6} color="#1c1c1e" />
                {unread > 0 && <span style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: 999, background: "#111" }} />}
              </button>
              <div style={{ textAlign: "center", paddingTop: 4 }}>
                <div style={{
                  fontSize: 52, fontWeight: 800, letterSpacing: "-2px", lineHeight: 1,
                  backgroundImage: "linear-gradient(180deg, rgba(28,28,30,0.55), rgba(28,28,30,0.14))",
                  WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
                }}>Nurora</div>
                {(() => {
                  const onWeekOffLeave = !!(sub && (sub.screen === "leaves" || (sub.screen === "myprofile" && sub.id === user.counsellorId)));
                  const onMySummary = !!(sub && sub.screen === "mysummary");
                  const onAttendance = !!(sub && sub.screen === "attendance");
                  const onNubills = !!(sub && sub.screen === "nubills");
                  const onPersonas = !!(sub && sub.screen === "personas");
                  const onBric = !!(sub && sub.screen === "bric");
                  const onReviews = !!(sub && sub.screen === "reviews");
                  const onFollowups = !!(sub && sub.screen === "followups");
                  const onSchedule = tab === "schedule" && !sub;
                  const navActive = (onSchedule && !user.isNuLancer) || onWeekOffLeave || onMySummary || onAttendance || onNubills || onPersonas || onBric || onReviews || onFollowups;
                  const navLabel = onWeekOffLeave ? "Week-offs and Leave" : onMySummary ? "My Summary" : onAttendance ? "Attendance" : onNubills ? "Nubills" : onPersonas ? "Persona" : onBric ? "BRIC" : onReviews ? "Google Reviews" : onFollowups ? "Follow-up & Commitments" : "Schedule's";
                  if (navActive) {
                    return (
                      <button onClick={() => setTitleMenuOpen((v) => !v)} style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 2,
                        background: "none", border: "none", cursor: "pointer", padding: "4px 8px",
                      }}>
                        <span style={{ fontSize: 21, fontWeight: 800, color: "#1c1c1e", letterSpacing: "-0.3px" }}>{navLabel}</span>
                        <ChevronDown size={17} strokeWidth={2.2} color="#1c1c1e"
                          style={{ transform: titleMenuOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .25s cubic-bezier(.4,0,.2,1)" }} />
                      </button>
                    );
                  }
                  if (onSchedule) {
                    return (
                      <div style={{ marginTop: 2 }}>
                        <span style={{ fontSize: 21, fontWeight: 800, color: "#1c1c1e", letterSpacing: "-0.3px" }}>Schedule's</span>
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 2 }}>
                      <span style={{ fontSize: 21, fontWeight: 800, color: "#1c1c1e", letterSpacing: "-0.3px" }}>{title}</span>
                    </div>
                  );
                })()}
              </div>

              {(() => {
                const onWeekOffLeave = !!(sub && (sub.screen === "leaves" || (sub.screen === "myprofile" && sub.id === user.counsellorId)));
                const onMySummary = !!(sub && sub.screen === "mysummary");
                const onAttendance = !!(sub && sub.screen === "attendance");
                const onNubills = !!(sub && sub.screen === "nubills");
                const onPersonas = !!(sub && sub.screen === "personas");
                const onBric = !!(sub && sub.screen === "bric");
                const onReviews = !!(sub && sub.screen === "reviews");
                const onFollowups = !!(sub && sub.screen === "followups");
                const onSchedule = tab === "schedule" && !sub && !user.isNuLancer;
                if (!titleMenuOpen || !(onSchedule || onWeekOffLeave || onMySummary || onAttendance || onNubills || onPersonas || onBric || onReviews || onFollowups)) return null;
                const currentKey = onWeekOffLeave ? "leaves" : onMySummary ? "mysummary" : onAttendance ? "attendance" : onNubills ? "nubills" : onPersonas ? "personas" : onBric ? "bric" : onReviews ? "reviews" : onFollowups ? "followups" : "schedule";
                const navOptions = [
                  { key: "schedule", label: "Schedule" },
                  { key: "leaves", label: "Week-offs and Leave" },
                  { key: "attendance", label: "Attendance" },
                  { key: "nubills", label: "Nubills" },
                  { key: "personas", label: "Persona" },
                  { key: "bric", label: "BRIC" },
                  { key: "reviews", label: "Google Reviews" },
                  { key: "followups", label: "Follow-up & Commitments" },
                  ...(user.role !== "admin" ? [{ key: "mysummary", label: "My Summary" }] : []),
                  { key: "more", label: "More" },
                  ...(user.role === "admin" ? [
                    { key: "counsellors", label: "Nurora Roster\u2019s" },
                    { key: "nulancers", label: "NuLancers" },
                    { key: "interestBooked", label: "Interest & Booked" },
                    { key: "reports", label: "Reports" },
                    { key: "settings", label: "Settings" },
                  ] : []),
                ].filter((opt) => opt.key !== currentKey)
                  .filter((opt) => ["schedule", "more", "counsellors", "nulancers", "interestBooked", "reports", "settings"].includes(opt.key) || canAccess(opt.key));
                return (
                  <>
                    <div onClick={() => setTitleMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 45, touchAction: "pan-y" }} />
                    <div style={{
                      position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 8,
                      zIndex: 46, minWidth: 232, borderRadius: 28, overflow: "hidden", padding: "8px",
                      background: "rgba(255,255,255,0.5)", backdropFilter: "blur(28px) saturate(190%)", WebkitBackdropFilter: "blur(28px) saturate(190%)",
                      border: "1px solid rgba(255,255,255,0.85)", boxShadow: "0 16px 40px rgba(20,20,20,0.16), 0 4px 12px rgba(20,20,20,0.08)",
                    }}>
                      {navOptions.map((opt) => (
                        <button key={opt.key} onClick={() => {
                          setTitleMenuOpen(false);
                          if (opt.key === "schedule" || opt.key === "more") { switchTab(opt.key); return; }
                          if (opt.key === "leaves") {
                            setSub(user.role === "admin" ? { screen: "leaves" } : { screen: "myprofile", id: user.counsellorId });
                            return;
                          }
                          setSub({ screen: opt.key });
                        }}
                          style={{
                            width: "100%", position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
                            padding: "13px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "center",
                            borderRadius: 18, fontFamily: FONT,
                          }}>
                          <span style={{ fontSize: 15, color: "#1c1c1e" }}>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </header>

        <main style={{ flex: 1, width: "100%", maxWidth: 980, margin: "0 auto", paddingBottom: 120 }}>
          {body}
        </main>
      </div>

      {/* drawer */}
      {drawer && (
        <div onClick={() => setDrawer(false)} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(17,17,17,0.18)" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 268, height: "100%", background: "#fff", borderRight: `1px solid ${C.line}`, padding: "26px 18px", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            {(() => {
              const myC = user.role === "resource" ? data.counsellors.find((c) => c.id === user.counsellorId) : null;
              const handleAvatarClick = () => {
                if (user.role === "admin") { setAgreementEditorOpen(true); setDrawer(false); }
                else if (myC) { setMyDetailsOpen(true); setDrawer(false); }
              };
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
                  <StatusAvatar name={user.name} size={44} photo={myC ? myC.photo : null} accountStatus={myC ? myC.accountStatus : "mpin"} isOwner={myC ? myC.isOwner : false} onClick={handleAvatarClick} />
                  <div>
                    <div style={{ fontSize: 19, letterSpacing: "-0.3px" }}>Nurora</div>
                    <div style={{ fontSize: 12, color: C.soft, marginTop: 2 }}>{user.name} · {user.role === "admin" ? "Admin" : user.isNuLancer ? "NuLancer" : "Counsellor"}</div>
                  </div>
                </div>
              );
            })()}
            {user.role === "resource" && (() => {
              const myC = data.counsellors.find((c) => c.id === user.counsellorId);
              if (!myC || myC.isOwner || myC.accountStatus !== "tpin") return null;
              return (
                <button onClick={() => { setSignupWizardOpen(true); setDrawer(false); }} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", marginBottom: 12,
                  borderRadius: 12, fontSize: 13, color: "#b42318", background: "#fdecea", border: "1px solid #f3c6c0", cursor: "pointer", textAlign: "left",
                }}>
                  <Shield size={16} strokeWidth={1.5} color="#b42318" />
                  <span style={{ flex: 1 }}>You're on a temporary PIN — complete signup</span>
                </button>
              );
            })()}
            {user.role === "resource" && (() => {
              const myC = data.counsellors.find((c) => c.id === user.counsellorId);
              if (!myC || myC.isOwner || myC.accountStatus !== "mpin" || !myC.agreementSignedAt) return null;
              const daysLeft = Math.max(0, Math.ceil(7 - (Date.now() - myC.agreementSignedAt) / 86400000));
              if (daysLeft <= 0) return null;
              return (
                <button onClick={() => { setAgreementViewOpen(true); setDrawer(false); }} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", marginBottom: 12,
                  borderRadius: 12, fontSize: 13, color: C.mid, background: C.chip, border: "none", cursor: "pointer", textAlign: "left",
                }}>
                  <FileText size={16} strokeWidth={1.5} color={C.mid} />
                  <span style={{ flex: 1 }}>View my agreement — {daysLeft}d left</span>
                </button>
              );
            })()}
            {TABS.filter((t) => !["invoices", "sessions", "clients", "more"].includes(t[0])).map(([k, label, Icon]) => (
              <button key={k} onClick={() => { switchTab(k); setDrawer(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <Icon size={17} strokeWidth={1.4} color={C.mid} />{label}
              </button>
            ))}
            {canAccess("weekoffs") && (
              <button onClick={() => {
                setSub(user.role === "admin" ? { screen: "leaves" } : { screen: "myprofile", id: user.counsellorId });
                setDrawer(false);
              }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <CalendarOff size={17} strokeWidth={1.4} color={C.mid} />Week-offs and Leave
              </button>
            )}
            {canAccess("attendance") && (
              <button onClick={() => { setSub({ screen: "attendance" }); setDrawer(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <MapPin size={17} strokeWidth={1.4} color={C.mid} />Attendance
              </button>
            )}
            {canAccess("nubills") && (
              <button onClick={() => { setSub({ screen: "nubills" }); setDrawer(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <FileText size={17} strokeWidth={1.4} color={C.mid} />Nubills
              </button>
            )}
            {canAccess("personas") && (
              <button onClick={() => { setSub({ screen: "personas" }); setDrawer(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <UserCheck size={17} strokeWidth={1.4} color={C.mid} />Persona
              </button>
            )}
            {canAccess("bric") && (
              <button onClick={() => { setSub({ screen: "bric" }); setDrawer(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <Filter size={17} strokeWidth={1.4} color={C.mid} />BRIC
              </button>
            )}
            {canAccess("reviews") && (
              <button onClick={() => { setSub({ screen: "reviews" }); setDrawer(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <Star size={17} strokeWidth={1.4} color={C.mid} />Google Reviews
              </button>
            )}
            {canAccess("followups") && (
              <button onClick={() => { setSub({ screen: "followups" }); setDrawer(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <CalendarClock size={17} strokeWidth={1.4} color={C.mid} />
                <span style={{ flex: 1 }}>Follow-up &amp; Commitments</span>
                {pendingFollowUpCount > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: "#e74c3c", borderRadius: 999, padding: "2px 7px", minWidth: 18, textAlign: "center" }}>
                    {pendingFollowUpCount}
                  </span>
                )}
              </button>
            )}
            {(user.role === "admin" || (data.counsellors.find((c) => c.id === user.counsellorId) || {}).benefitsEnabled) && (
              <button onClick={() => { setSub({ screen: "benefits" }); setDrawer(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <Shield size={17} strokeWidth={1.4} color={C.mid} />Resource Special Benefits
              </button>
            )}
            {user.role !== "admin" && canAccess("mysummary") && (
              <button onClick={() => { setSub({ screen: "mysummary" }); setDrawer(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <BarChart3 size={17} strokeWidth={1.4} color={C.mid} />My Summary
              </button>
            )}
            <button onClick={() => setMoreExpanded(!moreExpanded)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
              <MoreHorizontal size={17} strokeWidth={1.4} color={C.mid} />
              <span style={{ flex: 1 }}>More</span>
              <ChevronDown size={15} strokeWidth={1.6} color={C.faint} style={{ transform: moreExpanded ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
            </button>
            {moreExpanded && (
              <div style={{ paddingLeft: 8 }}>
                {user.role === "admin" && [["counsellors", "Nurora Roster\u2019s", Users], ["nulancers", "NuLancers", Users], ["interestBooked", "Interest & Booked", FileText], ["reports", "Reports", BarChart3], ["settings", "Settings", SettingsIcon]].map(([k, label, Icon]) => (
                  <button key={k} onClick={() => { setSub({ screen: k }); setDrawer(false); }}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <Icon size={17} strokeWidth={1.4} color={C.mid} />{label}
                  </button>
                ))}
                {user.role === "resource" && user.isNuLancer && !(data.counsellors.find((c) => c.id === user.counsellorId) || {}).isOwner && (
                  <button onClick={() => { setSub({ screen: "salary" }); setDrawer(false); }}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, fontSize: 14.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <Tag size={17} strokeWidth={1.4} color={C.mid} />Salary
                  </button>
                )}
              </div>
            )}
            <button onClick={act.logout} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", marginTop: 12, borderRadius: 12, fontSize: 14.5, color: C.mid, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
              <LogOut size={17} strokeWidth={1.4} color={C.mid} />Sign out
            </button>
          </div>
        </div>
      )}

      <SignupWizard open={signupWizardOpen} onClose={() => setSignupWizardOpen(false)}
        counsellor={user.role === "resource" ? data.counsellors.find((c) => c.id === user.counsellorId) : null} act={act} data={data} />
      {user.role === "admin" && (
        <AgreementEditorSheet open={agreementEditorOpen} onClose={() => setAgreementEditorOpen(false)} data={data} act={act} go={go} />
      )}
      {user.role === "resource" && (
        <AgreementViewSheet open={agreementViewOpen} onClose={() => setAgreementViewOpen(false)}
          counsellor={data.counsellors.find((c) => c.id === user.counsellorId)} data={data} />
      )}
      {user.role === "resource" && (
        <MyDetailsSheet open={myDetailsOpen} onClose={() => setMyDetailsOpen(false)}
          counsellor={data.counsellors.find((c) => c.id === user.counsellorId)} act={act} data={data} />
      )}

      {/* quick book bar (collapsed entry point) */}
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 55,
        padding: "0 12px calc(6px + env(safe-area-inset-bottom, 0px))",
        pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      }}>
        <div style={{
          width: "100%", maxWidth: 620, pointerEvents: "auto",
          background: "#fff", borderRadius: 32, border: `1px solid ${C.line}`,
          boxShadow: "0 10px 32px rgba(20,20,20,0.10), 0 2px 8px rgba(20,20,20,0.05)",
          padding: user.isNuLancer ? "14px 18px" : "16px 18px 14px",
        }}>
          {!user.isNuLancer && (
            <input
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              onFocus={() => setChatOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && quickText.trim()) {
                  act.sendMessage(quickText.trim());
                  setQuickText("");
                  setChatOpen(true);
                }
              }}
              placeholder="Message the team…"
              style={{ width: "100%", border: "none", outline: "none", fontSize: 15, color: C.ink, fontFamily: FONT, padding: "2px 2px 14px", background: "transparent" }}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => setBarPlusOpen((v) => !v)} aria-label="Add" style={{
                width: 36, height: 36, borderRadius: 999, background: C.chip, border: "none",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
              }}>
                <Plus size={17} strokeWidth={1.8} color="#1c1c1e"
                  style={{ transform: barPlusOpen ? "rotate(45deg)" : "none", transition: "transform .18s ease" }} />
              </button>
              {barPlusOpen && (
                <>
                  <div onClick={() => setBarPlusOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 56, touchAction: "pan-y" }} />
                  <div style={{
                    position: "absolute", left: 0, bottom: "100%", marginBottom: 8, zIndex: 57,
                    minWidth: 210, borderRadius: 20, overflow: "hidden", padding: 6,
                    background: "rgba(255,255,255,0.9)", backdropFilter: "blur(26px) saturate(190%)", WebkitBackdropFilter: "blur(26px) saturate(190%)",
                    border: "1px solid rgba(255,255,255,0.85)", boxShadow: "0 16px 40px rgba(20,20,20,0.16), 0 4px 12px rgba(20,20,20,0.08)",
                  }}>
                    <button onClick={() => { setBarPlusOpen(false); setQuickPrefill(null); setQuickOpen(true); }} style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", background: "transparent",
                      border: "none", cursor: "pointer", textAlign: "left", borderRadius: 14, fontFamily: FONT,
                    }}>
                      <Calendar size={16} strokeWidth={1.5} color={C.mid} />
                      <span style={{ fontSize: 13.5, color: "#1c1c1e" }}>New appointment</span>
                    </button>
                    {!user.isNuLancer && (
                      <>
                        <button onClick={() => { setBarPlusOpen(false); setComposeKind("todo"); setChatOpen(true); }} style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", background: "transparent",
                          border: "none", cursor: "pointer", textAlign: "left", borderRadius: 14, fontFamily: FONT,
                        }}>
                          <Check size={16} strokeWidth={1.7} color={C.mid} />
                          <span style={{ fontSize: 13.5, color: "#1c1c1e" }}>To-Do</span>
                        </button>
                        <button onClick={() => { setBarPlusOpen(false); setComposeKind("task"); setChatOpen(true); }} style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", background: "transparent",
                          border: "none", cursor: "pointer", textAlign: "left", borderRadius: 14, fontFamily: FONT,
                        }}>
                          <BarChart3 size={16} strokeWidth={1.5} color={C.mid} />
                          <span style={{ fontSize: 13.5, color: "#1c1c1e" }}>Task</span>
                        </button>
                        <button onClick={() => {
                          setBarPlusOpen(false); setChatOpen(true);
                          setTimeout(() => fileInputRef.current && fileInputRef.current.click(), 300);
                        }} style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", background: "transparent",
                          border: "none", cursor: "pointer", textAlign: "left", borderRadius: 14, fontFamily: FONT,
                        }}>
                          <FileText size={16} strokeWidth={1.5} color={C.mid} />
                          <span style={{ fontSize: 13.5, color: "#1c1c1e" }}>Attachment</span>
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <button onClick={() => { setQuickPrefill(null); setQuickOpen(true); }} style={{
              display: "flex", alignItems: "center", height: 36, padding: "0 14px", borderRadius: 999,
              background: C.chip, border: "none", cursor: "pointer",
            }}>
              <span style={{ fontSize: 13.5, color: "#1c1c1e", fontWeight: 500 }}>Quick Book</span>
            </button>
            <div style={{ flex: 1 }} />
            {!user.isNuLancer && (
              <>
                <button onClick={() => flash("Voice notes are coming soon.")} aria-label="Voice note" style={{
                  width: 36, height: 36, borderRadius: 999, background: "transparent", border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
                }}>
                  <Mic size={19} strokeWidth={1.6} color={C.mid} />
                </button>
                <button
                  onClick={() => { if (quickText.trim()) { act.sendMessage(quickText.trim()); setQuickText(""); setChatOpen(true); } }}
                  aria-label="Send"
                  style={{
                    width: 36, height: 36, borderRadius: 999, background: quickText.trim() ? "#111" : C.ghost,
                    border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: quickText.trim() ? "pointer" : "default", flexShrink: 0,
                  }}>
                  <ArrowUp size={18} strokeWidth={2.2} color="#fff" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* team chat — full screen */}
      {chatOpen && !user.isNuLancer && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#fff", display: "flex", flexDirection: "column" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 12, padding: "calc(14px + env(safe-area-inset-top,0px)) 16px 14px",
            borderBottom: `1px solid ${C.hair}`, flexShrink: 0,
          }}>
            <button onClick={() => setChatOpen(false)} style={{ cursor: "pointer", display: "flex", padding: 4 }}>
              <ArrowLeft size={21} strokeWidth={1.6} color="#1c1c1e" />
            </button>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#1c1c1e" }}>Team chat</span>
          </div>

          <div ref={chatScrollRef} style={{ flex: 1, overflowY: "auto", padding: "18px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
            {(data.messages || []).length === 0 && (
              <div style={{ fontSize: 13, color: C.faint, textAlign: "center", padding: "40px 0" }}>No activity yet. Say hello to the team.</div>
            )}
            {(() => {
              let lastDay = null;
              return (data.messages || []).map((m) => {
                const dayKey = ymd(new Date(m.ts));
                const showHeader = dayKey !== lastDay;
                lastDay = dayKey;
                const kindIcon = m.kind === "todo" ? "☐ " : m.kind === "task" ? "▤ " : m.kind === "attachment" ? "📎 " : "";
                const isSystem = m.senderId === "system";
                const mine = !isSystem && (user.role === "admin" ? m.senderId === "admin" : m.senderId === user.counsellorId);
                return (
                  <React.Fragment key={m.id}>
                    {showHeader && (
                      <div style={{ textAlign: "center", margin: "6px 0 2px" }}>
                        <span style={{ fontSize: 11, color: C.faint, background: C.chip, borderRadius: 999, padding: "4px 12px" }}>
                          {chatDayHeader(dayKey)}
                        </span>
                      </div>
                    )}
                    {isSystem ? (
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontSize: 14, lineHeight: 1.45, color: "#1c1c1e", wordBreak: "break-word" }}>
                          <span style={{ fontWeight: 700, color: C.mid }}>{m.senderName}</span>
                          {": "}
                          <span style={{ color: C.mid }}>{m.text}</span>
                        </div>
                        <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{chatTime(m.ts)}</div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                        <div style={{ maxWidth: "82%", display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
                          <div style={{
                            background: "rgba(255,255,255,0.55)", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)",
                            border: "1px solid rgba(255,255,255,0.75)", borderRadius: 17, padding: "9px 13px",
                            boxShadow: "0 6px 18px rgba(20,20,20,0.07), 0 1px 3px rgba(20,20,20,0.04)",
                          }}>
                            <span style={{ fontSize: 14, lineHeight: 1.45, color: "#1c1c1e", wordBreak: "break-word" }}>
                              <span style={{ fontWeight: 700 }}>{m.senderName}</span>
                              {": "}
                              {m.tag && <span style={{ fontSize: 11, color: C.mid, background: C.chip, borderRadius: 999, padding: "2px 7px", marginRight: 5 }}>{m.tag}</span>}
                              {kindIcon}{m.text}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{chatTime(m.ts)}</div>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              });
            })()}
          </div>

          <div style={{ padding: "10px 12px calc(10px + env(safe-area-inset-bottom,0px))", borderTop: `1px solid ${C.hair}`, flexShrink: 0, position: "relative" }}>
            {(composeKind !== "text" || composeTag) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {composeKind !== "text" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.mid, background: C.chip, borderRadius: 999, padding: "4px 10px" }}>
                    {composeKind === "todo" ? "To-Do" : "Task"}
                    <button onClick={() => setComposeKind("text")} style={{ cursor: "pointer", display: "flex" }}><X size={12} strokeWidth={2} color={C.faint} /></button>
                  </span>
                )}
                {composeTag && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.mid, background: C.chip, borderRadius: 999, padding: "4px 10px" }}>
                    {composeTag}
                    <button onClick={() => setComposeTag(null)} style={{ cursor: "pointer", display: "flex" }}><X size={12} strokeWidth={2} color={C.faint} /></button>
                  </span>
                )}
              </div>
            )}

            <div style={{
              display: "flex", alignItems: "center", gap: 8, background: C.chip, borderRadius: 999, padding: "6px 6px 6px 6px",
            }}>
              <button onClick={() => setPlusMenu(plusMenu ? null : "root")} aria-label="Add" style={{
                position: "relative", width: 34, height: 34, borderRadius: 999, background: "#fff", border: `1px solid ${C.line}`,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
              }}>
                <Plus size={17} strokeWidth={1.8} color="#1c1c1e"
                  style={{ transform: plusMenu ? "rotate(45deg)" : "none", transition: "transform .18s ease" }} />
                {unreadMsgCount > 0 && (
                  <span style={{
                    position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 999,
                    background: "#e0392c", color: "#fff", fontSize: 9.5, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
                    border: "1.5px solid #fff",
                  }}>{unreadMsgCount > 9 ? "9+" : unreadMsgCount}</span>
                )}
              </button>
              <input
                autoFocus
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && quickText.trim()) {
                    act.sendMessage(quickText.trim(), { kind: composeKind, tag: composeTag });
                    setQuickText(""); setComposeKind("text"); setComposeTag(null);
                  }
                }}
                placeholder={composeKind === "todo" ? "Add a to-do…" : composeKind === "task" ? "Add a task…" : "Message the team…"}
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 15, color: C.ink, fontFamily: FONT }}
              />
              <button
                onClick={() => { if (quickText.trim()) { act.sendMessage(quickText.trim(), { kind: composeKind, tag: composeTag }); setQuickText(""); setComposeKind("text"); setComposeTag(null); } }}
                aria-label="Send"
                style={{
                  width: 34, height: 34, borderRadius: 999, background: quickText.trim() ? "#111" : C.ghost,
                  border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: quickText.trim() ? "pointer" : "default", flexShrink: 0,
                }}>
                <ArrowUp size={17} strokeWidth={2.2} color="#fff" />
              </button>
            </div>

            {plusMenu && (
              <>
                <div onClick={() => setPlusMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 100, touchAction: "pan-y" }} />
                <div style={{
                  position: "absolute", left: 12, bottom: "100%", marginBottom: 8, zIndex: 101,
                  minWidth: 220, maxWidth: 280, borderRadius: 22, overflow: "hidden", padding: 6,
                  background: "rgba(255,255,255,0.85)", backdropFilter: "blur(26px) saturate(190%)", WebkitBackdropFilter: "blur(26px) saturate(190%)",
                  border: "1px solid rgba(255,255,255,0.85)", boxShadow: "0 16px 40px rgba(20,20,20,0.16), 0 4px 12px rgba(20,20,20,0.08)",
                }}>
                  {plusMenu === "root" ? (
                    <>
                      <button onClick={() => { fileInputRef.current && fileInputRef.current.click(); }} style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 12px", background: "transparent",
                        border: "none", cursor: "pointer", textAlign: "left", borderRadius: 14, fontFamily: FONT,
                      }}>
                        <FileText size={16} strokeWidth={1.5} color={C.mid} />
                        <span style={{ fontSize: 14, color: "#1c1c1e" }}>Attachment</span>
                      </button>
                      <button onClick={() => { setComposeKind("todo"); setPlusMenu(null); }} style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 12px", background: "transparent",
                        border: "none", cursor: "pointer", textAlign: "left", borderRadius: 14, fontFamily: FONT,
                      }}>
                        <Check size={16} strokeWidth={1.7} color={C.mid} />
                        <span style={{ fontSize: 14, color: "#1c1c1e" }}>To-Do</span>
                      </button>
                      <button onClick={() => { setComposeKind("task"); setPlusMenu(null); }} style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 12px", background: "transparent",
                        border: "none", cursor: "pointer", textAlign: "left", borderRadius: 14, fontFamily: FONT,
                      }}>
                        <BarChart3 size={16} strokeWidth={1.5} color={C.mid} />
                        <span style={{ fontSize: 14, color: "#1c1c1e" }}>Task</span>
                      </button>
                      <button onClick={() => setPlusMenu("tags")} style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 12px",
                        background: "transparent", border: "none", cursor: "pointer", textAlign: "left", borderRadius: 14, fontFamily: FONT,
                      }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <CalendarOff size={16} strokeWidth={1.5} color={C.mid} style={{ display: "none" }} />
                          <span style={{ fontSize: 14, color: "#1c1c1e" }}>Add Tags</span>
                        </span>
                        <ChevronRight size={15} strokeWidth={1.6} color={C.faint} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setPlusMenu("root")} style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 10px 12px",
                        background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT,
                      }}>
                        <ChevronLeft size={15} strokeWidth={1.8} color={C.mid} />
                        <span style={{ fontSize: 12.5, color: C.mid }}>Back</span>
                      </button>
                      <div style={{ maxHeight: 260, overflowY: "auto" }}>
                        {CHAT_TAGS.map((tg) => (
                          <button key={tg} onClick={() => { setComposeTag(tg); setPlusMenu(null); }} style={{
                            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "11px 12px", background: composeTag === tg ? "rgba(0,0,0,0.05)" : "transparent",
                            border: "none", cursor: "pointer", textAlign: "left", borderRadius: 14, fontFamily: FONT,
                          }}>
                            <span style={{ fontSize: 13.5, color: "#1c1c1e" }}>{tg}</span>
                            {composeTag === tg && <Check size={15} strokeWidth={2.2} color="#1c1c1e" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) { act.sendMessage(f.name, { kind: "attachment" }); }
                setPlusMenu(null);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}

      <NewAppointmentSheet
        open={quickOpen}
        onClose={() => { setQuickOpen(false); setQuickPrefill(null); setQuickText(""); }}
        data={data} act={act} date={ymd(new Date())} user={user}
        prefill={quickPrefill}
        initialClientName={quickText.trim()}
      />

      {/* notifications */}
      <Sheet open={notifOpen} onClose={() => setNotifOpen(false)} title="Notifications">
        {myNotifs.length === 0 && <Empty text="Nothing new. Bookings for you appear here." />}
        <div style={{ display: "grid", gap: 2 }}>
          {myNotifs.slice(0, 30).map((n) => (
            <div key={n.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.hair}` }}>
              <div style={{ fontSize: 14 }}>{n.title}</div>
              <div style={{ fontSize: 12.5, color: C.soft, marginTop: 3 }}>{n.body}</div>
            </div>
          ))}
        </div>
      </Sheet>

      <Toast msg={toast} />
    </div>
  );
}
