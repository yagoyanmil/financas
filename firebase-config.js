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
export const firebaseConfig = null;
/* Exemplo, depois de criar o projeto:
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "financas-casal.firebaseapp.com",
  projectId: "financas-casal",
  storageBucket: "financas-casal.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
*/

// ID sugerido para o "espaço" compartilhado do casal (usado só na primeira
// vez que abrirem o app, na tela de entrada).
export const SUGGESTED_HOUSEHOLD_ID = "casa-yupxfw11k1";
