# Plano de execução — alinhamento visual, motion e UX

## Lote 1 — Movimento contínuo e navegação estável
**Classificação:** Polimento agora  
**Maior ganho visual por menor custo.**

- **Objetivo:** eliminar o efeito de “tela piscando”, estabilizar visualmente a barra inferior e unificar movimentos curtos e naturais.
- **Arquivos/componentes prováveis:** `src/components/app/AppShell.tsx`, `src/components/app/ui.tsx`, `src/styles.css`, layout autenticado em `src/routes/_authenticated/route.tsx` e sheets locais já existentes.
- **Mudanças exatas:**
  - remover a entrada de rota baseada em `opacity: 0` e substituir por continuidade sem flash, usando movimento discreto apenas no conteúdo quando apropriado;
  - manter a BottomNav numa camada persistente do layout autenticado, preservando exatamente dimensões e aparência atuais;
  - corrigir o histórico artificial do menu radial: fechar por Voltar/Escape sem deixar uma entrada extra após navegar para Galeria, Sorteio ou Match;
  - definir primitives reutilizáveis para entrada e saída de sheets, garantindo que o conteúdo permaneça montado até terminar a saída;
  - manter feedback de toque em 150–200 ms e sheets em até 220 ms, com comportamento praticamente instantâneo em `prefers-reduced-motion`;
  - preservar safe area, alvos de aproximadamente 44 px e espaço reservado para a barra inferior.
- **Riscos:** mudança do local da BottomNav pode afetar gates de autenticação/onboarding ou empilhamento de sheets; interceptação incorreta do Voltar pode prender navegação.
- **Testes de aceitação:** navegar repetidamente pelas telas em 390×844 e 412×915 sem flash preto; barra não desmonta nem desloca; radial abre/fecha com stagger discreto; Escape e Voltar fecham o radial; após escolher um destino, Voltar retorna à tela anterior real; sheets animam entrada e saída; reduced-motion elimina movimentos perceptíveis; sem conteúdo atrás da barra.
- **Não mexer em:** dimensões/aparência aprovadas da barra, regras de acesso, consultas, banco, conteúdo das telas ou lógica de Match.
- **Custo relativo:** **baixo**.

## Lote 2 — Match como pilha cenográfica
**Classificação:** Polimento agora

- **Objetivo:** dar continuidade física aos votos e uma revelação final temática, sem revelar candidatos futuros, quantidade restante ou atividade do parceiro.
- **Arquivos/componentes prováveis:** `src/routes/_authenticated/match.tsx`, componentes locais extraídos da própria tela e `src/styles.css`; funções atuais de Match apenas se um ajuste mínimo de resposta for indispensável.
- **Mudanças exatas:**
  - substituir transições `page-enter`/fade dos candidatos por uma pilha visual de profundidade constante;
  - usar atrás do card somente camadas cenográficas neutras, nunca poster, título ou dados de candidatos reais;
  - no ❤️, retirar o card atual para a direita com rotação leve; no 👎, retirar para a esquerda; revelar o próximo poster real somente após o término da saída;
  - bloquear voto duplo durante a transição e preservar undo apenas do último voto próprio;
  - remover “Ver mais opções” e fazer a extensão adaptativa ocorrer automaticamente, sem comunicar lote, restante ou fim próximo;
  - redesenhar apenas a apresentação do resultado fechado: “Vocês deram Match em N obras”, lista dos matches e escolha manual ou sorteio uniforme entre eles;
  - manter os estados de sessão em andamento, continuar, abandonar e consentimento final já existentes.
- **Riscos:** prefetch ou estado React pode revelar o próximo item antes da hora; animação interrompida pode duplicar voto; sorteio final precisa operar somente sobre o resultado já autorizado e fechado.
- **Testes de aceitação:** screenshots e gravação curta em ambos os viewports; DOM e rede não expõem próximo candidato, votos/progresso do parceiro ou matches parciais; pilha mantém profundidade visual constante até o fim; votos animam nos lados corretos; próximo card aparece somente depois; toque repetido não cria voto duplicado; undo, retomada, abandono e resultado fechado continuam funcionando; teste de consentimento duplo somente com duas contas reais.
- **Não mexer em:** sigilo backend/RPC, votos temporários, interesses permanentes, shuffle estável individual, sessão persistente, estados `open`/`abandoned`/`closed`, limpeza ao abandonar ou último resultado concluído. Nenhum dado secreto deve ser enviado ao cliente.
- **Custo relativo:** **alto**.

