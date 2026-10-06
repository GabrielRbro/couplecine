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

## Pendente
- [ ] Rodada 9: ficha modular única, camadas/overlays estáveis, séries, filtros/refino Match, roleta aleatória, logos, feedback/teclado e busca inteligente; validação focada.
- [ ] Consentimento duplo do Match e Match ativo com 2 membros (bloqueado: precisa da conta real do parceiro)
- [ ] Teste real do Gemini (bloqueado: nenhuma chave configurada)
- [ ] Tela de Importações (feature futura)
