# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## Compras, recebimentos e viagens

- A opção de navegação "👩‍💼 Secretária RC" reutiliza a rota e os indicadores da antiga Inteligência RC. O resumo e as respostas rápidas consultam somente coleções do usuário autenticado (`users/{uid}`), incluindo vendas, clientes, produtos, despesas e históricos de recebimentos por compra/cliente. Viagens são sumarizadas pelos campos de viagem das vendas.
- A conversa desta primeira etapa é uma consulta local determinística, não uma IA: perguntas fora das consultas implementadas são identificadas como não suportadas. O histórico fica apenas na memória da tela, não há operações de escrita e nenhum dado é enviado a serviços externos. O botão de voz permanece desativado até a integração explícita de reconhecimento de fala.
- A interpretação financeira da Secretária separa recebimentos efetivados, vendas, lista de cobranças e valores pendentes. O total consolidado a receber usa a mesma regra no Financeiro, Dashboard e Secretária: quando há vendas legadas vinculadas, considera os saldos pendentes dessas vendas em vez de somar novamente `clients.totalDebt`; compras `per-sale` e saldos históricos sem venda legada vinculada são somados como valores independentes, e vendas sem cliente cadastrado entram uma vez como não atribuídas. A Secretária também responde despesas, lucro estimado e maior faturamento por viagem com os dados em memória do usuário autenticado.
- A conversa reconhece ordinais e períodos das viagens, pede o escopo quando uma consulta financeira sem contexto pode misturar viagens e mantém a última viagem selecionada em perguntas de acompanhamento. As respostas identificam o período usado; a 3ª e a 4ª viagem seguem explicitamente provisórias até a classificação histórica ser confirmada. Comparações de lucro não declaram vencedora quando faltam custos cadastrados.
- `npm test` executa os testes de domínio com dados fictícios em memória; eles não inicializam nem acessam Firebase.
- O Dashboard permite filtrar os totais de vendas por visão geral, 3ª viagem, 4ª viagem ou revisão. A classificação é calculada em leitura a partir de `saleDate` ou `createdAt` quando a data original falta; não grava a viagem no Firestore. Despesas só entram no resumo de uma viagem quando possuem vínculo explícito; clientes e estoque continuam gerais.
- `npm run dev:readonly -- --host 0.0.0.0 --port 4173 --strictPort` abre o app autenticado com leituras normais e bloqueio local de `addDoc`, `updateDoc`, `deleteDoc`, `setDoc` e `runTransaction`. O app continua exigindo a configuração web Firebase e login do usuário. Esse bloqueio no cliente não substitui regras Firestore somente leitura; não use este modo como controle de autorização em produção.
- Cada compra continua sendo um documento em `users/{uid}/sales/{saleId}`. Compras novas guardam `saleDate`, `dueDate`, `amountPaid`, `pendingAmount`, `status`, `tripName` e `tripCity`; o próprio `saleId` identifica a compra.
- Os recebimentos ficam na subcoleção `users/{uid}/sales/{saleId}/payments` e atualizam o saldo da compra em uma transação. Não se deve usar o saldo agregado do cliente para quitar uma compra específica.
- `clients.totalDebt` e o histórico antigo em `clients/{clientId}/payments` são preservados sem migração. Para clientes com compras registradas, a baixa agregada pela ficha do cliente é bloqueada; recebimentos devem ser vinculados à compra. Compras antigas ainda atualizam o saldo legado somente pela variação daquela compra, sem recalcular ou substituir o total do cliente.
- Compras antigas sem `balanceModel: "per-sale"` mantêm o comportamento de saldo agregado: receber, editar ou excluir uma compra atualiza `clients.totalDebt` apenas pela diferença daquela compra, dentro da mesma transação. A operação é bloqueada se o saldo agregado for menor que o saldo da compra; essa situação precisa de conciliação, não de ajuste automático. Compras novas marcadas como `per-sale` nunca alteram esse saldo antigo.
- A tela Financeiro usa a classificação compartilhada para filtrar todas as viagens, a 1ª, 2ª, 3ª, 4ª ou despesas sem viagem. Novas despesas exigem vínculo explícito; antigas sem `tripNumber` continuam preservadas e podem ser classificadas individualmente por edição. O resumo separa lucro estimado (vendas menos custo estimado de mercadorias e despesas vinculadas) de fluxo de caixa simplificado (recebido menos despesas); quando falta custo atual do produto, o lucro aparece indisponível. Nenhuma venda ou despesa antiga é classificada em massa.
- A comparação na tela Clientes é somente diagnóstica: mostra o saldo legado, a soma pendente das compras e a diferença aritmética. Diferença não é uma sugestão de ajuste; validar recibos, histórico de pagamentos e compras antes de qualquer alteração manual autorizada.
- A tela Vendas usa todo o histórico do usuário autenticado para propor a 3ª viagem (01/07–30/09/2026) e a 4ª (01/10–31/12/2026), com filtros, busca e totais separados. Usa `saleDate` original e, quando ausente, `createdAt`; nunca usa vencimento, pagamento ou `updatedAt` para determinar viagem. Datas não confiáveis, anteriores a julho ou posteriores a 2026 ficam para revisão. As propostas são somente leitura até aprovação; cada compra e seus pagamentos permanecem ligados individualmente à viagem original.
- Compras que já têm recebimentos não podem ser excluídas nem ter total/produtos alterados. Isso preserva estoque e trilha de pagamentos; datas e dados de viagem ainda podem ser corrigidos.

