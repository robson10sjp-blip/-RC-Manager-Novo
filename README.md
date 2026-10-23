# React + Vite

## Viagens por numero e ano

- Novas viagens exigem numero de 1 a 4 e ano editavel. O nome e gerado como "4ª viagem de 2026". Os trimestres sao apenas referencia, nunca uma regra para reclassificar dados.
- A criacao acontece somente em "Criar nova viagem" > "Confirmar nova viagem". O ID deterministico por numero/ano e a transacao impedem criacoes concorrentes duplicadas; cadastros antigos com o mesmo numero/ano tambem sao verificados.
- Editar uma venda carrega o registro original por ID e nao regrava campos de viagem inalterados. Referencias legadas ou ausentes permanecem preservadas, mesmo durante carregamento lento do cadastro.
- Seletores e filtros compartilham [tripIdentity.js](./src/domain/tripIdentity.js). IDs diferentes nao sao unidos por nomes semelhantes e anos ausentes nao sao deduzidos de datas. "Todas as viagens" inclui todos os registros; "Sem viagem definida" e um escopo separado.
- O Financeiro oferece revisao somente leitura de referencias legadas/ambiguas, com IDs dos registros e previa do numero/ano de destino. "Exportar diagnostico e backup dos vinculos" baixa um JSON privado dos campos de viagem carregados (incluindo campos ausentes); nao e backup integral do banco. Para simular uma associacao, escolha o registro, numero, ano e ID exato do destino e exporte a simulacao. O arquivo inclui caminho, campos originais, precondicoes e chave repetivel da operacao; nao e executavel e nao grava nem cria viagens. A associacao manual individual de vendas continua disponivel em "Editar" > "Viagem", mediante escolha explicita e salvar. Reparacoes em massa exigem nova aprovacao, conferencias transacionais e auditoria; nenhuma migracao e executada.
- Referencias sem cadastro com anos conflitantes no mesmo ID ficam em revisao, sem escolher o ultimo ano recebido. Cadastros existentes conservam seu numero/ano como fonte, com conflitos indicados para revisao. IDs diferentes nunca sao unidos, mesmo que o nome ou numero/ano coincidam.
- O formato novo de criacao requer as regras completas em [firestore.rules](./firestore.rules), ainda locais nesta revisao. Nenhuma regra de producao e publicada automaticamente. O isolamento por UID e os bloqueios de alteracao/exclusao de viagens permanecem.

## Calendario nas acoes da cliente

- Na ficha, "Nao comprou" e "Dar brinde" usam a data local de hoje, alteravel por calendario. ID e cidade vem automaticamente do cadastro da cliente. A viagem e opcional e nunca e inferida da data.
- Novos registros guardam `actionDate` no formato ISO (YYYY-MM-DD); os historicos mostram DD/MM/AAAA. Sem viagem, visitas de dias diferentes tem documentos separados. Ao vincular uma viagem explicitamente, o historico existente dessa viagem permanece reconhecido.
- Documentos antigos sem `actionDate` permanecem legiveis e cancelaveis, com suas datas e viagens originais. Publique o arquivo completo [firestore.rules](./firestore.rules) para aceitar o novo campo e registros sem viagem. As validacoes atomicas de estoque e o isolamento por UID permanecem ativos.

## Firebase no build de producao

- No Netlify, cadastre as seis variaveis `VITE_FIREBASE_*` exigidas em `src/firebase/configValidation.js`, no contexto **Production**, disponiveis para **Builds**, usando a configuracao web do projeto Firebase existente. No plano gratuito, use todos os escopos (o plano nao permite restringir a um escopo especifico). `VITE_FIREBASE_MEASUREMENT_ID` e opcional.
- O Vite incorpora esses valores no JavaScript durante o build; alterar variaveis exige um novo deploy. `.env.local` nao e versionado e nao esta disponivel no Netlify.
- O build falha explicitamente se uma variavel obrigatoria faltar ou contiver um valor de exemplo. A mensagem mostra apenas nomes de variaveis, nunca valores.
- O Service Worker usa atualizacao automatica e os arquivos de entrada do PWA exigem revalidacao HTTP. Nenhuma correcao requer apagar IndexedDB, login ou dados locais.

