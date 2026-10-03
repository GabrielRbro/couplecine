# Auditoria do Cinema Guide e plano de correção

## Como o teste foi feito
- Entrei com a sua conta e abri Início, Biblioteca, Adicionar, Galeria, Sortear, Match, Configurações, 2 séries e 2 filmes, em telas de 390x844 e 412x915 (Android maior), com toque ativado.
- Erros de console e de rede: nenhum nas duas telas.
- Layout shift (CLS): de 0 a 0,004 em todas as telas, ou seja, bom.
- Não deu para testar: login e onboarding do zero (já existe espaço criado) e qualquer coisa que dependa da parceira (ainda não há segunda conta).

## Pontos que você levantou

| Ponto | Resultado |
|---|---|
| Ícone de livro na Biblioteca e de foto na Galeria | Confirmado. Biblioteca usa `Library` (livros na estante), Galeria usa `Images` (fotos). |
| Match mostra votos do parceiro e matches antes do fim | Confirmado, na tela e no banco. |
| Match com ordem fixa e fluxo simples | Confirmado: mesma ordem nos dois aparelhos, sem lotes, sem meta, sem desfazer. |
| Início básico | Confirmado. Além disso, ficou só em "Carregando…" por mais de 3,5 s numa carga a frio. |
| Temporadas abaixo da Sinopse e acima do Elenco | Ordem correta (Progresso, Sinopse, Temporadas, Elenco). Os cards de episódio não têm resumo nem marcação de "próximo". |

---

## A) Críticos: regras e segurança

1. **Match revela o ritmo do parceiro e os matches ao vivo**
   - Evidência: a tela mostra "Parceiro · n/total" e a lista de Matches durante a votação. A função do banco `match_status` devolve a contagem de votos de cada pessoa e os matches a qualquer momento.
   - Área: `match.tsx`, função `private.match_status`.
   - Impacto: quebra o sigilo, que é a regra central do Match.
   - Mudança: o banco só revela matches quando a sessão estiver encerrada pelos dois. Durante a votação, não devolve nem contagem nem lista. Tirar da tela qualquer contagem do parceiro.

2. **Encerramento unilateral**
   - Evidência: um único toque em "Encerrar" fecha a sessão para o casal.
   - Impacto: viola a regra "revelar só quando os dois aceitarem encerrar".
   - Mudança: guardar o aceite de cada pessoa. A sessão só fecha e revela quando os dois tiverem aceitado. Iniciar outra sessão exige continuar ou abandonar a atual. O resultado mais recente substitui o anterior.

3. **Ordem fixa, sem lotes, sem desfazer**
   - Evidência: a lista de candidatos é gravada uma vez e percorrida na mesma ordem nos dois aparelhos.
   - Mudança:
     - ordem embaralhada por aparelho, com semente estável;
     - lote inicial de cerca de 15 obras, meta de cerca de 3 matches e continuação variável, com a lógica no banco;
     - desfazer apenas o último voto;
     - votos ❤️ hoje / 👎 não hoje, e o card mostra só os dados da obra.

4. **Lista de e-mails autorizados não é aplicada no primeiro acesso**
   - Evidência: o onboarding deixa qualquer conta Google criar um espaço novo (regras do banco: qualquer pessoa conectada pode criar um espaço).
   - Impacto: o app deixa de ser privado ao casal.
   - Mudança: só podem criar espaço as contas de uma lista de dono configurada, ou quem tiver convite. Quem não está na lista vê a tela "acesso não autorizado".

5. **Qualquer membro pode apagar obras e dados compartilhados**
   - Evidência: as regras de obras, indicações, sessões e episódios permitem apagar a qualquer membro.
   - Mudança: restringir a exclusão a quem criou o item. Indicações: cada um só remove a sua.

6. **Indicar de novo apaga e recria a indicação**
   - Evidência: `addWork` exclui a indicação antiga. Isso perde a data original de autoria e contraria "preservar autoria e data".
   - Mudança: manter o histórico (nova linha de indicação, sem apagar) e ajustar a lógica de "voltou para Indicações".

7. **Sorteio fora da regra**
   - Evidência: não repete-evita recusados na rodada, não distingue "sem resposta" de 😐 (os dois valem 1) e não tem a opção "nenhum viu / rever / qualquer".
   - Área: `watch.dice.tsx`.
   - Mudança: aplicar os pesos e opções definidos e excluir os recusados na mesma rodada.

