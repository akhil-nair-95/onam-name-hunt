// Shared data layer for both index.html and admin.html.
// Uses the Firebase v10 modular SDK loaded straight from Google's CDN as
// ES modules — no build step, no npm install, works as plain static files.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc,
  onSnapshot, query, where, orderBy, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const STATUS_REF = doc(db, "contest", "status");

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Resolves once we have SOME signed-in user (anonymous is fine for the
// public page). Every call site awaits this before touching Firestore.
let readyResolve;
export const authReady = new Promise((res) => { readyResolve = res; });

onAuthStateChanged(auth, (user) => {
  if (user) {
    readyResolve(user);
  } else {
    signInAnonymously(auth).catch((err) => {
      console.error("Anonymous sign-in failed", err);
    });
  }
});

export function getUid() {
  return authReady.then((u) => u.uid);
}

export function adminSignIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function adminSignOut() {
  return signOut(auth);
}

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}

// ---------------------------------------------------------------------------
// Names: submit, vote, live list
// ---------------------------------------------------------------------------

function normalize(text) {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Has this device already submitted a name? If so, returns that name's
 * data (so the UI can show "you already suggested: ...") — otherwise null.
 * Call this on page load, before showing the submission form.
 */
export async function getMySubmission() {
  const uid = await getUid();
  const claimSnap = await getDoc(doc(db, "submitters", uid));
  if (!claimSnap.exists()) return null;

  const nameId = claimSnap.data().nameId;
  const nameSnap = await getDoc(doc(db, "names", nameId));
  return nameSnap.exists() ? { id: nameSnap.id, ...nameSnap.data() } : null;
}

/**
 * Submits a new name — but only once per device, ever. If this device has
 * already submitted, throws ALREADY_SUBMITTED instead (check
 * getMySubmission() up front so the UI never even gets here in that case).
 *
 * If the typed name (case-insensitive) already exists from someone else,
 * this device's vote is added to that existing entry instead of creating a
 * duplicate — but the one-submission-per-device claim is still recorded
 * either way, so this device can't submit again afterwards.
 *
 * submitterName is the suggester's own name (required, shown to the admin
 * only) so the winner's suggester can actually be identified afterwards.
 *
 * Returns { nameId, alreadyExisted, alreadyVoted }.
 */
export async function submitOrVoteName(rawText, rawSubmitterName) {
  const text = normalize(rawText);
  const submitterName = normalize(rawSubmitterName || "");
  if (!text) throw new Error("EMPTY_NAME");
  if (text.length > 60) throw new Error("TOO_LONG");
  if (!submitterName) throw new Error("EMPTY_SUBMITTER");
  if (submitterName.length > 60) throw new Error("SUBMITTER_TOO_LONG");

  const uid = await getUid();

  const claimRef = doc(db, "submitters", uid);
  const existingClaim = await getDoc(claimRef);
  if (existingClaim.exists()) throw new Error("ALREADY_SUBMITTED");

  const textLower = text.toLowerCase();

  const existing = await getDocs(
    query(collection(db, "names"), where("textLower", "==", textLower))
  );

  let nameId, alreadyExisted, alreadyVoted;

  if (!existing.empty) {
    const existingDoc = existing.docs[0];
    const result = await castVote(existingDoc.id, uid);
    nameId = existingDoc.id;
    alreadyExisted = true;
    alreadyVoted = !result.voted;
  } else {
    const nameRef = await addDoc(collection(db, "names"), {
      text,
      textLower,
      submitterName,
      votes: 0,
      submittedBy: uid,
      submittedAt: serverTimestamp(),
    });
    await castVote(nameRef.id, uid);
    nameId = nameRef.id;
    alreadyExisted = false;
    alreadyVoted = false;
  }

  // Record the one-submission-per-device claim. If this somehow already
  // exists (a rare race between two near-simultaneous attempts from the
  // same device), Firestore rejects the write — that's fine, it just means
  // the other attempt won the race; this vote/name still went through.
  try {
    await setDoc(claimRef, { nameId, submittedAt: serverTimestamp() });
  } catch (err) {
    console.warn("submitters claim race (harmless):", err.message);
  }

  return { nameId, alreadyExisted, alreadyVoted };
}

/**
 * Casts uid's vote for nameId, if they haven't already.
 * Returns { voted: boolean } — voted is false if they'd already voted before.
 */
export async function castVote(nameId, uid) {
  const nameRef = doc(db, "names", nameId);
  const voterRef = doc(db, "names", nameId, "voters", uid);

  return runTransaction(db, async (tx) => {
    const voterSnap = await tx.get(voterRef);
    if (voterSnap.exists()) {
      return { voted: false };
    }
    const nameSnap = await tx.get(nameRef);
    if (!nameSnap.exists()) throw new Error("NAME_NOT_FOUND");

    tx.set(voterRef, { votedAt: serverTimestamp() });
    tx.update(nameRef, { votes: nameSnap.data().votes + 1 });
    return { voted: true };
  });
}

export async function upvoteName(nameId) {
  const uid = await getUid();
  return castVote(nameId, uid);
}

/** Live subscription to the full names list, sorted by votes desc. */
export function subscribeToNames(cb) {
  // Sorting by a single field (votes) needs no manually-created index —
  // Firestore maintains single-field indexes automatically. Sorting by
  // votes AND submittedAt together would require a composite index to be
  // created by hand in the console, so we sort only by votes here and
  // break ties client-side instead (see sortNames below).
  const q = query(collection(db, "names"), orderBy("votes", "desc"));
  return onSnapshot(q, (snap) => {
    const names = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(sortNames(names));
  });
}

/** Sort by votes desc, breaking ties by earliest submission first. */
function sortNames(names) {
  return [...names].sort((a, b) => {
    if ((b.votes || 0) !== (a.votes || 0)) return (b.votes || 0) - (a.votes || 0);
    const at = a.submittedAt ? a.submittedAt.toMillis() : 0;
    const bt = b.submittedAt ? b.submittedAt.toMillis() : 0;
    return at - bt;
  });
}

/** Which of the given nameIds has the current device already voted for? */
export async function getVotedSet(nameIds) {
  const uid = await getUid();
  const checks = await Promise.all(
    nameIds.map(async (id) => {
      const snap = await getDoc(doc(db, "names", id, "voters", uid));
      return [id, snap.exists()];
    })
  );
  return new Set(checks.filter(([, voted]) => voted).map(([id]) => id));
}

// ---------------------------------------------------------------------------
// Contest status
// ---------------------------------------------------------------------------

const DEFAULT_STATUS = { isOpen: true, showNamesPublicly: false, winnerNameId: null, winnerMethod: null };

export function subscribeToStatus(cb) {
  return onSnapshot(STATUS_REF, (snap) => {
    cb(snap.exists() ? { ...DEFAULT_STATUS, ...snap.data() } : DEFAULT_STATUS);
  });
}

export async function ensureStatusDoc() {
  const snap = await getDoc(STATUS_REF);
  if (!snap.exists()) {
    await setDoc(STATUS_REF, { ...DEFAULT_STATUS, decidedAt: null });
  }
}

export function setContestOpen(isOpen) {
  return updateDoc(STATUS_REF, { isOpen });
}

export function setNamesPublicVisibility(showNamesPublicly) {
  return updateDoc(STATUS_REF, { showNamesPublicly });
}

export function declareWinner(nameId, method) {
  return updateDoc(STATUS_REF, {
    winnerNameId: nameId,
    winnerMethod: method,
    isOpen: false,
    decidedAt: serverTimestamp(),
  });
}

export function resetContest() {
  return updateDoc(STATUS_REF, {
    winnerNameId: null,
    winnerMethod: null,
    isOpen: true,
    decidedAt: null,
  });
}

export async function getAllNamesOnce() {
  const snap = await getDocs(collection(db, "names"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
