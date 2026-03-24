import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC_Vz5gd8uZ2jLbt0MtKHipkF-1jJcWMbY",
  authDomain: "rateblaster-app.firebaseapp.com",
  projectId: "rateblaster-app",
  storageBucket: "rateblaster-app.firebasestorage.app",
  messagingSenderId: "826291139655",
  appId: "1:826291139655:web:8e186a037fb603eb152d62"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

export async function GET() {
  try {
    const q = query(collection(db, 'rates'), orderBy('date', 'desc'), limit(1));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return Response.json({ rates: null, message: 'No rates available yet.' });
    }

    const data = snapshot.docs[0].data();
    return Response.json({ rates: data });
  } catch (error) {
    return Response.json({ error: 'Failed to fetch rates.' }, { status: 500 });
  }
}