## Lote 3 — Home com hierarquia de central rápida
**Classificação:** Polimento agora

- **Objetivo:** retirar a aparência de dashboard sem transformar a Home em catálogo de streaming.
- **Arquivos/componentes prováveis:** `src/routes/_authenticated/index.tsx`, componentes locais da Home, `src/components/app/ui.tsx` e estilos/tokens existentes.
- **Mudanças exatas:**
  - tornar as ações Continuar, Não avaliados, Último Match e Importações mais legíveis e semanticamente coerentes;
  - garantir navegação/ação real para o que parece interativo; manter Importações explicitamente “em breve” ou “não configurado” e sem ação falsa;
  - dar mais presença a Continuar assistindo, com progresso, próximo episódio e Assistir na TV honestamente indisponível quando não configurado;
  - apresentar novidades contextuais e poucas sugestões, evitando dois carrosséis genéricos de posters;
  - manter densidade mobile, sem banners gigantes, cards aninhados ou mudanças nas fontes de dados.
- **Riscos:** aumentar demais os blocos e empurrar conteúdo útil para baixo; criar affordance para destino inexistente; sugestões parecerem uma segunda Biblioteca.
- **Testes de aceitação:** em ambos os viewports, primeira tela mostra cabeçalho, ações e parte do próximo conteúdo; todos os elementos com aparência clicável respondem ou estão claramente desabilitados; progresso não causa layout shift; Último Match mostra somente resultado `closed`; ausência de dados produz estados compactos; sem carrossel duplicado ou estética genérica de streaming.
- **Não mexer em:** regras de dados da Home, Match, Importações, tracker, TV, recomendações ou criação de novas features.
- **Custo relativo:** **médio**.

## Lote 4 — Detalhes de filme e série orientados por conteúdo
**Classificação:** Polimento agora

- **Objetivo:** reaproximar os detalhes dos mockups aprovados e tornar comparação, temporadas e ações menos sujeitas a erro.
- **Arquivos/componentes prováveis:** `src/routes/_authenticated/work.$id.tsx`, componentes locais de detalhes, `src/components/app/MediaCard.tsx`, `src/components/app/ui.tsx` e `src/styles.css`.
- **Mudanças exatas:**
  - filme: preservar hero/poster e reorganizar a leitura para metadados, ação principal, Interesse, Avaliação, indicação/histórico, Sinopse, Elenco e posts/fontes;
  - manter Assistir na TV com hierarquia de ação principal, mas desabilitado e identificado como não configurado até o POC;
  - substituir mini-perfis genéricos por duas comparações semânticas: Interesse e Avaliação, sempre Eu à esquerda e parceiro à direita;
  - aplicar no elenco diretor primeiro, separador visual `|`, personagem em destaque e ator abaixo;
  - série: manter Sinopse → Temporadas/progresso → Elenco, concentrando progresso dentro de Temporadas e abrindo a temporada do próximo episódio;
  - separar claramente o controle de “assistido” do restante do card do episódio, evitando que tocar no card inteiro altere estado;
  - preservar detalhes completos dos episódios e estados compartilhados já existentes.
- **Riscos:** telas longas podem perder contexto ou criar sobreposição com a barra; controles de episódio podem regredir em acessibilidade; reordenação pode afetar estados locais de temporada.
- **Testes de aceitação:** validar um filme e uma série nos dois viewports; ordem das seções correta; Eu sempre à esquerda; média somente quando ambos avaliaram; botão de TV claramente principal e indisponível; tocar no card de episódio não marca como assistido, apenas o controle dedicado o faz; temporada correta abre; rolagem, sticky/sheets e barra sem clipping.
- **Não mexer em:** integrações de TV/tracker, regras de avaliação e interesse, histórico, dados de episódios, backend ou schema.
- **Custo relativo:** **médio**.

