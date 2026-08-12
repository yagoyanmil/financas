// Configuração do Firebase (Firestore) usada para sincronizar os lançamentos
// entre os aparelhos do casal em tempo real.
//
// Enquanto firebaseConfig for `null`, o app roda em modo local (só neste
// navegador, sem sincronizar) — igual ao comportamento anterior.
//
// Para ativar a sincronização: crie um projeto gratuito em
// https://console.firebase.google.com, ative Firestore + Authentication
// (método Anônimo), registre um app Web e cole aqui o objeto que o
// console mostrar.
export const firebaseConfig = {
  apiKey: "AIzaSyB56FvRq48FkQDkKNRN8vssM3KByMmTuBs",
  authDomain: "financas-casal-f12e6.firebaseapp.com",
  projectId: "financas-casal-f12e6",
  storageBucket: "financas-casal-f12e6.firebasestorage.app",
  messagingSenderId: "1032383118603",
  appId: "1:1032383118603:web:df3eb5620bcc94e34bf60e"
};

// ID sugerido para o "espaço" compartilhado do casal (usado só na primeira
// vez que abrirem o app, na tela de entrada).
export const SUGGESTED_HOUSEHOLD_ID = "casa-yupxfw11k1";
