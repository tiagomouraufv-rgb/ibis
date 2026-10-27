# Leitor de Pesquisa: projeto Android (1.8.1)

Projeto do Android Studio que gera o APK do Leitor de Pesquisa. O app em si fica em
`app/src/main/assets/web` e é o mesmo da versão web. O código Android (`MainActivity.java`)
só abre o app e oferece as funções nativas:

- salvar arquivos pelo "Salvar como" do Android (Downloads, Drive, OneDrive…);
- compartilhar PDF, pacote do Obsidian e textos (Claude, e-mail, Drive…);
- abrir sites, Google Tradutor e Obsidian nos apps certos;
- microfone para notas de voz e gravação de sessão;
- leitura em voz alta com a voz do Android;
- abrir PDFs com "Abrir com…" ou "Compartilhar" a partir de outros apps;
- botão voltar do Android (fecha janelas e painéis antes de sair);
- login da conta Google para a sincronização pelo Google Drive (0.4.0);
- vídeo do YouTube em tela cheia e escolha de imagens pelo seletor do Android (0.5.0);
- botão lateral da S Pen como borracha (0.6.0);
- várias janelas (DeX: uma no tablet e outras no monitor), sincronizadas entre si (0.7.0);
- arrastar figura ou texto entre janelas e para outros apps (0.7.0);
- botões de página e de volume virando a página no e-ink (0.7.0);
- caneta rápida da Boox pelo kit da Onyx, experimental (0.7.0);
- compartilhar texto, caderno e PDF pelo menu do Android (1.0.0);
- mandar o trecho do PDF direto ao Acrobat ou ao NotebookLM e receber texto compartilhado de outros apps (1.1.0);
- ler e gravar na pasta do Syncthing escolhida pelo seletor de pastas do Android (lê `leitor-*.json`, grava só `app-*.json`), para as notas e a escrita irem e voltarem do reMarkable (1.4.0; gravar desde a 1.5.0).

Versões: Android Gradle Plugin 8.13.0, play-services-auth 22.0.0, Gradle 8.13, Java 17, compileSdk/targetSdk 36, minSdk 26.
Caneta rápida da Boox: onyxsdk-pen 1.4.11 e hiddenapibypass 4.3 (só quando `onyx=true` em `gradle.properties`).

## Assinatura (1.8.1)

O APK é gerado pelo GitHub Actions do repositório (arquivo `.github/workflows/apk.yml`), sempre com a mesma chave.
A chave não fica no código: vem dos Secrets `LEITOR_KEYSTORE_B64` e `LEITOR_KEYSTORE_PASS` (alias `leitor`, PKCS12).
SHA-1 da chave: `25:4D:5F:9C:E2:AB:4A:F4:60:CD:1F:AE:6B:A1:DD:72:5A:5D:15:84`.

## Caneta rápida da Boox (kit da Onyx): leia antes de compilar

- O kit da Onyx não fica no repositório padrão do Google. Ele vem do repositório da própria Onyx,
  `http://repo.boox.com/repository/maven-public/`, o endereço que a Onyx publica. Esse endereço é **http** (sem cadeado):
  em tese alguém na sua rede poderia trocar o arquivo no caminho. Para reduzir isso, o projeto só busca nesse
  endereço as bibliotecas da Onyx (`com.onyx…`), nada mais. Se preferir não usar, troque `onyx=true` por `onyx=false`
  em `gradle.properties` (o app compila sem a caneta rápida; o resto funciona igual, inclusive na Boox).
- Não consegui testar o kit da Onyx aqui (não tenho acesso ao repositório nem a uma Boox). Os nomes das funções seguem a
  documentação da Onyx (TouchHelper, RawInputCallback), mas alguns detalhes **não consegui confirmar**:
  o pacote exato da classe `TouchPoint` e se a versão 1.4.11 pede alguma inicialização extra no firmware da sua Boox.
- **Se a compilação falhar** com erros que citam `onyx`, `TouchPoint`, `TouchHelper` ou `repo.boox.com`:
  abra `gradle.properties`, troque `onyx=true` por `onyx=false`, clique em **Sync Now** e gere o APK de novo.
  Depois me mande o texto do erro para eu ajustar.