## Lote 5 — Superfícies de escolha: Biblioteca, Descobrir, Galeria e Sorteio
**Classificação:** Polimento agora, com evoluções funcionais posteriores explicitamente separadas

- **Objetivo:** diferenciar descoberta e escolha sem redesenhar o produto, corrigindo inconsistências pequenas e falhas de UX que podem perder a ação do usuário.
- **Arquivos/componentes prováveis:** `src/routes/_authenticated/library.tsx`, `src/components/app/DiscoverTab.tsx`, `src/routes/_authenticated/add.tsx`, `src/routes/_authenticated/watch.gallery.tsx`, `src/routes/_authenticated/watch.dice.tsx`, `src/lib/catalog.functions.ts` e `src/lib/tmdb.server.ts`.
- **Mudanças exatas — polimento agora:**
  - preservar grid de duas colunas e linguagem visual da Biblioteca;
  - Descobrir: manter estado anterior até confirmação da ação; em falha de indicar ou marcar como assistido, restaurar o card e mostrar erro recuperável;
  - Descobrir: criar uma área/estado pequeno e explícito de dispensados, para restaurar diretamente o item escolhido sem depender da recomposição aleatória do feed;
  - Galeria: ajustar hierarquia, cabeçalho e seleção para comunicar “modo de escolha”, mantendo filtros básicos e os mesmos dados;
  - Sorteio: corrigir os rótulos para refletirem exatamente “ainda não assistido juntos”, “nenhum dos dois viu”, “rever juntos” e “qualquer”, sem alterar a ponderação;
  - Adicionar/busca: alinhar promessa e comportamento — aceitar resultado `person` para buscar obras por ator/diretor, mas continuar adicionando somente obras TMDB validadas; manter busca tradicional, sem IA.
- **Mudanças exatas — feature posterior:**
  - unificação completa da busca local + TMDB, com ranking único e busca aprofundada por elenco/direção;
  - personalização de Descobrir mais individual que a influência atual do casal;
  - filtros avançados da Galeria;
  - vibe, energia e duração no Sorteio;
  - hub completo de Importações: share Android, URL, screenshot, texto, revisão e pilha de posters.
- **Riscos:** resultados por pessoa podem multiplicar chamadas e duplicar obras; rollback otimista precisa evitar reaparecimento duplicado; restaurar dispensados não pode alterar reação nem dados do parceiro; mudança de rótulo do Sorteio deve permanecer coerente com o predicado real.
- **Testes de aceitação:** em ambos os viewports, grid estável e sem overflow; simular falha de indicar e “Já assisti” e confirmar retorno do card sem duplicação; dispensar/restaurar reaparece de forma previsível; busca por ator/diretor retorna obras deduplicadas e permite adicionar pela lógica existente; Galeria é distinguível da Biblioteca sem nova feature; cada filtro do Sorteio é validado contra exemplos reais; console/rede limpos; typecheck e build aprovados.
- **Não mexer em:** IA, filtros avançados, algoritmo de personalização, novas fontes de dados, Home, Match, backend de segurança, Importações, tracker ou TV. Não criar migração neste lote salvo se uma correção comprovadamente exigir persistência inexistente; a preferência é reutilizar a tabela atual de dispensas.
- **Custo relativo:** **alto**.

## Ordem e custo geral

1. Lote 1 — baixo — maior retorno visual por crédito.
2. Lote 2 — alto — linguagem central do Match, com validação rigorosa de sigilo.
3. Lote 3 — médio — corrige a primeira impressão e a hierarquia diária.
4. Lote 4 — médio — melhora leitura e reduz ações acidentais.
5. Lote 5 — alto — reúne superfícies relacionadas, mas deve ser executado mantendo a fronteira explícita entre polimento atual e features posteriores.

**Custo relativo total da rodada de polimento:** alto, porém parcelável; cada lote pode ser executado, validado e encerrado independentemente.
