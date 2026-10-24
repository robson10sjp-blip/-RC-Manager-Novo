# Registro de retomada

## Simplificacao dos filtros - 2026-10-24 (validada)

- Menu unico nas sete abas aplicaveis: Geral (todos os anos), todas as
  viagens do ano e viagens 1 a 4 do ano. O campo Ano mostra "Todos os
  anos" no Geral; escolher um ano muda para o escopo anual. Removidas as
  opcoes de registros sem viagem e revisao, sem excluir esses registros.
- Selecoes antigas `unassigned`, `review` e IDs/valores fora do padrao
  sao exibidos como Geral. Escopo anual inclui registros cujo ano esta
  comprovado, ainda que o numero falte; viagem especifica requer ano e
  numero conhecidos. Geral preserva registros com ou sem vinculo. Nenhum
  ano e derivado da data de pagamento.
- A revisao tecnica saiu do Financeiro e permanece recolhida no fim da
  tela Despesas. Listagens de origem e filtros continuam acessiveis; sem
  reparacao automatica. A tela de destino usa "Escolher ano e viagem",
  oferece as quatro opcoes, carrega referencias completas existentes e
  nao substitui um vinculo incompleto ate escolha explicita. Cadastro
  inexistente so e criado pelo botao de acao explicita.
- Mantidos calculos e leitor comercial de vendas. Teste sintetico confirma
  Geral inclui despesas sem viagem/ano, incluindo o exemplo de R$ 1.579,
  anual inclui ano comprovado sem numero e periodo especifico nao absorve
  registro incompleto. Nao comprova os 25 registros nem os R$ 1.579 reais
  da conta; sem acesso Firebase autenticado, origem/destino seguem sem
  verificacao. Totais da foto permanecem referencias, nao constantes.
- Validacao final: 249 testes unitarios passaram; lint e build passaram.
  Playwright em 1366x900 e 390x844 confirmou seis opcoes exatas, troca
  de ano, independencia do formulario, revisao readonly, sem overflow,
  erros JS ou escritas Firestore. `git diff --check` passou. Build manteve
  aviso nao bloqueante de bundle acima de 500 kB.
- Previa somente leitura ativa: HTTP 200 e `MODE: readonly` confirmados.
  Link: https://glowing-adventure-777qpxpq5957hr755-4173.app.github.dev.
  Nenhuma publicacao ou gravacao real foi feita.

## Estado atual - padronizacao salva e validada (2026-10-24)

- Implementacao concluida em disco. Alteracoes preexistentes preservadas;
  nenhum commit, deploy, migracao ou gravacao na conta real.
- Revisados Dashboard, Vendas, Clientes/compras/recibos, Financeiro/
  cobrancas, Despesas/retiradas, Fornecedores/compras/parcelas/cheques,
  visitas/brindes e Secretaria/consultas locais e do servidor.
  Leitor aprovado das vendas, calculos especificos do Dashboard e
  recibo premium preservados. Nenhuma regra Firebase alterada.
- Validacao FINAL, incluindo os ultimos ajustes: 248 testes unitarios
  e 41 testes completos de regras/servicos no emulador passaram.
  Lint, build e git diff --check passaram. Build tem avisos de tamanho
  de bundle/importacao dinamica; nao bloqueiam a compilacao.
- Playwright local repetido em 1366x900 e 390x844: quatro viagens,
  troca de ano conservando numero, formulario independente, previa de
  correcao bloqueada no readonly, sem overflow horizontal ou erros JS/
  escritas Firestore observados. Testes de componentes com fixtures;
  nao representam navegacao autenticada em todas as telas reais.
- Testes sinteticos reproduzem os totais das fotos entre os resumos
  compartilhados; nao foi feita nova consulta autenticada a conta real.
  Movimentacoes posteriores continuam prevalecendo sobre as capturas.
- Ultimos refinamentos validados: cadastro existente reconhecido tambem
  pelo ID real; estilo dos campos da revisao; leitura e acao de visita
  priorizam a mesma referencia quando ha historico e desfazimento.
