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
- [ ] OFF somente indicações elegíveis da biblioteca, inclusive séries em andamento; remover pool popular solo e funções sem uso.
- [ ] ON refina somente ao tocar Iniciar, uma solicitação por tentativa, com fallback/minimum de dois candidatos e proteção contra respostas obsoletas.
- [ ] QA dirigido local/mocks: série em andamento, veto, OFF sem externos, ON sem Gemini real; conferir checks automáticos e registrar limites.
