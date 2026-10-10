# Roadmap

Concluído: Lotes 1–4, 5A–5D, Rodada 6, MCP.

## Rodada 7 — estabilização/refino
- [x] P1 Navegação: VT só no card tocado; radial sem ghost; overlay history (Back/Escape); sheet scroll-lock/foco; dvh/safe-area; voltar Add/Settings; Match sem nav
- [x] P2 Dados: excluir obra persistente; erros≠vazio; ensureWork concorrente; addWork erros; constraints espaço; policy works; RPC episódio; invalidação mínima; demo_cleanup; sessão acidental
- [x] P3 Cards cinematográficos (Galeria/Biblioteca/Descobrir/Home) + hero da ficha
- [x] P4 Layout animation Biblioteca/Galeria; filtros Galeria na URL; fade rolável Sorteio
- [x] P5 Não avaliados pile + ScorePicker
- [x] P6 Séries: progresso no header, lista sem overview/data, prioridade imagem, sem shift
- [x] P7 Match: exige 2 membros, último resultado sem auto-start, fullscreen, versos, saída física, roleta, join único
- [x] P8 Sorteio animação de embaralhar
- [x] P9 Gemini configurável (owner), rate guard atômico, perfil Descobrir, race da busca
- [x] P10 a11y/emoji/logs
- [x] Follow-up: Gemini conectado (status/test/save/remove owner), perfil Descobrir rico, Add/Settings voltar, race busca, convite 3º membro, logs de cache, validação banco

- [x] PWA instalável (manifest, ícones, SW só estáticos, aviso de atualização, Instalar em Configurações)

## Rodada 8 — concluída
- [x] Radial Galeria/Match/Sortear, uma barra glass persistente, toque ativo sem animação/navegação; sheets preservam scroll e ocultam barra.
- [x] Versos cenográficos, decode limitado com timeout/fallback; posters separados de backdrops; Continuar com altura fixa.
- [x] Logos TMDB em lotes visíveis/cache completo; busca com filtros/estado preservado, prévia protegida e obra existente abre ficha.
- [x] ScorePicker 5,0 sem foco numérico automático, feedback por faixa; série com progresso no hero e still + mini-poster; exclusão observável/Undo protegido.
- [x] Simulador solo local: votos, resultados, sorteio/reinício sem gravações Match; fluxo real preservado.
- [x] Build/typecheck automáticos OK; smoke autenticado 390×844/412×915: radial 5x Back/Escape, aba ativa, logos, sorteio 3x, busca/prévia/Back, série/modal/scroll, simulador/resultados. Console/rede sem erros; nota testada isoladamente sem salvar.
- [x] Nenhuma mutação de notas/reações/episódios/obras/Match no QA; contagens Match mantidas (16 sessões, 13 votos, 4 participantes, zero abertas).
- Limite dos dados: já havia 42 registros demo rastreados e 41 obras demo existentes na leitura inicial; preservados, sem completar artificialmente para 45.
- Limites: consentimento a dois/Android físico e Gemini com chave real não validados; espera Gemini exercitada com atraso controlado. Pessoas clicáveis e alias privado não implementados.

## Rodada 9
- [x] Ficha modular única para catálogo/biblioteca, adição in-place, metadados preservados durante exclusão e Undo, Descobrir abre ficha sem interceptação do gradiente.
- [x] Transição somente no poster; backdrop não atravessa texto; barra montada e frost constante; scroll-lock sem deslocar body.
- [x] Temporadas disponíveis antes do prefetch, reset horizontal, status em sheet; feedback animado de nota e blur por gesto intencional.
- [x] Filtros antes do Match, refinamento Gemini opcional com interseção de IDs elegíveis e fallback; proteção de respostas obsoletas; sorteio aleatório entre resultados no solo/fechado.
- [x] Busca inteligente com validações TMDB em lotes, cache por filtro/query e loading reutilizável; logos decodificados com fallback estável; dois Continuar sem deformar imagem e com altura fixa.
- [x] Typecheck/build automáticos OK. Smoke autenticado 390×844/412×915: radial Back/Escape repetido, ficha filme/série/externa, status sem salvar, episódio/Back/scroll, nota sem salvar, exclusão+Undo sem DELETE, busca/Back, Descobrir/ficha, Galeria e Sorteio local, filtros/refino/simulador e roleta 3x; sem erros de página/HTTP ou overflow nas telas medidas.
- Dados preservados no QA: 46 obras, 41 registros demo existentes, 16 sessões Match, 12 votos e zero abertas antes/depois; sem salvar notas/reações/episódios. Contagens são as observadas nesta rodada, não as de rodadas anteriores.
- PWA/configuração e integrações preservadas; instalação/atualização Android real não revalidadas. Consentimento a dois e alteração persistida de ficha não exercitados para preservar dados. Exatamente dois Continuar validado por estrutura, pois dados atuais têm três; métricas de créditos indisponíveis.
- Futuro, fora do escopo: pessoas clicáveis e alias privado do parceiro.