## Fornecedores: cheques e correcoes

- Compras e pagamentos de fornecedores continuam usando `users/{uid}/payables` e a subcolecao `payments`, compartilhadas com o Financeiro. Cheques emitidos ficam como obrigacao; somente a compensacao cria o pagamento no caixa, com ID deterministico compartilhado entre as telas para impedir duplicidade.
- Compras aceitam varias parcelas/cheques com banco/conta, numero, emissao e data prevista de compensacao. O saldo, as parcelas e os pagamentos sao editados em transacoes.
- A edicao de compras abre em modal. Campos monetarios aceitam digitacao e colagem em formato brasileiro/internacional e exibem valores como `R$ 8.900,00`.
- E possivel associar um ou varios cheques as parcelas em aberto de uma compra existente, sem criar nova compra ou aumentar a divida. Os cheques e a correcao sao gravados na mesma transacao e permanecem pendentes ate a compensacao.
- Correcoes preservam os valores anteriores em `payables/{payableId}/corrections`, sem criar um segundo pagamento. O total da compra nao pode ficar abaixo do que ja foi pago; reducoes que afetem parcelas pagas ou cheques emitidos sao bloqueadas para conciliacao explicita.
- As novas escritas de correcoes exigem as permissoes correspondentes em [firestore.rules](./firestore.rules). Publique o arquivo completo manualmente no console do Firebase; as regras de producao nao sao aplicadas pelo deploy do Netlify.

## Despesas e retirada pessoal

- A tela Despesas usa os mesmos documentos `users/{uid}/expenses` consumidos pelo Financeiro, Dashboard e Secretária RC; não existe uma coleção paralela nem lançamentos financeiros duplicados.
- Merenda, almoço, janta, combustível, hotel, mecânico, carro e outros são despesas operacionais. “Pessoal” é gravado como `kind: "personal_withdrawal"` e categoria `pessoal`; reduz o fluxo de caixa, mas é excluído das despesas operacionais e do lucro operacional. Os relatórios exibem a retirada separadamente.
- Data é local e vem preenchida com hoje. Forma de pagamento é opcional e a última opção usada fica no armazenamento local do dispositivo. Cidade e viagem são opcionais; o código não atribui viagem automaticamente pela data. A coleção existente já restringe leitura e gravação ao UID do proprietário, então esta tela não exige uma alteração adicional em `firestore.rules`.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## Compras, recebimentos e viagens

