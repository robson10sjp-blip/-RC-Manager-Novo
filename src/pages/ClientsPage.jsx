import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  getDocs,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";
import {
  addDoc,
  deleteDoc,
  runTransaction,
  updateDoc,
} from "../firebase/firestoreAccess";
import { useNavigate } from "react-router-dom";
import {
  displayCpf,
  displayPhone,
  formatCpf,
  formatPhone,
  isValidCpf,
  isValidPhone,
} from "../domain/clientFields";
import { toDate } from "../utils/dates";
import {
  LuBanknote,
  LuChevronDown,
  LuHistory,
  LuMapPin,
  LuMessageCircle,
  LuPencil,
  LuPhone,
  LuPlus,
  LuSearch,
  LuShoppingBag,
  LuTriangleAlert,
  LuUsers,
  LuWallet,
} from "react-icons/lu";
import {
  analyzeLegacyBalances,
  calculateConsolidatedReceivables,
  isSaleOverdue,
  organizeSalesByTrip2026,
} from "../domain/sales";
import "./ClientsPremium.css";

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
  const [sales, setSales] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tripFilter, setTripFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const navigate = useNavigate();
  const [loadingClients, setLoadingClients] = useState(true);
  const [saving, setSaving] = useState(false);
  const [receivingClientId, setReceivingClientId] = useState(null);
  const receivingClientLock = useRef(false);

  useEffect(() => {
    let unsubscribeClients = null;
    let unsubscribeSales = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeClients) {
        unsubscribeClients();
        unsubscribeClients = null;
      }
      if (unsubscribeSales) {
        unsubscribeSales();
        unsubscribeSales = null;
      }

      setClients([]);
      setSales([]);

      if (!user) {
        setLoadingClients(false);
        return;
      }

      setLoadingClients(true);

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

      unsubscribeSales = onSnapshot(
        collection(db, "users", user.uid, "sales"),
        (snapshot) => {
          setSales(
            snapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            }))
          );
        },
        (error) => {
          console.error("Erro ao carregar compras dos clientes:", error);
          alert(`Erro ao carregar compras dos clientes: ${error.message}`);
        }
      );
    });

    return () => {
      unsubscribeAuth();

      if (unsubscribeClients) {
        unsubscribeClients();
      }
      if (unsubscribeSales) {
        unsubscribeSales();
      }
    };
  }, []);

  const salesByClient = useMemo(() => {
    const byClient = new Map();

    for (const sale of sales) {
      if (!sale.clientId) continue;

      const current = byClient.get(sale.clientId) || {
        count: 0,
        pending: 0,
      };

      current.count += 1;
      current.pending += Number(sale.pendingAmount || 0);
      byClient.set(sale.clientId, current);
    }

    return byClient;
  }, [sales]);

  const reconciliation = useMemo(
    () => analyzeLegacyBalances(clients, sales),
    [clients, sales]
  );

  const reconciliationCandidates = useMemo(
    () => reconciliation.filter((entry) => entry.needsReview),
    [reconciliation]
  );
  const legacyOnlyCount = reconciliation.filter(
    (entry) => entry.hasLegacyOnly
  ).length;
  const purchasesOnlyCount = reconciliation.filter(
    (entry) => entry.hasPurchasesOnly
  ).length;

  const receivables = useMemo(
    () => calculateConsolidatedReceivables(clients, sales),
    [clients, sales]
  );

  const tripOrganization = useMemo(
    () => organizeSalesByTrip2026(sales),
    [sales]
  );

  const clientRows = useMemo(() => {
    const tripsByClient = new Map();
    const addTrips = (list, key) => {
      for (const sale of list) {
        if (!sale.clientId) continue;
        const set = tripsByClient.get(sale.clientId) || new Set();
        set.add(key);
        tripsByClient.set(sale.clientId, set);
      }
    };
    addTrips(tripOrganization.thirdTrip.sales, "third");
    addTrips(tripOrganization.fourthTrip.sales, "fourth");
    addTrips(tripOrganization.review.sales, "review");

    const balances = new Map(
      receivables.clients.map((entry) => [entry.clientId, entry])
    );

    return clients.map((client) => {
      const balance = balances.get(client.id);
      const openSales = balance?.sales || [];
      const overdueSales = openSales.filter((sale) =>
        isSaleOverdue(sale.dueDate, sale.pendingAmount)
      );
      const totalPending = balance?.totalPending || 0;
      const status =
        totalPending <= 0
          ? "paid"
          : overdueSales.length > 0
            ? "overdue"
            : "open";

      return {
        client,
        totalPending,
        legacyBalance: balance?.legacyBalance || 0,
        salesPending: balance?.salesPending || 0,
        overdueCount: overdueSales.length,
        undatedCount: openSales.filter((sale) => !toDate(sale.dueDate)).length,
        status,
        trips: tripsByClient.get(client.id) || new Set(),
      };
    });
  }, [clients, receivables, tripOrganization]);

  const cities = useMemo(
    () =>
      [
        ...new Set(
          clients.map((client) => String(client.city || "").trim()).filter(Boolean)
        ),
      ].sort((first, second) => first.localeCompare(second, "pt-BR")),
    [clients]
  );

  const overdueClientsCount = clientRows.filter(
    (row) => row.status === "overdue"
  ).length;

  const filteredRows = useMemo(() => {
    const search = searchText.trim().toLowerCase();
    const searchDigits = search.replace(/\D/g, "");

    return clientRows.filter(({ client, status, trips }) => {
      if (cityFilter !== "all" && String(client.city || "").trim() !== cityFilter) {
        return false;
      }
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (tripFilter !== "all" && !trips.has(tripFilter)) return false;
      if (!search) return true;

      const textMatch = [
        client.name,
        client.nickname,
        client.cpf,
        client.city,
        client.phone,
        client.street,
        client.number,
        client.district,
        client.notes,
      ].some((field) => String(field || "").toLowerCase().includes(search));

      const digitMatch =
        searchDigits.length >= 3 &&
        [client.cpf, client.phone].some((field) =>
          String(field || "").replace(/\D/g, "").includes(searchDigits)
        );

      return textMatch || digitMatch;
    });
  }, [clientRows, searchText, cityFilter, statusFilter, tripFilter]);

  const hasActiveFilters =
    searchText.trim() !== "" ||
    cityFilter !== "all" ||
    statusFilter !== "all" ||
    tripFilter !== "all";

  function clearFilters() {
    setSearchText("");
    setCityFilter("all");
    setStatusFilter("all");
    setTripFilter("all");
  }

  function openNewClientForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function handleQuickReceive(row) {
    if (salesByClient.has(row.client.id)) {
      navigate("/financeiro");
      return;
    }
    handleReceivePayment(row.client);
  }

  function handleNewSale(client) {
    navigate("/vendas", { state: { newSaleClientId: client.id } });
  }

  function handleChange(event) {
    const { name, value } = event.target;

    const masked =
      name === "cpf" ? formatCpf(value)
      : name === "phone" ? formatPhone(value)
      : value;

    setForm((current) => ({
      ...current,
      [name]: masked,
    }));
  }

  function clearForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }
async function handleReceivePayment(client) {
  if (receivingClientLock.current) return;

  const user = auth.currentUser;

  if (!user) {
    alert("Você precisa entrar novamente no sistema.");
    return;
  }

  const currentBalance = Number(client.totalDebt || 0);

  if (salesByClient.has(client.id)) {
    alert(
      "Este cliente possui compras registradas. Para não misturar o saldo antigo com uma compra, registre cada recebimento na venda correspondente pela tela Financeiro."
    );
    return;
  }

  if (currentBalance <= 0) {
    alert("Este cliente já está com o saldo pago.");
    return;
  }

  receivingClientLock.current = true;
  const typedValue = window.prompt(
    `Saldo atual de ${client.name}: ${formatCurrency(
      currentBalance
    )}\n\nDigite o valor recebido:`
  );

  if (typedValue === null) {
    receivingClientLock.current = false;
    return;
  }

  const paymentValue = Number(
    typedValue.replace(",", ".").replace(/[^\d.-]/g, "")
  );

  if (!paymentValue || paymentValue <= 0) {
    alert("Digite um valor válido.");
    receivingClientLock.current = false;
    return;
  }

  if (paymentValue > currentBalance) {
    alert("O valor recebido não pode ser maior que o saldo.");
    receivingClientLock.current = false;
    return;
  }

  try {
    setReceivingClientId(client.id);

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

      if (paymentValue > savedBalance) {
        throw new Error(
          `O saldo histórico atual é ${formatCurrency(savedBalance)}.`
        );
      }

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
  } finally {
    receivingClientLock.current = false;
    setReceivingClientId(null);
  }
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

    // Dados antigos inalterados não são revalidados, para não bloquear a edição de outros campos.
    const original = clients.find((item) => item.id === editingId);

    if (
      form.cpf.trim() &&
      form.cpf !== displayCpf(original?.cpf) &&
      !isValidCpf(form.cpf)
    ) {
      alert("CPF inválido. Confira os 11 números ou deixe o campo em branco.");
      return;
    }

    if (
      form.phone.trim() &&
      form.phone !== displayPhone(original?.phone) &&
      !isValidPhone(form.phone)
    ) {
      alert("Telefone incompleto. Use (00) 00000-0000 ou (00) 0000-0000.");
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
    setShowForm(true);

    setForm({
      name: client.name || "",
      nickname: client.nickname || "",
      phone: displayPhone(client.phone),
      cpf: displayCpf(client.cpf),
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

    if (salesByClient.has(client.id)) {
      alert(
        "Este cliente possui compras vinculadas. Não é possível excluí-lo sem preservar a associação das compras."
      );
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
      salesByClient.has(client.id)
        ? `Olá, ${client.nickname || client.name}! Tudo bem? Estou entrando em contato pela RC Confecções. Suas compras estão registradas separadamente; vou confirmar com você cada saldo em aberto.`
        : `Olá, ${client.nickname || client.name}! Tudo bem? Estou entrando em contato pela RC Confecções sobre seu saldo histórico de ${formatCurrency(
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

  const statusLabels = {
    paid: "Em dia",
    open: "A receber",
    overdue: "Atrasado",
  };

  function initials(name) {
    return String(name || "?")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }

  const formFields = (
    <form onSubmit={handleSubmit} className="cl-form">
      <div className="cl-form-head">
        <h2>{editingId ? "Editar cliente" : "Novo cliente"}</h2>
        <button type="button" onClick={clearForm} className="cl-btn cl-btn-ghost">
          Cancelar
        </button>
      </div>

      <div className="cl-form-grid">
        <label className="cl-wide">
          Nome completo
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Digite o nome do cliente"
            required
            disabled={saving}
          />
        </label>

        <label>
          Conhecido como
          <input
            type="text"
            name="nickname"
            value={form.nickname}
            onChange={handleChange}
            placeholder="Apelido ou nome conhecido"
            disabled={saving}
          />
        </label>

        <label>
          Telefone
          <input
            type="tel"
            inputMode="numeric"
            maxLength={15}
            name="phone"
            value={form.phone}
            onChange={handleChange}
            placeholder="(00) 00000-0000"
            disabled={saving}
          />
        </label>

        <label>
          CPF
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            name="cpf"
            value={form.cpf}
            onChange={handleChange}
            placeholder="000.000.000-00"
            disabled={saving}
          />
        </label>

        <label>
          Cidade
          <input
            type="text"
            name="city"
            value={form.city}
            onChange={handleChange}
            placeholder="Digite a cidade"
            disabled={saving}
          />
        </label>

        <label className="cl-wide">
          Rua
          <input
            type="text"
            name="street"
            value={form.street}
            onChange={handleChange}
            placeholder="Digite a rua"
            disabled={saving}
          />
        </label>

        <label>
          Número
          <input
            type="text"
            name="number"
            value={form.number}
            onChange={handleChange}
            placeholder="Número"
            disabled={saving}
          />
        </label>

        <label>
          Bairro
          <input
            type="text"
            name="district"
            value={form.district}
            onChange={handleChange}
            placeholder="Bairro"
            disabled={saving}
          />
        </label>

        <label className="cl-wide">
          Saldo legado/agregado (não conciliado)
          <input
            type="number"
            name="totalDebt"
            value={form.totalDebt}
            onChange={handleChange}
            placeholder="0,00"
            min="0"
            step="0.01"
            disabled={
              saving || Boolean(editingId && salesByClient.has(editingId))
            }
          />
          <small>
            Saldo histórico preservado. Compras novas e seus recebimentos são
            controlados individualmente.
            {editingId && salesByClient.has(editingId)
              ? " Não alterável enquanto houver compras registradas."
              : ""}
          </small>
        </label>

        <label className="cl-wide">
          Observações
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            placeholder="Ex.: prefere receber no fim do mês..."
            rows={3}
            disabled={saving}
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="cl-btn cl-btn-primary cl-submit"
      >
        {saving
          ? "Salvando..."
          : editingId
            ? "Salvar alterações"
            : "Cadastrar cliente"}
      </button>
    </form>
  );

  return (
    <div className="cl">
      <header className="cl-header">
        <div>
          <p className="cl-eyebrow">RC Confecções</p>
          <h1>Clientes</h1>
          <p className="cl-subtitle">
            Cadastre, pesquise e acompanhe seus clientes e saldos.
          </p>
        </div>

        <button
          type="button"
          className="cl-btn cl-btn-primary cl-new"
          onClick={openNewClientForm}
        >
          <LuPlus aria-hidden="true" /> Novo cliente
        </button>
      </header>

      <div className="cl-kpis">
        <article className="cl-kpi cl-kpi-navy">
          <span className="cl-kpi-icon"><LuUsers aria-hidden="true" /></span>
          <span className="cl-kpi-label">Total de clientes</span>
          <strong>{clients.length}</strong>
        </article>

        <article className="cl-kpi cl-kpi-gold">
          <span className="cl-kpi-icon"><LuWallet aria-hidden="true" /></span>
          <span className="cl-kpi-label">Total a receber</span>
          <strong>{formatCurrency(receivables.totalPending)}</strong>
          <small>Mesmo cálculo do Dashboard, sem somar a mesma dívida duas vezes.</small>
        </article>

        <article className="cl-kpi cl-kpi-red">
          <span className="cl-kpi-icon"><LuTriangleAlert aria-hidden="true" /></span>
          <span className="cl-kpi-label">Clientes atrasados</span>
          <strong>{overdueClientsCount}</strong>
          <small>Somente compras com vencimento informado e já vencido.</small>
        </article>
      </div>

      {showForm && <section className="cl-panel">{formFields}</section>}

      <section className="cl-panel">
        <div className="cl-search">
          <LuSearch aria-hidden="true" />
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Nome, apelido, CPF, cidade ou telefone"
            aria-label="Pesquisar clientes"
          />
        </div>

        <div className="cl-filters">
          <label>
            Cidade
            <select
              value={cityFilter}
              onChange={(event) => setCityFilter(event.target.value)}
            >
              <option value="all">Todas as cidades</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </label>

          <label>
            Situação financeira
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">Todas</option>
              <option value="open">A receber</option>
              <option value="overdue">Atrasado</option>
              <option value="paid">Em dia</option>
            </select>
          </label>

          <label>
            Viagem
            <select
              value={tripFilter}
              onChange={(event) => setTripFilter(event.target.value)}
            >
              <option value="all">Todas as viagens</option>
              <option value="third">3ª viagem</option>
              <option value="fourth">4ª viagem</option>
              <option value="review">Revisão necessária</option>
            </select>
          </label>

          {hasActiveFilters && (
            <button type="button" className="cl-btn cl-btn-ghost" onClick={clearFilters}>
              Limpar filtros
            </button>
          )}
        </div>

        <p className="cl-count">
          {filteredRows.length} de {clients.length} cliente(s)
          {tripFilter !== "all" &&
            " — viagem conforme classificação proposta das vendas"}
        </p>

        {loadingClients ? (
          <div className="cl-empty"><strong>Carregando clientes...</strong></div>
        ) : filteredRows.length === 0 ? (
          <div className="cl-empty">
            <strong>Nenhum cliente encontrado</strong>
            <p>Cadastre um cliente ou altere a pesquisa e os filtros.</p>
          </div>
        ) : (
          <div className="cl-list">
            {filteredRows.map((row) => {
              const { client } = row;
              const purchases = salesByClient.get(client.id);
              const expanded = expandedId === client.id;
              const address = [client.street, client.number, client.district]
                .filter(Boolean)
                .join(", ");

              return (
                <article key={client.id} className={`cl-row cl-row-${row.status}`}>
                  <div className="cl-row-main">
                    <span className="cl-avatar" aria-hidden="true">
                      {initials(client.name)}
                    </span>

                    <div className="cl-identity">
                      <h3>{client.name}</h3>
                      {client.nickname && <p>“{client.nickname}”</p>}
                    </div>

                    <div className="cl-contact">
                      <span><LuMapPin aria-hidden="true" /> {client.city || "Cidade não informada"}</span>
                      <span><LuPhone aria-hidden="true" /> {displayPhone(client.phone) || "Telefone não informado"}</span>
                    </div>

                    <div className="cl-balance">
                      <span>Saldo</span>
                      <strong>{formatCurrency(row.totalPending)}</strong>
                    </div>

                    <span className={`cl-status cl-status-${row.status}`}>
                      {statusLabels[row.status]}
                    </span>
                  </div>

                  <div className="cl-actions">
                    <button
                      type="button"
                      className="cl-btn cl-btn-soft"
                      onClick={() => setExpandedId(expanded ? null : client.id)}
                      aria-expanded={expanded}
                    >
                      <LuChevronDown aria-hidden="true" className={expanded ? "cl-flip" : ""} />
                      {expanded ? "Ocultar detalhes" : "Ver detalhes"}
                    </button>
                    <button type="button" className="cl-btn cl-btn-soft" onClick={() => handleEdit(client)}>
                      <LuPencil aria-hidden="true" /> Editar
                    </button>
                    <button type="button" className="cl-btn cl-btn-soft" onClick={() => handleNewSale(client)}>
                      <LuShoppingBag aria-hidden="true" /> Nova venda
                    </button>
                    <button
                      type="button"
                      className="cl-btn cl-btn-gold"
                      onClick={() => handleQuickReceive(row)}
                      disabled={receivingClientId === client.id}
                      title={
                        purchases
                          ? "Abre o Financeiro para receber por compra"
                          : "Registrar recebimento do saldo legado"
                      }
                    >
                      <LuBanknote aria-hidden="true" />
                      {receivingClientId === client.id ? "Registrando..." : "Receber"}
                    </button>
                  </div>

                  {expanded && (
                    <div className="cl-details">
                      <dl>
                        <div><dt>CPF</dt><dd>{displayCpf(client.cpf) || "Não informado"}</dd></div>
                        <div><dt>Endereço</dt><dd>{address || "Não informado"}</dd></div>
                        <div>
                          <dt>Saldo histórico agregado</dt>
                          <dd>{formatCurrency(client.totalDebt)}</dd>
                        </div>
                        <div>
                          <dt>Compras{purchases ? ` (${purchases.count})` : ""}</dt>
                          <dd>{formatCurrency(purchases?.pending || 0)} em aberto</dd>
                        </div>
                        {row.overdueCount > 0 && (
                          <div><dt>Vencidas</dt><dd>{row.overdueCount} compra(s)</dd></div>
                        )}
                        {row.undatedCount > 0 && (
                          <div>
                            <dt>Sem vencimento</dt>
                            <dd>{row.undatedCount} compra(s) — não classificadas como atrasadas</dd>
                          </div>
                        )}
                        {client.notes && (
                          <div className="cl-wide"><dt>Observações</dt><dd>{client.notes}</dd></div>
                        )}
                      </dl>

                      {purchases && (
                        <p className="cl-warning">
                          Para não misturar saldos, receba cada compra pela tela
                          Financeiro. O saldo histórico e as compras abertas podem
                          representar a mesma dívida e não são somados aqui.
                        </p>
                      )}

                      <div className="cl-actions">
                        <button type="button" className="cl-btn cl-btn-soft" onClick={() => handleShowHistory(client)}>
                          <LuHistory aria-hidden="true" /> Histórico
                        </button>
                        <button type="button" className="cl-btn cl-btn-soft" onClick={() => openWhatsApp(client)}>
                          <LuMessageCircle aria-hidden="true" /> WhatsApp
                        </button>
                        <button type="button" className="cl-btn cl-btn-danger" onClick={() => handleDelete(client)}>
                          Excluir
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <details className="cl-panel cl-check">
        <summary>
          <span>
            <strong>Conferência de saldos</strong>
            <small>
              {reconciliationCandidates.length} com possível sobreposição ·{" "}
              {legacyOnlyCount} somente saldo legado · {purchasesOnlyCount} somente compras
            </small>
          </span>
          <LuChevronDown aria-hidden="true" />
        </summary>

        <p className="cl-warning">
          Comparação somente para revisão. Não altera clientes, compras ou
          pagamentos. O saldo legado pode já incluir compras antigas; não some nem
          migre os valores sem confirmar os registros e recibos de origem.
        </p>

        <div className="cl-check-summary">
          <span>{reconciliationCandidates.length} cliente(s) com possível sobreposição</span>
          <span>{legacyOnlyCount} somente com saldo legado</span>
          <span>{purchasesOnlyCount} somente com compras</span>
        </div>

        {loadingClients ? (
          <p>Carregando saldos para comparação...</p>
        ) : reconciliationCandidates.length === 0 ? (
          <p>
            Nenhum cliente tem simultaneamente saldo legado e saldo pendente em
            compras nesta leitura.
          </p>
        ) : (
          <div className="cl-check-list">
            {reconciliationCandidates.map((entry) => (
              <div key={entry.clientId} className="cl-check-item">
                <strong>{entry.clientName}</strong>
                <span>Saldo legado: {formatCurrency(entry.legacyBalance)}</span>
                <span>Compras abertas: {formatCurrency(entry.purchaseBalance)}</span>
                <span>
                  Diferença matemática (não é valor para migração):{" "}
                  {formatCurrency(entry.difference)}
                </span>
                <small>
                  Conferir histórico de compras e recebimentos antes de qualquer
                  ajuste. Valores podem representar a mesma dívida.
                </small>
              </div>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}
