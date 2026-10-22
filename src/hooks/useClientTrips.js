import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config.js";

export default function useClientTrips(userId) {
  const [state, setState] = useState({});

  useEffect(() => {
    if (!userId) return undefined;
    const unsubscribes = ["trips", "clientVisits"].map((name) =>
      onSnapshot(collection(db, "users", userId, name), (snapshot) => {
        const records = snapshot.docs.map((document) => ({
          ...document.data(), id: document.id,
        }));
        setState((current) => ({
          ...(current.userId === userId ? current : {}),
          userId,
          [name]: records,
          [`${name}Error`]: "",
        }));
      }, (error) => {
        console.error(`Erro ao carregar ${name}:`, error);
        setState((current) => ({
          ...(current.userId === userId ? current : {}),
          userId,
          [`${name}Error`]: `Não foi possível carregar viagens/visitas (${name}): ${error.message}. Confira se as regras atualizadas foram publicadas no Firebase.`,
        }));
      })
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [userId]);

  const current = state.userId === userId ? state : {};
  return {
    trips: current.trips || [],
    visits: current.clientVisits || [],
    loading: !current.trips || !current.clientVisits,
    error: current.tripsError || current.clientVisitsError || "",
  };
}