- R$ 1.579,00: origem/ano reais ainda NAO verificados pelo agente.
  Nenhum vinculo foi corrigido na conta. Revisao individual pronta com
  lancamentos, total, destino, confirmacao, backup e trilha no documento;
  transacao revalida o estado e altera apenas campos de vinculo/auditoria.
- Proximo passo de negocio: usuario conferir a revisao autenticado e
  comprovar ou escolher explicitamente o destino. Aplicacao real somente
  em ambiente com escrita e mediante confirmacao; nao inferir 2026 da
  data atual ou da despesa. Outros vinculos reais tambem dependem dessa
  conferencia. Nao repetir o diagnostico nem reescrever o leitor.
- Previa readonly mantida, HTTP local 200 confirmado:
  https://glowing-adventure-777qpxpq5957hr755-4173.app.github.dev
  Ela nao impede o auto-stop configurado no Codespace.

## Historico das etapas de padronizacao - 2026-10-24

- Usuario confirmou pelas fotos: 3a/2026 = 117 vendas, vendido 89065,
  recebido 14975, pendente 74090; 4a/2026 = 29 vendas, vendido 26065,
  recebido 1335, pendente 24730. Total 146 / 115130 / 16310 / 98820.
  Referencias da captura, nao constantes da aplicacao; nao houve acesso
  autenticado do agente. Movimentacoes posteriores prevalecem.
- Inventario inicial concluido: Dashboard, Vendas, Clientes/compras/recibos,
  Financeiro, Despesas/retiradas, Fornecedores, visitas/brindes e Secretaria.
  Produtos/Estoque nao receberam filtros artificiais de viagem.
- Salvos helpers de escopo anual (quatro periodos, anual, geral, sem
  vinculo, revisao), componente TripPeriodFilter e estado de consulta.
- Ligados seletores de consulta em Dashboard, Vendas, Financeiro,
  Clientes e Despesas. Calculos especificos do Dashboard e leitor das
  vendas mantidos. General indica todos os anos explicitamente.
- TripSelector de formularios usa cadastros reais, com ano de destino;
  nao converte chave de resumo em documento nem cria ao navegar.
- Implementada correcao INDIVIDUAL de despesas em TripReview:
  previsualizacao, confirmacao, transacao com revalidacao de campos,
  backup e historico no proprio documento. Previa readonly bloqueia
  aplicar. Regras existentes permitem update de expenses ao dono;
  nenhuma regra alterada. Nenhuma escrita real executada.
- R$ 1579: origem real ainda nao inspecionada; nao atribuir ano sem
  evidencia. Lista de revisao mostra documentos/valores para o dono
  conferir, incluindo registros sem cadastro/ano.
- Proximos: completar Fornecedores, formularios financeiros, Secretaria,
  visitas historicas, testes de regressao e lint/build. Mudancas desta
  etapa AINDA NAO VALIDADAS; nao declarar conclusao.

### Etapa salva: integracao das abas

- Integrados Fornecedores (resumos/historicos filtrados, destino separado
  do filtro), formularios Financeiro/Despesas/Clientes e escolha de
  destino em operacoes da Secretaria pelo TripSelector compartilhado.
- Fornecedores nao preseleciona mais a ultima viagem automaticamente;
  mudar filtros nao altera formulario. Criacao explicita reutiliza um
  unico cadastro existente do mesmo numero/ano; multiplos exigem escolha.
- Secretaria recebeu resumo/cobrancas com o mesmo seletor; chat indica
  que periodo deve ser explicitado na pergunta. Resumo matinal nao mudou.
- Visitas reconhecem referencias historicas de um mesmo periodo comprovado;
  a acao reutiliza documento existente e preserva sua referencia. Avisos
  de brinde reconhecem o mesmo periodo; nenhum brinde/estoque recriado.
- Testes unitarios completos: 246 passaram, zero falhas. Lint completo
  passou nessa etapa. Adicionados testes de referencia da captura, ano,
  revisao de despesas e visitas/brindes; todos usam dados SINTETICOS.