## Pendente
- [ ] Consentimento duplo do Match e Match ativo com 2 membros (bloqueado: precisa da conta real do parceiro)
- [ ] Validação completa do Gemini por intenção/qualidade; refinamento retornou sucesso no smoke atual, sem alterar configuração de segredos.
- [ ] Tela de Importações (feature futura)

## Rodada 10
- [x] Estrutura overlays/transições e vidro da nav
- [x] Descobrir otimista, busca paginada/IA/ordem, Galeria logos/duração
- [x] Continuar com duas obras e episódios/modal
- [x] Match persistente/roleta/hero/status e candidatos externos
- [x] Smoke móvel 390x844 e 412x915: cinco ciclos radial/status/episódio estáveis, imagens preservadas; Back bloqueado validado isoladamente, busca paginada e sorteio estável; PWA preservada
- [ ] QA complementar: adicionar pelo Descobrir somente em DEMO restaurável, cache de logo frio/reload e fixture com exatamente duas obras; Match real deliberadamente não iniciado

## Rodada 11
- [x] Camadas shared, adição otimista e super reação
- [x] Ranking local, lotes IA, motion e layout busca
- [x] Logos independentes, sliders pointer e Duração animada
- [x] Episódios simples, ação direta e X externo
- [x] Match adaptativo/externos e poster vencedor com frost
- [x] Sorteio centralizado/motion e validação móvel dirigida sem dados reais

- QA dirigido: 390x844/412x915, paginação 20→40 e Back, sliders por drag (180min/nota8), modal scroll estável, rollback de adição por rede bloqueada, Gemini/TMDB externo (Dias Perfeitos/976893), Match solo adaptativo e persistência, 200 highlights sem repetição recente, sorteio central com retângulo estável e logos presentes no reload.
- Build automático OK; typecheck final separado não disponível no relatório. Limitações: lote extra IA não chamado para poupar quota; cache server-side realmente frio e escrita Assistido/adição de sucesso não exercitados em dados reais; Match real não iniciado.

## Handoff aprovado — implementação e smoke dirigido
- Base inicial: `a5f1ef47118fcbf1f7897bfe42cfecf40bd28599`; commits de edição são gerenciados pela plataforma.
- Alterados somente apresentação/componentes e funções de busca/candidatos: toggle IA dentro da busca e intenção Match, limpeza/loading, ordenação em sheet, voltar ao topo, feedback opaco de nota, Descobrir com atualização/dispensados/reação, ficha com créditos e episódios, overlay vencedor/retorno, pool solo TMDB por formato e refinamento, ranking por diretor e expansão limitada de títulos, saída animada do Sorteio e ajustes de camadas.
- [x] Smoke Chromium autenticado 390×844 e 412×915: Batman agora traz Cavaleiro das Trevas em 2º e Ressurge em 3º; Nolan inclui os filmes do diretor; toggle compacto presente dentro da busca; limpeza de query; ordenação Biblioteca usa sheet (zero selects nativos); Sorteio troca para Séries e limpa resultado incompatível, sem erro de página.
- [x] Match solo Séries: preparação, cartas TV, resultado TV, Assistir navega para ficha, Voltar mantém resultado, X fecha; nenhuma sessão Match real iniciada.
- [x] Duas solicitações de refinamento, uma por intenção: drama coreano/TV retornou Pousando no Amor, Vincenzo, Goblin e Descendentes do Sol; terror japonês/filme retornou Ringu, Ju-on, Audition e Uma Chamada Perdida. Nenhum save/delete de obra, nota, episódio ou reação foi executado no QA; apenas leitura, estado client-only e caches/telemetria existentes de IA.
- [ ] Validação integral das intenções não comprovada: o primeiro smoke ainda misturou candidatos internos não relacionados e resolveu homônimos com ano errado; depois foram corrigidos fallback interno e validação exata de ano, mas não repetida chamada Gemini para poupar quota. Origem/gênero de cada resultado não verificados independentemente.
- [ ] Itens visuais de nota, Descobrir e ficha não exercitados integralmente após edição; Android físico/glass/PWA e Match real a dois preservados, não revalidados. Não se declara conclusão dos 26 itens sem esta evidência.
- Checks automáticos disponíveis em `/tmp/observability/build-errors.log`: builds recentes OK; houve erros intermediários de JSX/schema corrigidos. Nenhum build/typecheck manual adicional foi executado, pois a plataforma os executa automaticamente; registrar eventual diagnóstico final em separado.
- Crédito da implementação anterior: 12,3 créditos, conforme informado pelo conector na revisão.

