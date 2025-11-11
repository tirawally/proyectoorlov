// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyANdA5Og2P_BVteUo0hRaIXZPekTXovtx0",
  authDomain: "orlov-31454.firebaseapp.com",
  projectId: "orlov-31454",
  storageBucket: "orlov-31454.firebasestorage.app",
  messagingSenderId: "232672725058",
  appId: "1:232672725058:web:1c2d5b101ff8efe4df45db",
  measurementId: "G-JS95BC8HW8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

// Export for use in other files
export { app, auth, db };