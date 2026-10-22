# React + Vite

## Firebase no build de producao

- No Netlify, cadastre as seis variaveis `VITE_FIREBASE_*` exigidas em `src/firebase/configValidation.js`, no contexto **Production**, disponiveis para **Builds**, usando a configuracao web do projeto Firebase existente. No plano gratuito, use todos os escopos (o plano nao permite restringir a um escopo especifico). `VITE_FIREBASE_MEASUREMENT_ID` e opcional.
- O Vite incorpora esses valores no JavaScript durante o build; alterar variaveis exige um novo deploy. `.env.local` nao e versionado e nao esta disponivel no Netlify.
- O build falha explicitamente se uma variavel obrigatoria faltar ou contiver um valor de exemplo. A mensagem mostra apenas nomes de variaveis, nunca valores.
- O Service Worker usa atualizacao automatica e os arquivos de entrada do PWA exigem revalidacao HTTP. Nenhuma correcao requer apagar IndexedDB, login ou dados locais.

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
- Em Clientes, “Compras e Recibos” lista as vendas pelo ID da cliente, sem consolidar o saldo legado com saldos individuais; o recibo reutiliza `ReceiptTemplate`. No Financeiro, “Recibo” abre a mesma visualização premium, com voltar/fechar, impressão, PDF e compartilhamento.
- O controle global de privacidade oculta indicadores monetários por padrão e mantém a preferência no armazenamento local do navegador (`rc-manager-financial-values-hidden`). Preços individuais de produtos permanecem visíveis.
- Os campos de nome formatam nomes novos ou alterados durante a edição; salvar outros campos sem tocar em um nome antigo mantém o texto armazenado.
- A classificação RC Premium é manual e permanente, armazenada no próprio documento da cliente como `classification`; novas clientes começam como `unclassified`. “Clientes Prego” é um filtro da mesma classificação. Registros antigos ativos em `pregoClients` continuam sendo reconhecidos como Prego até que uma classificação explícita seja escolhida, sem migração automática dos dados.
- Visitas exigem selecao manual de cidade e viagem. Clientes e Vendas compartilham o seletor: "Confirmar nova viagem" cria `users/{uid}/trips/{tripId}` com UUID permanente, inclusive quando duas viagens tem o mesmo nome. Novas vendas e visitas guardam o mesmo `tripId`; nenhuma data financeira e usada para adivinhar a identidade.
- Rotulos historicos como "3", "3a viagem" e "3ª viagem" recebem a mesma identidade de leitura `legacy-number-3`. Nomes explicitos antigos recebem uma identidade `legacy-name-*`. Isso nao migra nem regrava documentos antigos; viagens novas sempre tem UUID independente do historico. O recibo premium e os calculos financeiros nao mudam.
- `clientVisits` registra cliente por ID, cidade, chave canonica da cidade, `tripId`, nome de exibicao, status e historico. A transacao valida a existencia/cidade da cliente e usa um documento deterministico por cliente/cidade/viagem. Repetir a mesma marcacao nao duplica o historico. Desfazer grava `unvisited`, sem excluir o registro. "Comprou" e derivado apenas de venda nao cancelada do mesmo cliente/viagem/cidade; quando uma venda antiga nao informa cidade, usa-se a cidade da cliente.
- As gravacoes de visitas estao habilitadas no app e dependem da publicacao manual do `firestore.rules` atualizado. Se a regra ainda nao foi publicada, o app mostra o erro de permissao explicitamente. Brindes continuam bloqueados, separadamente, sem alteracao nesta entrega.
- As regras versionadas de segurança estão em `firestore.rules`, com configuração local em `firebase.json`. O escopo padrão é por proprietário (`users/{uid}`), negando acesso cruzado entre contas e negando por padrão caminhos não mapeados.
- As regras permitem criar/atualizar visitas apenas sob o UID do dono, com cliente existente, cidade correspondente, viagem valida e status `not_purchased`/`unvisited`. O escopo e a data de criacao sao imutaveis; exclusao e status manual "Comprou" sao negados. O cadastro `trips` so permite leitura e criacao pelo dono, sem alteracao/exclusao. `clientGifts` e `pregoClients` continuam com escrita bloqueada.
- Pagamentos (`sales/*/payments`, `clients/*/payments`, `payables/*/payments`) e `stockMovements` são imutáveis após criação nas rules atuais.
- Para validar as rules sem produção: `npm run test:rules` (usa emulador Firestore com dados fictícios). Esse teste não grava nem lê dados reais.

### Aplicar as regras de visitas

1. No projeto Firebase ja utilizado pelo sistema, abra **Firestore Database > Regras** e guarde a versao publicada atual.
2. Substitua todo o editor pelo conteudo completo de [firestore.rules](./firestore.rules) e clique em **Publicar**. Publicar regras nao altera documentos. Nao e necessario mudar credenciais, criar indices ou migrar registros.
3. Reabra o app e selecione cidade/viagem em Clientes. A criacao de uma viagem requer uma confirmacao explicita. Marque "Nao comprou", recarregue, selecione o mesmo escopo e confira; desfaca e confira novamente.
4. A validacao automatica de persistencia e acesso entre usuarios deve ser feita com `npm run test:rules`, sem gravacoes de teste em producao.
5. Para reverter, restaure as regras restritivas imediatamente anteriores, mantendo o isolamento por UID. Nao restaure a antiga regra de acesso geral a qualquer usuario autenticado.

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
