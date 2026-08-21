/* =========================================================
   AEGIS LEAGUE — firebase-init.js
   Pega aquí el firebaseConfig que copiaste de la consola
   de Firebase (Configuración del proyecto > Tus apps).
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBtA4Hnmzddm_hd0Z0KbbV10DsGlY7U-Ww",
  authDomain: "aegis-league.firebaseapp.com",
  projectId: "aegis-league",
  storageBucket: "aegis-league.firebasestorage.app",
  messagingSenderId: "957930185092",
  appId: "1:957930185092:web:b1c32b3ce418ed31d37dd1",
  measurementId: "G-X6NZGQ6PET"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

// Correo del usuario admin que creaste en Authentication > Users
export const ADMIN_EMAIL = "admin@aegisleague.com";
