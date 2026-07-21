import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
    runTransaction,
  addDoc,
  getDocs,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";

const emptyForm = {
  name: "",
  nickname: "",
  phone: "",
  cpf: "",
  city: "",
  street: "",
  number: "",
  district: "",
  totalDebt: "",
  notes: "",
};

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [loadingClients, setLoadingClients] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let unsubscribeClients = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeClients) {
        unsubscribeClients();
        unsubscribeClients = null;
      }

      if (!user) {
        setClients([]);
        setLoadingClients(false);
        return;
      }

      const clientsReference = collection(
        db,
        "users",
        user.uid,
        "clients"
      );

      unsubscribeClients = onSnapshot(
        clientsReference,
        (snapshot) => {
          const clientsList = snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          }));

          clientsList.sort((firstClient, secondClient) =>
            String(firstClient.name || "").localeCompare(
              String(secondClient.name || ""),
              "pt-BR"
            )
          );

          setClients(clientsList);
          setLoadingClients(false);
        },
        (error) => {
          console.error("Erro ao carregar clientes:", error);
          alert(`Erro ao carregar clientes: ${error.message}`);
          setLoadingClients(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();

      if (unsubscribeClients) {
        unsubscribeClients();
      }
    };
  }, []);

  const filteredClients = useMemo(() => {
    const search = searchText.trim().toLowerCase();

    if (!search) {
      return clients;
    }

    return clients.filter((client) => {
      const fields = [
        client.name,
        client.nickname,
        client.phone,
        client.cpf,
        client.city,
        client.street,
        client.number,
        client.district,
        client.notes,
      ];

      return fields.some((field) =>
        String(field || "").toLowerCase().includes(search)
      );
    });
  }, [clients, searchText]);

  const totalToReceive = useMemo(() => {
    return clients.reduce(
      (total, client) => total + Number(client.totalDebt || 0),
      0
    );
  }, [clients]);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function clearForm() {
    setForm(emptyForm);
    setEditingId(null);
  }
async function handleReceivePayment(client) {
  const user = auth.currentUser;

  if (!user) {
    alert("Você precisa entrar novamente no sistema.");
    return;
  }

  const currentBalance = Number(client.totalDebt || 0);

  if (currentBalance <= 0) {
    alert("Este cliente já está com o saldo pago.");
    return;
  }

  const typedValue = window.prompt(
    `Saldo atual de ${client.name}: ${formatCurrency(
      currentBalance
    )}\n\nDigite o valor recebido:`
  );

  if (typedValue === null) {
    return;
  }

  const paymentValue = Number(
    typedValue.replace(",", ".").replace(/[^\d.-]/g, "")
  );

  if (!paymentValue || paymentValue <= 0) {
    alert("Digite um valor válido.");
    return;
  }

  if (paymentValue > currentBalance) {
    alert("O valor recebido não pode ser maior que o saldo.");
    return;
  }

  try {
    const clientReference = doc(
      db,
      "users",
      user.uid,
      "clients",
      client.id
    );

    const paymentReference = doc(
      collection(
        db,
        "users",
        user.uid,
        "clients",
        client.id,
        "payments"
      )
    );

    await runTransaction(db, async (transaction) => {
      const clientSnapshot = await transaction.get(clientReference);

      if (!clientSnapshot.exists()) {
        throw new Error("Cliente não encontrado.");
      }

      const savedBalance = Number(
        clientSnapshot.data().totalDebt || 0
      );

      const updatedBalance = Math.max(
        savedBalance - paymentValue,
        0
      );

      transaction.update(clientReference, {
        totalDebt: updatedBalance,
        totalReceived:
          Number(clientSnapshot.data().totalReceived || 0) +
          paymentValue,
        status: updatedBalance === 0 ? "paid" : "partial",
        updatedAt: serverTimestamp(),
      });

      transaction.set(paymentReference, {
        value: paymentValue,
        previousBalance: savedBalance,
        remainingBalance: updatedBalance,
        createdAt: serverTimestamp(),
      });
    });

    alert(
      `Pagamento de ${formatCurrency(
        paymentValue
      )} registrado com sucesso!`
    );
  } catch (error) {
    console.error("Erro ao registrar pagamento:", error);
    alert(`Erro ao registrar pagamento: ${error.message}`);
  }
}
function getClientStatus(client) {
  const balance = Number(client.totalDebt || 0);
  const received = Number(client.totalReceived || 0);

  if (balance <= 0) {
    return {
      label: "Em dia",
      color: "#16a34a",
      background: "#dcfce7",
    };
  }

  if (received > 0) {
    return {
      label: "Parcial",
      color: "#ca8a04",
      background: "#fef9c3",
    };
  }

  return {
    label: "Pendente",
    color: "#dc2626",
    background: "#fee2e2",
  };
}