## Correção focada do Match — base 28e09e2
- [x] OFF somente indicações elegíveis da biblioteca, inclusive séries em andamento; removidos pool popular solo e funções sem uso. Preparação compartilhada solo/real; veto 👎 preservado.
- [x] ON refina somente ao tocar Iniciar, uma solicitação por tentativa, com fallback normal, mínimo de dois candidatos e proteção contra respostas obsoletas ao mudar intenção/filtro/toggle.
- [x] QA dirigido em 390×844/412×915 com componentes reais e mocks: série indicada em andamento aceita apesar do histórico; veto excluído; OFF sem externos/chamadas; ON chama uma vez no botão, não ao digitar; externos só ON; falha/resultado vazio retorna ao pool normal; resposta obsoleta não inicia; vazio OFF honesto; ON pode iniciar com dois externos e zero internos.
- [x] Smoke autenticado 412×915: filtro Séries OFF iniciou simulador com Dark; zero chamadas RPC bloqueadas, zero erros de página. Apenas estado client-only; nenhuma gravação de obra/nota/episódio/reação ou Match real.
- Checks: build automático OK; `git diff --check` limpo. Não executado build/typecheck manual adicional; a plataforma executa os checks automaticamente.
- Limites: Gemini real não chamado; qualidade/cache do provedor e Match real a dois não exercitados. Imagens dos fixtures usam fallback por não terem poster. Custo da implementação anterior corrigido para 12,3 créditos; não é o custo desta correção.

## Item 7.18 — linha de filtros unificada na Biblioteca (base bdf3252)
- [x] Uma única linha `mt-4 flex min-h-11 items-center gap-2` para as três abas; `Ordenar`/sheet só fora de Descobrir. Descobrir perdeu o wrapper `mt-4` próprio.
- [x] Medido autenticado em 390×844 e 412×915: Todos x16 y218 h28, Filmes x85 y217 h30, Séries x158 y217 h30, centros y232 — idêntico nas três abas nas duas larguras; `Ordenar` à direita (x280 a 390, x302 a 412), ausente em Descobrir; sem estouro horizontal (scrollWidth = largura da tela).
- [x] Estado/URL sem regressão: `?tab=disc&kind=movie` continua após recarregar, pill com `aria-pressed=true`. Nenhuma gravação de obra, nota, episódio ou reação; nenhuma chamada Gemini.
- [x] Capturas dos três tabs conferidas visualmente: mesma altura/posição dos pills, sem corte ou sobreposição na linha.
- Checks: `tsgo --noEmit` exit 0; build automático OK (16:28:08Z); `git diff --check` limpo. Commits da plataforma: `aaacddc` (linha compartilhada), `e9915e4` (remoção do bloco duplicado), `9728212` (altura mínima) — HEAD final `9728212`.
- Limites: diferença pré-existente e não alterada — o botão `Atualizar` do Descobrir ocupa uma linha própria e adia a grade cerca de 65px; na aba Assistidos a barra inferior sobrepõe o título do último card. Custo: o conector informou 17,70 créditos de mensagens em modo build no projeto em 8/10 (dia, não desta rodada isolada).

