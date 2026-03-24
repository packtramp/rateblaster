import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC_Vz5gd8uZ2jLbt0MtKHipkF-1jJcWMbY",
  authDomain: "rateblaster-app.firebaseapp.com",
  projectId: "rateblaster-app",
  storageBucket: "rateblaster-app.firebasestorage.app",
  messagingSenderId: "826291139655",
  appId: "1:826291139655:web:8e186a037fb603eb152d62"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