async function handleShowHistory(client) {
  const user = auth.currentUser;

  if (!user) {
    alert("Você precisa entrar novamente no sistema.");
    return;
  }

  try {
    const paymentsReference = collection(
      db,
      "users",
      user.uid,
      "clients",
      client.id,
      "payments"
    );

    const paymentsQuery = query(
      paymentsReference,
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(paymentsQuery);

    if (snapshot.empty) {
      alert(`${client.name} ainda não possui pagamentos registrados.`);
      return;
    }

    const historyText = snapshot.docs
      .map((paymentDocument) => {
        const payment = paymentDocument.data();

        const date = payment.createdAt?.toDate
          ? payment.createdAt.toDate().toLocaleDateString("pt-BR")
          : "Data não informada";

        return `${date}
Pagamento: ${formatCurrency(payment.value)}
Saldo restante: ${formatCurrency(payment.remainingBalance)}`;
      })
      .join("\n\n");

    alert(`Histórico de ${client.name}\n\n${historyText}`);
  } catch (error) {
    console.error("Erro ao carregar histórico:", error);
    alert(`Erro ao carregar histórico: ${error.message}`);
  }
}
  async function handleSubmit(event) {
    event.preventDefault();


    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    if (!form.name.trim()) {
      alert("Digite o nome do cliente.");
      return;
    }

    try {
      setSaving(true);

      const clientData = {
        name: form.name.trim(),
        nickname: form.nickname.trim(),
        phone: form.phone.trim(),
        cpf: form.cpf.trim(),
        city: form.city.trim(),
        street: form.street.trim(),
        number: form.number.trim(),
        district: form.district.trim(),
        totalDebt: Number(form.totalDebt || 0),
        notes: form.notes.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        const clientReference = doc(
          db,
          "users",
          user.uid,
          "clients",
          editingId
        );

        await updateDoc(clientReference, clientData);

        alert("Cliente atualizado com sucesso!");
      } else {
        const clientsReference = collection(
          db,
          "users",
          user.uid,
          "clients"
        );

        await addDoc(clientsReference, {
          ...clientData,
          createdAt: serverTimestamp(),
        });

        alert("Cliente cadastrado e salvo na nuvem!");
      }

      clearForm();
    } catch (error) {
      console.error("Erro ao salvar cliente:", error);
      alert(`Erro ao salvar cliente: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(client) {
    setEditingId(client.id);

    setForm({
      name: client.name || "",
      nickname: client.nickname || "",
      phone: client.phone || "",
      cpf: client.cpf || "",
      city: client.city || "",
      street: client.street || "",
      number: client.number || "",
      district: client.district || "",
      totalDebt: String(client.totalDebt || ""),
      notes: client.notes || "",
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function handleDelete(client) {
    const user = auth.currentUser;

    if (!user) {
      alert("Você precisa entrar novamente no sistema.");
      return;
    }

    const confirmed = window.confirm(
      `Deseja realmente excluir o cliente ${client.name}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const clientReference = doc(
        db,
        "users",
        user.uid,
        "clients",
        client.id
      );

      await deleteDoc(clientReference);

      if (editingId === client.id) {
        clearForm();
      }

      alert("Cliente excluído com sucesso!");
    } catch (error) {
      console.error("Erro ao excluir cliente:", error);
      alert(`Erro ao excluir cliente: ${error.message}`);
    }
  }

  function openWhatsApp(client) {
    const phone = String(client.phone || "").replace(/\D/g, "");

    if (!phone) {
      alert("Este cliente não possui telefone cadastrado.");
      return;
    }

    const brazilianPhone = phone.startsWith("55")
      ? phone
      : `55${phone}`;

    const message = encodeURIComponent(
      `Olá, ${client.nickname || client.name}! Tudo bem? Estou entrando em contato pela RC Confecções sobre seu saldo de ${formatCurrency(
        client.totalDebt
      )}.`
    );

    window.open(
      `https://wa.me/${brazilianPhone}?text=${message}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>RC Confecções</p>
          <h1 style={styles.title}>Clientes</h1>
          <p style={styles.subtitle}>
            Cadastre, pesquise e acompanhe seus clientes.
          </p>
        </div>

        <div style={styles.headerCards}>
          <div style={styles.counter}>
            <span style={styles.counterLabel}>Total de clientes</span>
            <strong style={styles.counterValue}>{clients.length}</strong>
          </div>

          <div style={styles.counter}>
            <span style={styles.counterLabel}>Total a receber</span>
            <strong style={styles.moneyValue}>
              {formatCurrency(totalToReceive)}
            </strong>
          </div>
        </div>
      </header>

      <section style={styles.grid}>
        <form onSubmit={handleSubmit} style={styles.card}>
          <div style={styles.formHeader}>
            <h2 style={styles.cardTitle}>
              {editingId ? "Editar cliente" : "Novo cliente"}
            </h2>

            {editingId && (
              <button
                type="button"
                onClick={clearForm}
                style={styles.cancelButton}
              >
                Cancelar
              </button>
            )}
          </div>

          <label style={styles.label}>
            Nome completo
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Digite o nome do cliente"
              required
              disabled={saving}
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Conhecido como
            <input
              type="text"
              name="nickname"
              value={form.nickname}
              onChange={handleChange}
              placeholder="Apelido ou nome conhecido"
              disabled={saving}
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Telefone
            <input
              type="tel"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="(00) 00000-0000"
              disabled={saving}
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            CPF
            <input
              type="text"
              name="cpf"
              value={form.cpf}
              onChange={handleChange}
              placeholder="000.000.000-00"
              disabled={saving}
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Cidade
            <input
              type="text"
              name="city"
              value={form.city}
              onChange={handleChange}
              placeholder="Digite a cidade"
              disabled={saving}
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Rua
            <input
              type="text"
              name="street"
              value={form.street}
              onChange={handleChange}
              placeholder="Digite a rua"
              disabled={saving}
              style={styles.input}
            />
          </label>

          <div style={styles.twoColumns}>
            <label style={styles.label}>
              Número
              <input
                type="text"
                name="number"
                value={form.number}
                onChange={handleChange}
                placeholder="Número"
                disabled={saving}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Bairro
              <input
                type="text"
                name="district"
                value={form.district}
                onChange={handleChange}
                placeholder="Bairro"
                disabled={saving}
                style={styles.input}
              />
            </label>
          </div>

          <label style={styles.label}>
            Valor a receber
            <input
              type="number"
              name="totalDebt"
              value={form.totalDebt}
              onChange={handleChange}
              placeholder="0,00"
              min="0"
              step="0.01"
              disabled={saving}
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Observações
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              placeholder="Ex.: prefere receber no fim do mês..."
              rows={4}
              disabled={saving}
              style={styles.textarea}
            />
          </label>

          <button
            type="submit"
            disabled={saving}
            style={{
              ...styles.button,
              opacity: saving ? 0.65 : 1,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving
              ? "Salvando..."
              : editingId
                ? "Salvar alterações"
                : "Cadastrar cliente"}
          </button>
        </form>

        <section style={styles.card}>
          <div style={styles.listHeader}>
            <div>
              <h2 style={styles.cardTitle}>Clientes cadastrados</h2>
              <p style={styles.helperText}>
                {filteredClients.length} cliente(s) encontrado(s).
              </p>
            </div>
          </div>

          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Pesquisar nome, apelido, telefone, CPF ou endereço"
            style={styles.searchInput}
          />

          {loadingClients ? (
            <div style={styles.empty}>
              <span style={styles.emptyIcon}>⏳</span>
              <strong>Carregando clientes...</strong>
            </div>
          ) : filteredClients.length === 0 ? (
            <div style={styles.empty}>
              <span style={styles.emptyIcon}>👥</span>
              <strong>Nenhum cliente encontrado</strong>
              <p>Cadastre um cliente ou altere sua pesquisa.</p>
            </div>
          ) : (
            <div style={styles.list}>
              {filteredClients.map((client) => (
                <article key={client.id} style={styles.clientItem}>
                  <div style={styles.clientContent}>
     <span
  style={{
    ...styles.statusBadge,
    color: getClientStatus(client).color,
    background: getClientStatus(client).background,
  }}
>
  {getClientStatus(client).label}
</span>
                    <h3 style={styles.clientName}>{client.name}</h3>

                    {client.nickname && (
                      <p style={styles.nickname}>
                        Conhecido como: {client.nickname}
                      </p>
                    )}

                    <p style={styles.clientInfo}>
                      📞 {client.phone || "Telefone não informado"}
                    </p>

                    {client.cpf && (
                      <p style={styles.clientInfo}>🪪 CPF: {client.cpf}</p>
                    )}

                    <p style={styles.clientInfo}>
                      📍 {[client.street, client.number, client.district, client.city]
                        .filter(Boolean)
                        .join(" • ") || "Endereço não informado"}
                    </p>

                    {client.notes && (
                      <p style={styles.notes}>📝 {client.notes}</p>
                    )}
                  </div>

                  <div style={styles.rightArea}>
                    <div style={styles.debtBox}>
                      <span style={styles.debtLabel}>A receber</span>

                      <strong style={styles.debtValue}>
                        {formatCurrency(client.totalDebt)}
                      </strong>
                    </div>

                    <div style={styles.actions}>
                        <button
  type="button"
  onClick={() => handleReceivePayment(client)}
  style={styles.receiveButton}
>
  Receber
</button>
                      <button
                        type="button"
                        onClick={() => handleShowHistory(client)}
                        style={styles.historyButton}
                      >
                        Histórico
                      </button>

                      <button
                        type="button"
                        onClick={() => openWhatsApp(client)}
                        style={styles.whatsAppButton}
                        title="Enviar cobrança pelo WhatsApp"
                      >
                        WhatsApp
                      </button>

                      <button
                        type="button"
                        onClick={() => handleEdit(client)}
                        style={styles.editButton}
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(client)}
                        style={styles.deleteButton}
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

const styles = {
  page: {
    color: "#0f172a",
    fontFamily: "Arial, sans-serif",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "20px",
    marginBottom: "24px",
  },

  headerCards: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
  },

  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontWeight: "800",
    fontSize: "13px",
    textTransform: "uppercase",
  },

  title: {
    margin: "5px 0",
    fontSize: "32px",
  },

  subtitle: {
    margin: 0,
    color: "#64748b",
  },

  counter: {
    minWidth: "145px",
    padding: "16px",
    borderRadius: "16px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    textAlign: "center",
  },

  counterLabel: {
    display: "block",
    color: "#64748b",
    fontSize: "13px",
    marginBottom: "6px",
  },

  counterValue: {
    fontSize: "28px",
  },

  moneyValue: {
    color: "#16a34a",
    fontSize: "19px",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)",
    gap: "22px",
  },

  card: {
    padding: "24px",
    borderRadius: "18px",
    background: "#ffffff",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
  },

  formHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
  },

  cardTitle: {
    margin: "0 0 18px",
    fontSize: "21px",
  },

  cancelButton: {
    border: 0,
    background: "transparent",
    color: "#64748b",
    fontWeight: "700",
    cursor: "pointer",
  },

  label: {
    display: "grid",
    gap: "8px",
    marginBottom: "16px",
    color: "#334155",
    fontSize: "14px",
    fontWeight: "700",
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 14px",
    borderRadius: "11px",
    border: "1px solid #cbd5e1",
    outline: "none",
    fontSize: "15px",
    color: "#111827",
    background: "#ffffff",
  },

  button: {
    width: "100%",
    border: 0,
    borderRadius: "11px",
    padding: "14px",
    background: "#2563eb",
    color: "#ffffff",
    fontSize: "16px",
    fontWeight: "800",
  },

  listHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
  },

  helperText: {
    margin: "-10px 0 18px",
    color: "#64748b",
    fontSize: "14px",
  },

  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 14px",
    marginBottom: "18px",
    borderRadius: "11px",
    border: "1px solid #cbd5e1",
    outline: "none",
    fontSize: "15px",
  },

  empty: {
    minHeight: "280px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    color: "#64748b",
  },

  emptyIcon: {
    marginBottom: "12px",
    fontSize: "40px",
  },

  list: {
    display: "grid",
    gap: "12px",
  },

  clientItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "20px",
    padding: "17px",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },

  clientContent: {
    flex: "1 1 200px",
  },

  clientName: {
    margin: "0 0 8px",
    fontSize: "17px",
  },

  clientInfo: {
    margin: "4px 0",
    color: "#64748b",
    fontSize: "14px",
  },

  rightArea: {
    display: "grid",
    justifyItems: "end",
    gap: "12px",
  },

  debtBox: {
    minWidth: "120px",
    textAlign: "right",
  },

  debtLabel: {
    display: "block",
    marginBottom: "5px",
    color: "#64748b",
    fontSize: "12px",
  },

  debtValue: {
    color: "#16a34a",
    fontSize: "17px",
  },

  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "7px",
  },

  whatsAppButton: {
    border: 0,
    borderRadius: "8px",
    padding: "8px 10px",
    background: "#16a34a",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },

  editButton: {
    border: 0,
    borderRadius: "8px",
    padding: "8px 10px",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },


  twoColumns: {
    display: "grid",
    gridTemplateColumns: "minmax(90px, 0.7fr) minmax(150px, 1.3fr)",
    gap: "12px",
  },

  textarea: {
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 14px",
    borderRadius: "11px",
    border: "1px solid #cbd5e1",
    outline: "none",
    resize: "vertical",
    fontFamily: "inherit",
    fontSize: "15px",
    color: "#111827",
    background: "#ffffff",
  },

  statusBadge: {
    display: "inline-block",
    marginBottom: "8px",
    padding: "5px 9px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: "800",
  },

  nickname: {
    margin: "0 0 8px",
    color: "#7c3aed",
    fontSize: "13px",
    fontWeight: "700",
  },

  notes: {
    margin: "8px 0 0",
    padding: "9px 10px",
    borderRadius: "9px",
    background: "#ffffff",
    color: "#475569",
    fontSize: "13px",
  },

  receiveButton: {
    border: 0,
    borderRadius: "8px",
    padding: "8px 10px",
    background: "#0f766e",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },

  historyButton: {
    border: 0,
    borderRadius: "8px",
    padding: "8px 10px",
    background: "#7c3aed",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },
  deleteButton: {
    border: 0,
    borderRadius: "8px",
    padding: "8px 10px",
    background: "#dc2626",
    color: "#ffffff",
    fontWeight: "700",
    cursor: "pointer",
  },
};