- A opção de navegação "👩‍💼 Secretária RC" reutiliza a rota e os indicadores da antiga Inteligência RC. O resumo e as respostas rápidas consultam somente coleções do usuário autenticado (`users/{uid}`), incluindo vendas, clientes, produtos, despesas e históricos de recebimentos por compra/cliente. Viagens são sumarizadas pelos campos de viagem das vendas.
- A conversa desta primeira etapa é uma consulta local determinística, não uma IA: perguntas fora das consultas implementadas são identificadas como não suportadas. O histórico fica apenas na memória da tela, não há operações de escrita e nenhum dado é enviado a serviços externos. O botão de voz permanece desativado até a integração explícita de reconhecimento de fala.
- A interpretação financeira da Secretária separa recebimentos efetivados, vendas, lista de cobranças e valores pendentes. O total consolidado a receber usa a mesma regra no Financeiro, Dashboard e Secretária: quando há vendas legadas vinculadas, considera os saldos pendentes dessas vendas em vez de somar novamente `clients.totalDebt`; compras `per-sale` e saldos históricos sem venda legada vinculada são somados como valores independentes, e vendas sem cliente cadastrado entram uma vez como não atribuídas. A Secretária também responde despesas, lucro estimado e maior faturamento por viagem com os dados em memória do usuário autenticado.
- A conversa reconhece numero e ano das viagens e mantém o ID escolhido nas perguntas de acompanhamento. Se houver mais de um vinculo possivel, solicita ano/referencia em vez de unir registros. Cobrancas e relatorios nao classificam vendas pela data. Comparacoes de lucro nao declaram vencedora quando faltam custos cadastrados. Lancamentos administrativos de despesas exigem uma viagem cadastrada explicitamente selecionada (ou confirmacao de "Sem viagem definida"), sem sugestao automatica por data.
- `npm test` executa os testes de domínio com dados fictícios em memória; eles não inicializam nem acessam Firebase.
- O Dashboard permite filtrar os totais por viagens cadastradas e ano, além de visão geral, registros sem viagem e revisão. Compras de mercadorias vinculadas à viagem/ano aparecem no cartão "Compras de mercadorias da viagem", que abre a lista detalhada e inclui obrigações ainda não pagas. O cartão mantém "Sem viagem definida" para compras antigas; despesas só entram no resumo quando possuem vínculo explícito.
- `npm run dev:readonly -- --host 0.0.0.0 --port 4173 --strictPort` abre o app autenticado com leituras normais e bloqueio local de `addDoc`, `updateDoc`, `deleteDoc`, `setDoc` e `runTransaction`. O app continua exigindo a configuração web Firebase e login do usuário. Esse bloqueio no cliente não substitui regras Firestore somente leitura; não use este modo como controle de autorização em produção.
- Cada compra continua sendo um documento em `users/{uid}/sales/{saleId}`. Compras novas guardam `saleDate`, `dueDate`, `amountPaid`, `pendingAmount`, `status`, `tripName` e `tripCity`; o próprio `saleId` identifica a compra.
- Os recebimentos ficam na subcoleção `users/{uid}/sales/{saleId}/payments` e atualizam o saldo da compra em uma transação. Não se deve usar o saldo agregado do cliente para quitar uma compra específica.
- `clients.totalDebt` e o histórico antigo em `clients/{clientId}/payments` são preservados sem migração. Para clientes com compras registradas, a baixa agregada pela ficha do cliente é bloqueada; recebimentos devem ser vinculados à compra. Compras antigas ainda atualizam o saldo legado somente pela variação daquela compra, sem recalcular ou substituir o total do cliente.
- Compras antigas sem `balanceModel: "per-sale"` mantêm o comportamento de saldo agregado: receber, editar ou excluir uma compra atualiza `clients.totalDebt` apenas pela diferença daquela compra, dentro da mesma transação. A operação é bloqueada se o saldo agregado for menor que o saldo da compra; essa situação precisa de conciliação, não de ajuste automático. Compras novas marcadas como `per-sale` nunca alteram esse saldo antigo.
- A tela Financeiro filtra viagens pelo ID cadastrado e, quando disponível, pelo par número/ano; compras antigas sem vínculo aparecem em “Sem viagem”. O resumo de compras inclui o valor integral de mercadorias ainda não pagas, enquanto pagamentos por viagem seguem a compra mesmo quando quitados depois. Cheques pendentes e compensados aparecem separados. O cartão de compras abre a lista de fornecedor, descrição, data, total, pago e saldo. O resumo mantém separados valor comprado, custo das mercadorias vendidas e pagamentos efetivos: compras de estoque não reduzem o lucro novamente; cada saída de caixa vem do pagamento ou da compensação, cujo histórico preserva a data real do evento.
- A comparação na tela Clientes é somente diagnóstica: mostra o saldo legado, a soma pendente das compras e a diferença aritmética. Diferença não é uma sugestão de ajuste; validar recibos, histórico de pagamentos e compras antes de qualquer alteração manual autorizada.
- A tela Vendas usa todo o historico do usuario autenticado, com filtros, busca e totais por ID de viagem. O ano nao e inferido da data da venda, criacao, vencimento ou pagamento. Referencias ausentes, sem ano ou ambiguas aparecem para revisao; cada compra e seus pagamentos permanecem ligados a referencia original.
- Compras que já têm recebimentos não podem ser excluídas nem ter total/produtos alterados. Isso preserva estoque e trilha de pagamentos; datas e dados de viagem ainda podem ser corrigidos.
- Em Clientes, “Compras e Recibos” lista as vendas pelo ID da cliente, sem consolidar o saldo legado com saldos individuais; o recibo reutiliza `ReceiptTemplate`. No Financeiro, “Recibo” abre a mesma visualização premium, com voltar/fechar, impressão, PDF e compartilhamento.
- O controle global de privacidade oculta indicadores monetários por padrão e mantém a preferência no armazenamento local do navegador (`rc-manager-financial-values-hidden`). Preços individuais de produtos permanecem visíveis.
- Os campos de nome formatam nomes novos ou alterados durante a edição; salvar outros campos sem tocar em um nome antigo mantém o texto armazenado.
- A classificação RC Premium é manual e permanente, armazenada no próprio documento da cliente como `classification`; novas clientes começam como `unclassified`. “Clientes Prego” é um filtro da mesma classificação. Registros antigos ativos em `pregoClients` continuam sendo reconhecidos como Prego até que uma classificação explícita seja escolhida, sem migração automática dos dados.
- O painel de visitas usa selecao de cidade e viagem. As acoes "Nao comprou" e "Dar brinde" usam o calendario e permitem viagem opcional. Clientes e Vendas compartilham a criacao explicita de `users/{uid}/trips/{tripId}` por numero/ano; IDs antigos UUID sao preservados. Vendas e visitas vinculadas usam o mesmo ID, sem adivinhar identidade pela data.
- Na ficha expandida, a cidade vem da cliente e a data vem preenchida com hoje. Os filtros superiores de pesquisa/historico nao alteram silenciosamente o vinculo de uma acao. Erros de carregamento ou permissao permanecem explicitos.
- Rotulos historicos sem ID como "3", "3a viagem" e "3ª viagem" recebem um escopo de leitura `legacy-number-3`; com ano explicito, o ano integra esse escopo. Esse escopo nao e unido a um ID cadastrado pelo nome. IDs reais diferentes permanecem separados, mesmo com nomes iguais. Nenhuma migracao ou regravacao automatica acontece; o layout premium do recibo e os valores financeiros sao preservados.
- `clientVisits` registra cliente por ID, cidade, chave canonica da cidade, `tripId`, nome de exibicao, status e historico. A transacao valida a existencia/cidade da cliente e usa um documento deterministico por cliente/cidade/viagem. Repetir a mesma marcacao nao duplica o historico. Desfazer grava `unvisited`, sem excluir o registro. "Comprou" e derivado apenas de venda nao cancelada do mesmo cliente/viagem/cidade; quando uma venda antiga nao informa cidade, usa-se a cidade da cliente.
- As gravacoes de visitas e brindes estao habilitadas no app (`CLIENT_VISIT_WRITES_ENABLED=true`, `CLIENT_GIFT_WRITES_ENABLED=true`) e dependem da publicacao manual do `firestore.rules` atualizado. Se a regra ainda nao foi publicada, o app mostra o erro de permissao explicitamente.
- As regras versionadas de segurança estão em `firestore.rules`, com configuração local em `firebase.json`. O escopo padrão é por proprietário (`users/{uid}`), negando acesso cruzado entre contas e negando por padrão caminhos não mapeados.
- As regras permitem criar/atualizar visitas apenas sob o UID do dono, com cliente existente, cidade correspondente, viagem valida e status `not_purchased`/`unvisited`. O escopo e a data de criacao sao imutaveis; exclusao e status manual "Comprou" sao negados. O cadastro `trips` so permite leitura e criacao pelo dono, sem alteracao/exclusao. Apenas `pregoClients` legado continua com escrita bloqueada; a classificacao atual permanece em `clients`.
- Brindes usam o mesmo `tripId` de visitas/vendas e guardam ID da cliente, cidade, produto cadastrado, quantidade inteira positiva e custo separado. As regras exigem, na mesma transacao, criacao do brinde e movimento imutavel mais a baixa exata do estoque; quantidade, custo, cliente e viagem sao validados. Nenhuma venda, despesa, recebivel ou divida e criada.
- Para corrigir um brinde, use **Cancelar e devolver ao estoque**, depois registre a entrega correta. Nao ha edicao nem exclusao do historico. O cancelamento usa o produto do documento persistido, nao o enviado pela tela, e exige o movimento de estorno e a devolucao exata no mesmo commit. Repetir a entrega com o mesmo ID ou repetir um cancelamento confirmado nao altera estoque novamente.
- Em conflitos simultaneos, as regras podem recusar uma tentativa: a tela informa explicitamente que ela nao foi confirmada. Confira o historico e repita com os mesmos dados/ID; nenhum commit parcial ou estoque negativo e permitido. Custos historicos sao mantidos mesmo se o preco atual mudar.
- Pagamentos (`sales/*/payments`, `clients/*/payments`, `payables/*/payments`) e `stockMovements` são imutáveis após criação nas rules atuais.
- Para validar as rules sem produção: `npm run test:rules` (usa emulador Firestore com dados fictícios). Esse teste não grava nem lê dados reais.

