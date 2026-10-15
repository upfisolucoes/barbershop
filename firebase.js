import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
const firebaseConfig = {
  "apiKey": 'AIzaSyDPlXlrV6jB3_umuWl9x1jHbzckz-wXGMc',
  "authDomain": 'barber-4ed00.firebaseapp.com',
  "projectId": \'barber-4ed00',
  "storageBucket": 'barber-4ed00.firebasestorage.app',
  "messagingSenderId": '1055953662943',
  "appId": '1:1055953662943:web:7a7523b0d728aaf72d4a6a'
};
const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=getFirestore(app);