- Proximos: emulador para transacoes/regras EXISTENTES, verificacao de
  layout com Playwright local e build. Nao houve leitura autenticada
  nem escrita de producao e nenhuma regra foi alterada.

### Etapa salva: emulador e navegador

- Suite completa de regras/servicos passou: 41 testes no projeto
  demo-rc-manager-rules. Correcao individual de despesa, backup,
  revalidacao concorrente e isolamento entre donos comprovados no
  emulador, nao em producao.
- Uma fixture antiga do teste de visitas nao tinha data comercial,
  embora esperasse compra na 3a/2026; agora informa saleDate explicitamente.
  O leitor aprovado nao foi afrouxado para fazer esse teste passar.
- Navegador Playwright local verificou os seletores em 1366x900 e
  390x844, quatro periodos, troca de ano conservando numero, destino
  independente do filtro e ausencia de overflow horizontal/erros JS/
  escritas Firestore. Dados de teste ficticios; SEM login na conta real.
- Build passou, com avisos de tamanho de bundle/importacao dinamica.
- Apos isso foram acrescentadas semantica anual das consultas da
  Secretaria/servidor, busca combinada no Financeiro, preservacao da
  privacidade no JSON do diagnostico e refinamentos de revisao.
  Validacao final concluida; resultados e proximos passos no estado atual
  acima. As pendencias descritas nas etapas anteriores sao historicas.

Atualizado em 2026-10-24, apos a validacao focada iniciada em 01:45 UTC.
Atualizar ao concluir cada etapa.

## Regras de preservacao

- Nao parar, reiniciar ou reconstruir o Codespace durante o diagnostico.
- Preservar todas as alteracoes preexistentes, inclusive arquivos nao rastreados.
- Salvar cada etapa em disco. Nao descartar nem refazer trabalho ja validado.
- Nao modificar dados de producao para investigar a classificacao.

## Diagnostico do Codespace concluido

- Logs da extensao registram `CodespaceStopping`, `forced: false`,
  `timeoutInMs: 120000` e notificacao de auto-stop.
- Configuracao registrada: `idle_timeout_minutes: 30`.
- Encerramentos repetidos do processo de extensoes por SIGTERM, inclusive
  2026-10-24 01:36:18 e 01:36:50 UTC. Inicializacao posterior em 01:38-01:39.
- Recursos na verificacao: 7,8 GiB RAM, 5,3 GiB disponiveis; zero OOM no
  cgroup atual; disco 57% ocupado, cerca de 13 GiB livres.
- Nao encontrados comandos de parada nas tarefas/scripts examinados.
- Causa exata da ultima parada NAO comprovada. Faltam motivo/solicitante
  no servico GitHub e logs do host anterior. API de leitura retornou 403;
  dmesg sem permissao e journal indisponivel.
- Nenhuma configuracao, autenticacao ou arquivo do projeto foi alterado
  durante esse diagnostico.

## Trabalho de vendas recebido (preexistente; nao descartar)

- 20 arquivos rastreados modificados, mais testes/relatorio e tres ZIPs
  nao rastreados. Inventario conferido com git status em 01:45 UTC.
- Ja existem leitor compartilhado de data comercial, classificacao
  trimestral por ano, agrupamento e painel de auditoria somente leitura.
- README informa que testes com 146 registros sao SINTETICOS; nao sao
  evidencia da distribuicao das vendas da conta real.
- Nenhuma venda real da 3a/4a viagem foi confirmada nesta retomada.

## Etapa anterior (historico; substituida pelo estado acima)

1. Conferir leitor, testes e acesso existente aos dados reais.
2. Localizar as vendas reais da 3a e 4a viagem e verificar data comercial,
   origem da data e totais, sem inventar datas/vinculos.
3. Corrigir somente defeitos comprovados, salvar e testar cada etapa.
4. Registrar resultados reais ou bloqueios de acesso, separando-os de
   testes sinteticos, antes de considerar a tarefa concluida.

## Pontos de entrada

