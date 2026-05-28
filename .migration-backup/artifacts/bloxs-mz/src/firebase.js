import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAvHkJopM2vGTvZSRbOTysBNRke-S4l74Y",
  authDomain: "bloxs-mz.firebaseapp.com",
  databaseURL: "https://bloxs-mz-default-rtdb.firebaseio.com",
  projectId: "bloxs-mz",
  storageBucket: "bloxs-mz.firebasestorage.app",
  messagingSenderId: "783500430815",
  appId: "1:783500430815:web:0d8d83520938cf123a886a",
};

export const isMockMode = false;

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const rtdb = getDatabase(app);
