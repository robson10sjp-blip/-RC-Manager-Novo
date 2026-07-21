import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCXYSMGNmCn9ZZd2RjOeJFZ2YSJfMfCjlA",
  authDomain: "rc-manager-novo.firebaseapp.com",
  projectId: "rc-manager-novo",
  storageBucket: "rc-manager-novo.firebasestorage.app",
  messagingSenderId: "395328443872",
  appId: "1:395328443872:web:e1d95127ae9c7d7b448785",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);