- src/domain/saleTrip.js: resolveSaleCalendar e getSaleTrip.
- src/domain/saleTripReport.js: buildSaleTripAudit.
- src/pages/SalesPage.jsx: painel de diagnostico e leitura das vendas.
- README.md: regras esperadas e limites da validacao anterior.

## Validacao nesta retomada

- Executado:
  `node --test src/domain/saleTrip.test.js src/domain/saleTripReport.test.js src/domain/tripIdentity.test.js src/domain/sales.test.js`.
- Resultado: 65 testes passaram, zero falhas. Isso valida a logica local,
  NAO confirma quantidade, valores nem datas das vendas reais.
- Leitura existente: SalesPage assina users/{uid}/sales usando a sessao
  Firebase do usuario no navegador. O terminal nao herda essa sessao.
- Nenhuma exportacao real de vendas foi encontrada na busca local.
  Nenhuma variavel de credencial Firebase/Google foi identificada;
  .env.local existe, mas configuracao web nao equivale a login no banco.
- Nao foi feita leitura autenticada nem escrita no banco real.
- Regra salva e testada: 3a = julho-setembro; 4a = outubro-dezembro,
  sempre no ano da data comercial e com instantes em America/Belem.
- Origem legada: somente esquema original reconhecido pode usar createdAt
  quando saleDate esta ausente/vazia. Datas invalidas nao sao adivinhadas;
  pagamento/vencimento/vinculo antigo nao substituem a data comercial.
- Divergencia documental identificada: README ainda citava paymentMethod
  como requisito do fallback, mas o leitor e teste ja nao exigem isso;
  documentacao ajustada para refletir a implementacao preservada.

## Bloqueio anterior e passos historicos

- Usuario confirmou ano 2026 e solicitou previa local somente leitura,
  instrucoes de acesso e botao para copiar o diagnostico agregado.
- Salvo botao e campo de copia manual em SalesPage; texto contem somente
  auditoria agregada e metadados fromCache/hasPendingWrites.
- Listener de vendas agora acompanha mudancas de metadados para informar
  confirmacao do servidor. Nenhuma escrita foi adicionada.
- Validacao concluida: 67 testes passaram, zero falhas, incluindo os
  testes de bloqueio de escrita. ESLint dos arquivos SalesPage e
  saleTripReport passou; git diff --check passou; editor sem erros em
  SalesPage. Copia por clique ainda depende da verificacao no navegador.
- Previa iniciada em processo persistente, sessao de shell
  rc-readonly-preview-4173, PID observado 9117, porta 4173.
- HTTP 200 confirmado em http://127.0.0.1:4173/; modulo servido confirmou
  MODE readonly e pagina compilada contem o botao de copia.
- Endereco para o usuario:
  https://glowing-adventure-777qpxpq5957hr755-4173.app.github.dev
- Abrir com autenticacao GitHub do Codespace, depois login existente do
  app; menu Vendas (/vendas), expandir diagnostico, aguardar confirmacao
  do servidor e copiar o JSON agregado. Verificar grupos trip-2026-3 e
  trip-2026-4. Nao tornar a porta publica nem enviar credenciais.
- Processo persistente nao impede auto-stop do Codespace. Se parar,
  conferir a porta e este registro antes de iniciar outra instancia.
- Ainda falta o usuario abrir a conta e fornecer o agregado real.
- Aguardar o ano de interesse e o painel Vendas > Diagnostico de viagens
  (somente leitura) da conta autenticada, ou uma exportacao autorizada.
- Pedir apenas quantidades, origens/formatos de datas e totais por viagem;
  nao pedir senha, token ou chave privada.
- Conferir grupos da 3a/4a e pendencias. Se houver vendas nao classificadas,
  examinar apenas os campos comerciais necessarios em exportacao local
  autorizada, antes de propor qualquer nova regra.
- Nao voltar a executar o diagnostico amplo do Codespace nem refazer os
  helpers ja salvos sem evidencia nova. Nenhuma classificacao de venda
  real foi confirmada ate aqui.
