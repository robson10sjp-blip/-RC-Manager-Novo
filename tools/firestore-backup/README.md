# Backup local do Firestore

Ferramenta independente do app RC Manager. Ela percorre as coleções e subcoleções com o Firebase Admin SDK, serializa IDs, caminhos e tipos Firestore e grava somente um arquivo JSON criptografado `.json.enc` fora do repositório.

## Segurança

- O modo de produção só é liberado com `--live-read-confirmed` e exatamente uma destas opções: `--writes-paused-confirmed` para janela sem gravações, ou `--accept-concurrent-writes-risk` para uma cópia de melhor esforço que pode refletir momentos diferentes. Não use sem autorização explícita para ler o banco real.
- O SDK usa Application Default Credentials. Prefira uma identidade Google com permissão somente de leitura, sem chaves de serviço no repositório.
- Para compatibilidade com Firebase Admin, a CLI cria uma configuração ADC impersonada temporária em `/dev/shm` com permissão `0600`, remove-a ao terminar e restaura `GOOGLE_APPLICATION_CREDENTIALS`. Ela não cria chave privada nem substitui a ADC padrão.
- A senha do arquivo é digitada duas vezes sem eco no terminal e não pode ser passada por argumento ou variável de ambiente.
- O arquivo deve ser um caminho absoluto fora do repositório, dentro de uma pasta externa já existente; o programa não cria pastas, não sobrescreve arquivos existentes e cria a saída com permissão `0600`.
- O arquivo usa AES-256-GCM e chave derivada por scrypt. Antes de publicar o arquivo final, a ferramenta o lê em streaming, valida a tag de autenticação e calcula o SHA-256, sem gravar plaintext. Guarde a senha separadamente: sem ela, o backup não poderá ser recuperado.
- A execução faz apenas enumeração e leituras do Firestore. Ela não chama operações de escrita, exclusão, migração ou restauração.

## Consistência e cotas

O Admin SDK não cria uma leitura transacional única do banco inteiro. Para consistência, interrompa temporariamente todas as gravações no app e em outros clientes durante a coleta. Se isso não for possível, `--accept-concurrent-writes-risk` permite uma cópia de melhor esforço: documentos alterados enquanto são lidas páginas diferentes podem produzir um retrato de momentos distintos; coleções/subcoleções criadas durante a enumeração podem ficar de fora. A rotina usa leituras paginadas ordenadas por ID, percorre recursivamente cada subcoleção e também enumera referências ausentes que ainda tenham subcoleções (por exemplo, pagamentos órfãos de uma venda removida). Ela aborta em caso de erro; ao final informa contagens agregadas sem IDs e SHA-256 do arquivo.

No Spark, leituras usam as cotas gratuitas disponíveis. Se não houver cota suficiente, a execução pode falhar; ela não habilita faturamento nem muda de plano. O backup local não usa exportação gerenciada nem Cloud Storage.

## Testes fictícios

Na pasta desta ferramenta, execute `npm install` uma vez e depois `npm test`. Os testes usam fixtures em memória e não inicializam o Admin SDK. Para exibir a sintaxe sem conectar ao banco: `npm run backup -- --help`.

Uma futura execução real exige autorização separada, ADC configuradas fora do repositório e uma pasta de saída protegida. Além da senha criptográfica, a CLI exige `--live-read-confirmed` e exatamente uma opção de consistência: `--writes-paused-confirmed` ou `--accept-concurrent-writes-risk`. Não as use durante os testes fictícios.