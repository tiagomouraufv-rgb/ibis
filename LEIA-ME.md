# Leitor de Pesquisa 1.2.1

App de leitura de PDF para tablet, celular, Fold, DeX, computador e Boox (funciona no Chrome e pode ser instalado como app).
Seus PDFs, anotações, áudios e o Digest ficam guardados no aparelho (no armazenamento do Chrome) e, se você ligar a sincronização, numa pasta do **seu** Google Drive.

## O que tem nesta versão

- **Novo na 1.2.1:** Enviar ao reMarkable abre uma janela com **Salvar o PDF** (para mandar pelo computador) e **Compartilhar…**, e mostra quantas notas e trechos vão escondidos. O “Exportar PDF anotado” comum não leva as notas para o reMarkable.
- **Novo na 1.2.0:** **Enviar ao reMarkable** (menu ⋯ do documento na biblioteca, na janela Exportar e na exportação de textos): um PDF para o leitor nativo do reMarkable, com destaques e escrita desenhados (destaque com nota sai destacado e sublinhado) e, escondidos dentro dele, as notas digitadas e os trechos do Digest daquele documento. Com o RM2 Notas 0.9 e o RM2 Digest 0.3 no reMarkable, as notas aparecem sozinhas ao abrir o documento (nota de destaque na margem, adesiva no mesmo ponto) e os trechos entram no Digest de lá. Textos viram PDF com camada de texto (dá para selecionar e destacar no reMarkable); parágrafos longos são divididos entre páginas em vez de encolhidos.
- **Novo na 1.1.0:** botão IA na barra lateral: IA interna (perguntas com citação clicável das páginas), Adobe Acrobat e NotebookLM / Gemini, mandando o PDF inteiro, um capítulo, uma seção ou páginas, com ou sem as suas anotações (e vídeos do YouTube como fontes extras); a resposta volta como nota no Digest; melhor ajuste também em textos e cadernos; tabela periódica interativa e calculadoras de materiais (semicondutores, metais, Lorentz, Mie, pinça Rayleigh, Beer–Lambert, raios X).
- **Novo na 1.0.2:** links corrigidos (janela fechada ou minimizada não “some” com o link; com uma janela só, abre aqui ou lado a lado, à escolha); “Nova página” no fim do caderno e página nova automática ao escrever no fim; Delete apaga a seleção; depois de soltar uma forma volta para Selecionar; formas de óptica geométrica (lentes e espelhos com raios e imagem), hidrogênio (orbitais, P(r), níveis) e harmônicos esféricos, química e mais eletromagnetismo (onda E ⊥ B ⊥ k, linhas de campo, ímã, polarização…); categorias e formas suas (da seleção, de SVG ou de imagem); índice de refração atualizado toda semana; botão de melhor ajuste da tela.
- **Novo na 1.0.1:** formas giram, mudam de tamanho e se movem depois de feitas (alças na seleção; Girar 90° e Espelhar no menu; o laço pega a forma inteira com um toque); figuras e campos 2D também vão no PDF exportado; margem para escrever no modo artigo (uma faixa ao lado de cada coluna); índice de refração dos materiais (refractiveindex.info): n, k, ε, absorção e reflexão em qualquer λ, pela seleção de texto, pela calculadora ou com Alt+N.
- **Novo na 1.0.0:** barra de rolagem em cada coluna da biblioteca; caneta só escreve na folha de escrita dos textos (o dedo rola); desfazer/refazer passo a passo em PDF, caderno e texto (Ctrl+Z / Ctrl+Y); borracha por área com tamanho; formas (geométricas, perfis e campos de feixe — gaussiano, LG, HG, Bessel, Airy —, óptica, quântica, eletromagnetismo, física médica) e calculadora física (luz/espectro, Raman, feixe gaussiano, foco, pinças, física médica, unidades, constantes) no painel da direita; compartilhar texto, caderno ou PDF pelo menu do Android; favoritos; mover caixa de texto do caderno; escolha do outro lado da tela dividida (Recentes, Favoritos, Biblioteca, Projetos e busca) e arrastar dos recentes para abrir lado a lado; duração das notas de voz corrigida; notas de voz exportadas como som do Acrobat; notas do Adobe (destaques com comentário, notas adesivas, respostas, desenhos) convertidas ao abrir; modo artigo no estilo NeoReader (colunas iguais, com ajuste manual).
- **Novo na 0.8.0:** biblioteca em três colunas (PDFs, Cadernos, Textos) em ordem alfabética, com “Continuar”; projetos com ordem (A–Z, última edição, tipo) e pastas/subpastas; links de volta em todos os documentos (etiqueta “← origem” na página, faixa no topo dos textos, painéis Ligações e Anotações), incluindo links escritos em textos e caixas de caderno; mostrador de página com salto digitado (Ctrl+G); caixas de nota do Obsidian (13 tipos, recolhíveis) no texto e no sumário; folha de escrita à mão ao lado dos textos; modo artigo agora recorta o PDF em uma coluna por vez; “Copiar link desta página”; arrastar entre janelas no DeX corrigido; leitor no celular corrigido (página em branco); Boox mais leve.
- **Novo na 0.7.0:** o app se ajusta ao aparelho (celular e Fold fechado, Fold aberto e tablet, DeX e computador, Boox com e-ink P&B ou colorido); várias janelas sincronizadas na hora (DeX: uma no tablet e outras no monitor; link abre na outra janela); arrastar figura recortada ou texto selecionado para um caderno ou texto (tela dividida e entre janelas); e-ink com página que vira (toques, deslize, botões), limpeza da tela, modo colunas, página inteira; modo artigo (texto do PDF em parágrafos, letra ajustável); caneta rápida da Boox (experimental, no app Android); PDFs da sincronização baixados só ao abrir (opcional); links em tabelas só azuis e sublinhados.
- **Novo na 0.6.0:** escolha da IA (Claude ou Gemini) com custo por consulta; resumo por capítulo de livros e artigos longos; cartão do artigo citado (título, autores, resumo, citações) com “Ler depois” e aba “Para ler” nos projetos; aba Digest nos projetos; tela dividida com PDF, caderno ou texto (bordas cortadas, links do outro lado, troca rápida por lado); tradução gratuita em janela; links do caderno com símbolo e sublinhado; tamanho das imagens no texto; tabela por número.
- **Novo na 0.5.0:** documento de texto em Markdown (equações numeradas, tabelas, imagens/GIF, vídeo do YouTube, notas de voz, caixas de nota, links e sumário automático); botões (n) e ref que numeram e citam equações sozinhos; laço em forma livre que pega tudo o que está dentro; botão da S Pen e ponta-borracha apagam; GIFs animados no caderno.
- **Novo na 0.4.0:** sincronização pelo Google Drive (web e Android, com login da conta Google); capa estilo "composition book" com cor à escolha; barra de texto no topo e largura da caixa ajustável; painel de símbolos de matemática; links funcionando nos cadernos; troca rápida entre arquivos (dois dedos ou botão ⇆); filtro por projeto no Digest.
- Leitor de PDF com zoom por pinça, sumário do PDF, miniaturas, marcadores e busca.
- Cadernos (estilo GoodNotes): S Pen, caixas de texto em Markdown com equações LaTeX numeradas, imagens, áudio, laço, modelos de página; exporta PDF e Obsidian.
- Imagens no Digest (colar, arquivo) e recorte de equações/figuras do PDF.
- **Caneta só com a S Pen**: o dedo arrasta e dá zoom; a palma é ignorada enquanto a caneta escreve.
- Caneta (5 cores, 3 espessuras), marca-texto livre, borracha, desfazer/refazer.
- Destaques coloridos por tipo (Geral, Importante, Dúvida, Citar, Parâmetro), sublinhado e tachado.
- Notas digitadas e notas de voz; gravação de sessão sincronizada com a escrita.
- Margem expandida, páginas em branco inseridas, lado a lado, modos sépia e escuro.
- Links: para outra página, outro PDF, o Digest, uma nota do Obsidian ou um site; links de volta.
- Pré-visualização de referências e figuras ao tocar nos links internos do PDF.
- Digest com áreas hierárquicas, tags, continuação de trecho, nota de voz e "Revisar".
- Projetos, busca geral, dados do artigo pelo DOI (ABNT e BibTeX).
- Leitura em voz alta, Google Tradutor, IA (Gemini) e "Levar ao Claude".
- Exportar PDF anotado (editável ou achatado) e reimportar com tudo editável.
- Enviar ao Obsidian (nota única ou pacote .zip) e cópia de segurança.

## Como publicar no GitHub Pages (uma vez)

1. Entre em github.com com a sua conta.
2. Clique em **+** (canto superior direito) → **New repository**. Nome: `leitor`. Marque **Public**. Clique em **Create repository**.
3. Na página do repositório, clique em **uploading an existing file**.
4. Extraia este .zip no PC e arraste **o conteúdo da pasta** (index.html, app.css, js, vendor, icons, …) para a página. Clique em **Commit changes**.
5. Vá em **Settings** → **Pages**. Em *Branch*, escolha **main** e **/(root)** → **Save**.
6. Espere 1–2 minutos. O endereço aparece no topo: `https://SEU-USUARIO.github.io/leitor/`.

## Como instalar no tablet

1. No Galaxy Tab, abra esse endereço no **Chrome**.
2. Toque em **⋮** → **Adicionar à tela inicial** (ou **Instalar app**).
3. Abra pelo ícone "Leitor".

## Atualizar para uma versão nova

Repita os passos 3–4 do GitHub com os arquivos novos (substituindo os antigos). No tablet, feche e abra o app duas vezes.
