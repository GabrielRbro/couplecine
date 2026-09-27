# AppCinema — Fases 1 e 2

App privado para um casal: biblioteca compartilhada de filmes e séries, indicações, reações, notas e progresso de séries. Mobile-first, tema escuro com roxo discreto, seguindo as telas de referência aprovadas.

## O que será entregue agora

### Fase 1 — base
- Visual: fundo quase preto, superfícies cinza muito escuro, bordas sutis, roxo como destaque discreto, cantos arredondados. Sem neon, sem banner gigante.
- Entrada só com Google, com lista de e-mails autorizados. Quem não está na lista não entra.
- Espaço do casal: o primeiro a entrar cria o espaço e pode usar tudo sozinho; depois convida a segunda pessoa pelo e-mail Google dela, que entra no mesmo espaço com os mesmos poderes.
- Navegação: duas abas (Início e Biblioteca) e o botão central elevado "Assistir" com pipoca em contorno. Ao tocar, vira X e abre o menu radial com Galeria, Sortear e Match (nesta fase, Galeria/Sortear/Match ficam como telas iniciais preparadas, sem a lógica das fases 3 e 4). A barra inferior é um componente único, idêntico em todas as telas.
- Início: saudação por horário, botões + e Configurações, cards rápidos (Continuar, Não avaliados, Último Match, Importações), "Continuar assistindo", "Novidades pra ti" e "Talvez vocês gostem".
- Biblioteca: busca, abas Indicações / Descobrir / Assistidos, filtros Todos / Filmes / Séries, ordenação, grade de dois cards por linha com reação de cada um ("Você 🔥 | Ela 👍").
- Detalhe de filme e de série, com a comparação sempre mostrando quem está logado à esquerda e o parceiro à direita. Na série, o bloco Temporadas fica abaixo da sinopse e acima do elenco; no elenco, o diretor/criador vem primeiro, separado por barra, com o personagem em destaque e o ator abaixo.
- Banco de dados com as tabelas do documento e regras de acesso: só os dois membros do espaço veem os dados, e ninguém edita a reação ou a nota do outro.

### Fase 2 — conteúdo real
- Ligação com o TMDB (em português), escondendo a chave no servidor, com cache dos dados usados.
- Busca tradicional (títulos, título original, atores, diretores) na biblioteca e no TMDB, sem duplicar obra que já existe.
- Adicionar obra: pesquisa no TMDB e escolha obrigatória de 🔥, 👍 ou 😐 (nunca 👎 na adição, nunca ❤️ como reação permanente). A escolha já salva a indicação.
- Alterar depois a própria reação, inclusive para 👎.
- Notas de 0 a 10 em passos de 0,5, opcionais, com média do casal só quando os dois avaliarem.
- Assistidos: filmes e séries vistos juntos, episódios, datas, pendências de avaliação.
- Progresso de séries compartilhado: episódios assistidos, próximo episódio calculado, estados Em andamento / Aguardando novos episódios / Pausada / Abandonada / Concluída, reversíveis e sem apagar histórico.
- "Já assisti" individual, separado do histórico do casal.
- Ordenação das Indicações por atividade relevante (nova indicação ou nova publicação), nunca por troca de emoji ou nota.
- Dados de demonstração para testar tudo isso (filmes, séries, reações diferentes, série em andamento e pausada, pendências).

## Fora desta entrega
Descobrir personalizado, Galeria filtrável, Sorteio ponderado, Match colaborativo, importações com IA, sincronização com tracker e envio para a TV ficam para as fases 3 a 7. Onde a tela existir, mostrará "em breve" ou "não configurado" em vez de fingir funcionar.

## Detalhes técnicos
- TanStack Start + React + TypeScript + Tailwind v4 + shadcn/ui; Lovable Cloud (Postgres, auth Google, RLS, realtime) precisa ser ativado.
- Rotas: `/auth`, `/onboarding`, `/` (Início), `/library`, `/work/$type/$tmdbId`, `/add`, `/search`, `/settings` e subpáginas, `/watch/gallery`, `/watch/dice`, `/match` (placeholders nesta entrega).
- Migrations com as tabelas do documento (profiles, couple_spaces, space_members, authorized_users, works, work_metadata_cache, indications, interests, ratings, prior_watch_status, source_posts, watch_events, joint_watch_sessions, series_states, season_cache, episode_cache, notification_preferences, notifications, integration_accounts) mais as restrições: unique(space_id, media_type, tmdb_id), unique(user_id, work_id) em interests e ratings; GRANTs explícitos e RLS por membership.
- TMDB acessado só por server functions, com a chave guardada como segredo do projeto; adapters `MetadataProvider`/`TMDBProvider` isolando o fornecedor. Demais adapters (IA, tracker, TV) ficam declarados como interface, sem implementação ativa.
- Componentes reutilizáveis: BottomNav, WatchFab, WatchRadialMenu, UserComparisonCard, ReactionPicker, RatingPicker, MediaCard, MediaGrid, WorkHero, DirectorAndCastRow, SeasonTabs, EpisodeCard, SeriesProgress, ContinueWatchingCard, EmptyState, ErrorState, UndoToast.
- Documentação em `/docs`: product-rules, data-model, integrations, known-limitations.

## Verificação ao final
Login, criação do espaço, adicionar obra pelo TMDB com reação, mesma obra indicada pelos dois sem duplicar, notas com média, progresso de série e navegação inteira em tela de celular.