## Fornecedores e contas a pagar

- Fornecedores e obrigações são armazenados somente em `users/{uid}/suppliers` e `users/{uid}/payables`, respeitando o usuário autenticado. A identificação de fornecedor é validada como única; fornecedores vinculados a contas não podem ser excluídos.
- Cada conta registra fornecedor, compra, total, entrada, viagem opcional e parcelas/títulos. Cheques exigem número individual, data de apresentação e conta Banco do Brasil PF ou PJ. A soma do cronograma deve corresponder ao saldo após a entrada.
- Cheques emitidos permanecem como obrigação pendente. Somente a confirmação de compensação atualiza o saldo pago e grava um evento no histórico de pagamentos, em transação com identificador estável para evitar duplicidade. Devolução e cancelamento preservam a dívida e o histórico de status, sem registrar saída de caixa; a obrigação pode ser paga depois por outro meio.
- A área de cheques filtra por mês de apresentação, fornecedor, conta PF/PJ e status, e resume os valores emitidos previstos para 7, 15 e 30 dias. A visão acompanha o filtro de viagem selecionado no Financeiro.
- Compras de estoque não geram despesa nem alteram estoque automaticamente; o custo entra no lucro conforme as mercadorias são vendidas. Compras marcadas como operacionais entram uma vez no lucro na data da compra e não devem ser lançadas também em `expenses`. Pagamentos a fornecedores diminuem o fluxo de caixa, mas não são lançados novamente como despesa nem alteram o custo das mercadorias vendidas.
- Dashboard e Financeiro acompanham obrigações gerais, viagens, parcelas vencidas, próximos vencimentos e valores já pagos; a Secretária RC responde consultas de saldo, credores, parcelas atrasadas e cheques por período.
- A prévia em modo `readonly` bloqueia as gravações no Firestore. As regras de segurança do Firebase não foram alteradas; o acesso às novas coleções depende de as regras existentes permitirem ao usuário autenticado ler/escrever sob o próprio caminho `users/{uid}`.

## Preparação para Netlify

- `netlify.toml` configura `npm run build`, publicação de `dist` e fallback para as rotas do React Router. Nenhum deploy é iniciado por essa configuração.
- Antes de publicar, configure no painel do site os valores do Firebase do projeto correto: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` e `VITE_FIREBASE_MEASUREMENT_ID`. Não grave esses valores em arquivos versionados.
- Confirme as regras implantadas do Firestore e conclua a conciliação dos saldos legados antes da autorização de publicação.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