## Rodada 12 — regressões + Importação v1 (base e6a844b)
- [x] Ficha: backdrop compartilhado agora fica abaixo da página nova (z 1 < root) e o snapshot antigo é ocultado — sem retângulo claro à frente do scrim. Pôster/Back intocados. Não verificado quadro a quadro no Android.
- [x] Episódios: marca visual 24px dentro do alvo de 44px; estado otimista por episódio, sem desabilitar os demais; rollback em erro. Sem gravação em QA.
- [x] Match IA: até 12 externos validados no TMDB, filtrados por sinais canônicos (original_language + gênero) derivados da intenção; internos de gênero incompatível descartados inclusive do fallback; cache v4. OFF inalterado. Gemini não chamado nesta rodada (qualidade real não comprovada). Pôsteres já carregam por carta (sem bloqueio global); prefetch extra não adicionado.
- [x] Resultado Match: X/Back fazem o pôster voltar à grade e o frost sumir antes de fechar.
- [x] Descobrir: Atualizar na mesma linha dos filtros (medido x284/x306, y210–254, pills centro y232 em 390/412); avança para páginas seguintes do TMDB (rerank Gemini só roda na página 1), mantém lista anterior enquanto carrega, seta horária. Dispensados abre/fecha animado com folga inferior.
- [x] Importação: rota `/import` (Home → Importações), texto/URL/captura PNG/JPEG/WebP ≤4 MB (não armazenada), rascunho na sessão por 30 min; links TMDB e IDs IMDb resolvidos sem IA; links sociais NÃO são buscados (sem proxy/SSRF) e geram aviso para enviar captura/texto; IA só sob botão via `analyzeImport`. Pilha de revisão um a um com backdrop, pular, 🔥/👍/😐, Já assisti antes, anterior/próxima, corrigir correspondência, rever pulados e resumo; dedupe por mediaType:tmdbId; obra existente avisada (só renova indicação).
- [x] Share Target GET (title/text/url → /import) no manifest; login preserva destino via `?next=`. Arquivos pelo menu Compartilhar NÃO suportados (exigiria POST multipart). SW inalterado.
- [x] Smoke autenticado 390/412: TMDB 155 + tt0137523 → pilha 2 cartas; link Instagram → aviso honesto; nenhuma reação tocada, nenhum save, nenhuma IA. `tsgo` exit 0.
- [ ] Validar no Android instalado: reinstalar PWA após publicar, compartilhar um link de outro app → AppCinema deve aparecer e abrir Importar com o texto.
- [ ] Suporte por plataforma social só após prova com 8–12 links reais. Origem/link não persistidos (sem modelo aprovado).
- Integrações pendentes (não iniciadas): Trakt/Simkl exigem conta + OAuth app e decisão de direção do sync; Nuvio sem API/contrato confirmado — nada prometido.

## Correção focada sobre 7d63e5c (Match IA / Importação)
- Custo da rodada anterior informado pelo conector: 13,5 créditos.
- Match IA: cliente adota o conjunto refinado mesmo sem externos; <2 compatíveis com intenção explícita → aviso honesto, sem reinserir pool normal. Fallback normal só em falha da IA com intenção genérica. Servidor verifica original_language no TMDB para no máximo 16 internos (4 por vez) quando há origem explícita; não verificados são omitidos. Validado: tsgo + vite build. NÃO validado: resposta IA mock no navegador (sem Gemini real); relevância real de "terror japonês".
- Poster Match: Match solo pré-carrega apenas o próximo pôster em segundo plano. Match real não prefetcha o próximo (ordem secreta do servidor). Sem prova visual de ganho → não marcado como resolvido.
- Importação: candidatos acumulam (dedupe mediaType:tmdbId, atualização funcional); botão "Revisar N obras"; voltar preserva candidatos e estados. Playwright 390/412: link TMDB + IMDb acumulou 2, voltar manteve 2 e "Já assisti antes" por obra, sem overflow. Nenhuma confirmação/escrita nem IA executada.
- Confirmação: addWork antes de markSeenBefore; falha da 2ª operação vira estado "parcial" (indicação salva) com "Tentar marcar visto". Caminho de erro não exercitado em teste.
- Share Target Android continua não provado no aparelho instalado.