- No aparelho, se a caneta rápida falhar, o app avisa e volta sozinho para a caneta comum. Dá para desligar em
  Configurações → Geral → Aparelho e tela.

## Gerar o APK (no PC com Windows)

1. Instale o Android Studio (developer.android.com/studio), com as opções padrão.
2. Extraia este .zip numa pasta de caminho curto, sem acentos, por exemplo `C:\Projetos\LeitorPesquisa`.
3. No Android Studio: **File → Open** → escolha a pasta `LeitorPesquisa` (a que tem `settings.gradle`) → **Trust Project**.
4. Espere a sincronização terminar (barra de baixo). Se aparecer um aviso para instalar
   componentes ou aceitar licenças, clique no link do aviso e aceite.
   Se aparecer a sugestão de atualizar o "Android Gradle Plugin", recuse por enquanto.
5. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
6. Quando terminar, clique em **locate** no aviso. O arquivo é
   `app\build\outputs\apk\debug\app-debug.apk`.

## Instalar no tablet

1. Passe o `app-debug.apk` para o tablet (cabo USB, Google Drive ou e-mail).
2. No tablet, abra o arquivo pelo app **Meus Arquivos** (ou pelo Drive).
3. Se o Android pedir, permita **instalar apps desconhecidos** para esse app.
4. Toque em **Instalar**. Se o Play Protect avisar que o app não é verificado, toque em
   **Mais detalhes → Instalar mesmo assim** (o app foi gerado por você, sem passar pela loja).

## Instalar na Boox (Go 7 e Go Color 7)

É o mesmo APK. Passe o `app-debug.apk` para a Boox (cabo USB ou Drive), abra pelo gerenciador de arquivos e instale.
Para o login do Google (sincronização) funcionar na Boox, o Google Play precisa estar ativo no aparelho; o caminho
desse ajuste muda conforme o firmware, e **não consegui confirmar** onde fica no seu. Se o login falhar na Boox,
me diga a versão do firmware (Configurações da Boox → Sobre / Informações do aparelho).

## Atualizar

Gere o APK novo no mesmo PC e instale por cima: os dados continuam.
Gerado em outro PC, o Android exige desinstalar antes (e isso apaga os dados):
faça antes a cópia de segurança em Configurações.

## Sincronização: cadastrar o app Android no Google Cloud (uma vez)

O login do Google no app Android só funciona depois que o app é cadastrado no mesmo
projeto do Google Cloud usado na versão web (passo a passo completo no app:
Configurações → Guia → "Sincronização (Google Drive): preparar uma vez").
Para o cadastro, o Google pede a "impressão digital SHA-1" da chave que assina o seu APK.

**💻 No PC (Windows), para obter o SHA-1:**

1. Gere o APK pelo menos uma vez (isso cria a chave de depuração do Android Studio).
2. Abra o **PowerShell** (menu Iniciar → digite PowerShell → Enter).
3. Copie e cole o comando abaixo (uma linha só) e tecle Enter. Ele só **lê** a chave; não muda nada:

   ```
   & "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
   ```

4. Na resposta, copie o valor da linha **SHA1:** (algo como `AB:CD:12:…`, 20 pares).
5. No Google Cloud: Google Auth Platform → Clientes → Criar cliente → tipo **Android** →
   nome do pacote `com.tiago.leitorpesquisa` → cole o SHA-1 → Criar.

Se o comando disser que não achou o `keytool.exe`, o Android Studio está em outra pasta:
abra o Android Studio → **File → Settings → Build, Execution, Deployment → Build Tools → Gradle**
e veja o caminho do "Gradle JDK"; troque `C:\Program Files\Android\Android Studio\jbr` por ele.

Atenção: o SHA-1 é da chave **deste PC**. Se você gerar o APK em outro computador, cadastre
também o SHA-1 dele (pode haver mais de um cliente Android no mesmo projeto).

## Se der erro

Na aba **Build** (embaixo), copie a primeira mensagem em vermelho e envie para o Claude.
