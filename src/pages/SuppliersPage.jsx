import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";
import { runTransaction } from "../firebase/firestoreAccess";
import "./SuppliersPage.css";

const emptyForm = { identifier: "", name: "", phone: "", city: "", notes: "" };

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [payables, setPayables] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingLock = useRef(false);

  useEffect(() => {
    let unsubscribeSuppliers = null;
    let unsubscribePayables = null;
    let generation = 0;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      generation += 1;
      const currentGeneration = generation;
      unsubscribeSuppliers?.();
      unsubscribePayables?.();
      setSuppliers([]);
      setPayables([]);
      setForm(emptyForm);
      setEditingId(null);
      setSearch("");
      setLoading(Boolean(user));
      setError("");

      if (!user) {
        setLoading(false);
        return;
      }

      unsubscribeSuppliers = onSnapshot(
        collection(db, "users", user.uid, "suppliers"),
        (snapshot) => {
          if (currentGeneration !== generation) return;
          setSuppliers(
            snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
          );
          setLoading(false);
        },
        (loadError) => {
          if (currentGeneration !== generation) return;
          console.error("Erro ao carregar fornecedores:", loadError);
          setError("Não foi possível carregar os fornecedores.");
          setLoading(false);
        }
      );
      unsubscribePayables = onSnapshot(
        collection(db, "users", user.uid, "payables"),
        (snapshot) => {
          if (currentGeneration !== generation) return;
          setPayables(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        },
        (loadError) => {
          if (currentGeneration !== generation) return;
          console.error("Erro ao verificar contas vinculadas:", loadError);
          setError("Não foi possível verificar as contas vinculadas aos fornecedores.");
        }
      );
    });

    return () => {
      generation += 1;
      unsubscribeAuth();
      unsubscribeSuppliers?.();
      unsubscribePayables?.();
    };
  }, []);

  const visibleSuppliers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return [...suppliers]
      .filter((supplier) =>
        !query ||
        [supplier.identifier, supplier.name, supplier.phone, supplier.city]
          .some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(query))
      )
      .sort((first, second) =>
        String(first.name || "").localeCompare(String(second.name || ""), "pt-BR")
      );
  }, [search, suppliers]);

  function handleChange(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const user = auth.currentUser;
    const identifier = form.identifier.trim();
    const name = form.name.trim();
    if (!user) {
      setError("Entre novamente no RC Manager para continuar.");
      return;
    }
    if (!identifier || !name) {
      setError("Informe a identificação única e o nome do fornecedor.");
      return;
    }
    const duplicateInLoadedRecords = suppliers.some(
      (supplier) =>
        supplier.id !== editingId &&
        String(supplier.identifier || "")
          .trim()
          .toLocaleLowerCase("pt-BR") === identifier.toLocaleLowerCase("pt-BR")
    );
    if (duplicateInLoadedRecords) {
      setError("Já existe um fornecedor com essa identificação.");
      return;
    }
    if (savingLock.current) return;

    try {
      savingLock.current = true;
      setSaving(true);
      setError("");
      const normalizedIdentifier = identifier.toLocaleLowerCase("pt-BR");
      const data = {
        identifier,
        normalizedIdentifier,
        name,
        phone: form.phone.trim(),
        city: form.city.trim(),
        notes: form.notes.trim(),
        updatedAt: serverTimestamp(),
      };
      const suppliersCollection = collection(db, "users", user.uid, "suppliers");
      const supplierReference = editingId
        ? doc(db, "users", user.uid, "suppliers", editingId)
        : doc(suppliersCollection);
      const identifierQuery = query(
        suppliersCollection,
        where("normalizedIdentifier", "==", normalizedIdentifier)
      );
      await runTransaction(db, async (transaction) => {
        const [matchingIdentifiers, supplierSnapshot] = await Promise.all([
          transaction.get(identifierQuery),
          editingId ? transaction.get(supplierReference) : Promise.resolve(null),
        ]);
        if (
          matchingIdentifiers.docs.some((item) => item.id !== editingId)
        ) {
          throw new Error("Já existe um fornecedor com essa identificação.");
        }
        if (editingId) {
          if (!supplierSnapshot?.exists()) {
            throw new Error("O fornecedor não foi encontrado.");
          }
          transaction.update(supplierReference, data);
        } else {
          transaction.set(supplierReference, {
            ...data,
            createdAt: serverTimestamp(),
          });
        }
      });
      resetForm();
    } catch (saveError) {
      console.error("Erro ao salvar fornecedor:", saveError);
      setError(`Não foi possível salvar o fornecedor: ${saveError.message}`);
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  }

  function editSupplier(supplier) {
    setEditingId(supplier.id);
    setForm({
      identifier: supplier.identifier || "",
      name: supplier.name || "",
      phone: supplier.phone || "",
      city: supplier.city || "",
      notes: supplier.notes || "",
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeSupplier(supplier) {
    const user = auth.currentUser;
    if (!user) {
      setError("Entre novamente no RC Manager para continuar.");
      return;
    }
    if (payables.some((payable) => payable.supplierId === supplier.id)) {
      setError("Este fornecedor possui contas vinculadas e não pode ser excluído.");
      return;
    }
    if (!window.confirm(`Excluir o fornecedor “${supplier.name}”?`)) return;
    try {
      const supplierReference = doc(db, "users", user.uid, "suppliers", supplier.id);
      const linkedPayables = query(
        collection(db, "users", user.uid, "payables"),
        where("supplierId", "==", supplier.id)
      );
      await runTransaction(db, async (transaction) => {
        const [supplierSnapshot, payableSnapshot] = await Promise.all([
          transaction.get(supplierReference),
          transaction.get(linkedPayables),
        ]);
        if (!supplierSnapshot.exists()) return;
        if (!payableSnapshot.empty) {
          throw new Error("Este fornecedor possui contas vinculadas e não pode ser excluído.");
        }
        transaction.delete(supplierReference);
      });
      if (editingId === supplier.id) resetForm();
      setError("");
    } catch (deleteError) {
      console.error("Erro ao excluir fornecedor:", deleteError);
      setError(`Não foi possível excluir o fornecedor: ${deleteError.message}`);
    }
  }

  return (
    <main className="suppliers-page">
      <header className="suppliers-header">
        <div>
          <p className="suppliers-eyebrow">Cadastros financeiros</p>
          <h1>Fornecedores</h1>
          <p>Organize os contatos e vincule cada conta ao fornecedor correto.</p>
        </div>
        <div className="suppliers-count">
          <strong>{suppliers.length}</strong>
          <span>fornecedor(es)</span>
        </div>
      </header>

      {error && <div className="suppliers-error" role="alert">{error}</div>}

      <section className="suppliers-grid">
        <form className="suppliers-card suppliers-form" onSubmit={handleSubmit}>
          <h2>{editingId ? "Editar fornecedor" : "Novo fornecedor"}</h2>
          <label>
            Identificação única *
            <input name="identifier" value={form.identifier} onChange={handleChange} required maxLength={40} placeholder="Ex.: FORN-001" />
          </label>
          <label>
            Nome *
            <input name="name" value={form.name} onChange={handleChange} required maxLength={120} />
          </label>
          <label>
            Telefone
            <input name="phone" value={form.phone} onChange={handleChange} inputMode="tel" maxLength={30} />
          </label>
          <label>
            Cidade
            <input name="city" value={form.city} onChange={handleChange} maxLength={100} />
          </label>
          <label>
            Observações
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={4} maxLength={1000} />
          </label>
          <button className="suppliers-primary-button" type="submit" disabled={saving}>
            {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar fornecedor"}
          </button>
          {editingId && (
            <button className="suppliers-secondary-button" type="button" onClick={resetForm}>
              Cancelar edição
            </button>
          )}
          <small>* Campos obrigatórios. A identificação deve ser única.</small>
        </form>

        <section className="suppliers-card">
          <div className="suppliers-list-heading">
            <div>
              <h2>Fornecedores cadastrados</h2>
              <p>Dados privados da conta autenticada.</p>
            </div>
            <input
              className="suppliers-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar fornecedor"
              aria-label="Buscar fornecedor"
            />
          </div>
          {loading ? (
            <p className="suppliers-empty">Carregando fornecedores…</p>
          ) : visibleSuppliers.length === 0 ? (
            <p className="suppliers-empty">Nenhum fornecedor cadastrado ainda.</p>
          ) : (
            <div className="suppliers-list">
              {visibleSuppliers.map((supplier) => (
                <article className="supplier-row" key={supplier.id}>
                  <div className="supplier-avatar" aria-hidden="true">🏢</div>
                  <div className="supplier-details">
                    <div className="supplier-title-line">
                      <h3>{supplier.name}</h3>
                      <span>{supplier.identifier}</span>
                    </div>
                    <p>
                      {[supplier.phone, supplier.city].filter(Boolean).join(" • ") ||
                        "Telefone e cidade não informados"}
                    </p>
                    {supplier.notes && <p className="supplier-notes">{supplier.notes}</p>}
                    <small>
                      {payables.filter((item) => item.supplierId === supplier.id).length} conta(s) vinculada(s)
                    </small>
                  </div>
                  <div className="supplier-actions">
                    <button type="button" onClick={() => editSupplier(supplier)}>Editar</button>
                    <button type="button" onClick={() => removeSupplier(supplier)}>Excluir</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
