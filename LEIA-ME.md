# Leitor de Pesquisa 0.3.0

App de leitura de PDF para o Galaxy Tab S11 (funciona no Chrome e pode ser instalado como app).
Seus PDFs, anotações, áudios e o Digest ficam guardados **só no tablet** (no armazenamento do Chrome).

## O que tem nesta versão

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
