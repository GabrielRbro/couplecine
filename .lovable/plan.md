# Rodada 8 — polimento focado do AppCinema

## Escopo
Preservar dados atuais, PWA, Gemini storage, RLS, seed demo, MCP e regras do Match real. Sem nova auditoria geral ou alterações em outras features.

## Entregas
1. **Navegação e camadas:** uma BottomNav persistente, radial Galeria/Match/Sortear, toque ativo sem navegação/animação, vidro fosco estável, Back/Escape sem transição de página; scrollbars ocultas e sheets com posição de rolagem preservada.
2. **Arte e movimento:** versos cinematográficos comuns a Sorteio/Match, poucas imagens pré-carregadas e decodificadas antes do shuffle, fallback cenográfico em falha, bordas/sombras discretas; corrigir camadas e limpeza das transições compartilhadas.
3. **Galeria:** logos transparentes TMDB com prioridade pt-BR/pt → en → neutro, fallback textual, composição refinada e consulta limitada ao lote visível com cache existente.
4. **Notas e séries:** ScorePicker começa em 5,0 sem foco numérico automático, feedback breve por faixa de nota também na pilha; progresso compacto no hero e episódios com still horizontal + mini poster da temporada; modal sem tremida ou barra sobreposta.
5. **Busca e prévia:** remover Buscar, filtros Todos/Filmes/Séries, preservar consulta/filtros/posição, lista animada e estado Gemini sutil; resultado abre prévia TMDB completa. Adicionar só após CTA e picker; obra existente abre biblioteca.
6. **Simulação do Match:** modo explicitamente local para espaço com um membro, mesmas animações, votos/resultados/sorteio locais, sair/reiniciar; nenhuma escrita colaborativa nem parceiro fictício. Com dois membros, fluxo real intacto.
7. **Estados coerentes:** retirada de indicação atualiza ações, pending-delete observável impede exclusão repetida e preserva Undo; Continuar assistindo mantém altura constante, variando apenas largura.

## Detalhes técnicos
- Reutilizar componentes e serviços atuais; extrair apenas apresentação compartilhada indispensável à prévia/arte.
- Prévia protegida em `/title/$mediaType/$tmdbId`, com metadados próprios; TMDB acessado exclusivamente pelos serviços server-side existentes.
- Logos guardados no JSON de `work_metadata_cache`, incluindo ausência de logo e validade; processamento em pequenos lotes com concorrência limitada, sem migration.
- Simulador isolado do caminho de RPCs/sessões reais e desligado automaticamente quando houver parceiro.
- Não adicionar filtro de Ano nesta rodada: os três filtros pedidos bastam e evitam complexidade opcional.

## Validação focada
- Verificar saída automática de build/typecheck, sem executar builds manuais do projeto.
- Smoke autenticado em 390×844 e 412×915: radial 5x/Back/toque ativo, Biblioteca/Galeria/transições, logos/fallback, Sorteio 3x com imagens prontas, ficha série/modal, busca/filtro/prévia/Back e simulador até resultados.
- Confirmar simulador sem novas linhas Match e 45 demos intactas; QA não salva indicação, nota ou episódio nem apaga obra real.
- Feedback de nota validado isoladamente, sem persistência. Exclusão validada por código/estado sem teste destrutivo.
- Teclado/safe-area físicos Android e consentimento real com duas contas serão reportados como limites quando indisponíveis; Gemini pending pode ser exercitado com resposta controlada, sem alegar teste real de chave.

## Documentação final
Nota curta de conclusão no roadmap apenas após validação; manter futuros **pessoas clicáveis** e **apelido privado do parceiro** como não implementados. Registrar somente novas decisões estruturais indispensáveis em AGENTS.