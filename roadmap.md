# Roadmap

Concluído: Lotes 1–4, microetapas 5A–5D.

## Rodada 6 (concluída)
- [x] 1. Gate com sessão local, summary leve via view work_watch_summary, defaults de cache + preload por intenção, View Transitions com poster/backdrop compartilhado, radial→Início/Biblioteca sem histórico sintético
- [x] 2. Galeria: lista vertical de cards com backdrop, Todos/Filmes/Séries/Até 2h/Filtros (sheet)
- [x] 3. Home: atalhos Não avaliados/Último Match/Importações; Continuar assistindo 1/2/3+; "Interesse em comum"
- [x] 4. Detalhes: Interesse/Avaliação lado a lado; aggregate_credits; cache de metadados versionado (v2)
- [x] 5. Séries: temporada atual primeiro, demais em background, imagens 2 por vez, season_cache, sheet de episódio
- [x] 6. Match: auto-start, cenográficos visíveis, carta só revela com imagem pronta, match_extend 4–8 com retry, veto 👎 (polling de 5 s mantido; Realtime não feito)
- [x] 7. Biblioteca: estado na URL, busca filtra Descobrir, cards pressable, dispensados com no máx. 12 chamadas TMDB (4 por vez)
- [x] 8. Gemini server-side: pesquisa inteligente, rerank do Descobrir, analyzeImport (sem tela de Importações ainda). Aguardando GEMINI_API_KEY
- [x] 9. Seed demo-v1 (45 obras) rastreado em demo_batch_items; remoção em Configurações (demo_cleanup)
- [x] 10. Validado em 390x844

## Pendente
- [ ] GEMINI_API_KEY (bloqueado: usuário precisa adicionar o secret)
- [ ] Tela de Importações (feature futura) usando analyzeImport