### Aplicar as regras completas de visitas e brindes

1. No projeto Firebase ja utilizado pelo sistema, abra **Firestore Database > Regras** e guarde a versao publicada atual.
2. Substitua todo o editor pelo conteudo completo de [firestore.rules](./firestore.rules) e clique em **Publicar**. Publicar regras nao altera documentos. Nao e necessario mudar credenciais, criar indices ou migrar registros.
3. Reabra o app e selecione cidade/viagem em Clientes. A criacao de uma viagem requer uma confirmacao explicita. "Dar brinde" exige cliente da cidade selecionada, produto existente com estoque e custo valido. Para corrigir, cancele antes de registrar novamente; o historico permanece consultavel apos recarregar.
4. A validacao automatica de persistencia e acesso entre usuarios deve ser feita com `npm run test:rules`, sem gravacoes de teste em producao.
5. Para reverter, restaure as regras restritivas imediatamente anteriores, mantendo o isolamento por UID. Nao restaure a antiga regra de acesso geral a qualquer usuario autenticado.

## Fornecedores e contas a pagar

- Fornecedores e obrigações são armazenados somente em `users/{uid}/suppliers` e `users/{uid}/payables`, respeitando o usuário autenticado. A identificação de fornecedor é validada como única; fornecedores vinculados a contas não podem ser excluídos.
- Cada conta registra fornecedor, compra, total, entrada, viagem opcional e parcelas/títulos. Cheques exigem número individual, data de apresentação e conta Banco do Brasil PF ou PJ. A soma do cronograma deve corresponder ao saldo após a entrada.
- Compras podem ser vinculadas a uma viagem cadastrada (ex.: “1ª viagem de 2027”); a última viagem criada é sugerida, mas pode ser alterada. O vínculo não é inferido pela data. A edição da compra permite corrigir esse vínculo e preserva a versão anterior na trilha de auditoria.
- Cheques emitidos permanecem como obrigação pendente. Somente a confirmação de compensação atualiza o saldo pago e grava um evento no histórico de pagamentos, em transação com identificador estável para evitar duplicidade. Devolução e cancelamento preservam a dívida e o histórico de status, sem registrar saída de caixa; a obrigação pode ser paga depois por outro meio.
- A área de cheques filtra por mês de apresentação, fornecedor, conta PF/PJ e status, e resume os valores emitidos previstos para 7, 15 e 30 dias. A visão acompanha o filtro de viagem selecionado no Financeiro.
- Compras de estoque não geram despesa nem alteram estoque automaticamente; o custo entra no lucro conforme as mercadorias são vendidas. Compras marcadas como operacionais entram uma vez no lucro na data da compra e não devem ser lançadas também em `expenses`. Pagamentos a fornecedores diminuem o fluxo de caixa, mas não são lançados novamente como despesa nem alteram o custo das mercadorias vendidas.
- Dashboard e Financeiro acompanham obrigações gerais, viagens, parcelas vencidas, próximos vencimentos e valores já pagos; a Secretária RC responde consultas de saldo, credores, parcelas atrasadas e cheques por período.
- A prévia em modo `readonly` bloqueia as gravações no Firestore. As regras locais validam vínculos de viagem em compras e exigem auditoria ao corrigir esses vínculos, mantendo o acesso sob `users/{uid}`. Para aplicar essa validação em produção, publique manualmente o `firestore.rules` atualizado; o deploy do site não publica regras automaticamente.

## Preparação para Netlify

- `netlify.toml` configura `npm run build`, publicação de `dist` e fallback para as rotas do React Router. Nenhum deploy é iniciado por essa configuração.
- Antes de publicar, configure no painel do site os valores do Firebase do projeto correto: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` e `VITE_FIREBASE_MEASUREMENT_ID`. Não grave esses valores em arquivos versionados.
- Confirme as regras implantadas do Firestore e conclua a conciliação dos saldos legados antes da autorização de publicação.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
