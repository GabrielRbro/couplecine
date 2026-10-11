# POC: captura de Reel/TikTok com contas dedicadas

Este teste roda **fora do AppCinema**. Recebe um link, usa uma sessão de navegador
da conta exclusiva do sistema e devolve um JSON com a descrição, texto visível,
comentários, possíveis legendas, OCR de frames e transcrição quando o vídeo pode
ser obtido. Não grava no banco, não altera a publicação e não usa créditos do Lovable.

## Preparar numa máquina com navegador gráfico

```sh
cd tools/social-poc
npm ci
npx playwright install chromium
```

Opcional para as etapas de mídia: `tesseract` com idiomas `por` e `eng`, `yt-dlp`,
`ffmpeg` e `whisper-cli` com um modelo local (`WHISPER_MODEL=/caminho/modelo.bin`).
Se faltar algum programa, o JSON registra a etapa indisponível e as outras
continuam. Nenhuma chave do AppCinema ou do TMDB é necessária neste teste.

Crie contas específicas para esta função. Faça login diretamente no navegador
aberto pelo comando; o programa não recebe senha:

```sh
npm run login -- instagram
npm run login -- tiktok
```

Depois rode um link por vez:

```sh
npm run capture -- 'https://www.instagram.com/reel/Dcbr7-kKd9K/'
npm run capture -- 'https://www.tiktok.com/@perfil/video/1234567890123456789'
```

Se o navegador gráfico não estiver disponível, acrescente `--headless` ao fim do
comando de captura. O login inicial ainda exige interface gráfica. O JSON na
saída contém `status`, cada evidência coletada e o estado das etapas de vídeo e
áudio. Um link acessível no navegador pode, ainda assim, não disponibilizar a
mídia ao `yt-dlp`; esse resultado fica registrado sem inventar uma transcrição.

Perfis de navegador ficam em `.social-poc/profiles/`, ignorado pelo Git. Eles
contêm cookies de sessão; mantenha-os só na máquina do motor e nunca os envie
por chat. Vídeo, áudio e frames vão a uma pasta temporária que é apagada ao
final da execução. A POC limita vídeos a 60 MB, áudio a 60 segundos e a captura
a um link por execução. Não contorna desafios ou bloqueios da plataforma.

## Aceite do experimento

Execute links conhecidos com título na descrição, pelo menos um com pista no
vídeo/áudio e exemplos inconclusivos. Compare a evidência do JSON com o post
original. Somente depois dessa medição o worker será ligado às sessões do app;
nenhum resultado deste comando é importado automaticamente ao AppCinema.