## B) Polimento visual, animações e fluidez

1. **Ícones:** Biblioteca com ícone cinematográfico (claquete ou rolo de filme) e Galeria com film strip, em `AppShell.tsx`.
2. **Menu radial:** a posição está ok, mas falta animação escalonada (stagger), giro pipoca → X, resposta ao toque (escala) e fechamento com Esc ou voltar. Respeitar prefers-reduced-motion, que hoje não é tratado em lugar nenhum.
3. **Carregamento:** Início e demais telas mostram "Carregando…" em texto puro.
   - Trocar por skeletons de cards e pôsteres, sem salto de layout.
   - Acelerar a primeira carga: as consultas de espaço e de biblioteca rodam em sequência; dá para paralelizar e guardar cache.
4. **Transições de rota:** não existem. Adicionar fade e slide curto (150–200 ms) entre telas e na abertura dos detalhes.
5. **Sheets:** a escolha de reação em Adicionar e os editores de nota e reação abrem e fecham secos. Animar a subida e a descida da sheet e o fundo, e permitir arrastar para fechar.
6. **Feedback de toque:** botões e cards não reagem ao toque. Adicionar estado pressionado (leve escala ou opacidade) em cards, pílulas e botões.
7. **Alvos de toque abaixo de 40 px:**
   - "Voltar" (20x20) em Adicionar e Configurações;
   - "Buscar" (45x20);
   - pílulas Todos/Filmes/Séries (cerca de 30 px de altura) em Biblioteca, Galeria e Sortear;
   - abas da Biblioteca (36 px).
   - Mudança: área mínima de 44 px.
8. **Sobreposição no fim das telas:** o conteúdo do fim da página aparece por trás da barra inferior (visto no detalhe da série). Revisar o espaço inferior conforme a safe area e a altura real da barra.
9. **Duplicações:** o estilo de pílula está copiado em 3 telas e o cabeçalho com Voltar em 2. Extrair `FilterPills` e `PageHeader` para uniformizar.
10. **Início:** cards rápidos "Último Match" e "Importações" mostram "—" fixo. Ligar "Último Match" ao resultado revelado. Em "Continuar assistindo", adicionar barra de progresso, "Próximo TnEm" e o botão "Assistir na TV" (não configurado).

## C) Funcionalidades ainda incompletas (sem inventar além das regras)

1. **Detalhe de série:**
   - cards de episódio com resumo curto e destaque "próximo";
   - na barra de temporadas, abrir direto na temporada do próximo episódio.
2. **Detalhe:** mostrar autoria e data da indicação, com o histórico de quem indicou.
3. **Galeria:** filtros avançados (duração, ano, quem indicou, reações, histórico, notas).
4. **Descobrir:** feed individual com ➕ (🔥/👍/😐), ✓ Já assisti e ✕ dispensar, este último só no feed de quem dispensou.
5. **Importações:** sessões persistentes, pilha de pôsteres e validação no TMDB. Fica para uma etapa própria, depois dos blocos A e B.
6. **Busca:** a da Biblioteca procura só por título. Incluir título original, atores e diretores.
7. **TV e tracker:** seguem como "não configurado", conforme as regras.

## Ordem de execução sugerida
1. Bloco A, itens 1 a 3 (Match seguro), com as mudanças no banco e na tela.
2. Bloco A, itens 4 a 7.
3. Bloco B inteiro.
4. Bloco C, itens 1 a 3 e 6; depois Descobrir; depois Importações.

## Detalhes técnicos
- Match:
  - novas colunas ou tabela de aceite de encerramento por usuário (`match_close_acks`);
  - `match_status` passa a devolver só o estado da própria pessoa até o fechamento conjunto, e os matches só com `status='closed'`;
  - RPCs com SECURITY DEFINER no schema `private`: `match_next_batch` (lote adaptativo), `match_undo_last`, `match_close_ack`;
  - embaralhamento na tela com semente `hash(session_id + user_id)`.
- Allowlist: tabela `owner_allowlist` e trocar a policy `spaces_create` para exigir e-mail na lista; trigger ou policy em `space_members`.
- DELETE: policies separadas por tabela, exigindo `created_by = auth.uid()` ou `indicated_by = auth.uid()`.
- Animações: utilitários CSS em `styles.css` com `@media (prefers-reduced-motion)`; sheet reutilizável (vaul ou Drawer do shadcn).
- Todas as migrações são aditivas, sem apagar dados.
