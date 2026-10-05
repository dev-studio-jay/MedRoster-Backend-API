import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!process.env.FIREBASE_ADMIN_PROJECT_ID || !process.env.FIREBASE_ADMIN_CLIENT_EMAIL || !privateKey) {
        throw new Error(
            'Missing Firebase Admin credentials. Set FIREBASE_ADMIN_PROJECT_ID, ' +
            'FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY in your .env file.'
        );
    }

    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
            clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
            privateKey,
        }),
    });
}

export const db = getFirestore();
export const adminAuth = getAuth();

export function docToJson(snap) {
    if (!snap.exists) return null;
    return { _id: snap.id, ...snap.data() };
}

export function docsToJson(snaps) {
    return snaps.docs.map((s) => docToJson(s));
}

export async function batchedDelete(refs) {
    const chunks = chunkArray(refs, 499);
    for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach((ref) => batch.delete(ref));
        await batch.commit();
    }
}

export async function batchedUpdate(entries) {
    const chunks = chunkArray(entries, 499);
    for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach(({ ref, data }) => batch.update(ref, data));
        await batch.commit();
    }
}

export async function batchedSet(collRef, docs) {
    const chunks = chunkArray(docs, 499);
    for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach((doc) => batch.set(collRef.doc(), doc));
        await batch.commit();
    }
}

export function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}