## Rodada: importação social, Simkl leitura, Nuvio link
- Importação: "Buscar legenda do post" (Instagram reel/p, TikTok vídeo/foto, vt/vm shortlink via redirect manual validado por hop) + "Analisar legenda com IA" manual por legenda. Teste real de leitura (sem IA, sem gravação): DF055xVpSAc → legenda com "The Verge of Death (2023)"; DXz6DesPdXh → "Só filmaçooo…"; TikTok ZSbnvdyM7 → legenda com "INCEPTION"; ZSbnvho9Y (fotos) → oEmbed indisponível, pede captura; IP/host fora da lista rejeitados. Demais IDs da amostra não testados. Instagram pode bloquear (429/login) em produção — fallback honesto implementado, não medido no worker publicado.
- source_posts NÃO é gravado nesta rodada (unicidade space_id+source_url não alterada); origem fica só na sessão.
- Simkl: código pronto (OAuth V2 PKCE S256, state único 10 min, callback /api/public/simkl/callback com checagem iss, refresh próximo da expiração, revogação ao desconectar, activities → shows→movies→anime sequencial, snapshot após sucesso, deltas date_from + diff de exclusões, 429 com até 2 retries, auto ≥20 min só com Configurações visível, manual ≥60 s). PENDENTE: registrar app Simkl e salvar SIMKL_CLIENT_ID, SIMKL_CLIENT_SECRET, SIMKL_REDIRECT_URI=https://couplecine.lovable.app/api/public/simkl/callback. Fluxo real não validado sem credenciais. Nada é escrito no Simkl nem na biblioteca do casal.
- Nuvio TV: link copiável nuvio://tmdb/<movie|tv>/<id> na ficha; sem envio remoto/reprodução. Não testado em aparelho.
- Revisão pré-publicação: /users/settings agora GET; falhas de gravação (conta, itens, snapshot) aparecem como erro e não avançam snapshot; refresh de token dentro do tratamento de erro (vira "conecte de novo"); reconciliação de exclusões pagina de 1000 em 1000 e apaga em lotes de 100 com checagem de erro; Configurações mostra totais exatos por tipo e episódios rotulados como amostra quando há 1000+ itens; img_index do carrossel Instagram é preservado e exibido só como referência de captura. Verificado: tsgo, vite build, leitura real de DcZua17jzOu?img_index=4 (imgIndex=4, legenda sem títulos). Fluxo Simkl real segue sem teste (sem credenciais).
- Caixa de links salvos em /import: "Salvar links" grava até 12 posts Instagram/TikTok canonizados (img_index preservado) em source_posts com work_id nulo via RLS; lista 20 pendentes com "Analisar". Verificado só tsgo/build; gravação real não exercitada.

## Compartilhamento / Importações — correção estrutural
- Migrações 0008–0010: source_post_works (N:N, mesmo espaço por FKs compostas, backfill do work_id antigo — havia 0), source_posts com leitura por membros e update/delete só do autor, import_sessions/import_candidates pessoais (escrita só pelo servidor; cliente só alterna pendente/pulado), RPCs import_confirm/undo/set_reaction/set_seen/complete/dismiss. Os 12 links continuam (12 pendentes, 0 vínculos) e aparecem na tela.
- Canonicalização: /reel/ e /reels/ → /reel/, /p/ mantém /p/ (+img_index), tracking removido. 5 testes vitest passando.
- POC Reel Dcbr7-kKd9K (sandbox, 1 leitura): HTTP 200, legenda pública com "The Matrix, 1999" e autor onegoodcut. No worker publicado não medido; bloqueio 429/login cai em "Precisa de ajuda" + captura/legenda.
- Não validado em execução: as RPCs (o acesso de teste ao banco não tem permissão de executá-las nem de assumir o papel de usuário; sem writes reais). Lógica revisada, testes SQL preparados em /tmp não rodaram.
- Capturas não são armazenadas; a escolhida na entrada só existe em memória até analisar. Share Target de imagem (POST multipart) não implementado: exigiria rota POST no servidor + armazenamento temporário; pendente.
