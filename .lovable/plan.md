# Auditoria somente leitura — AppCinema pós-Rodada 6

Evidências: leitura do código e navegação autenticada em 390x844, sem alterar dados (nenhum voto, nenhum abandono, nada salvo). O exame visual completo em 412x915 e a inspeção quadro a quadro das transições ficaram de fora desta passada (ver "Não validado").

## Bugs confirmados

| # | Sev. | Problema | Causa provável (arquivo) | Reproduzir | Correção sugerida |
|---|---|---|---|---|---|
| A | Crítico | "Excluir obra" nunca apaga de fato | `work.$id.tsx` IndicationsBlock: `deleteWork` navega para /library e depois agenda o `setTimeout`; o cleanup do `useEffect` limpa o timer quando o componente desmonta. A obra só some do cache e volta no próximo refetch | Ficha → Excluir → confirmar → esperar 6 s → recarregar a Biblioteca | Mover o timer de exclusão para fora do componente (módulo ou mutation global), ou excluir já e desfazer recriando |
| B | Alto | Rep. 1, 13 e 14: sobreposições e camadas erradas durante transições | Toda MediaCard, todo card de Continuar assistindo e todo card da Galeria recebem `viewTransitionName`. Medido: 32 nomes ativos só na Biblioteca. Cada nome vira um grupo na camada de topo da View Transition, acima da BottomNav e do menu radial, e também cria contexto de empilhamento | Home → Biblioteca, ou tocar um item do radial: cards passam por cima da barra | Dar nome só ao elemento tocado, no clique (por exemplo um `sharedId` em memória). Destino com o mesmo nome |
| C | Alto | Rep. 4/11: Voltar com janela aberta sai da página | `AnimatedSheet` não registra entrada no histórico. Medido: episódio aberto + voltar → saiu da ficha | Ficha de série → episódio → Voltar | No AnimatedSheet, ao abrir, empurrar uma entrada pelo `router.history` (não pelo `window.history`) e fechar no popstate, igual ao radial |
| D | Alto | Rep. 11: scroll da página atrás da janela | `AnimatedSheet` não trava o `body`. A medição (wheel sobre a janela) foi inconclusiva | Abrir episódio e rolar fora da janela | `overflow: hidden` no body enquanto estiver aberto, com compensação da scrollbar |
| E | Médio | Rep. 14: radial usa `window.history.pushState` cru | `AppShell.tsx` BottomNav: a entrada não tem a chave de índice do TanStack, e o popstate também chega ao router, que dispara uma View Transition e restauração de scroll. A navegação radial → Biblioteca está correta (history.length estável) | Abrir/fechar o radial várias vezes e observar o flash | Usar `router.history.push` com state, ou bloquear a transição desse pop |
| F | Médio | Rep. 6: Match tem BottomNav | `_authenticated/route.tsx` só esconde a barra em /onboarding | Abrir Match | Esconder também em /match e dar ao Match um layout fullscreen próprio |
| G | Médio | Rep. 6: cards cenográficos parecem vazios | `styles.css` match-stack-back: só gradiente com borda, sem textura de "verso" | Match em andamento | Desenhar um verso de carta (padrão sutil e logo) com profundidade |
| H | Médio | Rep. 2: filtros e abas sem realocação | Biblioteca usa grid simples sem layout animation. Na Galeria o `layout` do Motion existe, mas `popLayout` mais a View Transition do router competem | Trocar Filmes/Séries | `motion` com `layout` + `AnimatePresence` na Biblioteca; usar `viewTransition:false` nos filtros |
| I | Médio | Rep. 5: Não avaliados abre a ficha | `index.tsx`: Link para `/work/$id` do primeiro pendente | Tocar no atalho | Sheet com pilha de posters reaproveitando o seletor de nota |
| J | Médio | Rep. 8: Dar nota abre uma grade inline de 21 botões | `work.$id.tsx` Comparison | Tocar "Dar nota" | Sheet com campo numérico (0–10, passo 0,5) e seleção rápida |
| K | Baixo | Rep. 9/10: progresso e comparação altos | SeriesBlock tem um card cheio de "Progresso do casal". Comparison tem título, rótulos e botões de 44px empilhados | Ficha de série | Progresso como linha discreta junto ao cabeçalho. Comparison numa faixa única de ~64px |
| L | Baixo | Rep. 12: card de episódio mostra a sinopse | SeriesBlock renderiza `ep.overview` | Ficha de série | Remover a sinopse do card |
| M | Baixo | Rep. 7: Sorteio só faz fade | `watch.dice.tsx` linha 183: scale/opacity | Sortear | Animação física curta de embaralhar/virar |
| N | Médio | Galeria perde os filtros ao voltar | `watch.gallery.tsx`: filtros em `useState` | Filtrar → obra → Voltar | Search params, como na Biblioteca |

## Outros problemas encontrados
- Match: depois de abandonar na mesma visita, `initialOpenId` continua com valor e o início automático não acontece. Aparece o botão "Começar", o que é inconsistente com a regra.
- Match: o polling de 5 s chama `match_join` a cada ciclo (uma RPC de escrita idempotente). É custo desnecessário.
- `ai_cache`: o limite por hora conta só as respostas salvas. Falhas e 429 não contam, então tentativas com erro não têm limite. Além disso, o upsert de um item de cache renova o `created_at` e conta de novo.
- Dispensados: acima de 12 itens fora da biblioteca, aparecem rótulos genéricos ("Filme dispensado").
- As séries de demonstração não têm `posterPath` das temporadas no cache, então não há fallback para o poster da temporada.
- Cada episódio marcado invalida a biblioteca inteira (refetch completo). Uma atualização otimista local seria suficiente.
- A View Transition também roda em navegações com skeleton (perfil ainda carregando). O elemento compartilhado falha e vira só fade.
- Os emojis de reação dependem da fonte do sistema (em headless viram caixas). O app não define fonte de emoji.
- `useLibrary` com `spaceId` vazio cria a chave `["library",""]` (inofensivo, mas polui o cache).
- Lint: centenas de avisos de formatação herdados em arquivos não tocados (`watch.dice.tsx`, entre outros).

## Não validado
- Consentimento duplo, privacidade em tempo real e votos do parceiro no Match: exigem segunda conta.
- Início automático do Match e votação: exigem abandonar a sessão real de 3 de outubro ou votar.
- Pesquisa inteligente, rerank do Descobrir e análise de importação: falta `GEMINI_API_KEY`.
- Exclusão e escrita de nota ou episódio na prática: exigem mutar dados (o bug A foi confirmado pelo código).
- Toque físico do Android e safe-area real: só simulados no navegador headless.

## Ordem sugerida de correção
1. A (exclusão) e B (nomes de transição só no elemento tocado): resolvem o Crítico e os itens 1, 13 e 14.
2. C, D e E: histórico e janelas (itens 4 e 11).
3. F e G: Match fullscreen e verso das cartas.
4. H e N: realocação e estado dos filtros.
5. I e J: janelas de nota.
6. K, L e M: polimentos.
